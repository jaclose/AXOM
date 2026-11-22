import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import {
  createLocalBackup,
  listLocalBackups,
  pruneLocalBackups,
  readLocalBackup,
  resetLocalBackupRuntimeForTests,
} from "./localBackup";
import { BACKUP_STORE_NAME, DB_NAME, DB_VERSION, localVaultStorage, STORE_NAME } from "./localVault";
import { makeSeed } from "./seed";
import { inspectLocalWorkspaceBackup } from "./storageRecovery";

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
  resetLocalBackupRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("automatic local migration backups", () => {
  it("uses the canonical vault version and object stores shared with primary persistence", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, questions: [{ id: "q1" }] }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await createLocalBackup(31);

    const db = await openDatabase(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([STORE_NAME, BACKUP_STORE_NAME]));
    db.close();
  });

  it("stores the full snapshot in IndexedDB and only summary metadata in localStorage", async () => {
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd", name: "JD" }, questions: [{ id: "q1", stem: "large payload" }] },
      version: 32,
    });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);

    const key = await createLocalBackup(31);
    expect(key).toBeTruthy();
    const marker = JSON.parse(localStorage.getItem(key!)!) as { storage: string; oldSchemaVersion: number; sizeBytes: number };
    expect(marker).toMatchObject({ storage: "indexeddb", oldSchemaVersion: 31 });
    expect(marker.sizeBytes).toBeGreaterThan(0);
    expect(localStorage.getItem(key!)).not.toContain("large payload");

    const recovered = await readLocalBackup(key!);
    expect(recovered?.indexedDb?.records[STORAGE_KEYS.persistedState]).toBe(persisted);
    expect(listLocalBackups()).toHaveLength(1);
  });

  it("keeps a successful IndexedDB backup recoverable when the rich localStorage marker exceeds quota", async () => {
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: "q1", stem: "marker quota payload" }] },
      version: 34,
    });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    const localWrites = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name.startsWith(STORAGE_KEYS.localBackupPrefix) && value.includes('"storage":"indexeddb"')) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      values.set(name, String(value));
    });

    const key = await createLocalBackup(34);

    expect(key).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key!)!)).toEqual([
      "idb",
      34,
      expect.any(String),
      expect.any(String),
    ]);
    expect(localWrites.mock.calls.some(([, value]) => value.includes("marker quota payload"))).toBe(false);
    expect((await readLocalBackup(key!))?.indexedDb?.records[STORAGE_KEYS.persistedState]).toBe(persisted);

    // The compact marker is persistent, not just an in-memory escape hatch.
    resetLocalBackupRuntimeForTests();
    expect(listLocalBackups()).toEqual([expect.objectContaining({ key, oldSchemaVersion: 34 })]);
    expect(await readLocalBackup(key!)).not.toBeNull();
    localWrites.mockRestore();
  });

  it("keeps the durable backup listed in-session when localStorage rejects every marker", async () => {
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: "q1", stem: "fully blocked marker" }] },
      version: 34,
    });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    const localWrites = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      values.set(name, String(value));
    });

    const key = await createLocalBackup(34);

    expect(key).toBeTruthy();
    expect(localStorage.getItem(key!)).toBeNull();
    expect(listLocalBackups()).toEqual([expect.objectContaining({ key, oldSchemaVersion: 34 })]);
    expect((await readLocalBackup(key!))?.indexedDb?.records[STORAGE_KEYS.persistedState]).toBe(persisted);
    expect(localWrites.mock.calls.some(([, value]) => value.includes("fully blocked marker"))).toBe(false);
    localWrites.mockRestore();
  });

  it("discovers durable backup metadata after a module reload when every localStorage marker failed", async () => {
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: "q1", stem: "reload-safe metadata" }] },
      version: 34,
    });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    const localWrites = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        throw new DOMException("Full", "QuotaExceededError");
      }
      values.set(name, String(value));
    });
    const key = await createLocalBackup(34);
    expect(key).toBeTruthy();
    expect(localStorage.getItem(key!)).toBeNull();

    vi.resetModules();
    const reloaded = await import("./localBackup");
    const discovered = await reloaded.refreshLocalBackupSummaries();

    expect(discovered).toEqual([expect.objectContaining({ key, oldSchemaVersion: 34 })]);
    expect((await reloaded.readLocalBackup(key!))?.indexedDb?.records[STORAGE_KEYS.persistedState]).toBe(persisted);
    localWrites.mockRestore();
  });

  it("falls back promptly when an older open vault blocks the backup-store upgrade", async () => {
    const oldConnection = await openVersionOneVault();
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: "q1", stem: "upgrade blocked" }] },
      version: 34,
    });
    await putState(oldConnection, STORAGE_KEYS.persistedState, persisted);
    const opens = vi.spyOn(fakeIndexedDb, "open");

    const result = await Promise.race([
      createLocalBackup(34),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 250)),
    ]);

    expect(result).not.toBe("timed-out");
    const key = result as string;
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ oldSchemaVersion: 34 });
    expect(opens.mock.calls.filter(([, version]) => version === DB_VERSION)).toHaveLength(1);

    oldConnection.close();
    const upgraded = await openDatabase(DB_NAME);
    expect(upgraded.version).toBe(DB_VERSION);
    upgraded.close();
    opens.mockRestore();
  });

  it("uses distinct keys for same-millisecond chunked backups and prunes every old chunk", async () => {
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd" },
        documents: [{ id: "large", rawText: "private source ".repeat(120_000) }],
      },
      version: 34,
    });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    vi.stubGlobal("CompressionStream", undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T20:45:00.000Z"));

    const first = await createLocalBackup(33, 8);
    const second = await createLocalBackup(34, 8);

    expect(first).toBe(`${STORAGE_KEYS.localBackupPrefix}2026-10-23T20:45:00.000Z`);
    expect(second).toBe(`${STORAGE_KEYS.localBackupPrefix}2026-10-23T20:45:00.001Z`);
    const db = await openDatabase(DB_NAME);
    const before = await getStoreKeys(db, BACKUP_STORE_NAME);
    expect(before.some((key) => key.startsWith(`${first}:chunks:`))).toBe(true);
    expect(before.some((key) => key.startsWith(`${second}:chunks:`))).toBe(true);
    db.close();

    await pruneLocalBackups(1);
    const pruned = await openDatabase(DB_NAME);
    const after = await getStoreKeys(pruned, BACKUP_STORE_NAME);
    expect(after.some((key) => key === first || key.includes(first!))).toBe(false);
    expect(after.some((key) => key === second || key.includes(second!))).toBe(true);
    pruned.close();
    expect(await readLocalBackup(first!)).toBeNull();
    expect(await readLocalBackup(second!)).not.toBeNull();
    now.mockRestore();
  });

  it("uses an existing backup store without forcing an upgrade or copying a large workspace into localStorage", async () => {
    const oldConnection = await openVersionTwoVault();
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd", name: "JD" },
        documents: [{
          id: "private-review-large",
          fileType: "axom-private-bank-review",
          libraryOnly: true,
          rawText: "review source ".repeat(500_000),
        }],
      },
      version: 34,
    });
    await putState(oldConnection, STORAGE_KEYS.persistedState, persisted);
    const localWrites = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (value.length > 1_000) throw new DOMException("Full", "QuotaExceededError");
      values.set(name, String(value));
    });
    // Force the realistic worst case where a large private snapshot cannot be
    // compressed before it reaches the IndexedDB value boundary.
    vi.stubGlobal("CompressionStream", undefined);

    const key = await createLocalBackup(34);

    expect(key).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key!)!)).toMatchObject({ storage: "indexeddb" });
    expect(localWrites.mock.calls.some(([, value]) => value.includes("review source"))).toBe(false);
    expect(JSON.parse((await getStoredValue(oldConnection, BACKUP_STORE_NAME, key!))!)).toMatchObject({
      format: "axom-local-backup-chunks",
      version: 1,
      length: expect.any(Number),
      chunkCount: expect.any(Number),
    });
    expect((await readLocalBackup(key!))?.indexedDb?.records[STORAGE_KEYS.persistedState]).toBe(persisted);
    expect((await getStoreKeys(oldConnection, BACKUP_STORE_NAME)).filter((storedKey) => storedKey.includes(":chunks:")))
      .not.toHaveLength(0);
    expect(listLocalBackups()).toHaveLength(1);
    await pruneLocalBackups(0);
    expect(await getStoreKeys(oldConnection, BACKUP_STORE_NAME)).toEqual([]);
    expect(await readLocalBackup(key!)).toBeNull();
    localWrites.mockRestore();
    oldConnection.close();
  });

  it("prunes both metadata and IndexedDB payloads to the requested retention limit", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, questions: [{ id: "q1" }] }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    const older = await createLocalBackup(30, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createLocalBackup(31, 1);

    expect(listLocalBackups().map((backup) => backup.key)).toEqual([newer]);
    expect(await readLocalBackup(older!)).toBeNull();
    expect(await readLocalBackup(newer!)).not.toBeNull();
  });

  it("keeps a recoverable full localStorage snapshot when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "fallback" }] } }));
    const key = await createLocalBackup(31);
    const raw = localStorage.getItem(key!);
    expect(raw).toContain("fallback");
    expect((await readLocalBackup(key!))?.oldSchemaVersion).toBe(31);
  });

  it("stores and verifies a compressed fallback when the plain snapshot exceeds the remaining per-write capacity", async () => {
    const failure = new DOMException("Synthetic vault quota", "QuotaExceededError");
    vi.stubGlobal("indexedDB", { open: () => { throw failure; } });
    const persisted = JSON.stringify({ state: { profile: { userId: "fallback-owner" },
      questions: [{ id: "q1", notes: "Preserve Greek αβ and Arabic شرح. ".repeat(10_000), attempts: [{ answerKey: "B" }] }] } });
    values.set(STORAGE_KEYS.persistedState, persisted);
    const writes = vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.localBackupPrefix) && value.length > 32_768)
        throw new DOMException("Synthetic browser quota", "QuotaExceededError");
      values.set(key, value);
    });

    const key = (await createLocalBackup(34))!;
    const raw = storage.getItem(key)!;
    expect(JSON.parse(raw)).toMatchObject({ format: "axom-local-backup-packed", version: 1, key, oldSchemaVersion: 34 });
    expect(raw.length).toBeLessThan(32_768);
    expect(writes.mock.calls.filter(([name]) => name.startsWith(STORAGE_KEYS.localBackupPrefix))).toHaveLength(1);
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
    resetLocalBackupRuntimeForTests();
    expect(listLocalBackups()).toEqual([expect.objectContaining({ key, oldSchemaVersion: 34, appVersion: expect.any(String) })]);
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
  });

  it("opens a compressed fallback through ordinary workspace recovery after runtime reload", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const state = makeSeed();
    state.profile = { ...state.profile, userId: "fallback-owner", name: "Preserved learner" };
    state.documents = [{ id: "source", title: "Synthetic source", fileName: "source.txt", fileType: "text",
      uploadedAt: "2026-11-21T00:00:00.000Z", rawText: "Preserved source text. ".repeat(10_000), sizeBytes: 220_000,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true }];
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state, version: state.schemaVersion }));
    const key = (await createLocalBackup(state.schemaVersion))!;
    expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ format: "axom-local-backup-packed" });
    resetLocalBackupRuntimeForTests();
    const inspection = await inspectLocalWorkspaceBackup(key);
    expect(inspection?.state.profile).toMatchObject({ userId: "fallback-owner", name: "Preserved learner" });
    expect(inspection?.state.documents[0].rawText).toBe(state.documents[0].rawText);
  });

  it.each(["missing", "truncated"])("refuses an unverified %s fallback write without pruning an older recovery copy", async mode => {
    vi.stubGlobal("indexedDB", undefined);
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "older" }] } }));
    const older = (await createLocalBackup(33))!;
    const original = storage.getItem(older);
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "new", notes: "A note. ".repeat(10_000) }] } }));
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        if (mode === "truncated") values.set(key, value.slice(0, -1));
      } else values.set(key, value);
    });
    await expect(createLocalBackup(34, 1)).rejects.toThrow("could not be verified after saving");
    expect(storage.getItem(older)).toBe(original);
    expect((await readLocalBackup(older))?.oldSchemaVersion).toBe(33);
  });

  it.each(["version", "identity", "length", "hash", "payload", "summary"])("rejects a compressed fallback with changed %s", async field => {
    vi.stubGlobal("indexedDB", undefined);
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "q1", notes: "Exact text. ".repeat(10_000) }] } }));
    const key = (await createLocalBackup(34))!;
    const packed = JSON.parse(storage.getItem(key)!);
    if (field === "version") packed.version = 2;
    if (field === "identity") packed.key = key + "-different";
    if (field === "length") packed.expandedBytes += 1;
    if (field === "hash") packed.sha256 = "0".repeat(64);
    if (field === "payload") packed.payload = packed.payload.slice(0, -8);
    if (field === "summary") packed.oldSchemaVersion += 1;
    values.set(key, JSON.stringify(packed));
    await expect(readLocalBackup(key)).resolves.toBeNull();
  });

  it.each(["CompressionStream", "DecompressionStream"])("retains the plain fallback when %s is unavailable", async api => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal(api, undefined);
    const persisted = JSON.stringify({ state: { questions: [{ id: "legacy", notes: "Keep text. ".repeat(1_000) }] } });
    values.set(STORAGE_KEYS.persistedState, persisted);
    const key = (await createLocalBackup(34))!;
    expect(JSON.parse(storage.getItem(key)!)).toHaveProperty("localStorage");
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
  });

  it.each(["compression", "checksum"])("keeps a verified plain fallback available when %s cannot run", async api => {
    vi.stubGlobal("indexedDB", undefined);
    if (api === "compression") vi.stubGlobal("CompressionStream", class { constructor() { throw new Error("Unsupported compression"); } });
    else vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("Checksum unavailable"));
    const persisted = JSON.stringify({ state: { questions: [{ id: "legacy", notes: "Keep text. ".repeat(1_000) }] } });
    values.set(STORAGE_KEYS.persistedState, persisted);
    const key = (await createLocalBackup(34))!;
    expect(JSON.parse(storage.getItem(key)!)).toHaveProperty("localStorage");
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
  });

  it("migrates a compressed fallback only after its exact IndexedDB payload is readable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({ state: { questions: [{ id: "local", notes: "Source evidence. ".repeat(10_000) }] } });
    values.set(STORAGE_KEYS.persistedState, persisted);
    const key = (await createLocalBackup(33))!;
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    await createLocalBackup(34);
    expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ storage: "indexeddb" });
    resetLocalBackupRuntimeForTests();
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
  });

  it("preserves the self-contained fallback when a later migration cannot verify its vault readback", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({ state: { questions: [{ id: "local", notes: "Source evidence. ".repeat(10_000) }] } });
    values.set(STORAGE_KEYS.persistedState, persisted);
    const key = (await createLocalBackup(33))!;
    const original = storage.getItem(key);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const get = IDBObjectStore.prototype.get;
    const failReadback = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, name) {
      const result = get.call(this, name);
      if (this.name === BACKUP_STORE_NAME && name === key) this.transaction.abort();
      return result;
    });
    await createLocalBackup(34);
    failReadback.mockRestore();
    expect(storage.getItem(key)).toBe(original);
    resetLocalBackupRuntimeForTests();
    expect((await readLocalBackup(key))?.localStorage[STORAGE_KEYS.persistedState]).toBe(persisted);
  });

  it("keeps the existing fallback retention limit for both plain and compressed snapshots", async () => {
    vi.stubGlobal("indexedDB", undefined);
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "plain" }] } }));
    const plain = (await createLocalBackup(32, 2))!;
    values.set(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "packed", notes: "Preserved text. ".repeat(10_000) }] } }));
    const first = (await createLocalBackup(33, 2))!;
    const second = (await createLocalBackup(34, 2))!;
    expect(storage.getItem(plain)).toBeNull();
    expect((await readLocalBackup(first))?.oldSchemaVersion).toBe(33);
    expect((await readLocalBackup(second))?.oldSchemaVersion).toBe(34);
    expect(listLocalBackups().map(item => item.key)).toEqual([second, first]);
  });

  it("retains both storage failures when a safety backup cannot be saved", async () => {
    localStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "unsaved" }] } }));
    const indexedDbFailure = new DOMException("Vault write unavailable", "UnknownError");
    const fallbackFailure = new DOMException("Browser storage limit", "QuotaExceededError");
    vi.stubGlobal("indexedDB", { open: () => { throw indexedDbFailure; } });
    const localWrite = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name.startsWith(STORAGE_KEYS.localBackupPrefix)) throw fallbackFailure;
      values.set(name, String(value));
    });

    let failure: unknown;
    try { await createLocalBackup(34); } catch (error) { failure = error; }
    localWrite.mockRestore();

    expect(failure).toBeInstanceOf(AggregateError);
    const combined = failure as AggregateError;
    expect(combined.errors).toEqual([indexedDbFailure, fallbackFailure]);
    expect(combined.message).toContain("Vault write unavailable");
    expect(combined.message).toContain("Browser storage limit");
    expect(combined.message).toContain("Keep this tab open and export a backup");
    expect([...values.keys()].filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix))).toEqual([]);
  });

  it("prunes limit+2 full fallback snapshots locally without reopening unavailable IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { questions: [{ id: "fallback" }] } }));

    const keys = [] as string[];
    for (const schemaVersion of [30, 31, 32, 33]) {
      keys.push((await createLocalBackup(schemaVersion, 2))!);
    }

    expect(listLocalBackups().map(backup => backup.key)).toEqual([keys[3], keys[2]]);
    expect(await readLocalBackup(keys[0])).toBeNull();
    expect(await readLocalBackup(keys[1])).toBeNull();
    expect((await readLocalBackup(keys[2]))?.oldSchemaVersion).toBe(32);
    expect((await readLocalBackup(keys[3]))?.oldSchemaVersion).toBe(33);
  });

  it("does not let newer unreadable markers displace the only verified backup", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, questions: [{ id: "safe" }] }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    const validKey = await createLocalBackup(31, 8);
    for (let index = 0; index < 8; index += 1) {
      localStorage.setItem(`${STORAGE_KEYS.localBackupPrefix}2099-01-0${index + 1}T00:00:00.000Z`, JSON.stringify({
        storage: "indexeddb", savedAt: `2099-01-0${index + 1}T00:00:00.000Z`,
        oldSchemaVersion: 31, appVersion: "missing", commitSha: "missing",
      }));
    }
    await pruneLocalBackups(1);
    expect(await readLocalBackup(validKey!)).not.toBeNull();
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVersionTwoVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(BACKUP_STORE_NAME)) request.result.createObjectStore(BACKUP_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVersionOneVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putState(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function getStoredValue(db: IDBDatabase, storeName: string, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}

function getStoreKeys(db: IDBDatabase, storeName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error);
  });
}
