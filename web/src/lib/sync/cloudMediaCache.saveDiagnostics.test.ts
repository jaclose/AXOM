// @vitest-environment node
import { IDBDatabase, IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import {
  assertVaultWritesSince, DB_NAME, DB_VERSION, ensureVaultStores, flushLocalVaultWrites,
  getVaultWriteCheckpoint, localVaultStorage, resetLocalVaultRuntimeForTests, STORE_NAME,
} from "../localVault";
import { saveCloudMediaIndex } from "./cloudMediaCache";
import { readMediaManifest } from "./cloudMedia";

const owner = "11111111-1111-4111-8111-111111111111";
const indexKey = `axom.cloud.media.v2:${owner}`;
const media = [{ blobKey: "question-image", hash: "a".repeat(64), byteSize: 7, updatedAt: "2026-11-09T12:00:00.000Z" }];
const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "learner" }, label }, version: 35 });

async function open(version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => ensureVaultStores(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function write(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

async function read(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  resetLocalVaultRuntimeForTests();
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("saves an owner image index without bypassing or clearing a stale workspace conflict", async () => {
  await localVaultStorage.setItem(STORAGE_KEYS.persistedState, snapshot("hydrated base"));
  await flushLocalVaultWrites();
  await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  const db = await open();
  await write(db, STORAGE_KEYS.persistedState, snapshot("newer other tab"));
  const checkpoint = getVaultWriteCheckpoint();
  await localVaultStorage.setItem(STORAGE_KEYS.persistedState, snapshot("stale retry"));
  await flushLocalVaultWrites();
  expect(() => assertVaultWritesSince(checkpoint)).toThrow(/Another AXOM tab/);

  await expect(saveCloudMediaIndex(owner, media)).resolves.toBeUndefined();
  expect(await read(db, indexKey)).toEqual(media);
  expect(await read(db, STORAGE_KEYS.persistedState)).toBe(snapshot("newer other tab"));
  expect(() => assertVaultWritesSince(checkpoint)).toThrow(/Another AXOM tab/);
  db.close();
});

it("rejects a stale client schema without changing the newer workspace or its media index", async () => {
  const db = await open(DB_VERSION + 1);
  await write(db, STORAGE_KEYS.persistedState, snapshot("newer schema"));
  await write(db, indexKey, media);
  await expect(saveCloudMediaIndex(owner, [])).rejects.toMatchObject({ name: "VersionError" });
  expect(await read(db, STORAGE_KEYS.persistedState)).toBe(snapshot("newer schema"));
  expect(await read(db, indexKey)).toEqual(media);
  db.close();
});

it("surfaces local image-index write failure without replacing workspace data", async () => {
  const db = await open();
  await write(db, STORAGE_KEYS.persistedState, snapshot("durable workspace"));
  const close = vi.spyOn(IDBDatabase.prototype, "close");
  const originalPut = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
    if (key === indexKey) throw new DOMException("Fixture storage failure", "QuotaExceededError");
    return originalPut.call(this, value, key);
  });
  await expect(saveCloudMediaIndex(owner, media)).rejects.toMatchObject({ name: "QuotaExceededError" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(close.mock.contexts[0]).not.toBe(db);
  expect(await read(db, STORAGE_KEYS.persistedState)).toBe(snapshot("durable workspace"));
  expect(await read(db, indexKey)).toBeUndefined();
  db.close();
});

it("closes the opened index connection when transaction creation throws", async () => {
  const db = await open();
  await write(db, STORAGE_KEYS.persistedState, snapshot("durable workspace"));
  const close = vi.spyOn(IDBDatabase.prototype, "close");
  const originalTransaction = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, stores, mode, options) {
    if (this !== db && mode === "readwrite") throw new DOMException("Fixture closed connection", "InvalidStateError");
    return originalTransaction.call(this, stores, mode, options);
  });
  await expect(saveCloudMediaIndex(owner, media)).rejects.toMatchObject({ name: "InvalidStateError" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(close.mock.contexts[0]).not.toBe(db);
  expect(await read(db, STORAGE_KEYS.persistedState)).toBe(snapshot("durable workspace"));
  db.close();
});

it.skipIf(!process.env.AXOM_PRIVATE_CLOUD_MEDIA_MANIFEST)("validates and clones an explicitly supplied private media manifest", async () => {
  const supplied: unknown = JSON.parse(await readFile(process.env.AXOM_PRIVATE_CLOUD_MEDIA_MANIFEST!, "utf8"));
  const entries = readMediaManifest(supplied);
  expect(structuredClone(entries)).toEqual(entries);
  await expect(saveCloudMediaIndex(owner, entries)).resolves.toBeUndefined();
  const db = await open();
  expect(await read(db, indexKey)).toEqual(entries);
  db.close();
});
