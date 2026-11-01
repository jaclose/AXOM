import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import { createLocalBackup, resetLocalBackupRuntimeForTests } from "./localBackup";
import * as localVault from "./localVault";
import { localVaultStorage, resetLocalVaultRuntimeForTests } from "./localVault";
import { makeSeed, SCHEMA_VERSION } from "./seed";
import { inspectLocalWorkspaceBackup, restoreLocalWorkspaceBackup } from "./storageRecovery";

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
  resetLocalVaultRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => vi.unstubAllGlobals());

describe("automatic workspace recovery", () => {
  it("verifies and restores only the normalized workspace through the local vault", async () => {
    const backedUp = makeSeed();
    backedUp.profile = { ...backedUp.profile, name: "Snapshot user", userId: "snapshot-user" };
    backedUp.documents = [{
      id: "private-review",
      title: "Private review source",
      fileName: "private-review.pdf",
      fileType: "application/pdf",
      uploadedAt: "2026-10-23T00:00:00.000Z",
      rawText: "private source review ".repeat(60_000),
      sizeBytes: 1_320_000,
      checksum: "private-review-checksum",
      tags: ["private"],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    }];
    await localVaultStorage.setItem(
      STORAGE_KEYS.persistedState,
      JSON.stringify({ state: backedUp, version: 31 }),
    );
    localStorage.setItem(STORAGE_KEYS.themePreference, "dark");
    localStorage.setItem(STORAGE_KEYS.migrationFailure, "original-marker");
    const key = await createLocalBackup(31);
    expect(key).toBeTruthy();

    const current = makeSeed();
    current.profile = { ...current.profile, name: "Current user", userId: "current-user" };
    await localVaultStorage.setItem(
      STORAGE_KEYS.persistedState,
      JSON.stringify({ state: current, version: SCHEMA_VERSION }),
    );
    localStorage.setItem(STORAGE_KEYS.themePreference, "light");
    localStorage.setItem(STORAGE_KEYS.migrationFailure, "unresolved-marker");

    const inspection = await inspectLocalWorkspaceBackup(key!);
    expect(inspection).toMatchObject({ oldSchemaVersion: 31 });
    expect(inspection?.state.profile.name).toBe("Snapshot user");
    expect(inspection?.state.documents[0]?.rawText).toBe(backedUp.documents[0]?.rawText);

    await restoreLocalWorkspaceBackup(key!);
    const restored = JSON.parse((await localVaultStorage.getItem(STORAGE_KEYS.persistedState))!) as {
      state: ReturnType<typeof makeSeed>;
      version: number;
    };
    expect(restored.version).toBe(SCHEMA_VERSION);
    expect(restored.state.profile.name).toBe("Snapshot user");
    expect(restored.state.documents[0]?.rawText).toBe(backedUp.documents[0]?.rawText);
    expect(localStorage.getItem(STORAGE_KEYS.themePreference)).toBe("light");
    expect(localStorage.getItem(STORAGE_KEYS.migrationFailure)).toBe("unresolved-marker");
  });

  it("accepts the intentional scoped localStorage fallback and rejects malformed workspaces", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const fallback = makeSeed();
    fallback.profile = { ...fallback.profile, name: "Fallback user", userId: "fallback-user" };
    localStorage.setItem(
      `${STORAGE_KEYS.persistedState}:user:fallback-user`,
      JSON.stringify({ state: fallback, version: 31 }),
    );
    const validKey = await createLocalBackup(31);
    expect((await inspectLocalWorkspaceBackup(validKey!))?.state.profile.name).toBe("Fallback user");

    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { terms: "invalid" }, version: 31 }));
    const invalidKey = await createLocalBackup(31);
    await expect(inspectLocalWorkspaceBackup(invalidKey!)).resolves.toBeNull();
    await expect(restoreLocalWorkspaceBackup(invalidKey!)).rejects.toThrow(/could not be verified/i);
  });

  it("does not report a restore as successful until the vault reads back the restored workspace", async () => {
    const backedUp = makeSeed();
    backedUp.profile = { ...backedUp.profile, name: "Backup user", userId: "backup-user" };
    await localVaultStorage.setItem(
      STORAGE_KEYS.persistedState,
      JSON.stringify({ state: backedUp, version: 31 }),
    );
    const key = await createLocalBackup(31);

    const current = makeSeed();
    current.profile = { ...current.profile, name: "Current user", userId: "current-user" };
    const currentSerialized = JSON.stringify({ state: current, version: SCHEMA_VERSION });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, currentSerialized);
    const skippedWrite = vi.spyOn(localVault, "replaceLocalVaultItem").mockResolvedValue(undefined);

    await expect(restoreLocalWorkspaceBackup(key!)).rejects.toThrow(/could not verify the restored workspace/i);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(currentSerialized);
    skippedWrite.mockRestore();
  });

  it("replaces a live workspace whose chunk manifest can no longer be reconstructed", async () => {
    const backedUp = makeSeed();
    backedUp.profile = { ...backedUp.profile, name: "Recovered user", userId: "shared-user" };
    await localVaultStorage.setItem(
      STORAGE_KEYS.persistedState,
      JSON.stringify({ state: backedUp, version: 31 }),
    );
    const key = await createLocalBackup(31);

    const damaged = makeSeed();
    damaged.profile = { ...damaged.profile, name: "Damaged current user", userId: "shared-user" };
    damaged.documents = [{
      id: "damaged-large-source",
      title: "Damaged large source",
      fileName: "damaged.pdf",
      fileType: "application/pdf",
      uploadedAt: "2026-10-23T00:00:00.000Z",
      rawText: "damaged source ".repeat(90_000),
      sizeBytes: 1_350_000,
      checksum: "damaged-source-checksum",
      tags: [],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    }];
    await localVaultStorage.setItem(
      STORAGE_KEYS.persistedState,
      JSON.stringify({ state: damaged, version: SCHEMA_VERSION }),
    );
    await deleteFirstWorkspaceChunk();

    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    await restoreLocalWorkspaceBackup(key!);

    const restored = JSON.parse((await localVaultStorage.getItem(STORAGE_KEYS.persistedState))!) as {
      state: ReturnType<typeof makeSeed>;
    };
    expect(restored.state.profile.name).toBe("Recovered user");
  });
});

async function deleteFirstWorkspaceChunk(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const manifest = await new Promise<{ chunkPrefix: string }>((resolve, reject) => {
      const tx = db.transaction("state", "readonly");
      const request = tx.objectStore("state").get(STORAGE_KEYS.persistedState);
      request.onsuccess = () => resolve(JSON.parse(String(request.result)) as { chunkPrefix: string });
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").delete(`${manifest.chunkPrefix}:0`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
