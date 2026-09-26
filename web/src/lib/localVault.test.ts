import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWrite,
  assertVaultWritesSince,
  getVaultWriteCheckpoint,
  flushLocalVaultWrites,
  localVaultStorage,
  writeLocalFallback,
} from "./localVault";
import { STORAGE_KEYS } from "./brand";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

beforeEach(async () => {
  values.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => vi.unstubAllGlobals());

describe("IndexedDB-first local vault", () => {
  it("coalesces a burst of saves: the newest snapshot wins and nothing older lands after it", async () => {
    const snapshot = (n: number) => JSON.stringify({ state: { profile: { userId: "jd" }, n }, version: 32 });
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const saves = [1, 2, 3, 4, 5].map((n) => localVaultStorage.setItem(STORAGE_KEYS.persistedState, snapshot(n)));
    await Promise.all(saves);
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(snapshot(5));
    // The first save was already in flight; 2–4 were superseded before writing.
    const written = put.mock.calls.map(([value]) => value).filter((value) => typeof value === "string" && value.startsWith("{"));
    expect(new Set(written)).toEqual(new Set([snapshot(1), snapshot(5)]));
    put.mockRestore();
  });


  it("stores the large workspace in IndexedDB and keeps only a small profile pointer in localStorage", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" }, questions: [{ id: "q1" }] }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.persistedState}:active-user`)).toBe("jd");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("uses the full localStorage fallback only when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" } }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("rejects instead of claiming durability when neither storage path is available", () => {
    const persisted = JSON.stringify({ state: { questions: [{ id: "not-durable" }] }, version: 32 });

    expect(() => writeLocalFallback(null, STORAGE_KEYS.persistedState, persisted, ""))
      .toThrow(/no local storage fallback/i);
  });

  it("records an adapter failure for operations that explicitly require durability", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    const checkpoint = getVaultWriteCheckpoint();

    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "not-durable");

    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/no local storage fallback/i);
  });

  it("attributes durability failure to the exact adapter write sequence", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "durable");
    const durableSequence = checkpoint + 1;

    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "not-durable");
    const failedSequence = durableSequence + 1;

    expect(() => assertVaultWrite(durableSequence)).not.toThrow();
    expect(() => assertVaultWrite(failedSequence)).toThrow(/no local storage fallback/i);
  });

  it("removes primary, profile pointer, and scoped IndexedDB records together", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" } }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await localVaultStorage.removeItem(STORAGE_KEYS.persistedState);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.persistedState}:active-user`)).toBeNull();
  });

  it("falls back deterministically instead of hanging when a v2 upgrade is blocked by an old tab", async () => {
    const oldConnection = await openVersionOneVault();
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, questions: [{ id: "safe" }] }, version: 32 });
    await expect(Promise.race([
      localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted),
      new Promise((_, reject) => setTimeout(() => reject(new Error("setItem hung")), 500)),
    ])).resolves.toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    oldConnection.close();
  });
});

function openVersionOneVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
