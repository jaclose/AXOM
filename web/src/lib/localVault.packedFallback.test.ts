import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWritesSince, DB_NAME, getVaultWriteCheckpoint, localVaultStorage,
  replaceLocalVaultItem, resetLocalVaultRuntimeForTests, resolveMarkedVaultSnapshotRecord, resolveWorkspaceSnapshotRecord, STORE_NAME, VAULT_CONFLICT_MESSAGE,
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

  it.each(["ordinary save", "verified restore"] as const)(
    "retires an acknowledged packed workspace within a whole-origin quota during %s",
    async operation => {
      const fixture = await quotaFixture();
      const older = snapshot("quota-packed original with notes and attempts", true);
      await localVaultStorage.setItem(key, older);
      const originalRaw = values.get(packedKey)!;
      expect(originalRaw).toBeTruthy();
      fixture.blockVault.mockRestore();

      // Count every origin key, including retained legacy copies. This is not a
      // named-key-only quota stub: a full second packed envelope cannot fit.
      const used = () => [...values.entries()].reduce((total, [name, stored]) => total + name.length + stored.length, 0);
      const headroom = Math.max(320, Math.floor(originalRaw.length / 2));
      expect(headroom).toBeLessThan(originalRaw.length);
      const capacity = used() + headroom;
      fixture.blockRaw.mockImplementation((name, stored) => {
        const value = String(stored);
        const previous = values.get(name);
        const projected = used() - (previous === undefined ? 0 : name.length + previous.length) + name.length + value.length;
        if (projected > capacity) throw new DOMException("Whole-origin recovery quota exceeded", "QuotaExceededError");
        values.set(name, value);
      });

      const committed = snapshot(`newer verified IDB ${operation} after quota`);
      const checkpoint = getVaultWriteCheckpoint();
      if (operation === "verified restore") await replaceLocalVaultItem(key, committed);
      else await localVaultStorage.setItem(key, committed);
      expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
      expect(readVaultWriteFailure()).toBeNull();
      expect(values.get(packedKey)).toBe(originalRaw); // Preserve old bytes.
      const receipt = values.get(`${key}:packed-retired`);
      expect(receipt).toBeTruthy();
      expect(receipt!.length).toBeLessThan(headroom);
      expect(JSON.parse(receipt!)).toMatchObject({
        version: 2, rawSha256: await compression.sha256(new TextEncoder().encode(originalRaw)),
        committedUserId: "synthetic-learner",
      });
      expect(JSON.parse(receipt!).raw).toBeUndefined();
      expect(used()).toBeLessThanOrEqual(capacity);

      // The same selector is used by recovery exports and app-update snapshots.
      const captured = Object.fromEntries(values);
      await expect(resolveWorkspaceSnapshotRecord({ [key]: committed }, captured, key)).resolves.toBe(committed);
      await expect(resolveWorkspaceSnapshotRecord(
        { [key]: snapshot("another account", false, "other-learner") }, captured, key,
      )).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
      resetLocalVaultRuntimeForTests();
      expect(await localVaultStorage.getItem(key)).toBe(committed);
    },
  );

  it("fails closed if v2 receipt hashing fails after a verified packed decode", async () => {
    const fixture = await quotaFixture();
    const packedY = snapshot("offline packed Y with distinct notes", true);
    await localVaultStorage.setItem(key, packedY);
    const preservedPacked = values.get(packedKey)!;
    fixture.blockVault.mockRestore();

    const restoredX = snapshot("explicit restored X with distinct notes");
    await replaceLocalVaultItem(key, restoredX);
    const receiptKey = `${key}:packed-retired`;
    const originalReceipt = values.get(receiptKey)!;
    expect(JSON.parse(originalReceipt)).toMatchObject({ version: 2 });
    resetLocalVaultRuntimeForTests();

    // Packed Y must decode successfully. Only its second SHA-256, used
    // to verify the separate retirement receipt, is transiently unavailable.
    const originalSha256 = compression.sha256;
    let receiptFailures = 0;
    const hashSpy = vi.spyOn(compression, "sha256").mockImplementation(async bytes => {
      if (new TextDecoder().decode(bytes) === preservedPacked) {
        receiptFailures += 1;
        throw new Error("Synthetic v2 receipt digest interruption");
      }
      return originalSha256(bytes);
    });
    try {
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
      // An immutable physical backup selector must also refuse uncertain data.
      await expect(resolveWorkspaceSnapshotRecord(
        { [key]: restoredX }, Object.fromEntries(values), key,
      )).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
      expect(receiptFailures).toBe(2);
      expect(values.get(packedKey)).toBe(preservedPacked);
      expect(values.get(receiptKey)).toBe(originalReceipt);

      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, snapshot("blind write after uncertain receipt"));
      expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(values.get(packedKey)).toBe(preservedPacked);
      expect(values.get(receiptKey)).toBe(originalReceipt);
    } finally {
      hashSpy.mockRestore();
    }
    // When verification is available, fresh hydration selects the restored
    // IndexedDB data rather than an older, still-preserved packed copy.
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).resolves.toBe(restoredX);
    expect(values.get(packedKey)).toBe(preservedPacked);
  });

  it.each(["receipt read error", "malformed receipt", "invalid receipt schema", "invalid v1 receipt"] as const)(
    "fails closed on %s after a verified restore without losing either workspace",
    async fault => {
      const fixture = await quotaFixture();
      const packedY = snapshot("original packed Y with unique notes", true);
      await localVaultStorage.setItem(key, packedY);
      const originalPacked = values.get(packedKey)!;
      fixture.blockVault.mockRestore();
      const restoredX = snapshot("verified restoration X with unique notes");
      const checkpoint = getVaultWriteCheckpoint();
      await replaceLocalVaultItem(key, restoredX);
      expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
      const receiptKey = `${key}:packed-retired`;
      const originalReceipt = values.get(receiptKey)!;
      expect(JSON.parse(originalReceipt)).toMatchObject({ version: 2 });
      const getItem = storage.getItem;
      const inaccessible = fault === "receipt read error"
        ? vi.spyOn(storage, "getItem").mockImplementation(name => {
          if (name === receiptKey) throw new DOMException("Synthetic receipt blocked", "SecurityError");
          return getItem(name);
        })
        : null;
      if (fault === "malformed receipt") values.set(receiptKey, "{incomplete");
      if (fault === "invalid receipt schema") values.set(receiptKey, JSON.stringify({ version: 2, rawSha256: "invalid" }));
      if (fault === "invalid v1 receipt") {
        const malformed = { ...JSON.parse(originalReceipt), version: 1 };
        delete malformed.rawSha256;
        values.set(receiptKey, JSON.stringify(malformed)); // Missing required original bytes.
      }
      const uncertainReceipt = values.get(receiptKey);
      resetLocalVaultRuntimeForTests();
      try {
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        expect(values.get(packedKey)).toBe(originalPacked);
        expect(values.get(receiptKey)).toBe(uncertainReceipt);
        const writeCheckpoint = getVaultWriteCheckpoint();
        await localVaultStorage.setItem(key, snapshot("blind write must be rejected"));
        expect(() => assertVaultWritesSince(writeCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
        expect(values.get(packedKey)).toBe(originalPacked);
        // A captured backup cannot represent a transient live Storage exception.
        // When its saved receipt bytes themselves are damaged, the immutable
        // backup selector must also fail closed rather than selecting packed Y.
        if (fault !== "receipt read error") {
          await expect(resolveWorkspaceSnapshotRecord(
            { [key]: restoredX }, Object.fromEntries(values), key,
          )).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        }
      } finally {
        inaccessible?.mockRestore();
      }
      values.set(receiptKey, originalReceipt);
      resetLocalVaultRuntimeForTests();
      await expect(localVaultStorage.getItem(key)).resolves.toBe(restoredX);
      expect(values.get(packedKey)).toBe(originalPacked);
    },
  );

  it("reads existing version-1 full-raw receipts without rewriting or discarding historical packed bytes", async () => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("legacy version-one packed", true));
    const previousRaw = values.get(packedKey)!;
    fixture.blockVault.mockRestore();
    const committed = snapshot("newer durable committed revision");
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, committed);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    const v2 = JSON.parse(values.get(`${key}:packed-retired`)!);
    values.set(`${key}:packed-retired`, JSON.stringify({
      version: 1, raw: previousRaw, committedFingerprint: v2.committedFingerprint,
      committedUserId: v2.committedUserId,
    }));
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(committed);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: committed }, Object.fromEntries(values), key)).resolves.toBe(committed);
    expect(values.get(packedKey)).toBe(previousRaw);
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
    const capturedRaw = values.get(packedKey);
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    expect(values.get(packedKey)).toBe(capturedRaw); // Retained, never compare/delete.
    expect(values.get(`${key}:packed-retired`)).toBeTruthy();
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
    expect(values.get(packedKey)).toBeTruthy();
    expect(values.get(`${key}:packed-retired`)).toBeTruthy();
    expect(values.get(`${STORAGE_KEYS.localBackupPrefix}existing`)).toBe("historical backup bytes");
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(restored);
  });

  it("preserves a peer's newly acknowledged plain fallback during verified restore", async () => {
    const base = snapshot("persisted base");
    const restored = snapshot("verified restored snapshot");
    const peer = snapshot("peer offline edit");
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:synthetic-learner`;

    await localVaultStorage.setItem(key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);
    // Obtain the marker and all associated bytes through the real fallback path.
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, peer);
    const marker = values.get(markerKey);
    expect(marker).toBeTruthy();
    expect(values.get(key)).toBe(peer);
    expect(values.get(scopedKey)).toBe(peer);
    values.delete(markerKey);
    values.delete(key);
    values.delete(scopedKey);
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (!injected && this.name === STORE_NAME && args[1] === key && args[0] === restored) {
        injected = true;
        // A second tab acknowledges a byte-distinct plain recovery copy
        // after restore's initial read, but before its IDB commit completes.
        values.set(markerKey, marker!);
        values.set(key, peer);
        values.set(scopedKey, peer);
      }
      return originalPut.apply(this, args);
    });

    const backupKey = `${STORAGE_KEYS.localBackupPrefix}preserved`;
    values.set(backupKey, "historical backup bytes");
    const checkpoint = getVaultWriteCheckpoint();
    await replaceLocalVaultItem(key, restored);
    expect(injected).toBe(true);
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(readVaultWriteFailure()).not.toBeNull();
    expect(values.get(markerKey)).toBe(marker);
    expect(values.get(key)).toBe(peer);
    expect(values.get(scopedKey)).toBe(peer);
    expect(values.get(backupKey)).toBe("historical backup bytes");
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it("keeps a newly acknowledged marked plain recovery copy when packed read-side promotion completes", async () => {
    const base = snapshot("committed base");
    const packedY = snapshot("packed promotion Y", true);
    const peerZ = snapshot("peer's separately acknowledged plain Z");
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:synthetic-learner`;

    // Capture a genuine plain marker through the storage API, not a guessed hash.
    await localVaultStorage.setItem(key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, peerZ);
    const peerMarker = values.get(markerKey);
    expect(peerMarker).toBeTruthy();
    expect(values.get(key)).toBe(peerZ);
    expect(values.get(scopedKey)).toBe(peerZ);
    values.delete(markerKey);
    values.delete(key);
    values.delete(scopedKey);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(base);

    // Force a real compressed fallback with an IDB error and plain-store quota.
    const put = IDBObjectStore.prototype.put;
    const blockVault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === STORE_NAME) throw new DOMException("Synthetic IDB quota", "QuotaExceededError");
      return put.apply(this, args);
    });
    const blockRaw = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if ((name === key || name.startsWith(`${key}:user:`)) && value.length > 4_096) {
        throw new DOMException("Synthetic plain quota", "QuotaExceededError");
      }
      values.set(name, String(value));
    });
    await localVaultStorage.setItem(key, packedY);
    expect(values.get(packedKey)).toBeTruthy();
    blockVault.mockRestore();
    blockRaw.mockRestore();
    resetLocalVaultRuntimeForTests();

    // Simulate a peer tab acknowledging Z after A's successful IDB promotion,
    // exactly when A retires the captured packed key.
    let injected = false;
    const acknowledgePlainPeer = () => {
      if (injected) return;
      injected = true;
      values.set(key, peerZ);
      values.set(markerKey, peerMarker!);
      values.set(scopedKey, peerZ);
    };
    // Exercise both the old destructive retirement (RED) and the new
    // non-destructive receipt write. A packed-key remove must never erase the
    // plain peer, and a receipt write must not silently select stale Y.
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(name => {
      values.delete(name);
      if (name === packedKey) acknowledgePlainPeer();
    });
    const set = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name === `${key}:packed-retired`) acknowledgePlainPeer();
      values.set(name, String(value));
    });
    try {
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    } finally {
      remove.mockRestore();
      set.mockRestore();
    }

    expect(injected).toBe(true);
    expect(values.get(key)).toBe(peerZ);
    expect(values.get(markerKey)).toBe(peerMarker);
    expect(values.get(scopedKey)).toBe(peerZ);
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(key)).toBe(peerZ);
    expect(values.get(markerKey)).toBe(peerMarker);
  });

  it("keeps a peer's packed Z if it arrives between packed retirement comparison and storage mutation", async () => {
    const fixture = await quotaFixture();
    const oldY = snapshot("old packed Y", true);
    const newZ = snapshot("peer newly acknowledged packed Z", true);
    await localVaultStorage.setItem(key, oldY);
    const capturedRaw = values.get(packedKey)!;
    await localVaultStorage.setItem(key, newZ);
    const peerRaw = values.get(packedKey)!;
    expect(capturedRaw).not.toBe(peerRaw);
    values.set(packedKey, capturedRaw);
    fixture.blockVault.mockRestore();
    resetLocalVaultRuntimeForTests();

    let injected = false;
    const acknowledgePeer = () => {
      if (injected) return;
      injected = true;
      values.set(packedKey, peerRaw);
    };
    // RED: a comparison followed by removeItem can erase Z.
    // GREEN: write a bound retirement receipt without deleting any packed bytes;
    // a peer's single-key acknowledgement during that write must survive.
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(name => {
      if (name === packedKey) acknowledgePeer();
      values.delete(name);
    });
    const set = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
      if (name === `${key}:packed-retired`) acknowledgePeer();
      values.set(name, String(value));
    });
    try {
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    } finally {
      remove.mockRestore();
      set.mockRestore();
    }
    expect(injected).toBe(true);
    expect(values.get(packedKey)).toBe(peerRaw);
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(packedKey)).toBe(peerRaw);
  });

  it("uses the committed IDB after receipt retirement of packed Y without deleting Y", async () => {
    const fixture = await quotaFixture();
    const oldY = snapshot("packed retained Y", true);
    await localVaultStorage.setItem(key, oldY);
    const packedRaw = values.get(packedKey)!;
    fixture.blockVault.mockRestore();
    const committed = snapshot("newer verified restore");
    const checkpoint = getVaultWriteCheckpoint();
    await replaceLocalVaultItem(key, committed);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(values.get(packedKey)).toBe(packedRaw);
    expect(values.get(`${key}:packed-retired`)).toBeTruthy();
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(committed);
    const backupKey = await createLocalBackup(34, 99);
    const captured = (await readLocalBackup(backupKey!))!;
    await expect(resolveWorkspaceSnapshotRecord(captured.indexedDb?.records, captured.localStorage, key)).resolves.toBe(committed);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: snapshot("wrong vault") }, captured.localStorage, key))
      .rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: snapshot("wrong account", false, "other-learner") }, captured.localStorage, key))
      .rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it("retains a packed snapshot's legacy account binding across promotion and later saves", async () => {
    const fixture = await quotaFixture();
    // Old clients can have no plain active-user pointer even though their
    // packed recovery is account-bound. A new receipt must not rewrite this
    // captured binding and create a spurious conflict on reload.
    values.delete(`${key}:active-user`);
    const packed = snapshot("packed with absent legacy user", true);
    await localVaultStorage.setItem(key, packed);
    expect(values.get(`${key}:active-user`)).toBeUndefined();
    fixture.blockVault.mockRestore();
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(packed);
    const latest = snapshot("later committed update");
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, latest);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(values.get(`${key}:active-user`)).toBeUndefined();
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it("accepts subsequent ordinary saves after a retired packed record is preserved", async () => {
    const fixture = await quotaFixture();
    await localVaultStorage.setItem(key, snapshot("original packed", true));
    const packedY = values.get(packedKey)!;
    fixture.blockVault.mockRestore();
    await replaceLocalVaultItem(key, snapshot("verified restore"));
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toContain("verified restore");
    const latest = snapshot("new normal save");
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, latest);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(values.get(packedKey)).toBe(packedY);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it.each(["ordinary save", "verified restore"] as const)(
    "does not delete a newly acknowledged fallback in the middle of %s cleanup",
    async (operation) => {
      const base = snapshot("committed base");
      const older = snapshot("first offline fallback");
      const newer = snapshot("other tab newly acknowledged fallback");
      const committed = snapshot(operation === "ordinary save" ? "new IndexedDB save" : "explicit restored backup");
      const markerKey = `${key}:fallback-newer`;
      const scopedKey = `${key}:user:synthetic-learner`;

      await localVaultStorage.setItem(key, base);
      expect(await localVaultStorage.getItem(key)).toBe(base);
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, older);
      const olderMarker = values.get(markerKey);
      expect(olderMarker).toBeTruthy();
      await localVaultStorage.setItem(key, newer);
      const newerMarker = values.get(markerKey);
      expect(newerMarker).toBeTruthy();
      expect(newerMarker).not.toBe(olderMarker);

      // A tab captured Y. A peer Z remains in a separately acknowledged local
      // recovery chain, then finishes writing Z during the first cleanup remove.
      values.set(markerKey, olderMarker!);
      values.set(key, older);
      values.set(scopedKey, older);
      resetLocalVaultRuntimeForTests();
      // Hydrate Y's original fallback revision before restoring the IDB connection.
      expect(await localVaultStorage.getItem(key)).toBe(older);
      vi.stubGlobal("indexedDB", fakeIndexedDb);

      let injected = false;
      const acknowledgePeer = () => {
        if (injected) return;
        injected = true;
        values.set(markerKey, newerMarker!);
        values.set(key, newer);
        values.set(scopedKey, newer);
      };
      // RED: the old multi-key deletion destroys Z. GREEN: an immutable
      // retirement receipt never deletes peer bytes; inject Z as it is written.
      const remove = vi.spyOn(storage, "removeItem").mockImplementation((name) => {
        if (name === key) acknowledgePeer();
        values.delete(name);
      });
      const set = vi.spyOn(storage, "setItem").mockImplementation((name, value) => {
        if (name === `${key}:fallback-retired`) acknowledgePeer();
        values.set(name, String(value));
      });
      const checkpoint = getVaultWriteCheckpoint();
      try {
        if (operation === "verified restore") await replaceLocalVaultItem(key, committed);
        else await localVaultStorage.setItem(key, committed);
      } finally {
        remove.mockRestore();
        set.mockRestore();
      }

      expect(injected).toBe(true);
      expect(values.get(key)).toBe(newer);
      expect(values.get(markerKey)).toBe(newerMarker);
      expect(values.get(scopedKey)).toBe(newer);
      expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    },
  );

  it("refuses to treat a retired account-A fallback as account-B vault data after reload", async () => {
    const oldOwner = snapshot("A local recovery", false, "synthetic-learner");
    const savedA = snapshot("A confirmed vault", false, "synthetic-learner");
    const committedB = snapshot("B independently committed vault", false, "second-learner");
    const markerKey = `${key}:fallback-newer`;
    const scopedA = `${key}:user:synthetic-learner`;

    await localVaultStorage.setItem(key, snapshot("A base", false, "synthetic-learner"));
    expect(await localVaultStorage.getItem(key)).toContain("A base");
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, oldOwner);
    const originalMarker = values.get(markerKey);
    expect(originalMarker).toBeTruthy();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    expect(await localVaultStorage.getItem(key)).toBe(oldOwner);
    await localVaultStorage.setItem(key, savedA);
    expect(values.get(key)).toBe(oldOwner);
    expect(values.get(scopedA)).toBe(oldOwner);
    expect(values.has(`${key}:fallback-retired`)).toBe(true);

    await putCompetingVault(committedB);
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(key)).toBe(oldOwner);
    expect(values.get(markerKey)).toBe(originalMarker);
    expect(values.get(scopedA)).toBe(oldOwner);

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("B blind overwrite", false, "second-learner"));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDb.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(read).toBe(committedB);
    } finally { db.close(); }
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

  it("does not hydrate packed Y when another tab saves packed Z during asynchronous verification", async () => {
    await quotaFixture();
    const stale = snapshot("packed stale Y", true);
    await localVaultStorage.setItem(key, stale);
    const staleRaw = values.get(packedKey)!;
    const latest = snapshot("peer packed Z", true);
    await localVaultStorage.setItem(key, latest);
    const latestRaw = values.get(packedKey)!;
    expect(latestRaw).not.toBe(staleRaw);
    values.set(packedKey, staleRaw);
    resetLocalVaultRuntimeForTests();

    let entered!: () => void;
    let resume!: () => void;
    const verifying = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const digest = compression.sha256;
    vi.spyOn(compression, "sha256").mockImplementationOnce(async bytes => {
      entered();
      await paused;
      return digest(bytes);
    });

    const reading = localVaultStorage.getItem(key);
    await verifying;
    // This single-key acknowledgement is atomic; the plain mirrors do not move.
    values.set(packedKey, latestRaw);
    resume();
    await expect(reading).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(values.get(packedKey)).toBe(latestRaw);
    // A conflict latches this tab. A fresh runtime must recover durable Z.
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    expect(stale).not.toBe(latest);
  });

  it("does not return stale packed Y if packed Z arrives before a failed IndexedDB promotion", async () => {
    const fixture = await quotaFixture();
    const stale = snapshot("failed promotion Y", true);
    await localVaultStorage.setItem(key, stale);
    const staleRaw = values.get(packedKey)!;
    const latest = snapshot("newer peer Z", true);
    await localVaultStorage.setItem(key, latest);
    const latestRaw = values.get(packedKey)!;
    values.set(packedKey, staleRaw);
    resetLocalVaultRuntimeForTests();

    fixture.blockVault.mockRestore();
    const put = IDBObjectStore.prototype.put;
    let switched = false;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (!switched && this.name === STORE_NAME && args[1] === key) {
        switched = true;
        values.set(packedKey, latestRaw);
        throw new DOMException("Synthetic promotion quota failure", "QuotaExceededError");
      }
      return put.apply(this, args);
    });

    const reading = localVaultStorage.getItem(key);
    await expect(reading).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(switched).toBe(true);
    expect(values.get(packedKey)).toBe(latestRaw);
    expect(stale).not.toBe(latest);
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
  it("uses the committed IDB workspace in physical recovery snapshots when a known fallback is retired", async () => {
    const restored = snapshot("explicitly restored original workspace");
    const retired = snapshot("older independently recoverable offline notes");
    const receiptKey = `${key}:fallback-retired`;
    const markerKey = `${key}:fallback-newer`;

    await localVaultStorage.setItem(key, restored);
    expect(await localVaultStorage.getItem(key)).toBe(restored);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, retired);
    const originalMarker = values.get(markerKey);
    expect(originalMarker).toBeTruthy();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const checkpoint = getVaultWriteCheckpoint();
    await replaceLocalVaultItem(key, restored);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await localVaultStorage.getItem(key)).toBe(restored);
    expect(values.get(key)).toBe(retired); // Never delete recoverable bytes.
    expect(values.get(markerKey)).toBe(originalMarker);
    expect(values.get(receiptKey)).toBeTruthy();

    const backupKey = await createLocalBackup(34, 99);
    expect(backupKey).toBeTruthy();
    const captured = (await readLocalBackup(backupKey!))!;
    const indexedDb = captured.indexedDb?.records;
    const local = captured.localStorage;
    expect(indexedDb).toBeDefined();
    expect(indexedDb?.[key]).toBe(restored);
    expect(local[key]).toBe(retired);
    expect(local[receiptKey]).toBeTruthy();

    // Recovery inspection and app-update checkpoints share this selector.
    // A retained retired marker must not resurrect the older workspace.
    expect(resolveMarkedVaultSnapshotRecord(indexedDb, local, key)).toBe(restored);
    await expect(resolveWorkspaceSnapshotRecord(indexedDb, local, key)).resolves.toBe(restored);

    // The receipt is valid only for its exact IDB bytes and same account.
    const different = snapshot("competing different committed workspace");
    const otherAccount = snapshot("other account workspace", false, "other-learner");
    expect(() => resolveMarkedVaultSnapshotRecord({ [key]: different }, local, key)).toThrow(VAULT_CONFLICT_MESSAGE);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: otherAccount }, local, key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    await expect(resolveWorkspaceSnapshotRecord(undefined, local, key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);

    // A receipt for a previous marker must not retire a new acknowledged copy.
    const wrongReceipt = { ...local, [receiptKey]: JSON.stringify({ ...JSON.parse(local[receiptKey]), marker: "previous-marker" }) };
    expect(resolveMarkedVaultSnapshotRecord(indexedDb, wrongReceipt, key)).toBe(retired);
    await expect(resolveWorkspaceSnapshotRecord(indexedDb, wrongReceipt, key)).resolves.toBe(retired);
    expect(values.get(key)).toBe(retired);
    expect(values.get(markerKey)).toBe(originalMarker);
  });

});
