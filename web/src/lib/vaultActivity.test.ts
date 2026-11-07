// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";

const markerKey = STORAGE_KEYS.lastVaultWriteAt;
const savedAt = "2026-11-06T20:00:00.000Z";

/** Persisted v4 targets intentionally fail old clients' version-blind checks. */
const asStoredReceipt = <T extends { target: string; version: number }>(record: T): T =>
  record.version === 4
    ? { ...record, target: `axom-receipt-v4-${record.target}` } as T
    : record;

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
    const expected = { at: savedAt, target: "indexeddb", version: 4, scope: "workspace" };
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual(asStoredReceipt(expected));
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
    { at: savedAt, target: "indexeddb", version: 4, scope: "auxiliary" },
    { at: "not-a-date", target: "indexeddb", version: 4, scope: "workspace" },
    { at: savedAt, target: "cloud", version: 4, scope: "workspace" },
    { at: 1234, target: "indexeddb", version: 4, scope: "workspace" },
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
      at: shortlyAfter.toISOString(), target: "axom-receipt-v4-local-fallback", version: 4, scope: "workspace",
    });
  });

});

describe("cross-tab workspace marker consistency", () => {
  it("reconciles a silently replaced older valid marker while Settings is unmounted", async () => {
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    expect(readLastVaultWrite()?.at).toBe(savedAt);
    const replacement = { at: "2026-11-06T19:00:00.000Z", target: "local-fallback", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(replacement)));
    // No subscriber is active to receive a storage event.
    expect(readLastVaultWrite()).toEqual(replacement);
  });

  it("accepts a silent same-time marker target replacement", async () => {
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    expect(readLastVaultWrite()?.target).toBe("indexeddb");
    const replacement = { at: savedAt, target: "local-fallback", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(replacement)));
    expect(readLastVaultWrite()).toEqual(replacement);
  });

  it("retains a same-tab confirmed write while its optional marker is throttled", async () => {
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    markVaultWrite("indexeddb", new Date(savedAt));
    const persisted = window.localStorage.getItem(markerKey);
    const renewed = new Date(Date.parse(savedAt) + 250).toISOString();
    markVaultWrite("indexeddb", new Date(renewed));
    expect(window.localStorage.getItem(markerKey)).toBe(persisted);
    expect(readLastVaultWrite()?.at).toBe(renewed);
  });

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
    const valid = { at: savedAt, target: "indexeddb", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(valid)));
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
        at: savedAt, target: "indexeddb", version: 4, scope: "workspace",
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

  it("rejects stale prior metadata when a newer quota-only write has no channel, then permits immediate recovery", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
    const previous = { at: "2026-11-06T19:59:00.000Z", target: "indexeddb", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(previous)));
    const { markVaultWrite, readLastVaultWrite } = await import("./vaultActivity");
    const nativeSet = Storage.prototype.setItem;
    const reject = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("simulated metadata-only quota");
      return nativeSet.call(this, key, value);
    });
    try {
      markVaultWrite("indexeddb", new Date(savedAt));
      expect(readLastVaultWrite()).toBeNull();
      expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual(asStoredReceipt(previous));
    } finally {
      reject.mockRestore();
      if (descriptor) Object.defineProperty(window, "BroadcastChannel", descriptor);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    }
    // The next successful marker write should work even within the old 1s throttle.
    markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 100));
    expect(readLastVaultWrite()?.at).toBe("2026-11-06T20:00:00.100Z");
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null").at).toBe("2026-11-06T20:00:00.100Z");
  });

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

    const renewed = { at: "2026-11-06T20:01:00.000Z", target: "indexeddb", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(renewed)));
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
    const renewed = { at: "2026-11-06T20:02:00.000Z", target: "indexeddb", version: 4, scope: "workspace" };
    window.localStorage.setItem(markerKey, JSON.stringify(asStoredReceipt(renewed)));
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


describe("lifecycle receipts fail-closed", () => {
  it.each(["pagehide", "visibilitychange"] as const)(
    "drops a quota-only green receipt on %s when a suspended tab could miss invalidation",
    async (eventName) => {
      const channelDescriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
      class UnreliableChannel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
      Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: UnreliableChannel });
      const workspace = '{"synthetic":"bytes are never discarded"}';
      window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
      const vault = await import("./vaultActivity");
      const originalSet = Storage.prototype.setItem;
      const rejected = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
        if (key === markerKey) throw new Error("simulated marker-only quota error");
        return originalSet.call(this, key, value);
      });
      try { vault.markVaultWrite("indexeddb", new Date(savedAt)); }
      finally { rejected.mockRestore(); }
      expect(vault.readLastVaultWrite()?.at).toBe(savedAt);
      expect(window.localStorage.getItem(markerKey)).toBeNull();
      const notify = vi.fn();
      const unsub = vault.subscribeVaultWriteStatus(notify);
      const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
      if (eventName === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event("pagehide"));
      }
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(notify).toHaveBeenCalled();
      expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
      unsub();
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      else Reflect.deleteProperty(document, "visibilityState");
      if (channelDescriptor) Object.defineProperty(window, "BroadcastChannel", channelDescriptor);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    },
  );

  it("drops a quota-only receipt on a BFCache pageshow even if the hidden event was missed", async () => {
    const channelDescriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    class Channel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: Channel });
    const nativeSet = Storage.prototype.setItem;
    const rejected = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("optional metadata quota");
      return nativeSet.call(this, key, value);
    });
    try {
      const vault = await import("./vaultActivity");
      vault.markVaultWrite("indexeddb", new Date(savedAt));
      expect(vault.readLastVaultWrite()?.at).toBe(savedAt);
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(window.localStorage.getItem(markerKey)).toBeNull();
    } finally {
      rejected.mockRestore();
      if (channelDescriptor) Object.defineProperty(window, "BroadcastChannel", channelDescriptor);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    }
  });

  it("does not create an unverifiable quota-only badge when saving from a hidden tab", async () => {
    const channelDescriptor = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    class Channel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: Channel });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const nativeSet = Storage.prototype.setItem;
    const rejected = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("optional metadata quota");
      return nativeSet.call(this, key, value);
    });
    try {
      const vault = await import("./vaultActivity");
      vault.markVaultWrite("indexeddb", new Date(savedAt));
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(window.localStorage.getItem(markerKey)).toBeNull();
    } finally {
      rejected.mockRestore();
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      else Reflect.deleteProperty(document, "visibilityState");
      if (channelDescriptor) Object.defineProperty(window, "BroadcastChannel", channelDescriptor);
      else Reflect.deleteProperty(window, "BroadcastChannel");
    }
  });

  it("keeps a persisted workspace receipt through page suspension", async () => {
    const vault = await import("./vaultActivity");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const prior = vault.readLastVaultWrite();
    window.dispatchEvent(new Event("pagehide"));
    expect(vault.readLastVaultWrite()).toEqual(prior);
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual(asStoredReceipt(prior!));
  });
});


describe("account-scoped local save receipts", () => {
  it("writes opaque v4 for signed-in saves so old main and v2 clients cannot misattribute A to B", async () => {
    const workspace = JSON.stringify({ notes: "synthetic workspace remains untouched" });
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const raw = window.localStorage.getItem(markerKey);
    const saved = JSON.parse(raw ?? "null");
    expect(saved).toMatchObject({
      version: 4, scope: "workspace", accountId: "account-a",
      target: "axom-receipt-v4-indexeddb",
    });
    // The pre-stack main reader ignores version and accountId but insists
    // target === "indexeddb" or "local-fallback". Neither matches v4.
    expect(["indexeddb", "local-fallback"]).not.toContain(saved.target);
    // The #170 reader requires version 2 and also rejects the v4 receipt.
    // Never revert only to #172: its v2 writer is unsafe with a #170 reader.
    expect(saved.version === 2 && saved.scope === "workspace").toBe(false);
    vault.setVaultAccountIdentity("account-b");
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity(null);
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 1100));
    expect(vault.readLastVaultWrite()).toMatchObject({ accountId: "account-a", target: "indexeddb" });
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
  });

  it("does not trust old v3 or unsealed v4 markers even for the correct account", async () => {
    const workspace = '{"private":"unchanged"}';
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    for (const record of [
      { at: savedAt, target: "indexeddb", version: 3, scope: "workspace", accountId: "account-a" },
      { at: savedAt, target: "indexeddb", version: 4, scope: "workspace", accountId: "account-a" },
      { at: savedAt, target: "axom-receipt-v4-indexeddb", version: 4, scope: "workspace", accountId: "account-b" },
    ]) {
      window.localStorage.setItem(markerKey, JSON.stringify(record));
      expect(vault.readLastVaultWrite()).toBeNull();
    }
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 1100));
    expect(vault.readLastVaultWrite()).toMatchObject({
      accountId: "account-a", target: "indexeddb", version: 4,
    });
  });

  it("holds all v2 receipts while signed in, including forged account-tagged v2 markers", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    for (const marker of [
      { at: savedAt, target: "indexeddb", scope: "workspace", version: 2 },
      { at: savedAt, target: "indexeddb", scope: "workspace", version: 2, accountId: "account-a" },
    ]) {
      const raw = JSON.stringify(marker);
      window.localStorage.setItem(markerKey, raw);
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(window.localStorage.getItem(markerKey)).toBe(raw);
    }
    vault.setVaultAccountIdentity(null);
    // Account-tagged v2 remains untrusted even in local-only mode.
    expect(vault.readLastVaultWrite()).toBeNull();
  });

  it("reads an unscoped historical v2 receipt only while signed out without upgrading it", async () => {
    const workspace = '{"local-only":"preserve"}';
    const legacy = { at: savedAt, target: "local-fallback", scope: "workspace", version: 2 };
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    window.localStorage.setItem(markerKey, JSON.stringify(legacy));
    const vault = await import("./vaultActivity");
    expect(vault.readLastVaultWrite()).toEqual(legacy);
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity(null);
    // Once a signed-in account has been left, the old guest receipt is no
    // longer evidence of this session's current workspace. Its bytes remain.
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 5000));
    expect(vault.readLastVaultWrite()?.version).toBe(4);
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
  });

  it("does not reaccept account A's old badge after a completed A-B-A identity roundtrip", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const raw = window.localStorage.getItem(markerKey);
    expect(JSON.parse(raw ?? "null").accountId).toBe("account-a");
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-a");
    vault.setVaultAccountIdentity("account-b");
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity(null);
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 1100));
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-a");
  });
  it("holds unscoped historical markers for signed-in accounts while preserving them for local-only use", async () => {
    const legacy = { at: savedAt, target: "indexeddb", scope: "workspace", version: 2 };
    window.localStorage.setItem(markerKey, JSON.stringify(legacy));
    const vault = await import("./vaultActivity");
    expect(vault.readLastVaultWrite()).toEqual(legacy);
    vault.setVaultAccountIdentity("account-b");
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(markerKey) ?? "null")).toEqual(legacy);
  });
  it("does not attribute an A-origin queued save to a switched B session", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.setVaultAccountIdentity("account-b");
    vault.markVaultWrite("indexeddb", new Date(savedAt), "account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-b");
  });
  it("fails closed rather than keeping B green when an older A acknowledgement arrives", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-b");
    vault.markVaultWrite("local-fallback", new Date(savedAt));
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 50), "account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 100));
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-b");
  });
});


describe("account switch status invalidation safety", () => {
  it("retires an already completed A receipt across A-B-A without any queued write", async () => {
    const workspace = JSON.stringify({ notebook: "confirmed bytes must survive identity changes" });
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const prior = window.localStorage.getItem(markerKey);
    expect(prior).not.toBeNull();
    vault.setVaultAccountIdentity("account-a");
    expect(window.localStorage.getItem(markerKey)).toBe(prior);
    vault.setVaultAccountIdentity("account-b");
    expect(window.localStorage.getItem(markerKey)).toBeNull();
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 1100));
    expect(vault.readLastVaultWrite()).toMatchObject({
      accountId: "account-a", target: "indexeddb", at: "2026-11-06T20:00:01.100Z",
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
  });

  it("holds the old A receipt after identity switching even when marker removal and replacement are both denied", async () => {
    const workspace = '{"synthetic":"do not discard durable workspace"}';
    window.localStorage.setItem(STORAGE_KEYS.persistedState, workspace);
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const old = window.localStorage.getItem(markerKey);
    const nativeRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function(this: Storage, key: string) {
      if (key === markerKey) throw new Error("status removal denied");
      return nativeRemove.call(this, key);
    });
    const nativeSet = Storage.prototype.setItem;
    const replace = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("status replacement denied");
      return nativeSet.call(this, key, value);
    });
    try {
      vault.setVaultAccountIdentity("account-b");
      vault.setVaultAccountIdentity("account-a");
      expect(window.localStorage.getItem(markerKey)).toBe(old);
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(workspace);
    } finally {
      replace.mockRestore();
      remove.mockRestore();
    }
    vault.markVaultWrite("indexeddb", new Date(Date.parse(savedAt) + 1100));
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-a");
  });

  it("recognizes a matching persisted receipt on first signed-in identity hydration", async () => {
    const raw = JSON.stringify({
      at: savedAt, scope: "workspace", version: 4,
      target: "axom-receipt-v4-indexeddb", accountId: "account-a",
    });
    window.localStorage.setItem(markerKey, raw);
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toMatchObject({
      at: savedAt, target: "indexeddb", accountId: "account-a",
    });
    expect(window.localStorage.getItem(markerKey)).toBe(raw);
    // This tests initial metadata continuity, not actual workspace-revision equality.
  });

  it("does not revive a deleted workspace's marker if metadata removal was blocked across A-B-A", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWrite("indexeddb", new Date(savedAt));
    const raw = window.localStorage.getItem(markerKey);
    const nativeRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === markerKey) throw new Error("blocked metadata removal");
      return nativeRemove.call(this, key);
    });
    const nativeSet = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === markerKey) throw new Error("blocked metadata replacement");
      return nativeSet.call(this, key, value);
    });
    try { vault.invalidateVaultWrite(); }
    finally { set.mockRestore(); remove.mockRestore(); }
    expect(window.localStorage.getItem(markerKey)).toBe(raw);
    expect(vault.readLastVaultWrite()).toBeNull();
    vault.setVaultAccountIdentity("account-b");
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readLastVaultWrite()).toBeNull();
  });

  it("does not report a late A failure against the switched B identity", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.setVaultAccountIdentity("account-b");
    vault.markVaultWriteFailure(new Date(savedAt), "account-a");
    expect(vault.readVaultWriteFailure()).toBeNull();
    vault.markVaultWriteFailure(new Date(savedAt), "account-b");
    expect(vault.readVaultWriteFailure()).toBe(savedAt);
  });

  it("does not attribute a failed A save to B after an account switch", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWriteFailure(new Date(savedAt));
    expect(vault.readVaultWriteFailure()).toBe(savedAt);
    vault.setVaultAccountIdentity("account-b");
    expect(vault.readVaultWriteFailure()).toBeNull();
  });
});

describe("account session epoch for delayed writes", () => {
  it("does not credit an A write queued before A → B → A to the returned A session", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    const oldEpoch = vault.readVaultAccountEpoch();
    vault.setVaultAccountIdentity("account-b");
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readVaultAccountEpoch()).toBeGreaterThan(oldEpoch);

    vault.markVaultWrite("indexeddb", new Date(savedAt), "account-a", oldEpoch);
    expect(vault.readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(markerKey)).toBeNull();

    vault.markVaultWrite("indexeddb", new Date(savedAt), "account-a", vault.readVaultAccountEpoch());
    expect(vault.readLastVaultWrite()).toMatchObject({
      version: 4, accountId: "account-a", target: "indexeddb",
    });
  });

  it("does not report an old A failure after A → B → A, but reports a current A failure", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    const oldEpoch = vault.readVaultAccountEpoch();
    vault.setVaultAccountIdentity("account-b");
    vault.setVaultAccountIdentity("account-a");
    vault.markVaultWriteFailure(new Date(savedAt), "account-a", oldEpoch);
    expect(vault.readVaultWriteFailure()).toBeNull();
    vault.markVaultWriteFailure(new Date(savedAt), "account-a", vault.readVaultAccountEpoch());
    expect(vault.readVaultWriteFailure()).toBe(savedAt);
  });

  it("does not advance the epoch when the account identity is unchanged", async () => {
    const vault = await import("./vaultActivity");
    vault.setVaultAccountIdentity("account-a");
    const epoch = vault.readVaultAccountEpoch();
    vault.setVaultAccountIdentity("account-a");
    expect(vault.readVaultAccountEpoch()).toBe(epoch);
    vault.markVaultWrite("local-fallback", new Date(savedAt), "account-a", epoch);
    expect(vault.readLastVaultWrite()?.accountId).toBe("account-a");
  });
});

describe("real queued IndexedDB write status across A-B-A", () => {
  it("keeps stale write durable but suppresses its receipt, then restores fresh A receipt", async () => {
    const { indexedDB: fakeIndexedDb, IDBKeyRange } = await import("fake-indexeddb");
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const key = STORAGE_KEYS.persistedState;
    const oldWorkspace = JSON.stringify({ state: { profile: { userId: "jd" }, journal: "old session" }, version: 34 });
    const newWorkspace = JSON.stringify({ state: { profile: { userId: "jd" }, journal: "current session" }, version: 34 });
    const vault = await import("./vaultActivity");
    const local = await import("./localVault");
    try {
      vault.setVaultAccountIdentity("account-a");
      const pending = local.localVaultStorage.setItem(key, oldWorkspace);
      vault.setVaultAccountIdentity("account-b");
      vault.setVaultAccountIdentity("account-a");
      await pending;
      expect(await local.localVaultStorage.getItem(key)).toBe(oldWorkspace);
      expect(vault.readLastVaultWrite()).toBeNull();
      expect(window.localStorage.getItem(markerKey)).toBeNull();

      await local.localVaultStorage.setItem(key, newWorkspace);
      expect(vault.readVaultWriteFailure()).toBeNull();
      expect(vault.readLastVaultWrite()).toMatchObject({ accountId: "account-a", version: 4, target: "indexeddb" });
      expect(window.localStorage.getItem(markerKey)).not.toBeNull();
      expect(await local.localVaultStorage.getItem(key)).toBe(newWorkspace);
      expect(vault.readLastVaultWrite()).toMatchObject({ accountId: "account-a", version: 4 });
    } finally {
      vault.setVaultAccountIdentity(null);
      vi.unstubAllGlobals();
    }
  });
});
