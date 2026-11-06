// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";

const markerKey = STORAGE_KEYS.lastVaultWriteAt;
const savedAt = "2026-11-06T20:00:00.000Z";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("verified local workspace save timestamps across upgrades", () => {
  it.each(["indexeddb", "local-fallback"] as const)(
    "does not call a legacy %s auxiliary marker a confirmed workspace save",
    async (target) => {
      const legacy = JSON.stringify({ at: savedAt, target });
      const workspace = JSON.stringify({ state: { notebook: "keep" }, version: 1 });
      window.localStorage.setItem(markerKey, legacy);
      window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);

      const { readLastVaultWrite, readVaultWriteFailure } = await import("./vaultActivity");
      expect(readLastVaultWrite()).toBeNull();
      expect(readVaultWriteFailure()).toBeNull();
      expect(window.localStorage.getItem(markerKey)).toBe(legacy);
      expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
    },
  );

  it("persists a verified workspace write across a fresh module reload", async () => {
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    const expected = { at: savedAt, target: "indexeddb", version: 2, scope: "workspace" };
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual(expected);
    expect(readLastVaultWrite()).toEqual(expected);

    vi.resetModules();
    expect((await import("./vaultActivity")).readLastVaultWrite()).toEqual(expected);
  });

  it("recognizes a valid fallback but rejects a late legacy-tab marker", async () => {
    const { markVaultWrite } = await import("./vaultActivity");
    markVaultWrite("local-fallback", new Date(savedAt));
    vi.resetModules();
    expect((await import("./vaultActivity")).readLastVaultWrite()?.target).toBe("local-fallback");

    window.localStorage.setItem(markerKey, JSON.stringify({ at: savedAt, target: "indexeddb" }));
    vi.resetModules();
    expect((await import("./vaultActivity")).readLastVaultWrite()).toBeNull();
  });

  it.each([
    { at: savedAt, target: "indexeddb", version: 1, scope: "workspace" },
    { at: savedAt, target: "indexeddb", version: 2, scope: "auxiliary" },
    { at: "not-a-date", target: "indexeddb", version: 2, scope: "workspace" },
    { at: savedAt, target: "cloud", version: 2, scope: "workspace" },
    { at: 1234, target: "indexeddb", version: 2, scope: "workspace" },
    [],
    null,
  ])("rejects malformed/unverified metadata %#", async (record) => {
    window.localStorage.setItem(markerKey, JSON.stringify(record));
    expect((await import("./vaultActivity")).readLastVaultWrite()).toBeNull();
  });
  it("invalidates the marker without deleting a workspace and allows immediate renewal", async () => {
    const workspace = JSON.stringify({ state: { notebook: "preserve" } });
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    const { markVaultWrite, invalidateVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    expect(readLastVaultWrite()?.scope).toBe("workspace");
    expect(window.localStorage.getItem(markerKey)).not.toBeNull();

    invalidateVaultWrite();
    expect(readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);

    const shortlyAfter = new Date(new Date(savedAt).getTime() + 300);
    markVaultWrite("local-fallback", shortlyAfter);
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual({
      at: shortlyAfter.toISOString(), target: "local-fallback", version: 2, scope: "workspace",
    });
  });

});
