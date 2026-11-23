// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import { DB_NAME, flushLocalVaultWrites, localVaultStorage, resetLocalVaultRuntimeForTests, STORE_NAME } from "../localVault";
import { closeWorkspace, openEmptyWorkspace } from "./persistenceHarness.testing";

function openSeededReader(key: string, value: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve(db);
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}

function readFromOpenConnection(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteSeededDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Synthetic database deletion failed"));
    request.onblocked = () => reject(new Error("Synthetic database remained blocked"));
  });
}

describe("shared question-content persistence harness lifecycle", () => {
  it("refuses a blocked fake-IDB deletion and keeps the existing workspace bytes while the reader is open", async () => {
    const key = STORAGE_KEYS.persistedState;
    const previous = JSON.stringify({ state: { questions: [{ id: "synthetic-keep" }] }, version: 34 });
    const reader = await openSeededReader(key, previous);
    try {
      await expect(openEmptyWorkspace()).rejects.toThrow(/blocked deleting synthetic indexeddb/i);
      // The helper must not reinterpret a failed deletion as fresh storage.
      expect(await readFromOpenConnection(reader, key)).toBe(previous);
    } finally {
      reader.close();
      // A blocked IndexedDB deletion may complete after the reader closes.
      // Drain that queued request before starting another synthetic lifetime.
      await deleteSeededDatabase();
      resetLocalVaultRuntimeForTests();
      vi.unstubAllGlobals();
    }
  });

  it("forgets the previous test-only CAS/deletion lineage after a verified fresh database", async () => {
    await openEmptyWorkspace();
    try {
      const key = STORAGE_KEYS.persistedState;
      const first = JSON.stringify({ state: { questions: [{ id: "first-synthetic" }] }, version: 34 });
      const second = JSON.stringify({ state: { questions: [{ id: "second-synthetic" }] }, version: 34 });

      await localVaultStorage.setItem(key, first);
      await flushLocalVaultWrites();
      expect(await localVaultStorage.getItem(key)).toBe(first);

      // The shared helper destroys this synthetic DB intentionally. A newly
      // hydrated test tab must not inherit a stale expected fingerprint.
      await openEmptyWorkspace();
      expect(await localVaultStorage.getItem(key)).toBeNull();
      await localVaultStorage.setItem(key, second);
      await flushLocalVaultWrites();
      expect(await localVaultStorage.getItem(key)).toBe(second);
    } finally {
      await closeWorkspace();
    }
  });
});
