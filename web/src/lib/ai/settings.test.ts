// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import { loadAiSettings, saveAiSettings, type AiSettings } from "./settings";

const sample: AiSettings = {
  mode: "cloud",
  localEndpoint: "http://localhost:11434",
  localModel: "known-local-model",
  cloudProxyUrl: "https://obsolete.example/functions/v1/ai-proxy",
};

afterEach(() => vi.unstubAllGlobals());

describe("device-specific AI preference write receipts", () => {
  it("acknowledges only a byte-exact successful write and preserves other fields after reload", () => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => { items.set(key, value); },
      getItem: (key: string) => items.get(key) ?? null,
    });
    const reset: AiSettings = { ...sample, cloudProxyUrl: undefined };
    expect(saveAiSettings(reset)).toBe(true);
    expect(items.get(STORAGE_KEYS.aiSettings)).toBe(JSON.stringify(reset));
    expect(loadAiSettings()).toMatchObject({
      mode: "cloud",
      localEndpoint: "http://localhost:11434",
      localModel: "known-local-model",
    });
    expect(loadAiSettings().cloudProxyUrl).toBeUndefined();
  });

  it("refuses to acknowledge a silent no-op write, preserving the unsafe old preference", () => {
    const original = JSON.stringify(sample);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      setItem,
      getItem: () => original,
    });
    expect(saveAiSettings({ ...sample, cloudProxyUrl: undefined })).toBe(false);
    expect(setItem).toHaveBeenCalledOnce();
    expect(loadAiSettings().cloudProxyUrl).toBe(sample.cloudProxyUrl);
  });

  it("fails closed if device storage denies writes or readback", () => {
    const denied = () => { throw new DOMException("Blocked", "SecurityError"); };
    vi.stubGlobal("localStorage", {
      setItem: denied,
      getItem: () => JSON.stringify(sample),
    });
    expect(saveAiSettings({ ...sample, cloudProxyUrl: undefined })).toBe(false);
    vi.stubGlobal("localStorage", {
      setItem: vi.fn(),
      getItem: denied,
    });
    expect(saveAiSettings({ ...sample, cloudProxyUrl: undefined })).toBe(false);
  });
});
