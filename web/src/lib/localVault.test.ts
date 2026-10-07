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
import { readVaultWriteFailure } from "./vaultActivity";

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

describe("a save that could not reach IndexedDB", () => {
  const key = STORAGE_KEYS.persistedState;
  const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });

  it("is read back at the next start instead of the older copy still in IndexedDB", async () => {
    // Regression: an old tab blocks the vault upgrade, so the save lands in
    // localStorage. The next start read IndexedDB first, returned the older
    // workspace, and the following save deleted the newer copy.
    const oldTab = await openVersionOneVault();
    await putDirect(oldTab, key, snapshot("older"));
    await localVaultStorage.setItem(key, snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    oldTab.close();

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    // Once the vault is writable the copy moves across and the fallback goes.
    await waitFor(async () => {
      await localVaultStorage.getItem(key);
      return localStorage.getItem(key) === null;
    });
    expect(localStorage.getItem(`${key}:fallback-newer`)).toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("keeps saving to the fallback while the upgrade stays blocked", async () => {
    // Regression: the browser queues later open requests behind the blocked
    // one in silence, so the second save never returned and nothing after it
    // was written anywhere.
    const oldTab = await openVersionOneVault();
    const saves = (async () => {
      await localVaultStorage.setItem(key, snapshot("first"));
      await localVaultStorage.setItem(key, snapshot("second"));
      await localVaultStorage.setItem(key, snapshot("third"));
    })();
    await expect(Promise.race([
      saves,
      new Promise((_, reject) => setTimeout(() => reject(new Error("a later save hung")), 500)),
    ])).resolves.toBeUndefined();
    expect(localStorage.getItem(key)).toBe(snapshot("third"));
    oldTab.close();

    // Once the other tab is gone the vault takes over again.
    await waitFor(async () => {
      await localVaultStorage.setItem(key, snapshot("fourth"));
      return localStorage.getItem(key) === null;
    });
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("fourth"));
  });

  it("stays readable from the fallback while IndexedDB is still not writable", async () => {
    const oldTab = await openVersionOneVault();
    await putDirect(oldTab, key, snapshot("older"));
    await localVaultStorage.setItem(key, snapshot("newer"));

    // The old tab is still open, so the copy cannot be moved across yet.
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    oldTab.close();
  });

  it("never lets an unmarked localStorage copy override the vault", async () => {
    // A copy mirrored by an older build carries no marker and may be stale.
    await localVaultStorage.setItem(key, snapshot("newer"));
    localStorage.setItem(key, snapshot("stale mirror"));

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("ignores a marker that does not describe the copy beside it", async () => {
    await localVaultStorage.setItem(key, snapshot("newer"));
    localStorage.setItem(key, snapshot("stale mirror"));
    localStorage.setItem(`${key}:fallback-newer`, "12:deadbeef");

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("is kept when only the per-profile duplicate ran out of room", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const scopedKey = `${key}:user:jd`;
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === scopedKey) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });
    const checkpoint = getVaultWriteCheckpoint();

    await localVaultStorage.setItem(key, snapshot("newer"));

    // The workspace itself is on disk, so this is a save, not a failure.
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("is reported while no store accepts it, and the report clears once saving works", async () => {
    await localVaultStorage.setItem(key, snapshot("saved"));
    expect(readVaultWriteFailure()).toBeNull();

    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", { ...storage, setItem: () => { throw new Error("QuotaExceededError"); } });
    await localVaultStorage.setItem(key, snapshot("lost"));
    expect(readVaultWriteFailure()).not.toBeNull();

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("localStorage", storage);
    await localVaultStorage.setItem(key, snapshot("saved again"));
    expect(readVaultWriteFailure()).toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("saved again"));
  });
});

async function waitFor(check: () => Promise<boolean>, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met in time.");
}

function putDirect(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
