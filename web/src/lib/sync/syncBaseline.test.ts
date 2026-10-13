// @vitest-environment node
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { readSyncBaseline, saveSyncBaseline, type SyncBaseline } from "./syncBaseline";
import { DB_NAME, DB_VERSION, STORE_NAME } from "../localVault";

afterEach(() => vi.unstubAllGlobals());
const baseline = (): SyncBaseline => ({ revision: 2, contentHash: "a".repeat(64), packed: {
  _axomCloudFormat: 2, _axomDeltaFormat: 1, _axomHashFormat: 1, content: '{"questions":[]}', expandedBytes: 16, media: [], sources: [],
} });
it("uses only the matching account and exact acknowledged revision", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const account = crypto.randomUUID(); const value = baseline();
  await saveSyncBaseline(account, value);
  expect(await readSyncBaseline(account, 2)).toEqual(value);
  expect(await readSyncBaseline(account, 1)).toBeUndefined();
  expect(await readSyncBaseline(crypto.randomUUID(), 2)).toBeUndefined();
});
it("treats a damaged persisted cache as missing, without touching workspace data", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const account = crypto.randomUUID(); await saveSyncBaseline(account, baseline());
  // Evict only this optional in-memory baseline, as a reload would.
  await saveSyncBaseline(crypto.randomUUID(), baseline()); await saveSyncBaseline(crypto.randomUUID(), baseline());
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...baseline(), checksum: "damaged" }, `axom.sync.baseline.v1:${account}`);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close(); expect(await readSyncBaseline(account, 2)).toBeUndefined();
});
