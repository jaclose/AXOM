import { describe, expect, it, vi } from "vitest";
import { createUpdateController, isDifferentWebBuild, UPDATE_CHECK_INTERVAL, UPDATE_DOWNLOAD_TIMEOUT, type NativeUpdate, type UpdateDependencies } from "./appUpdates";

function fixture(desktop = true) {
  const calls: string[] = [];
  const candidate: NativeUpdate = {
    version: "1.2.0", body: "Release notes",
    download: vi.fn(async (progress) => {
      calls.push("download");
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 60 } });
      progress({ event: "Progress", data: { chunkLength: 40 } });
      progress({ event: "Finished" });
    }),
    install: vi.fn(async () => { calls.push("install"); }),
    close: vi.fn(async () => undefined),
  };
  const deps: UpdateDependencies = {
    desktop, enabled: true, now: vi.fn(() => 1000), online: vi.fn(() => true),
    desktopConfigured: vi.fn(async () => true),
    checkNative: vi.fn(async () => candidate),
    checkWeb: vi.fn(async () => ({ version: "1.2.0", buildId: "build-2" })),
    checkpoint: vi.fn(async () => { calls.push("checkpoint"); }),
    activateWeb: vi.fn(async () => { calls.push("activate"); }),
    restart: vi.fn(async () => { calls.push("restart"); }),
    readDeferred: vi.fn(() => null), writeDeferred: vi.fn(),
  };
  return { controller: createUpdateController(deps), deps, candidate, calls };
}

describe("explicit app update lifecycle", () => {
  it("checks without downloading, then verifies download, checkpoints, installs, and restarts in order", async () => {
    const { controller, calls, candidate } = fixture();
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("available");
    expect(calls).toEqual([]);
    await controller.download();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", downloadedBytes: 100, totalBytes: 100 });
    expect(calls).toEqual(["download"]);
    expect(candidate.download).toHaveBeenCalledWith(expect.any(Function), { timeout: UPDATE_DOWNLOAD_TIMEOUT });
    await controller.apply();
    expect(calls).toEqual(["download", "checkpoint", "install", "restart"]);
  });

  it("refuses install/restart if the snapshot cannot be verified, and allows a safe retry", async () => {
    const { controller, deps, calls } = fixture();
    await controller.check();
    await controller.download();
    vi.mocked(deps.checkpoint).mockRejectedValueOnce(new Error("Vault is full"));
    await controller.apply();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "Vault is full" });
    expect(calls).toEqual(["download"]);
    await controller.apply();
    expect(calls).toEqual(["download", "checkpoint", "install", "restart"]);
  });

  it("does not install an unverified or incomplete download", async () => {
    const { controller, candidate, calls } = fixture();
    await controller.check();
    vi.mocked(candidate.download).mockRejectedValue(new Error("Signature verification failed"));
    await controller.download();
    await controller.apply();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(calls).toEqual([]);
  });

  it("retries a failed relaunch without reinstalling consumed native bytes", async () => {
    const { controller, deps, candidate, calls } = fixture();
    await controller.check();
    await controller.download();
    vi.mocked(deps.restart).mockRejectedValueOnce(new Error("Restart was blocked"));
    await controller.apply();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", restartPending: true, error: "Restart was blocked" });
    await controller.check(true);
    expect(candidate.close).not.toHaveBeenCalled();
    expect(deps.checkNative).toHaveBeenCalledTimes(1);
    await controller.apply();
    expect(candidate.install).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["download", "checkpoint", "install", "checkpoint", "restart"]);
  });

  it("rechecks workspace safety before retrying an installed update's restart", async () => {
    const { controller, deps, candidate } = fixture();
    await controller.check();
    await controller.download();
    vi.mocked(deps.restart).mockRejectedValueOnce(new Error("Restart was blocked"));
    await controller.apply();
    vi.mocked(deps.checkpoint).mockRejectedValueOnce(new Error("Workspace save failed"));
    await controller.apply();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", restartPending: true, error: "Workspace save failed" });
    expect(candidate.install).toHaveBeenCalledTimes(1);
    expect(deps.restart).toHaveBeenCalledTimes(1);
  });

  it("retains a verified download when checking again after a checkpoint failure", async () => {
    const { controller, deps, candidate } = fixture();
    await controller.check();
    await controller.download();
    vi.mocked(deps.checkpoint).mockRejectedValueOnce(new Error("Vault is full"));
    await controller.apply();
    await controller.check(true);
    expect(controller.hasDownloaded()).toBe(true);
    expect(candidate.close).not.toHaveBeenCalled();
    expect(deps.checkNative).toHaveBeenCalledTimes(1);
    await controller.apply();
    expect(candidate.install).toHaveBeenCalledTimes(1);
  });

  it("clears replaced candidate metadata when a manual check fails", async () => {
    const { controller, deps, candidate } = fixture();
    await controller.check();
    vi.mocked(deps.checkNative).mockRejectedValueOnce(new Error("Service unavailable"));
    await controller.check(true);
    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", version: undefined, notes: undefined, buildId: undefined });
    await controller.download();
    expect(candidate.download).not.toHaveBeenCalled();
  });

  it("disables unsigned local builds without contacting the update server", async () => {
    const { controller, deps } = fixture();
    vi.mocked(deps.desktopConfigured).mockResolvedValue(false);
    await controller.check(true);
    expect(controller.getSnapshot().phase).toBe("disabled");
    expect(deps.checkNative).not.toHaveBeenCalled();
  });

  it("retries on reconnect without an offline throttle and coalesces concurrent requests", async () => {
    const { controller, deps } = fixture();
    vi.mocked(deps.online).mockReturnValue(false);
    await controller.check();
    expect(deps.checkNative).not.toHaveBeenCalled();
    vi.mocked(deps.online).mockReturnValue(true);
    await Promise.all([controller.check(), controller.check(), controller.check(true)]);
    expect(deps.checkNative).toHaveBeenCalledTimes(1);
  });

  it("throttles automatic checks while a manual check bypasses the interval", async () => {
    const { controller, deps } = fixture();
    vi.mocked(deps.checkNative).mockResolvedValue(null);
    await controller.check();
    await controller.check();
    expect(deps.checkNative).toHaveBeenCalledTimes(1);
    await controller.check(true);
    expect(deps.checkNative).toHaveBeenCalledTimes(2);
    vi.mocked(deps.now).mockReturnValue(UPDATE_CHECK_INTERVAL + 1001);
    await controller.check();
    expect(deps.checkNative).toHaveBeenCalledTimes(3);
  });

  it("defers a build for this app session without losing the available update", async () => {
    const { controller, deps } = fixture(false);
    await controller.check();
    controller.defer();
    expect(deps.writeDeferred).toHaveBeenCalledWith("build-2");
    expect(controller.getSnapshot()).toMatchObject({ phase: "available", deferred: true });
  });

  it("web refresh checkpoints before activating a waiting worker, and does not invoke native installation", async () => {
    const { controller, calls, deps } = fixture(false);
    await controller.check();
    await controller.apply();
    expect(calls).toEqual(["checkpoint", "activate", "restart"]);
    expect(deps.desktopConfigured).not.toHaveBeenCalled();
  });

  it("retains the app if worker activation fails", async () => {
    const { controller, deps, calls } = fixture(false);
    await controller.check();
    vi.mocked(deps.activateWeb).mockRejectedValue(new Error("Worker staging failed"));
    await controller.apply();
    expect(calls).toEqual(["checkpoint"]);
    expect(controller.getSnapshot().phase).toBe("error");
  });

  it("retries refresh without activating an already activated web update", async () => {
    const { controller, deps, calls } = fixture(false);
    await controller.check();
    vi.mocked(deps.restart).mockRejectedValueOnce(new Error("Refresh was blocked"));
    await controller.apply();
    expect(controller.getSnapshot().restartPending).toBe(true);
    await controller.apply();
    expect(calls).toEqual(["checkpoint", "activate", "checkpoint", "restart"]);
  });

  it("will not apply stale web metadata after its replacement check fails", async () => {
    const { controller, deps } = fixture(false);
    await controller.check();
    vi.mocked(deps.checkWeb).mockRejectedValueOnce(new Error("Manifest unavailable"));
    await controller.check(true);
    await controller.apply();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(deps.checkpoint).not.toHaveBeenCalled();
    expect(deps.activateWeb).not.toHaveBeenCalled();
    expect(deps.restart).not.toHaveBeenCalled();
  });
});

describe("web build identity", () => {
  it("detects same-version deployments but ignores identical or absent identities", () => {
    expect(isDifferentWebBuild({ version: "1.0.0", buildId: "new" }, "1.0.0", "old")).toBe(true);
    expect(isDifferentWebBuild({ version: "1.0.0", buildId: "same" }, "1.0.0", "same")).toBe(false);
    expect(isDifferentWebBuild({ version: "1.0.0" }, "1.0.0", "old")).toBe(false);
    expect(isDifferentWebBuild({ version: "0.9.0" }, "1.0.0", "old")).toBe(true);
  });
});
