// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsPanel } from "./AiSettingsPanel";

type TestSettings = {
  mode: "off" | "local" | "cloud" | "mock";
  localEndpoint: string;
  localModel?: string;
  cloudProxyUrl?: string;
};

const cloudUrl = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/ai-proxy";
const mocks = vi.hoisted(() => ({
  saved: { mode: "off", localEndpoint: "http://localhost:11434" } as TestSettings,
  save: vi.fn(),
  saveOk: true,
  health: vi.fn(async (settings: TestSettings) => ({
    ok: !settings.cloudProxyUrl || settings.cloudProxyUrl === cloudUrl,
    detail: settings.cloudProxyUrl && settings.cloudProxyUrl !== cloudUrl ? "Cloud AI is unavailable." : "AXOM Cloud AI ready.",
  })),
  detect: vi.fn(async () => ({ ok: false, detail: "No local model detected." })),
}));

vi.mock("../../lib/ai", () => ({
  DEFAULT_AI_SETTINGS: { mode: "off", localEndpoint: "http://localhost:11434" },
  loadAiSettings: () => ({ ...mocks.saved }),
  saveAiSettings: (settings: TestSettings) => {
    mocks.save(settings);
    if (!mocks.saveOk) return false;
    mocks.saved = { ...settings };
    return true;
  },
  cloudEndpoint: (settings: TestSettings) => (
    !settings.cloudProxyUrl || settings.cloudProxyUrl === cloudUrl ? cloudUrl : null
  ),
  checkProviderHealth: mocks.health,
  detectOllama: mocks.detect,
}));

beforeEach(() => {
  mocks.saved = {
    mode: "off",
    localEndpoint: "http://localhost:11434",
    localModel: "existing-local-model",
    cloudProxyUrl: "https://old-untrusted.example/functions/v1/ai-proxy",
  };
  mocks.save.mockClear();
  mocks.saveOk = true;
  mocks.health.mockClear();
  mocks.health.mockImplementation(async (settings: TestSettings) => ({
    ok: !settings.cloudProxyUrl || settings.cloudProxyUrl === cloudUrl,
    detail: settings.cloudProxyUrl && settings.cloudProxyUrl !== cloudUrl ? "Cloud AI is unavailable." : "AXOM Cloud AI ready.",
  }));
  mocks.detect.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cloud AI legacy destination recovery", () => {
  it("keeps an invalid saved destination blocked until the learner explicitly clears it", async () => {
    render(<AiSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /AXOM Cloud AI/ }));
    const warning = screen.getByRole("alert", { name: "Cloud AI connection blocked" });
    expect(warning.textContent).toMatch(/will not send your account token or study text/);
    expect(mocks.saved.cloudProxyUrl).toBe("https://old-untrusted.example/functions/v1/ai-proxy");
    await waitFor(() => expect(screen.getByText("Cloud AI is unavailable.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Use AXOM's verified server" }));
    expect(mocks.saved).toMatchObject({
      mode: "cloud",
      localEndpoint: "http://localhost:11434",
      localModel: "existing-local-model",
    });
    expect(mocks.saved.cloudProxyUrl).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ cloudProxyUrl: undefined }));
    expect(screen.queryByRole("alert", { name: "Cloud AI connection blocked" })).toBeNull();
    await waitFor(() => expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy());
    expect(mocks.health).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "cloud",
      cloudProxyUrl: undefined,
    }));
  });

  it("does not suggest a reset for an already trusted Cloud destination", async () => {
    mocks.saved = { mode: "cloud", localEndpoint: "http://localhost:11434", cloudProxyUrl: cloudUrl };
    render(<AiSettingsPanel />);
    expect(screen.queryByRole("button", { name: "Use AXOM's verified server" })).toBeNull();
    await waitFor(() => expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy());
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("ignores a delayed rejection from the obsolete destination after recovery", async () => {
    mocks.saved.mode = "cloud";
    let resolveOld: ((result: { ok: boolean; detail: string }) => void) | undefined;
    mocks.health.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<AiSettingsPanel />);
    expect(mocks.health).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Use AXOM's verified server" }));
    await waitFor(() => expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy());
    await act(async () => { resolveOld?.({ ok: false, detail: "Stale blocked destination" }); });
    expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy();
    expect(screen.queryByText("Stale blocked destination")).toBeNull();
  });

  it("keeps the old destination blocked and offers retry when storage refuses the reset", async () => {
    mocks.saved.mode = "cloud";
    mocks.saveOk = false;
    render(<AiSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Use AXOM's verified server" }));
    expect(mocks.saved.cloudProxyUrl).toBe("https://old-untrusted.example/functions/v1/ai-proxy");
    expect(screen.getByRole("alert", { name: "Cloud AI connection blocked" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/could not save the change/);
    expect(mocks.health).toHaveBeenCalledTimes(1);

    mocks.saveOk = true;
    fireEvent.click(screen.getByRole("button", { name: "Use AXOM's verified server" }));
    expect(mocks.saved.cloudProxyUrl).toBeUndefined();
    await waitFor(() => expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not mutate the Cloud destination when choosing Local or Off", () => {
    render(<AiSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Local \(Ollama\)/ }));
    expect(mocks.saved.cloudProxyUrl).toBe("https://old-untrusted.example/functions/v1/ai-proxy");
    expect(screen.queryByRole("alert", { name: "Cloud AI connection blocked" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Off/ }));
    expect(mocks.saved.cloudProxyUrl).toBe("https://old-untrusted.example/functions/v1/ai-proxy");
    expect(mocks.saved.localModel).toBe("existing-local-model");
  });

  it("does not display Off as saved when browser storage rejects a Cloud opt-out, and can retry", () => {
    mocks.saved = { mode: "cloud", localEndpoint: "http://localhost:11434" };
    mocks.saveOk = false;
    render(<AiSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Off/ }));
    expect(mocks.saved.mode).toBe("cloud");
    expect(screen.getByRole("button", { name: /AXOM Cloud AI/ }).className).toContain("on");
    expect(screen.getByRole("status").textContent).toMatch(/could not save/i);
    mocks.saveOk = true;
    fireEvent.click(screen.getByRole("button", { name: /^Off/ }));
    expect(mocks.saved.mode).toBe("off");
    expect(screen.getByRole("button", { name: /^Off/ }).className).toContain("on");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not falsely select Local or Demo when preference writes fail", () => {
    mocks.saved = { mode: "off", localEndpoint: "http://localhost:11434" };
    mocks.saveOk = false;
    render(<AiSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Local/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Demo/ }));
    expect(mocks.saved.mode).toBe("off");
    expect(screen.getByRole("button", { name: /^Off/ }).className).toContain("on");
    expect(screen.getByRole("status").textContent).toMatch(/could not save/i);
  });

  it("does not let a delayed Local probe override Cloud consent or Cloud health", async () => {
    mocks.saved = { mode: "local", localEndpoint: "http://localhost:11434" };
    let resolveLocal: ((result: { ok: boolean; detail: string; models: string[] }) => void) | undefined;
    mocks.detect.mockImplementationOnce(() => new Promise((resolve) => { resolveLocal = resolve; }));
    render(<AiSettingsPanel />);
    await waitFor(() => expect(mocks.detect).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /AXOM Cloud AI/ }));
    await waitFor(() => expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy());
    const savesAtCloud = mocks.save.mock.calls.length;
    await act(async () => {
      resolveLocal?.({ ok: true, detail: "Obsolete local endpoint succeeded.", models: ["wrong-model"] });
    });
    expect(mocks.saved.mode).toBe("cloud");
    expect(mocks.saved.localModel).toBeUndefined();
    expect(mocks.save.mock.calls.length).toBe(savesAtCloud);
    expect(screen.getByText("AXOM Cloud AI ready.")).toBeTruthy();
    expect(screen.queryByText("Obsolete local endpoint succeeded.")).toBeNull();
  });
});
