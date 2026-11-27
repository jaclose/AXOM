import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWritesSince,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
  localVaultStorage,
  resetLocalVaultRuntimeForTests,
  VAULT_STALL_COOLDOWN_MS,
  VAULT_WRITE_STALL_MS,
} from "./localVault";
import { STORAGE_KEYS } from "./brand";
import { readLastVaultWrite } from "./vaultActivity";

// Fault matrix (owner contract §14) for the write queue under one stalled,
// aborted or slow IndexedDB write. F2 is the 27 Nov "Saving…" freeze.

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};
const KEY = STORAGE_KEYS.persistedState;
const snapshot = (n: number) => JSON.stringify({ state: { profile: { userId: "learner" }, n }, version: 32 });

/** An IndexedDB whose open requests never answer, unless `answer` is called. */
function silentIndexedDb() {
  const requests: Array<{ request: IDBOpenDBRequest; answer: (db: IDBDatabase) => void }> = [];
  const open = vi.fn(() => {
    const request = {} as IDBOpenDBRequest;
    let result: IDBDatabase | undefined;
    Object.defineProperty(request, "result", { get: () => result });
    requests.push({ request, answer: (db) => { result = db; request.onsuccess?.call(request, {} as Event); } });
    return request;
  });
  return { factory: { open }, open, requests };
}

/** fake-indexeddb, with every successful open answered `delayMs` late. */
function slowIndexedDb(delayMs: number) {
  const open = vi.fn((name: string, version?: number) => {
    const real = version === undefined ? fakeIndexedDb.open(name) : fakeIndexedDb.open(name, version);
    const proxy = {} as IDBOpenDBRequest;
    Object.defineProperty(proxy, "result", { get: () => real.result });
    Object.defineProperty(proxy, "error", { get: () => real.error });
    real.onupgradeneeded = (event) => proxy.onupgradeneeded?.call(proxy, event as IDBVersionChangeEvent);
    real.onerror = (event) => proxy.onerror?.call(proxy, event);
    real.onblocked = (event) => proxy.onblocked?.call(proxy, event as IDBVersionChangeEvent);
    real.onsuccess = (event) => { setTimeout(() => proxy.onsuccess?.call(proxy, event), delayMs); };
    return proxy;
  });
  return { open };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  values.clear();
  resetLocalVaultRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a save whose IndexedDB never answers (F2)", () => {
  it("releases the write queue after the stall ceiling and keeps the save in the fallback", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const silent = silentIndexedDb();
    vi.stubGlobal("indexedDB", silent.factory);
    const checkpoint = getVaultWriteCheckpoint();
    let flushed = false;

    void localVaultStorage.setItem(KEY, snapshot(1));
    void flushLocalVaultWrites().then(() => { flushed = true; });
    await vi.advanceTimersByTimeAsync(VAULT_WRITE_STALL_MS - 1);
    expect(flushed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(flushed).toBe(true));
    expect(localStorage.getItem(KEY)).toBe(snapshot(1));
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(readLastVaultWrite()?.target).toBe("local-fallback");
  });

  it("sends later saves straight to the fallback while IndexedDB cools down", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const silent = silentIndexedDb();
    vi.stubGlobal("indexedDB", silent.factory);
    void localVaultStorage.setItem(KEY, snapshot(1));
    await vi.advanceTimersByTimeAsync(VAULT_WRITE_STALL_MS);
    await flushLocalVaultWrites();
    const opensAfterStall = silent.open.mock.calls.length;

    await localVaultStorage.setItem(KEY, snapshot(2));
    await flushLocalVaultWrites();

    expect(silent.open.mock.calls.length).toBe(opensAfterStall);
    expect(localStorage.getItem(KEY)).toBe(snapshot(2));

    // After the cooldown, IndexedDB is tried again.
    await vi.advanceTimersByTimeAsync(VAULT_STALL_COOLDOWN_MS);
    void localVaultStorage.setItem(KEY, snapshot(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(silent.open.mock.calls.length).toBeGreaterThan(opensAfterStall);
    // Let that attempt stall out too, so no write is left in the shared queue.
    await vi.advanceTimersByTimeAsync(VAULT_WRITE_STALL_MS);
    await flushLocalVaultWrites();
    expect(localStorage.getItem(KEY)).toBe(snapshot(3));
  });

  it("closes a connection that answers after it was abandoned, without writing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const silent = silentIndexedDb();
    vi.stubGlobal("indexedDB", silent.factory);
    void localVaultStorage.setItem(KEY, snapshot(1));
    await vi.advanceTimersByTimeAsync(VAULT_WRITE_STALL_MS);
    await flushLocalVaultWrites();

    const close = vi.fn();
    // A late read may still run; a late write must never open.
    const transaction = vi.fn<(stores: string, mode?: IDBTransactionMode) => IDBTransaction>(() => {
      throw new Error("no transaction in this fake");
    });
    const late = { version: 5, objectStoreNames: { contains: () => true }, close, transaction, onversionchange: null } as unknown as IDBDatabase;
    for (const pending of silent.requests) pending.answer(late);
    await vi.advanceTimersByTimeAsync(0);

    expect(transaction.mock.calls.filter(([, mode]) => mode === "readwrite")).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });
});

describe("a save whose transaction aborts (F3)", () => {
  it("does not hang the queue and keeps the save in the fallback", async () => {
    await localVaultStorage.getItem(KEY);
    const checkpoint = getVaultWriteCheckpoint();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      return {} as IDBRequest<IDBValidKey>;
    });

    await localVaultStorage.setItem(KEY, snapshot(1));
    await flushLocalVaultWrites();

    expect(localStorage.getItem(KEY)).toBe(snapshot(1));
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
  });
});

describe("a slow but healthy save (F4)", () => {
  it("lands in IndexedDB once, without a fallback or a repeated write", async () => {
    await localVaultStorage.getItem(KEY);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("indexedDB", slowIndexedDb(15_000));
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    let flushed = false;

    // fake-indexeddb works in real event-loop turns; only the open's answer is
    // held back on the fake clock, so the 15 s are the open, not the commit.
    const realTurns = async (limit: number) => {
      for (let turn = 0; turn < limit && !flushed; turn += 1) await new Promise((done) => setImmediate(done));
    };

    void localVaultStorage.setItem(KEY, snapshot(1));
    void flushLocalVaultWrites().then(() => { flushed = true; });
    await realTurns(20);
    expect(flushed).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    await realTurns(200);
    expect(flushed).toBe(true);

    expect(put.mock.calls.filter(([value]) => value === snapshot(1))).toHaveLength(2); // primary + profile copy
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readLastVaultWrite()?.target).toBe("indexeddb");
  });
});
