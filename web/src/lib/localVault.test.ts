import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWrite,
  assertVaultWritesSince,
  DB_VERSION,
  getVaultWriteCheckpoint,
  flushLocalVaultWrites,
  localVaultStorage,
  resetLocalVaultRuntimeForTests,
  VAULT_CONFLICT_MESSAGE,
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
  resetLocalVaultRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => vi.unstubAllGlobals());

describe("IndexedDB-first local vault", () => {
  it("prevents a stale second runtime from replacing a newer workspace", async () => {
    const key = STORAGE_KEYS.persistedState;
    const largeLibraryState = "source review ".repeat(90_000);
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label, largeLibraryState }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("shared base"));
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("shared base"));

    vi.resetModules();
    const secondTab = await import("./localVault");
    expect(await secondTab.localVaultStorage.getItem(key)).toBe(snapshot("shared base"));

    await localVaultStorage.setItem(key, snapshot("first tab edit"));
    await flushLocalVaultWrites();
    const staleCheckpoint = secondTab.getVaultWriteCheckpoint();
    await secondTab.localVaultStorage.setItem(key, snapshot("stale second tab edit"));
    await secondTab.flushLocalVaultWrites();

    expect(() => secondTab.assertVaultWritesSince(staleCheckpoint))
      .toThrow(secondTab.VAULT_CONFLICT_MESSAGE);
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("first tab edit"));
  });

  it("rejects a fallback save when another tab commits before its vault transaction", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("vault base"));

    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("fallback edit"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const competingTab = await openCurrentVault();
    let competingCommit: Promise<void> | null = null;
    const getItem = vi.spyOn(storage, "getItem").mockImplementation((name) => {
      const value = values.get(name) ?? null;
      if (name === key && competingCommit === null && values.has(markerKey)) {
        // This tab already read the valid marker. Before its IndexedDB
        // transaction starts, another tab commits and clears that fallback.
        competingCommit = putDirect(competingTab, key, snapshot("newer tab edit"));
        values.delete(markerKey);
      }
      return value;
    });

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("stale fallback tab edit"));
    await flushLocalVaultWrites();
    await competingCommit;
    const saved = await getDirect(competingTab, key);
    getItem.mockRestore();
    competingTab.close();

    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(saved).toBe(snapshot("newer tab edit"));
  });

  it("does not promote a fallback over a commit that wins before promotion", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("vault base"));

    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("fallback edit"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const competingTab = await openCurrentVault();
    let competingCommit: Promise<void> | null = null;
    const getItem = vi.spyOn(storage, "getItem").mockImplementation((name) => {
      const value = values.get(name) ?? null;
      if (name === key && competingCommit === null && values.has(markerKey)) {
        competingCommit = putDirect(competingTab, key, snapshot("newer tab edit"));
        values.delete(markerKey);
      }
      return value;
    });

    const hydrated = await localVaultStorage.getItem(key);
    await competingCommit;
    const saved = await getDirect(competingTab, key);
    getItem.mockRestore();
    competingTab.close();

    expect(hydrated).toBe(snapshot("newer tab edit"));
    expect(saved).toBe(snapshot("newer tab edit"));
  });

  it("promotes and keeps saving an auxiliary-key fallback after IndexedDB recovers", async () => {
    const key = STORAGE_KEYS.aiGenerations;
    const older = JSON.stringify({ schemaVersion: 1, generations: [{ id: "older" }] });
    const fallback = JSON.stringify({ schemaVersion: 1, generations: [{ id: "fallback" }] });
    const next = JSON.stringify({ schemaVersion: 1, generations: [{ id: "next" }] });

    await localVaultStorage.setItem(key, older);
    expect(await localVaultStorage.getItem(key)).toBe(older);

    const db = await openCurrentVault();
    try {
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, fallback);

      expect(await getDirect(db, key)).toBe(older);
      expect(localStorage.getItem(key)).toBe(fallback);
      expect(JSON.parse(localStorage.getItem(`${key}:fallback-newer`) ?? "null"))
        .toMatchObject({ version: 1, baseFingerprint: expect.any(String) });

      vi.stubGlobal("indexedDB", fakeIndexedDb);
      expect(await localVaultStorage.getItem(key)).toBe(fallback);
      expect(localStorage.getItem(key)).toBeNull();
      expect(await getDirect(db, key)).toBe(fallback);

      await localVaultStorage.setItem(key, next);
      await flushLocalVaultWrites();
      expect(await getDirect(db, key)).toBe(next);
      expect(await localVaultStorage.getItem(key)).toBe(next);
    } finally {
      db.close();
    }
  });

  it("keeps a confirmed vault save successful when optional localStorage metadata is full", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, value: "durable" } });
    const marker = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(readVaultWriteFailure()).toBeNull();
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    marker.mockRestore();
  });

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

  it("uses a viable localStorage fallback above the IndexedDB chunk threshold", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd", name: "JD" },
        documents: [{ id: "medium", rawText: "r".repeat(1_100_000) }],
      },
      version: 34,
    });

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);

    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
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

  it("requires the physical v4 upgrade before writing chunks and falls back while a v3 tab blocks it", async () => {
    const oldConnection = await openVersionThreeVault();
    const key = STORAGE_KEYS.persistedState;
    const base = JSON.stringify({ state: { profile: { userId: "jd" }, label: "v3 base" }, version: 34 });
    await putDirect(oldConnection, key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd" },
        documents: [{
          id: "private-review-large",
          fileType: "axom-private-bank-review",
          libraryOnly: true,
          rawText: "review source ".repeat(500_000),
        }],
      },
      version: 34,
    });
    const latest = persisted.replace("private-review-large", "private-review-latest");
    const checkpoint = getVaultWriteCheckpoint();
    await expect(Promise.race([
      localVaultStorage.setItem(key, persisted),
      new Promise((_, reject) => setTimeout(() => reject(new Error("setItem hung")), 500)),
    ])).resolves.toBeUndefined();
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await getDirect(oldConnection, key)).toBe(base);
    expect(localStorage.getItem(key)).toBe(persisted);

    await expect(Promise.race([
      localVaultStorage.setItem(key, latest),
      new Promise((_, reject) => setTimeout(() => reject(new Error("later setItem hung")), 500)),
    ])).resolves.toBeUndefined();
    expect(await getDirect(oldConnection, key)).toBe(base);
    expect(localStorage.getItem(key)).toBe(latest);
    oldConnection.close();

    // The next read promotes the fallback only after the v4 barrier can land.
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    await waitFor(async () => {
      await localVaultStorage.getItem(key);
      return localStorage.getItem(key) === null;
    });
    expect(localStorage.getItem(key)).toBeNull();
    const upgraded = await openCurrentVault();
    expect(upgraded.version).toBe(DB_VERSION);
    expect(JSON.parse((await getDirect(upgraded, key))!)).toMatchObject({
      format: "axom-local-vault-chunks",
      version: 1,
      length: latest.length,
    });
    upgraded.close();
  });

  it("does not let a v3 writer open after a chunked primary commits behind the v4 barrier", async () => {
    const key = STORAGE_KEYS.persistedState;
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, documents: [{ rawText: "x".repeat(1_100_000) }] },
      version: 34,
    });

    await localVaultStorage.setItem(key, persisted);
    await flushLocalVaultWrites();

    const current = await openCurrentVault();
    expect(current.version).toBe(4);
    expect(JSON.parse((await getDirect(current, key))!)).toMatchObject({ format: "axom-local-vault-chunks" });
    current.close();
    await expect(openVaultAtVersion(3)).rejects.toMatchObject({ name: "VersionError" });
    expect(await localVaultStorage.getItem(key)).toBe(persisted);
  });

  it("closes a late upgrade connection after the request already reported that it was blocked", async () => {
    const initialClose = vi.fn();
    const lateClose = vi.fn();
    const initialDb = {
      version: 1,
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(),
      close: initialClose,
      onversionchange: null,
    } as unknown as IDBDatabase;
    const lateDb = {
      close: lateClose,
      onversionchange: null,
    } as unknown as IDBDatabase;
    let openCount = 0;
    const open = vi.fn(() => {
      openCount += 1;
      if (openCount > 2) throw new Error("IndexedDB unavailable after blocked upgrade");
      const request = {} as IDBOpenDBRequest;
      Object.defineProperty(request, "result", { value: openCount === 1 ? initialDb : lateDb });
      if (openCount === 1) {
        queueMicrotask(() => {
          request.onupgradeneeded?.call(request, {} as IDBVersionChangeEvent);
          request.onsuccess?.call(request, {} as Event);
        });
      } else {
        queueMicrotask(() => {
          request.onblocked?.call(request, {} as IDBVersionChangeEvent);
          setTimeout(() => request.onsuccess?.call(request, {} as Event), 0);
        });
      }
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" } }, version: 34 });

    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(initialClose).toHaveBeenCalledOnce();
    expect(lateClose).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("round-trips the live-size private workspace through chunks across a fresh runtime", async () => {
    const key = STORAGE_KEYS.persistedState;
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd" },
        documents: [{
          id: "private-review-live-size",
          fileType: "axom-private-bank-review",
          libraryOnly: true,
          rawText: "r".repeat(17_561_151),
        }],
      },
      version: 34,
    });

    await localVaultStorage.setItem(key, persisted);
    await flushLocalVaultWrites();
    const db = await openCurrentVault();
    const manifest = JSON.parse((await getDirect(db, key))!) as { format: string; chunkCount: number; length: number };
    expect(manifest).toMatchObject({ format: "axom-local-vault-chunks", length: persisted.length });
    expect(manifest.chunkCount).toBeGreaterThan(16);
    expect(localStorage.getItem(key)).toBeNull();
    db.close();

    vi.resetModules();
    const freshRuntime = await import("./localVault");
    expect(await freshRuntime.localVaultStorage.getItem(key)).toBe(persisted);
  });
});

describe("a save that could not reach IndexedDB", () => {
  const key = STORAGE_KEYS.persistedState;
  const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });

  it("is read back at the next start instead of the older copy still in IndexedDB", async () => {
    // When IndexedDB is unavailable, the next start must not read its older
    // workspace ahead of the marked fallback and then delete the newer copy.
    await localVaultStorage.setItem(key, snapshot("older"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    // Once the vault is writable the copy moves across and the fallback goes.
    await waitFor(async () => {
      await localVaultStorage.getItem(key);
      return localStorage.getItem(key) === null;
    });
    expect(localStorage.getItem(`${key}:fallback-newer`)).toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("keeps saving to the fallback while IndexedDB stays unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
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
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    // Once IndexedDB is available the vault takes over again.
    await waitFor(async () => {
      await localVaultStorage.setItem(key, snapshot("fourth"));
      return localStorage.getItem(key) === null;
    });
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("fourth"));
  });

  it("stays readable from the fallback while IndexedDB is still not writable", async () => {
    await localVaultStorage.setItem(key, snapshot("older"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer"));

    // IndexedDB is still unavailable, so the copy cannot be moved across yet.
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);
  });

  it("never lets an unmarked localStorage copy override the vault", async () => {
    // A copy mirrored by an older build carries no marker and may be stale.
    await localVaultStorage.setItem(key, snapshot("newer"));
    localStorage.setItem(key, snapshot("stale mirror"));

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it.each(["workspace", "all"])("keeps the last successful fallback after %s writes run out of space", async (failure) => {
    await localVaultStorage.setItem(key, snapshot("older vault"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("saved fallback"));
    const checkpoint = getVaultWriteCheckpoint();
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (failure === "all" || name === key) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });

    await localVaultStorage.setItem(key, snapshot("unsaved change"));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/QuotaExceededError/);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("localStorage", storage);

    // A failed later save must not make the last successful save invisible.
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("saved fallback"));
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

function getDirect(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("state", "readonly").objectStore("state").get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}

function openCurrentVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVaultAtVersion(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVersionThreeVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
      if (!request.result.objectStoreNames.contains("backups")) request.result.createObjectStore("backups");
      if (!request.result.objectStoreNames.contains("questionAttachmentBlobs")) request.result.createObjectStore("questionAttachmentBlobs");
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
