import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic workspace recovery", () => {
  it.each(["indexeddb", "compressed-browser-fallback"])("recovers the actual newer fallback notes and attempt from a %s backup", async tier => {
    const { older, latest, latestRaw, marker } = await writeNewerFallback();
    let stopFailure = () => {};
    if (tier === "compressed-browser-fallback") {
      const add = IDBObjectStore.prototype.add;
      const failBackup = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value, key) {
        const result = add.call(this, value, key);
        if (this.name === localVault.BACKUP_STORE_NAME) this.transaction.abort();
        return result;
      });
      stopFailure = () => failBackup.mockRestore();
    }
    const key = (await createLocalBackup(SCHEMA_VERSION))!;
    stopFailure();
    if (tier === "compressed-browser-fallback") {
      expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ format: "axom-local-backup-packed" });
    }
    resetLocalBackupRuntimeForTests();

    const inspection = await inspectLocalWorkspaceBackup(key);
    expect(inspection?.state.questions[0].notes).toBe(latest.questions[0].notes);
    expect(inspection?.state.questions[0].attempts).toEqual(latest.questions[0].attempts);
    // Inspection is read-only: it must not promote the local copy or alter the
    // physical vault whose older contents were captured in the same snapshot.
    expect(await readPhysicalWorkspace()).toBe(JSON.stringify({ state: older, version: SCHEMA_VERSION }));
    expect(storage.getItem(STORAGE_KEYS.persistedState)).toBe(latestRaw);
    expect(storage.getItem(`${STORAGE_KEYS.persistedState}:fallback-newer`)).toBe(marker);

    await restoreLocalWorkspaceBackup(key);
    const restored = JSON.parse((await localVaultStorage.getItem(STORAGE_KEYS.persistedState))!);
    expect(restored.state.questions[0].notes).toBe(latest.questions[0].notes);
    expect(restored.state.questions[0].attempts).toEqual(latest.questions[0].attempts);
  });

  it("keeps a captured competing vault commit ahead of a marked fallback based on an older commit", async () => {
    const { older } = await writeNewerFallback();
    const competing = structuredClone(older);
    competing.questions[0].notes = "A competing tab's later durable edit";
    const competingRaw = JSON.stringify({ state: competing, version: SCHEMA_VERSION });
    await writePhysicalWorkspace(competingRaw);
    const key = (await createLocalBackup(SCHEMA_VERSION))!;

    const inspection = await inspectLocalWorkspaceBackup(key);
    expect(inspection?.state.questions[0].notes).toBe(competing.questions[0].notes);
    expect(await readPhysicalWorkspace()).toBe(competingRaw);
  });

  it.each(["corrupt-value", "corrupt-marker", "legacy-ambiguous"])("refuses automatic recovery for a %s fallback identity", async mode => {
    const { latestRaw, marker } = await writeNewerFallback();
    if (mode === "corrupt-value") storage.setItem(STORAGE_KEYS.persistedState, latestRaw + " ");
    if (mode === "corrupt-marker") storage.setItem(`${STORAGE_KEYS.persistedState}:fallback-newer`, "{malformed");
    if (mode === "legacy-ambiguous") {
      storage.setItem(`${STORAGE_KEYS.persistedState}:fallback-newer`, JSON.parse(marker).valueFingerprint);
    }
    const key = (await createLocalBackup(SCHEMA_VERSION))!;
    const before = await readPhysicalWorkspace();
    await expect(inspectLocalWorkspaceBackup(key)).resolves.toBeNull();
    await expect(restoreLocalWorkspaceBackup(key)).rejects.toThrow("could not be verified");
    expect(await readPhysicalWorkspace()).toBe(before);
  });

  it("keeps an unmarked browser mirror behind the captured vault", async () => {
    const { older } = await writeNewerFallback();
    storage.removeItem(`${STORAGE_KEYS.persistedState}:fallback-newer`);
    const key = (await createLocalBackup(SCHEMA_VERSION))!;
    expect((await inspectLocalWorkspaceBackup(key))?.state.questions[0].notes).toBe(older.questions[0].notes);
  });

  it("accepts a legacy fallback marker when the captured vault holds the identical workspace", async () => {
    const { latest, latestRaw, marker } = await writeNewerFallback();
    storage.setItem(`${STORAGE_KEYS.persistedState}:fallback-newer`, JSON.parse(marker).valueFingerprint);
    await writePhysicalWorkspace(latestRaw);
    const key = (await createLocalBackup(SCHEMA_VERSION))!;
    expect((await inspectLocalWorkspaceBackup(key))?.state.questions[0].attempts).toEqual(latest.questions[0].attempts);
  });

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

async function writeNewerFallback() {
  const older = makeSeed();
  older.profile = { ...older.profile, userId: "same-learner", name: "Synthetic learner" };
  older.questions = [{
    id: "synthetic-q1", source: "manual", stem: "Which letter comes first?",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }], correctKey: "A",
    status: "unseen", tags: [], attempts: [], notes: "Earlier note",
    createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
  }];
  await localVaultStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: older, version: SCHEMA_VERSION }));
  const latest = structuredClone(older);
  latest.questions[0].notes = "Preserve the latest learner explanation. ".repeat(1_000).trim();
  latest.questions[0].status = "incorrect";
  latest.questions[0].attempts = [{ at: "2026-11-21T01:00:00.000Z", answerKey: "B", status: "incorrect", mode: "tutor" }];
  latest.questions[0].updatedAt = "2026-11-21T01:00:00.000Z";
  const latestRaw = JSON.stringify({ state: latest, version: SCHEMA_VERSION });
  vi.stubGlobal("indexedDB", undefined);
  const checkpoint = localVault.getVaultWriteCheckpoint();
  await localVaultStorage.setItem(STORAGE_KEYS.persistedState, latestRaw);
  await localVault.flushLocalVaultWrites();
  localVault.assertVaultWritesSince(checkpoint);
  const marker = storage.getItem(`${STORAGE_KEYS.persistedState}:fallback-newer`)!;
  expect(JSON.parse(marker)).toMatchObject({ version: 1, baseFingerprint: expect.any(String), valueFingerprint: expect.any(String) });
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  return { older, latest, latestRaw, marker };
}

async function readPhysicalWorkspace(): Promise<string | undefined> {
  const db = await openVaultDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(localVault.STORE_NAME, "readonly").objectStore(localVault.STORE_NAME).get(STORAGE_KEYS.persistedState);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writePhysicalWorkspace(value: string): Promise<void> {
  const db = await openVaultDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(localVault.STORE_NAME, "readwrite");
      tx.objectStore(localVault.STORE_NAME).put(value, STORAGE_KEYS.persistedState);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = tx.onerror;
    });
  } finally { db.close(); }
}

function openVaultDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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
