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

describe("cross-tab workspace marker consistency", () => {
  it("invalidates a cached green save after another tab removes the marker and preserves workspace bytes", async () => {
    const preservedWorkspace = JSON.stringify({ state: { notes: "synthetic private draft untouched" } });
    window.localStorage.setItem(STORAGE_KEYS.persistedState, preservedWorkspace);
    const { markVaultWrite, readLastVaultWrite, subscribeVaultWriteStatus } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    expect(readLastVaultWrite()?.scope).toBe("workspace");

    const listener = vi.fn();
    const unsubscribe = subscribeVaultWriteStatus(listener);
    const previous = window.localStorage.getItem(markerKey);
    window.localStorage.removeItem(markerKey);
    window.dispatchEvent(new StorageEvent("storage", {
      key: markerKey, oldValue: previous, newValue: null, storageArea: window.localStorage,
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(preservedWorkspace);

    const shortlyAfter = new Date(Date.parse(savedAt) + 200);
    markVaultWrite("indexeddb", shortlyAfter);
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null").at).toBe(shortlyAfter.toISOString());
    unsubscribe();
    const count = listener.mock.calls.length;
    window.localStorage.removeItem(markerKey);
    window.dispatchEvent(new StorageEvent("storage", { key: markerKey, storageArea: window.localStorage }));
    expect(listener).toHaveBeenCalledTimes(count);
    // A hidden Settings panel must also notice absent metadata on its next read.
    expect(readLastVaultWrite()).toBeNull();
  });

  it("recognizes a remote verified save but holds legacy or invalid replacements", async () => {
    const { readLastVaultWrite, subscribeVaultWriteStatus } = await import("./vaultActivity");
    const listener = vi.fn();
    const unsubscribe = subscribeVaultWriteStatus(listener);
    const valid = { at: savedAt, target: "indexeddb", version: 2, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(valid));
    window.dispatchEvent(new StorageEvent("storage", {
      key: markerKey, newValue: JSON.stringify(valid), storageArea: window.localStorage,
    }));
    expect(readLastVaultWrite()).toEqual(valid);
    expect(listener).toHaveBeenCalledTimes(1);

    window.localStorage.setItem(markerKey, JSON.stringify({ at: savedAt, target: "indexeddb" }));
    window.dispatchEvent(new StorageEvent("storage", {
      key: markerKey, newValue: JSON.stringify({ at: savedAt, target: "indexeddb" }), storageArea: window.localStorage,
    }));
    expect(readLastVaultWrite()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("ignores unrelated and sessionStorage events but preserves unsaved-failure alerts", async () => {
    const { markVaultWrite, markVaultWriteFailure, readLastVaultWrite, readVaultWriteFailure, subscribeVaultWriteStatus } =
      await import("./vaultActivity");
    markVaultWrite("local-fallback", new Date(savedAt));
    const listener = vi.fn();
    const unsubscribe = subscribeVaultWriteStatus(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "other-cache", storageArea: window.localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key: markerKey, storageArea: window.sessionStorage }));
    expect(listener).not.toHaveBeenCalled();
    expect(readLastVaultWrite()?.target).toBe("local-fallback");

    const failureTime = new Date(Date.parse(savedAt) + 300);
    markVaultWriteFailure(failureTime);
    expect(listener).toHaveBeenCalledTimes(1);
    window.localStorage.removeItem(markerKey);
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: window.localStorage }));
    expect(readLastVaultWrite()).toBeNull();
    expect(readVaultWriteFailure()).toBe(failureTime.toISOString());
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("optional marker storage quota boundaries", () => {
  it("retains a verified in-process save with an active invalidation channel even if status metadata is blocked", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    class WorkingChannel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: WorkingChannel });
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    const rejected = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("simulated metadata-only quota rejection");
    });
    try {
      markVaultWrite("indexeddb", new Date(savedAt));
      expect(readLastVaultWrite()).toEqual({
        at: savedAt, target: "indexeddb", version: 2, scope: "workspace",
      });
    } finally {
      rejected.mockRestore();
      if (descriptor) Object.defineProperty(window, "BroadcastChannel", descriptor);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    }
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    // An absent marker is never promoted to persisted success on another load.
    vi.resetModules();
    expect((await import("./vaultActivity")).readLastVaultWrite()).toBeNull();
  });
  it.each(["missing", "constructor-rejected"] as const)(
    "never advertises quota-only saves when the cross-tab channel is %s",
    async (mode) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
      Object.defineProperty(window, "BroadcastChannel", {
        configurable: true,
        value: mode === "missing" ? undefined : class RejectedChannel {
          constructor() { throw new Error("simulated channel permission rejection"); }
        },
      });
      const workspace = '{"synthetic":"preserve original workspace bytes"}';
      window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
      const nativeSet = Storage.prototype.setItem;
      const reject = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
        if (key === markerKey) throw new Error("simulated optional status-only quota");
        return nativeSet.call(this, key, value);
      });
      try {
        const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
        markVaultWrite("indexeddb", new Date(savedAt));
        // The workspace write has completed. The badge cannot safely claim
        // current durability across tabs without either signalling channel.
        expect(readLastVaultWrite()).toBeNull();
        expect(window.localStorage.getItem(markerKey)).toBeNull();
        expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
        window.localStorage.removeItem(STORAGE_KEYS.persistedState);
        expect(readLastVaultWrite()).toBeNull();
      } finally {
        reject.mockRestore();
        if (descriptor) Object.defineProperty(window, "BroadcastChannel", descriptor);
        else Reflect.deleteProperty(window, "BroadcastChannel");
      }
    },
  );

});

describe("independent-review save-marker regressions", () => {
  it("recovers a renewed remote marker after invalidation while Settings was unmounted", async () => {
    const vault = await import("./vaultActivity");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const first = window.localStorage.getItem(markerKey);
    const unsubscribe = vault.subscribeVaultWriteStatus(vi.fn());
    window.localStorage.removeItem(markerKey);
    window.dispatchEvent(new StorageEvent("storage", {
      key: markerKey, oldValue: first, newValue: null, storageArea: window.localStorage,
    }));
    expect(vault.readLastVaultWrite()).toBeNull();
    unsubscribe();

    const renewed = { at: "2026-11-06T20:01:00.000Z", target: "indexeddb", version: 2, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(renewed));
    // No subscriber, so a normal StorageEvent would have no listener.
    expect(vault.readLastVaultWrite()).toEqual(renewed);
  });

  it("rejects an old persisted marker when invalidation could not remove it", async () => {
    const vault = await import("./vaultActivity");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const old = window.localStorage.getItem(markerKey);
    const nativeRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function(this: Storage, key: string) {
      if (key === markerKey) throw new Error("simulated remove blocked");
      return nativeRemove.call(this, key);
    });
    const nativeSet = Storage.prototype.setItem;
    const replace = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("simulated replacement blocked");
      return nativeSet.call(this, key, value);
    });
    try { vault.invalidateVaultWrite(); }
    finally { replace.mockRestore(); remove.mockRestore(); }
    expect(window.localStorage.getItem(markerKey)).toBe(old);
    expect(vault.readLastVaultWrite()).toBeNull();
    const renewed = { at: "2026-11-06T20:02:00.000Z", target: "indexeddb", version: 2, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(renewed));
    expect(vault.readLastVaultWrite()).toEqual(renewed);
  });

  it("invalidates a quota-only in-memory save across tab modules without a storage-key event", async () => {
    type FakeMessage = { data: unknown };
    class FakeChannel {
      static peers = new Set<FakeChannel>();
      onmessage: ((event: FakeMessage) => void) | null = null;
      constructor(readonly name: string) { FakeChannel.peers.add(this); }
      postMessage(data: unknown) {
        for (const peer of FakeChannel.peers) {
          if (peer !== this && peer.name === this.name) peer.onmessage?.({ data });
        }
      }
      close() { FakeChannel.peers.delete(this); }
    }
    const originalChannel = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: FakeChannel });
    try {
      const firstTab = await import("./vaultActivity");
      const nativeSet = Storage.prototype.setItem;
      const reject = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
        if (key === markerKey) throw new Error("simulated status-only quota");
        return nativeSet.call(this, key, value);
      });
      try { firstTab.markVaultWrite("indexeddb", new Date(savedAt)); }
      finally { reject.mockRestore(); }
      expect(firstTab.readLastVaultWrite()?.at).toBe(savedAt);
      expect(window.localStorage.getItem(markerKey)).toBeNull();

      vi.resetModules(); // independent runtime copy, representing the other tab
      const secondTab = await import("./vaultActivity");
      secondTab.invalidateVaultWrite();
      expect(firstTab.readLastVaultWrite()).toBeNull();
    } finally {
      if (originalChannel) Object.defineProperty(window, "BroadcastChannel", originalChannel);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    }
  });
});
