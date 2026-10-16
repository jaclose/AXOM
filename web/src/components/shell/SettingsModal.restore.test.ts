// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import type { Store } from "../../lib/store";
import type { NoctyriumState } from "../../lib/types";
import { persistPortableRestore } from "./SettingsModal";

type Mode = "replace" | "merge";

function restoreHarness(mode: Mode) {
  const prior = makeSeed();
  prior.profile = { ...prior.profile, name: `Prior ${mode}` };
  const target: NoctyriumState = {
    ...makeSeed(),
    profile: { ...makeSeed().profile, name: `Recovered ${mode}` },
  };

  let live: Store;
  const replaceAll = vi.fn((next: NoctyriumState) => {
    live = { ...next, replaceAll } as unknown as Store;
  });
  const current = { ...prior, replaceAll } as unknown as Store;
  live = current;

  const rollback = vi.fn(async () => {});
  const restoreMedia = vi.fn(async () => ({ restored: 1, skipped: 0, rollback }));
  const restoreOriginals = vi.fn(async () => ({ restored: 1, skipped: 0 }));
  const flush = vi.fn(async () => {});
  const assertWritesSince = vi.fn();
  const maintainAttachments = vi.fn(async (): Promise<{ deletedOrphanBlobKeys: string[]; missingBlobKeys: string[] }> => ({ deletedOrphanBlobKeys: [], missingBlobKeys: [] }));
  const recordRestore = vi.fn();
  let checkpoint = 0;
  const services = {
    getState: () => live,
    getCheckpoint: vi.fn(() => checkpoint++),
    flush,
    assertWritesSince,
    maintainAttachments,
    recordRestore,
  };
  const run = () => persistPortableRestore({
    current,
    fileName: `${mode}.zip`,
    mode,
    restoredState: target,
    restoreMedia,
    restoreOriginals,
  }, services);

  return {
    current, target, run, replaceAll, restoreMedia, restoreOriginals, rollback,
    flush, assertWritesSince, maintainAttachments, recordRestore, services,
    getLive: () => live,
    setLive: (next: Store) => { live = next; },
  };
}

describe.each(["replace", "merge"] as const)("portable %s transaction", (mode) => {
  it("stages binaries, durably adopts the target, then records and maintains it", async () => {
    const h = restoreHarness(mode);
    const message = await h.run();

    expect(h.restoreMedia).toHaveBeenCalledBefore(h.replaceAll);
    expect(h.restoreOriginals).toHaveBeenCalledBefore(h.replaceAll);
    expect(h.replaceAll).toHaveBeenCalledTimes(1);
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.assertWritesSince).toHaveBeenCalledWith(0);
    expect(h.recordRestore).toHaveBeenCalledWith({
      kind: mode === "merge" ? "portable-merge" : "portable-restore",
      detail: `${mode}.zip`,
    });
    expect(h.recordRestore).toHaveBeenCalledBefore(h.maintainAttachments);
    expect(h.getLive().profile.name).toBe(`Recovered ${mode}`);
    expect(message).toMatch(new RegExp(`^${mode === "merge" ? "Merged" : "Restored"} ${mode}\\.zip\\. Saved on this device\\.`));
    expect(message).toContain("Restored 1 image attachment.");
    expect(message).toContain("Restored 1 original file.");
  });

  it("leaves the workspace untouched when media staging fails", async () => {
    const h = restoreHarness(mode);
    h.restoreMedia.mockRejectedValueOnce(new Error("media refused"));

    await expect(h.run()).rejects.toThrow(/Image files could not be prepared.*workspace was not changed/);
    expect(h.replaceAll).not.toHaveBeenCalled();
    expect(h.restoreOriginals).not.toHaveBeenCalled();
    expect(h.recordRestore).not.toHaveBeenCalled();
    expect(h.maintainAttachments).not.toHaveBeenCalled();
  });

  it("removes staged media when original-file preparation fails", async () => {
    const h = restoreHarness(mode);
    h.restoreOriginals.mockRejectedValueOnce(new Error("original refused"));

    await expect(h.run()).rejects.toThrow(/Original files could not be prepared.*workspace was not changed/);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.replaceAll).not.toHaveBeenCalled();
    expect(h.recordRestore).not.toHaveBeenCalled();
  });

  it("aborts and removes staged media when the captured workspace changes", async () => {
    const h = restoreHarness(mode);
    h.restoreOriginals.mockImplementationOnce(async () => {
      h.setLive({ ...h.current, profile: { ...h.current.profile, name: "Concurrent edit" } } as unknown as Store);
      return { restored: 1, skipped: 0 };
    });

    await expect(h.run()).rejects.toThrow(/workspace changed while preparing recovery/);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.replaceAll).not.toHaveBeenCalled();
    expect(h.recordRestore).not.toHaveBeenCalled();
  });

  it("restores and durably confirms the exact prior workspace when target saving fails", async () => {
    const h = restoreHarness(mode);
    h.assertWritesSince.mockImplementationOnce(() => { throw new Error("target save refused"); });

    await expect(h.run()).rejects.toThrow(/prior workspace was restored and confirmed on this device/);
    expect(h.replaceAll).toHaveBeenCalledTimes(2);
    expect(h.replaceAll.mock.calls[1][0].profile.name).toBe(`Prior ${mode}`);
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(h.assertWritesSince).toHaveBeenNthCalledWith(1, 0);
    expect(h.assertWritesSince).toHaveBeenNthCalledWith(2, 1);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.getLive().profile.name).toBe(`Prior ${mode}`);
    expect(h.recordRestore).not.toHaveBeenCalled();
    expect(h.maintainAttachments).not.toHaveBeenCalled();
  });

  it("states uncertainty when the prior workspace rollback cannot be confirmed", async () => {
    const h = restoreHarness(mode);
    h.assertWritesSince.mockImplementation(() => { throw new Error("vault unavailable"); });

    await expect(h.run()).rejects.toThrow(/could not confirm the prior workspace rollback.*Keep this tab open/);
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(h.assertWritesSince).toHaveBeenCalledTimes(2);
    expect(h.rollback).toHaveBeenCalledOnce();
    expect(h.recordRestore).not.toHaveBeenCalled();
  });

  it("keeps durable success when maintenance fails and reports cleanup as a warning", async () => {
    const h = restoreHarness(mode);
    h.maintainAttachments.mockRejectedValueOnce(new Error("attachment store blocked"));

    const message = await h.run();
    expect(message).toContain("Saved on this device.");
    expect(message).toContain("workspace is saved, but image cleanup could not finish");
    expect(h.recordRestore).toHaveBeenCalledOnce();
    expect(h.rollback).not.toHaveBeenCalled();
  });

  it("reports missing referenced media as success with a cleanup warning", async () => {
    const h = restoreHarness(mode);
    h.maintainAttachments.mockResolvedValueOnce({
      deletedOrphanBlobKeys: [],
      missingBlobKeys: ["missing-a", "missing-b"],
    });

    const message = await h.run();
    expect(message).toContain("Saved on this device.");
    expect(message).toContain("2 referenced image attachments are still missing");
    expect(h.recordRestore).toHaveBeenCalledOnce();
    expect(h.rollback).not.toHaveBeenCalled();
  });
});
