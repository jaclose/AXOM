import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWritesSince, DB_NAME, getVaultWriteCheckpoint, localVaultStorage,
  replaceLocalVaultItem, resetLocalVaultRuntimeForTests, resolveWorkspaceSnapshotRecord, STORE_NAME, VAULT_CONFLICT_MESSAGE,
} from "./localVault";
import { packedFallbackKey } from "./packedVaultFallback";
import { STORAGE_KEYS } from "./brand";
import { createLocalBackup, readLocalBackup, resetLocalBackupRuntimeForTests } from "./localBackup";
import { inspectLocalWorkspaceBackup } from "./storageRecovery";
import { makeSeed } from "./seed";
import * as compression from "./compressedText";
import { readVaultWriteFailure } from "./vaultActivity";

const key = STORAGE_KEYS.persistedState;
const packedKey = packedFallbackKey(key);
const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (name: string) => values.get(name) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (name: string) => { values.delete(name); },
  setItem: (name: string, value: string) => { values.set(name, String(value)); },
};

function snapshot(label: string, large = false, userId = "synthetic-learner"): string {
  return JSON.stringify({ state: { profile: { userId }, label,
    questions: [{ id: "q-one", notes: `${label}: retain this note`, attempts: [{ at: "2026-11-22T00:00:00Z", answerKey: "B", status: "correct", mode: "tutor" }] }],
    documents: large ? [{ id: "source", rawText: "A synthetic explanation and its source context. ".repeat(6_000) }] : [],
  }, version: 34 });
}

beforeEach(async () => {
  values.clear();
  resetLocalVaultRuntimeForTests();
  resetLocalBackupRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function quotaFixture() {
  const base = snapshot("vault base");
  await localVaultStorage.setItem(key, base);
  const put = IDBObjectStore.prototype.put;
  const blockVault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === STORE_NAME) throw new DOMException("Synthetic state quota", "QuotaExceededError");
    return put.apply(this, args);
  });
  const legacy = snapshot("last raw fallback");
  await localVaultStorage.setItem(key, legacy);
  const legacyRecords = Object.fromEntries([...values].filter(([name]) => name.startsWith(key)));
  const blockRaw = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
    if ((name === key || name.startsWith(`${key}:user:`)) && value.length > 4_096) {
      throw new DOMException("Synthetic plain fallback quota", "QuotaExceededError");
    }
    values.set(name, String(value));
  });
  return { base, legacy, legacyRecords, blockVault, blockRaw };
}

function expectLegacyUnchanged(expected: Record<string, string>) {
  for (const [name, value] of Object.entries(expected)) expect(values.get(name)).toBe(value);
}

async function putCompetingVault(value: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDb.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

describe("verified separate compressed workspace fallback", () => {
  it("survives real state-store quota and raw fallback quota without changing legacy records or backups", async () => {
    const fixture = await quotaFixture();
    values.set(`${STORAGE_KEYS.localBackupPrefix}existing`, "existing backup bytes");
    const latest = snapshot("latest notes and attempt", true);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, latest);

    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(readVaultWriteFailure()).toBeNull();
    expect(values.get(packedKey)!.length).toBeLessThan(4_096);
    expect(JSON.parse(values.get(packedKey)!)).toMatchObject({ format: "axom-packed-workspace-fallback", name: key, userId: "synthetic-learner" });
    expectLegacyUnchanged(fixture.legacyRecords);
    expect(values.get(`${STORAGE_KEYS.localBackupPrefix}existing`)).toBe("existing backup bytes");
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    expectLegacyUnchanged(fixture.legacyRecords);
  });

  it("continues saving over the current packed record and promotes only after IDB recovers", async () => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("first packed", true));
    const latest = snapshot("second packed", true);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, latest);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expectLegacyUnchanged(fixture.legacyRecords);
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    fixture.blockVault.mockRestore();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    expect(values.has(packedKey)).toBe(false);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it("retires the captured packed record after an explicit verified restore and preserves historical backups", async () => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("old packed", true));
    values.set(`${STORAGE_KEYS.localBackupPrefix}existing`, "historical backup bytes");
    fixture.blockVault.mockRestore();
    const restored = snapshot("explicitly restored workspace");
    const checkpoint = getVaultWriteCheckpoint();
    await replaceLocalVaultItem(key, restored);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(values.has(packedKey)).toBe(false);
    expect(values.get(`${STORAGE_KEYS.localBackupPrefix}existing`)).toBe("historical backup bytes");
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(restored);
  });

  it.each(["absent", "older"])("preserves a new packed record arriving during restore when the prior record was %s", async prior => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("older packed", true));
    const older = values.get(packedKey)!;
    await localVaultStorage.setItem(key, snapshot("concurrent packed work", true));
    const concurrent = values.get(packedKey)!;
    if (prior === "absent") values.delete(packedKey);
    else values.set(packedKey, older);
    fixture.blockVault.mockRestore();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === STORE_NAME && args[1] === key) values.set(packedKey, concurrent);
      return put.apply(this, args);
    });
    const checkpoint = getVaultWriteCheckpoint();
    await replaceLocalVaultItem(key, snapshot("requested restore"));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(readVaultWriteFailure()).not.toBeNull();
    expect(values.get(packedKey)).toBe(concurrent);
    expectLegacyUnchanged(fixture.legacyRecords);
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it.each(["explicit removal", "confirmed empty read"])("forgets the previous profile after %s while keeping backups", async lifecycle => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("old profile", true));
    const backupKey = `${STORAGE_KEYS.localBackupPrefix}existing`;
    values.set(backupKey, "historical backup bytes");
    if (lifecycle === "explicit removal") {
      await localVaultStorage.removeItem(key);
    } else {
      for (const name of [...values.keys()]) if (name.startsWith(key)) values.delete(name);
      await new Promise<void>((resolve, reject) => {
        const request = fakeIndexedDb.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      expect(await localVaultStorage.getItem(key)).toBeNull();
    }
    const fresh = snapshot("new profile after empty lifecycle", true, "new-synthetic-owner");
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, fresh);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(JSON.parse(values.get(packedKey)!)).toMatchObject({ userId: "new-synthetic-owner" });
    expect(await localVaultStorage.getItem(key)).toBe(fresh);
    expect(values.get(backupKey)).toBe("historical backup bytes");
    expect(fixture.blockVault).toHaveBeenCalled();
  });

  it.each(["version", "name", "account", "length", "oversized", "hash", "payload", "fingerprint"])("refuses a corrupt %s without adopting the stale vault or replacing the packed bytes", async field => {
    await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("packed", true));
    const envelope = JSON.parse(values.get(packedKey)!);
    if (field === "version") envelope.version = 2;
    if (field === "name") envelope.name = "other-workspace";
    if (field === "account") envelope.userId = "other-learner";
    if (field === "length") envelope.expandedBytes += 1;
    if (field === "oversized") envelope.expandedBytes = compression.MAX_EXPANDED_TEXT_BYTES + 1;
    if (field === "hash") envelope.sha256 = "0".repeat(64);
    if (field === "payload") envelope.payload = envelope.payload.slice(0, -12);
    if (field === "fingerprint") envelope.valueFingerprint = "invalid";
    const damaged = JSON.stringify(envelope);
    values.set(packedKey, damaged);
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(/compressed workspace/i);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("must not replace damaged evidence", true));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/compressed workspace/i);
    expect(values.get(packedKey)).toBe(damaged);
  });

  it("does not replace a packed workspace with a different local profile", async () => {
    await quotaFixture();
    const latest = snapshot("owned packed", true);
    await localVaultStorage.setItem(key, latest);
    const packed = values.get(packedKey);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("other profile", true, "different-owner"));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/different local profile/i);
    expect(values.get(packedKey)).toBe(packed);
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it("keeps the previous packed copy if a later atomic write exceeds quota", async () => {
    const fixture = await quotaFixture();
    const latest = snapshot("last successful packed", true);
    await localVaultStorage.setItem(key, latest);
    const before = values.get(packedKey);
    fixture.blockRaw.mockImplementation((name, value) => {
      if (name === packedKey) throw new DOMException("Packed capacity exhausted", "QuotaExceededError");
      values.set(name, value);
    });
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("could not save this change", true));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/Packed capacity exhausted/);
    expect(values.get(packedKey)).toBe(before);
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it("does not report success when the packed write is silently discarded", async () => {
    const fixture = await quotaFixture();
    fixture.blockRaw.mockImplementation((name, value) => {
      if (name === packedKey) return;
      if (name === key && value.length > 4_096) throw new DOMException("Raw capacity", "QuotaExceededError");
      values.set(name, value);
    });
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("not stored", true));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/could not be read back/i);
    expect(readVaultWriteFailure()).not.toBeNull();
    expect(values.has(packedKey)).toBe(false);
    expectLegacyUnchanged(fixture.legacyRecords);
  });

  it.each(["CompressionStream", "DecompressionStream"])("does not claim compressed recovery when %s is unavailable", async api => {
    const fixture = await quotaFixture();
    vi.stubGlobal(api, undefined);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("cannot compress", true));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/restorable workspace fallback/i);
    expect(values.has(packedKey)).toBe(false);
    expectLegacyUnchanged(fixture.legacyRecords);
  });

  it.each(["legacy raw record", "legacy marker", "IDB"])("fails closed when a competing %s changes after the packed save", async tier => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("packed", true));
    const packed = values.get(packedKey);
    if (tier === "legacy raw record") values.set(key, snapshot("legacy runtime edit"));
    if (tier === "legacy marker") values.set(`${key}:fallback-newer`, "a competing marker");
    if (tier === "IDB") { fixture.blockVault.mockRestore(); await putCompetingVault(snapshot("competing vault edit")); }
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(packedKey)).toBe(packed);
  });

  it.each(["legacy", "IDB"])("rechecks a competing %s commit made during asynchronous compression", async tier => {
    const fixture = await quotaFixture();
    let started!: () => void;
    let finish!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const paused = new Promise<void>(resolve => { finish = resolve; });
    const compress = compression.compressText;
    vi.spyOn(compression, "compressText").mockImplementationOnce(async value => {
      started(); await paused; return compress(value);
    });
    const checkpoint = getVaultWriteCheckpoint();
    const saving = localVaultStorage.setItem(key, snapshot("stale compressed proposal", true));
    await began;
    if (tier === "legacy") values.set(key, snapshot("concurrent legacy edit"));
    else { fixture.blockVault.mockRestore(); await putCompetingVault(snapshot("concurrent vault edit")); }
    finish();
    await saving;
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.has(packedKey)).toBe(false);
  });

  it("does not acknowledge a packed save when IDB changes during asynchronous readback verification", async () => {
    const fixture = await quotaFixture();
    let started!: () => void;
    let finish!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const paused = new Promise<void>(resolve => { finish = resolve; });
    const digest = compression.sha256;
    let digests = 0;
    vi.spyOn(compression, "sha256").mockImplementation(async bytes => {
      if (++digests === 2) { started(); await paused; }
      return digest(bytes);
    });
    const checkpoint = getVaultWriteCheckpoint();
    const saving = localVaultStorage.setItem(key, snapshot("pending acknowledgement", true));
    await began;
    fixture.blockVault.mockRestore();
    await putCompetingVault(snapshot("newer vault during verification"));
    finish();
    await saving;
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(packedKey)).toBeTruthy(); // Both copies remain available for recovery.
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it.each(["indexeddb", "local-fallback"])("captures the actual latest packed notes and attempt in an ordinary %s safety backup", async tier => {
    const fixture = await quotaFixture();
    const state = makeSeed();
    state.profile.userId = "synthetic-learner";
    state.questions = [{ id: "q-one", source: "manual", stem: "Synthetic question", status: "correct", marked: false, tags: [],
      options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }], correctKey: "B", notes: "Latest personal note",
      attempts: [{ answerKey: "B", status: "correct", mode: "tutor", at: "2026-11-22T00:00:00Z" }],
      createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z" }];
    state.documents = [{ id: "large-source", title: "Synthetic source", fileName: "synthetic.txt", fileType: "txt", rawText: "Synthetic source context. ".repeat(6_000), sizeBytes: 0, uploadedAt: "2026-11-22T00:00:00Z", linkedQuestionSetIds: [], tags: [], libraryOnly: true }];
    const latest = JSON.stringify({ state, version: 34 });
    await localVaultStorage.setItem(key, latest);
    if (tier === "local-fallback") vi.stubGlobal("indexedDB", undefined);
    const backup = await createLocalBackup(34, 99);
    expect(backup).toBeTruthy();
    const savedRecords = new Map(values);
    const inspection = await inspectLocalWorkspaceBackup(backup!);
    expect(inspection?.state.questions[0].notes).toBe("Latest personal note");
    expect(inspection?.state.questions[0].attempts).toEqual(state.questions[0].attempts);
    expect(values).toEqual(savedRecords);
    expectLegacyUnchanged(fixture.legacyRecords);
    const captured = (await readLocalBackup(backup!))!;
    const damaged = JSON.parse(captured.localStorage[packedKey]);
    damaged.sha256 = "0".repeat(64);
    await expect(resolveWorkspaceSnapshotRecord(captured.indexedDb?.records,
      { ...captured.localStorage, [packedKey]: JSON.stringify(damaged) }, key)).rejects.toThrow(/compressed workspace/i);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: snapshot("competing vault") }, captured.localStorage, key))
      .rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values).toEqual(savedRecords);
  });
});
