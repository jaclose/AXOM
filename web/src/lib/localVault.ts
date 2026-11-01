import type { StateStorage } from "zustand/middleware";
import { userIdFromName } from "./userIdentity";
import { STORAGE_KEYS } from "./brand";
import { markVaultWrite, markVaultWriteFailure } from "./vaultActivity";

export const DB_NAME = STORAGE_KEYS.vaultDb;
export const STORE_NAME = "state";
export const BACKUP_STORE_NAME = "backups";
/** Question-note image bytes live here, keyed by blobKey — never in the JSON
 * workspace state and never in localStorage (Q2b-2). */
export const ATTACHMENT_STORE_NAME = "questionAttachmentBlobs";
/**
 * Physical vault schema version. Version 4 is the coordination barrier for
 * chunked workspace values: a v3 tab must close before the first chunk
 * manifest can be committed, and cannot reopen against the upgraded vault.
 * This is independent from the logical Zustand store schema.
 */
export const DB_VERSION = 4;

/** Shared upgrade path: create any missing stores without touching existing data. */
export function ensureVaultStores(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) db.createObjectStore(BACKUP_STORE_NAME);
  if (!db.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) db.createObjectStore(ATTACHMENT_STORE_NAME);
}
const activeUserKey = (name: string) => `${name}:active-user`;
const scopedStateKey = (name: string, userId: string) => `${name}:user:${userId}`;
/** Present only while the localStorage copy is ahead of IndexedDB. */
const fallbackMarkerKey = (name: string) => `${name}:fallback-newer`;
let vaultWriteSequence = 0;
const vaultWriteFailures = new Map<number, Error>();
const observedVaultSnapshots = new Map<string, string | null>();
const conflictedWorkspaceKeys = new Set<string>();
/** A blocked versionchange request cannot be cancelled. Fail later upgrade
 * attempts promptly until that queued request either succeeds or errors. */
let vaultUpgradeBlocked = false;

export const VAULT_CONFLICT_MESSAGE = "Another AXOM tab saved a newer workspace. This tab did not overwrite it. Keep this tab open, export or copy any unsaved work, then reload AXOM and retry.";

class VaultConflictError extends Error {
  readonly code = "AXOM_VAULT_CONFLICT";

  constructor() {
    super(VAULT_CONFLICT_MESSAGE);
    this.name = "VaultConflictError";
  }
}

export function isVaultConflictError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && (
    error.name === "VaultConflictError"
    || ("code" in error && error.code === "AXOM_VAULT_CONFLICT")
  );
}

/** Test isolation for the one module-local runtime that represents a browser tab. */
export function resetLocalVaultRuntimeForTests(): void {
  observedVaultSnapshots.clear();
  conflictedWorkspaceKeys.clear();
  vaultUpgradeBlocked = false;
}

/** Capture the current adapter position before a write that must be durable. */
export function getVaultWriteCheckpoint(): number {
  return vaultWriteSequence;
}

/** Assert the outcome of one exact adapter write, without attributing a later
 * unrelated write failure to this operation. */
export function assertVaultWrite(sequence: number): void {
  if (vaultWriteSequence < sequence) {
    throw new Error("AXOM could not confirm that the expected local vault write started.");
  }
  const failure = vaultWriteFailures.get(sequence);
  if (failure) throw failure;
}

/**
 * Ordinary store writes remain best-effort for non-browser/test environments,
 * but finalization can explicitly require that every adapter write since its
 * checkpoint reached IndexedDB or the localStorage fallback.
 */
export function assertVaultWritesSince(checkpoint: number): void {
  const failed = [...vaultWriteFailures.entries()]
    .filter(([sequence]) => sequence > checkpoint)
    .sort(([left], [right]) => left - right)[0];
  if (failed) throw failed[1];
}

function localFallback(): Storage | null {
  try {
    // Node 25 exposes an unusable experimental global `localStorage` unless a
    // file flag is supplied. In browsers/jsdom, the Window-owned storage is the
    // real fallback and must take precedence over that process-level getter.
    if (typeof window !== "undefined") return window.localStorage;
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function writeLocalFallback(
  fallbackStore: Storage | null,
  name: string,
  value: string,
  userId: string,
  indexedDbError?: unknown,
): void {
  if (!fallbackStore) {
    throw new Error("AXOM could not write to IndexedDB and no local storage fallback is available.", {
      cause: indexedDbError,
    });
  }
  fallbackStore.setItem(name, value);
  if (userId) {
    fallbackStore.setItem(activeUserKey(name), userId);
    fallbackStore.setItem(scopedStateKey(name, userId), value);
  }
}

/** Enough to tell one saved snapshot from another; never a security measure. */
function snapshotFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

const CHUNKED_VALUE_FORMAT = "axom-local-vault-chunks";
const CHUNKED_VALUE_VERSION = 1;
/** Keep each IndexedDB value well below Chromium's large-value failure edge. */
const VAULT_CHUNK_CHARACTERS = 1024 * 1024;

interface ChunkedValueManifest {
  format: typeof CHUNKED_VALUE_FORMAT;
  version: typeof CHUNKED_VALUE_VERSION;
  fingerprint: string;
  length: number;
  chunkPrefix: string;
  chunkCount: number;
}

interface StoredValuePlan {
  storedValue: string;
  manifest?: ChunkedValueManifest;
  chunks: string[];
}

function readChunkedValueManifest(value: string | null | undefined): ChunkedValueManifest | undefined {
  if (typeof value !== "string" || value.length > 4096 || !value.includes(CHUNKED_VALUE_FORMAT)) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkedValueManifest>;
    if (
      parsed.format !== CHUNKED_VALUE_FORMAT
      || parsed.version !== CHUNKED_VALUE_VERSION
      || typeof parsed.fingerprint !== "string"
      || typeof parsed.length !== "number"
      || !Number.isSafeInteger(parsed.length)
      || parsed.length < 0
      || typeof parsed.chunkPrefix !== "string"
      || !parsed.chunkPrefix.includes(":chunks:")
      || typeof parsed.chunkCount !== "number"
      || !Number.isSafeInteger(parsed.chunkCount)
      || parsed.chunkCount < 1
      || parsed.chunkCount > 100_000
    ) return undefined;
    return parsed as ChunkedValueManifest;
  } catch {
    return undefined;
  }
}

function chunkPrefix(name: string, userId: string): string {
  return `${name}:chunks:${snapshotFingerprint(userId || "local-workspace")}`;
}

function storedValuePlan(name: string, value: string, userId: string): StoredValuePlan {
  if (!observesWorkspace(name) || value.length <= VAULT_CHUNK_CHARACTERS) {
    return { storedValue: value, chunks: [] };
  }
  const prefix = chunkPrefix(name, userId);
  const chunks: string[] = [];
  for (let at = 0; at < value.length; at += VAULT_CHUNK_CHARACTERS) {
    chunks.push(value.slice(at, at + VAULT_CHUNK_CHARACTERS));
  }
  const manifest: ChunkedValueManifest = {
    format: CHUNKED_VALUE_FORMAT,
    version: CHUNKED_VALUE_VERSION,
    fingerprint: snapshotFingerprint(value),
    length: value.length,
    chunkPrefix: prefix,
    chunkCount: chunks.length,
  };
  return { storedValue: JSON.stringify(manifest), manifest, chunks };
}

function validateReassembledValue(manifest: ChunkedValueManifest, chunks: readonly string[]): string {
  if (chunks.length !== manifest.chunkCount || chunks.some(chunk => typeof chunk !== "string")) {
    throw new Error("The local vault workspace is missing one or more storage chunks.");
  }
  const value = chunks.join("");
  if (value.length !== manifest.length || snapshotFingerprint(value) !== manifest.fingerprint) {
    throw new Error("The local vault workspace chunks failed their integrity check.");
  }
  return value;
}

/** Resolve one record captured from the physical IndexedDB state store.
 * Migration backups include the store's chunk records verbatim, while their
 * recovery consumers need the same logical string returned by this adapter. */
export function resolveVaultSnapshotRecord(
  records: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  const stored = records[key];
  if (typeof stored !== "string") return undefined;
  const manifest = readChunkedValueManifest(stored);
  if (!manifest) return stored;
  const chunks: string[] = [];
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const chunk = records[`${manifest.chunkPrefix}:${index}`];
    if (typeof chunk !== "string") {
      throw new Error("The local vault workspace is missing one or more storage chunks.");
    }
    chunks.push(chunk);
  }
  return validateReassembledValue(manifest, chunks);
}

function workspaceFingerprint(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return readChunkedValueManifest(value)?.fingerprint ?? snapshotFingerprint(value);
}

type VaultExpectation = {
  fingerprints: readonly (string | null)[];
  latchConflict?: boolean;
};

type NewerFallbackCopy = {
  value: string;
  marker: string;
  fingerprint: string;
  baseFingerprint?: string | null;
};

function observesWorkspace(name: string): boolean {
  return name === STORAGE_KEYS.persistedState;
}

function rememberVaultSnapshot(name: string, value: string | null): void {
  if (!observesWorkspace(name) || !conflictedWorkspaceKeys.has(name)) {
    observedVaultSnapshots.set(name, workspaceFingerprint(value));
  }
}

function observedVaultFingerprint(name: string): string | null | undefined {
  return observedVaultSnapshots.has(name) ? observedVaultSnapshots.get(name) : undefined;
}

function workspaceExpectation(name: string): VaultExpectation | undefined {
  if (!observesWorkspace(name)) return undefined;
  if (conflictedWorkspaceKeys.has(name)) throw new VaultConflictError();
  return {
    // A runtime that has not hydrated cannot safely replace an existing vault.
    // Zustand hydrates before normal writes; null only permits a genuinely new vault.
    fingerprints: [observedVaultFingerprint(name) ?? null],
  };
}

function assertFallbackStillCurrent(name: string, current: NewerFallbackCopy | null, expected: VaultExpectation | undefined): void {
  if (!expected || current === null) return;
  if (!expected.fingerprints.includes(current.fingerprint)) {
    conflictedWorkspaceKeys.add(name);
    throw new VaultConflictError();
  }
}

function fallbackExpectation(copy: NewerFallbackCopy, latchConflict = true): VaultExpectation {
  const fingerprints = copy.baseFingerprint === undefined
    ? [copy.fingerprint]
    : [copy.baseFingerprint, copy.fingerprint];
  return { fingerprints, latchConflict };
}

function encodeFallbackMarker(valueFingerprint: string, baseFingerprint: string | null | undefined): string {
  if (baseFingerprint === undefined) return valueFingerprint;
  return JSON.stringify({ version: 1, valueFingerprint, baseFingerprint });
}

/**
 * The localStorage copy, but only when a save marked it as newer than
 * IndexedDB. A copy mirrored by an older build carries no marker and can be
 * stale, so it never overrides the vault.
 */
function newerFallbackCopy(fallbackStore: Storage | null, name: string): NewerFallbackCopy | null {
  try {
    const marker = fallbackStore?.getItem(fallbackMarkerKey(name));
    if (!marker) return null;
    const value = fallbackStore?.getItem(name) ?? null;
    if (value === null) return null;

    let valueFingerprint = marker;
    let baseFingerprint: string | null | undefined;
    try {
      const parsed = JSON.parse(marker) as {
        version?: unknown;
        valueFingerprint?: unknown;
        baseFingerprint?: unknown;
      };
      if (
        parsed.version === 1
        && typeof parsed.valueFingerprint === "string"
        && (typeof parsed.baseFingerprint === "string" || parsed.baseFingerprint === null)
      ) {
        valueFingerprint = parsed.valueFingerprint;
        baseFingerprint = parsed.baseFingerprint;
      }
    } catch {
      // Legacy markers contain only the fallback snapshot fingerprint.
    }
    return snapshotFingerprint(value) === valueFingerprint
      ? { value, marker, fingerprint: valueFingerprint, baseFingerprint }
      : null;
  } catch {
    return null;
  }
}

/**
 * Workspace JSON only needs the long-lived `state` store. Open the current
 * database version instead of forcing a schema upgrade on every save: an
 * older AXOM tab may legitimately keep v1/v2 open, and that must not divert a
 * multi-megabyte workspace into localStorage while the upgrade is blocked.
 * New databases still create every current store in `onupgradeneeded`;
 * feature-specific boundaries request an upgrade only when their store is absent.
 */
function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(req.result);
    };
    req.onsuccess = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.close();
        reject(new Error("The local vault is missing its workspace store"));
        return;
      }
      // A brand-new database has no competing connection, so finish at the
      // canonical schema version. Only pre-existing databases use their
      // current store without demanding an upgrade from older open tabs.
      if (created && req.result.version < DB_VERSION) {
        req.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open local vault"));
    req.onblocked = () => reject(new Error("Local vault access is blocked by another tab"));
  });
}

function openUpgradedVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (vaultUpgradeBlocked) {
      reject(new Error("Local vault upgrade is blocked by another tab"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
      // A blocked request can succeed later after its caller already fell back.
      // Do not leak that late database connection or resolve a settled promise.
      if (blocked) {
        vaultUpgradeBlocked = false;
        req.result.close();
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => {
      if (blocked) vaultUpgradeBlocked = false;
      reject(req.error ?? new Error("Unable to upgrade local vault"));
    };
    req.onblocked = () => {
      blocked = true;
      vaultUpgradeBlocked = true;
      reject(new Error("Local vault upgrade is blocked by another tab"));
    };
  });
}

function openExistingVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(req.result);
    };
    req.onsuccess = () => {
      if (created && req.result.version < DB_VERSION) {
        req.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open existing local vault"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  open: () => Promise<IDBDatabase> = openVault,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = run(tx.objectStore(STORE_NAME));
    let result: T;
    let settled = false;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => {
      if (!settled) reject(req.error ?? new Error("Local vault request failed"));
      settled = true;
    };
    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve(result);
      settled = true;
    };
    tx.onerror = () => {
      db.close();
      if (!settled) reject(tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
    tx.onabort = tx.onerror;
  });
}

/** Read either a legacy single-value record or an atomically stored chunk set. */
async function readVaultRecord(
  key: string,
  open: () => Promise<IDBDatabase> = openExistingVault,
): Promise<string | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const primary = store.get(key);
    let result: string | undefined;
    let failure: Error | undefined;
    let chunked: { manifest: ChunkedValueManifest; chunks: string[] } | undefined;
    primary.onsuccess = () => {
      if (typeof primary.result !== "string") return;
      const manifest = readChunkedValueManifest(primary.result);
      if (!manifest) {
        result = primary.result;
        return;
      }
      const chunks = new Array<string>(manifest.chunkCount);
      chunked = { manifest, chunks };
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const request = store.get(`${manifest.chunkPrefix}:${index}`);
        request.onsuccess = () => {
          if (typeof request.result !== "string") {
            failure ??= new Error("The local vault workspace is missing one or more storage chunks.");
            return;
          }
          chunks[index] = request.result;
        };
        request.onerror = () => { failure ??= request.error ?? new Error("Unable to read a local vault chunk."); };
      }
    };
    primary.onerror = () => { failure = primary.error ?? new Error("Unable to read the local workspace."); };
    tx.oncomplete = () => {
      db.close();
      if (!failure && chunked) {
        try { result = validateReassembledValue(chunked.manifest, chunked.chunks); }
        catch (error) { failure = error instanceof Error ? error : new Error("Unable to rebuild the local workspace."); }
      }
      if (failure) reject(failure);
      else resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? failure ?? new Error("Local vault read failed"));
    };
    tx.onabort = tx.onerror;
  });
}

/** One transaction: compare the hydrated workspace, then replace its primary,
 * active-profile pointer and per-profile copy. IndexedDB keeps the comparison
 * and writes atomic across browser tabs. */
async function writeVault(
  name: string,
  value: string,
  userId: string,
  expected?: VaultExpectation,
): Promise<void> {
  const plan = storedValuePlan(name, value, userId);
  // A chunk manifest is only safe after the physical v4 upgrade succeeds.
  // Otherwise an already-open v3 writer could replace the manifest with a
  // legacy single value while leaving its chunks behind. Small legacy values
  // can continue using the long-lived state store while an upgrade is blocked.
  const db = await (plan.manifest ? openUpgradedVault() : openVault());
  if (plan.manifest && db.version < DB_VERSION) {
    db.close();
    throw new Error("The local vault must finish its storage upgrade before saving this large workspace.");
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let conflict: VaultConflictError | null = null;
    let settled = false;

    const write = (current: string | undefined, previous: readonly (string | undefined)[]) => {
      // A missing record is a fresh/recreated vault, not a competing revision.
      // Conflicts only exist when another concrete workspace replaced the one
      // this runtime hydrated.
      if (
        expected
        && typeof current === "string"
        && !expected.fingerprints.includes(workspaceFingerprint(current))
      ) {
        conflict = new VaultConflictError();
        if (expected.latchConflict !== false && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        tx.abort();
        return;
      }
      const currentPrefix = chunkPrefix(name, userId);
      const nextChunkCount = plan.manifest?.chunkPrefix === currentPrefix ? plan.manifest.chunkCount : 0;
      for (const raw of previous) {
        const manifest = readChunkedValueManifest(raw);
        if (!manifest || manifest.chunkPrefix !== currentPrefix) continue;
        for (let index = nextChunkCount; index < manifest.chunkCount; index += 1) {
          store.delete(`${manifest.chunkPrefix}:${index}`);
        }
      }
      if (plan.manifest) {
        plan.chunks.forEach((chunk, index) => store.put(chunk, `${plan.manifest!.chunkPrefix}:${index}`));
      }
      store.put(plan.storedValue, name);
      if (userId) {
        store.put(userId, activeUserKey(name));
        store.put(plan.storedValue, scopedStateKey(name, userId));
      }
    };

    const primary = store.get(name);
    primary.onsuccess = () => {
      const primaryValue = typeof primary.result === "string" ? primary.result : undefined;
      const userScoped = userId ? store.get(scopedStateKey(name, userId)) : undefined;
      const finish = (userScopedValue?: string) => {
        if (primaryValue !== undefined) {
          write(primaryValue, [primaryValue, userScopedValue]);
          return;
        }
        const active = store.get(activeUserKey(name));
        active.onsuccess = () => {
          if (typeof active.result !== "string" || !active.result) {
            write(userScopedValue, [userScopedValue]);
            return;
          }
          const scoped = store.get(scopedStateKey(name, active.result));
          scoped.onsuccess = () => {
            const activeValue = typeof scoped.result === "string" ? scoped.result : undefined;
            write(activeValue ?? userScopedValue, [userScopedValue, activeValue]);
          };
        };
      };
      if (!userScoped) finish();
      else userScoped.onsuccess = () => finish(typeof userScoped.result === "string" ? userScoped.result : undefined);
    };

    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve();
      settled = true;
    };
    tx.onerror = () => {
      if (conflict || settled) return;
      db.close();
      reject(tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
    tx.onabort = () => {
      db.close();
      if (!settled) reject(conflict ?? tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
  });
}

// IndexedDB owns the large serialized workspace. localStorage keeps only the
// tiny active-profile pointer and device preferences; remove the mirrored
// state, and the marker that called it newer, after a confirmed vault write.
function clearFallbackCopy(fallbackStore: Storage | null, name: string, userId: string): void {
  // These optional mirrors must not turn a confirmed IndexedDB write into a
  // failed save when localStorage is full or unavailable.
  try {
    fallbackStore?.removeItem(name);
    fallbackStore?.removeItem(fallbackMarkerKey(name));
    if (userId) {
      fallbackStore?.setItem(activeUserKey(name), userId);
      fallbackStore?.removeItem(scopedStateKey(name, userId));
    }
  } catch { /* IndexedDB already holds the durable workspace. */ }
}

async function readVaultSnapshot(name: string): Promise<string | null> {
  const primary = await readVaultRecord(name, openExistingVault);
  if (primary) return primary;
  const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
  if (!activeUser) return null;
  return await readVaultRecord(scopedStateKey(name, activeUser), openExistingVault) ?? null;
}

async function removeVaultRecords(name: string, active?: string): Promise<void> {
  const db = await openExistingVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const keys = [name, ...(active ? [scopedStateKey(name, active)] : [])];
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        const manifest = readChunkedValueManifest(typeof request.result === "string" ? request.result : undefined);
        if (!manifest) return;
        for (let index = 0; index < manifest.chunkCount; index += 1) {
          store.delete(`${manifest.chunkPrefix}:${index}`);
        }
      };
      store.delete(key);
    }
    store.delete(activeUserKey(name));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Unable to remove the local workspace.")); };
    tx.onabort = tx.onerror;
  });
}

function clearFallbackCopyIfUnchanged(
  fallbackStore: Storage | null,
  name: string,
  copy: NewerFallbackCopy,
  currentUserId: string,
): void {
  try {
    if (
      fallbackStore?.getItem(fallbackMarkerKey(name)) !== copy.marker
      || fallbackStore.getItem(name) !== copy.value
    ) return;
    const fallbackUserId = persistedUserId(copy.value);
    fallbackStore.removeItem(name);
    fallbackStore.removeItem(fallbackMarkerKey(name));
    if (fallbackUserId) fallbackStore.removeItem(scopedStateKey(name, fallbackUserId));
    if (currentUserId) fallbackStore.setItem(activeUserKey(name), currentUserId);
  } catch { /* The durable IndexedDB snapshot remains authoritative. */ }
}

const vaultStorage: StateStorage = {
  async getItem(name) {
    // A save that could not reach IndexedDB leaves its snapshot here, ahead of
    // the vault. Reading the vault first used to hand back the older copy, and
    // the next successful save then deleted the newer one.
    const fallbackStore = localFallback();
    const newer = newerFallbackCopy(fallbackStore, name);
    if (newer !== null) {
      const userId = persistedUserId(newer.value);
      try {
        // The marker records the IndexedDB snapshot on which this fallback was
        // based. Comparing that base and the fallback itself in one transaction
        // prevents a late promotion from replacing a newer tab's commit.
        await writeVault(name, newer.value, userId, fallbackExpectation(newer, false));
        clearFallbackCopy(fallbackStore, name, userId);
      } catch (promotionError) {
        if (isVaultConflictError(promotionError) && newer.baseFingerprint !== undefined) {
          try {
            const current = await readVaultSnapshot(name);
            if (current !== null) {
              clearFallbackCopyIfUnchanged(fallbackStore, name, newer, persistedUserId(current));
              rememberVaultSnapshot(name, current);
              return current;
            }
          } catch {
            // Keep the fallback below when the winning vault cannot be reread.
          }
        }
        // Still not writable: the copy stays in localStorage for the next start.
      }
      rememberVaultSnapshot(name, newer.value);
      return newer.value;
    }

    try {
      const value = await readVaultRecord(name, openExistingVault);
      if (value) {
        rememberVaultSnapshot(name, value);
        return value;
      }

      const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
      if (activeUser) {
        const scoped = await readVaultRecord(scopedStateKey(name, activeUser), openExistingVault);
        if (scoped) {
          rememberVaultSnapshot(name, scoped);
          return scoped;
        }
      }
    } catch {
      // Fall back below.
    }

    const fallback = fallbackStore?.getItem(name) ??
      fallbackStore?.getItem(scopedStateKey(name, fallbackStore?.getItem(activeUserKey(name)) ?? "")) ??
      null;
    if (fallback) {
      try {
        await writeVault(name, fallback, persistedUserId(fallback));
      } catch {
        // localStorage still has the data; no need to interrupt app load.
      }
    }
    rememberVaultSnapshot(name, fallback);
    return fallback;
  },

  async setItem(name, value) {
    const writeSequence = ++vaultWriteSequence;
    const userId = persistedUserId(value);
    const fallbackStore = localFallback();
    let fallbackBaseFingerprint: string | null | undefined;
    try {
      const expected = workspaceExpectation(name);
      const currentFallback = newerFallbackCopy(fallbackStore, name);
      assertFallbackStillCurrent(name, currentFallback, expected);
      fallbackBaseFingerprint = currentFallback !== null
        ? currentFallback.baseFingerprint
        : observedVaultFingerprint(name);
      if (currentFallback === null && fallbackBaseFingerprint === undefined) {
        try {
          fallbackBaseFingerprint = workspaceFingerprint(await readVaultSnapshot(name));
        } catch {
          // The write attempt below decides whether a local fallback is needed.
        }
      }
      if (fallbackBaseFingerprint === undefined) {
        fallbackBaseFingerprint = expected?.fingerprints[0];
      }
      // A fallback save can replace only the vault snapshot on which its chain
      // began, or an idempotent promotion of the same fallback. A competing
      // commit is rejected inside the IndexedDB transaction.
      const vaultExpectation = currentFallback !== null
        ? fallbackExpectation(currentFallback)
        : expected;
      await writeVault(name, value, userId, vaultExpectation);
      clearFallbackCopy(fallbackStore, name, userId);
      rememberVaultSnapshot(name, value);
      markVaultWrite("indexeddb");
    } catch (indexedDbError) {
      if (isVaultConflictError(indexedDbError)) {
        if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        vaultWriteFailures.set(writeSequence, indexedDbError);
        markVaultWriteFailure();
        return;
      }
      // Try the established localStorage recovery path for any workspace.
      // Browser quotas vary, and medium multi-megabyte snapshots can still fit;
      // the storage implementation itself is the authority on available room.
      let saved: boolean;
      let failure: unknown;
      const previousFallback = newerFallbackCopy(fallbackStore, name);
      try {
        const expected = workspaceExpectation(name);
        assertFallbackStillCurrent(name, previousFallback, expected);
        // Marker first: it is tiny, and one that does not match the copy beside
        // it is ignored, so a copy that failed to land is never read as newer.
        // Retain the original vault base across a chain of fallback-only saves.
        const baseFingerprint = previousFallback !== null
          ? previousFallback.baseFingerprint
          : fallbackBaseFingerprint === undefined
            ? expected?.fingerprints[0]
            : fallbackBaseFingerprint;
        fallbackStore?.setItem(
          fallbackMarkerKey(name),
          encodeFallbackMarker(snapshotFingerprint(value), baseFingerprint),
        );
        writeLocalFallback(fallbackStore, name, value, userId, indexedDbError);
        saved = true;
      } catch (fallbackError) {
        failure = fallbackError;
        const conflict = isVaultConflictError(fallbackError);
        if (conflict && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        // The workspace copy can land before the per-profile copy runs out of room.
        try { saved = !conflict && fallbackStore?.getItem(name) === value; } catch { saved = false; }
      }
      if (saved) {
        rememberVaultSnapshot(name, value);
        markVaultWrite("local-fallback");
      } else {
        // A quota failure leaves the preceding workspace in place. Keep its
        // valid marker too, or the next start would prefer the older vault.
        try {
          if (previousFallback !== null && fallbackStore?.getItem(name) === previousFallback.value) {
            if (fallbackStore.getItem(fallbackMarkerKey(name)) !== previousFallback.marker) {
              fallbackStore.setItem(fallbackMarkerKey(name), previousFallback.marker);
            }
          } else {
            fallbackStore?.removeItem(fallbackMarkerKey(name));
          }
        } catch { /* the last successful copy remains available for recovery */ }
        vaultWriteFailures.set(
          writeSequence,
          failure instanceof Error ? failure : new Error("AXOM could not persist the local workspace."),
        );
        // Ordinary saves are best-effort, so say so: this one is on no disk.
        markVaultWriteFailure();
      }
    }
  },

  async removeItem(name) {
    const fallback = localFallback();
    let active = fallback?.getItem(activeUserKey(name)) ?? undefined;
    if (!active) {
      try {
        active = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
      } catch {
        // Continue with the localStorage cleanup path below.
      }
    }
    fallback?.removeItem(name);
    fallback?.removeItem(fallbackMarkerKey(name));
    fallback?.removeItem(activeUserKey(name));
    if (active) fallback?.removeItem(scopedStateKey(name, active));
    try {
      await removeVaultRecords(name, active);
    } catch {
      // No-op; best effort cleanup.
    }
  },
};

/** Replace a verified workspace backup even when the live chunk manifest can
 * no longer be reconstructed. This intentionally bypasses the ordinary
 * hydrated-snapshot conflict check; callers must validate and explicitly
 * authorize the replacement before scheduling it. A failed IndexedDB write is
 * reported instead of leaving a forced restore in a fallback that cannot be
 * promoted safely later. */
async function replaceVaultItem(name: string, value: string): Promise<void> {
  const writeSequence = ++vaultWriteSequence;
  const userId = persistedUserId(value);
  try {
    await writeVault(name, value, userId);
    clearFallbackCopy(localFallback(), name, userId);
    conflictedWorkspaceKeys.delete(name);
    rememberVaultSnapshot(name, value);
    markVaultWrite("indexeddb");
  } catch (error) {
    vaultWriteFailures.set(
      writeSequence,
      error instanceof Error ? error : new Error("AXOM could not replace the local workspace."),
    );
    markVaultWriteFailure();
  }
}

// Writes are coalesced per key, newest wins: at most one IndexedDB write is in
// flight, and a burst of saves collapses into the latest snapshot. An older
// save can therefore never land after a newer one (the update checkpoint relies
// on that), and a quick reload or tab close is not stuck behind a backlog of
// stale full-workspace writes.
type VaultOp = { kind: "set" | "replace"; value: string } | { kind: "remove" };
const pendingVaultOps = new Map<string, VaultOp>();
let vaultDrain: Promise<void> | null = null;

async function drainVaultWrites(): Promise<void> {
  try {
    while (pendingVaultOps.size) {
      const [name, op] = pendingVaultOps.entries().next().value as [string, VaultOp];
      pendingVaultOps.delete(name);
      try {
        if (op.kind === "set") await vaultStorage.setItem(name, op.value);
        else if (op.kind === "replace") await replaceVaultItem(name, op.value);
        else await vaultStorage.removeItem(name);
      } catch {
        // setItem records failures itself (assertVaultWrite); keep draining.
      }
    }
  } finally {
    vaultDrain = null;
  }
}

function scheduleVaultWrite(name: string, op: VaultOp): Promise<void> {
  pendingVaultOps.set(name, op);
  vaultDrain ??= drainVaultWrites();
  return vaultDrain;
}

/** Resolves once every save requested so far (or a newer one) is on disk. */
export function flushLocalVaultWrites(): Promise<void> {
  return vaultDrain ?? Promise.resolve();
}

export const localVaultStorage: StateStorage = {
  getItem: (name) => vaultStorage.getItem(name),
  setItem: (name, value) => scheduleVaultWrite(name, { kind: "set", value }),
  removeItem: (name) => scheduleVaultWrite(name, { kind: "remove" }),
};

/** Schedule an explicit verified-backup replacement after earlier writes. */
export function replaceLocalVaultItem(name: string, value: string): Promise<void> {
  return scheduleVaultWrite(name, { kind: "replace", value });
}

function persistedUserId(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      state?: { profile?: { userId?: unknown; name?: unknown } };
    };
    const profile = parsed.state?.profile;
    if (!profile) return "";
    if (typeof profile?.userId === "string" && profile.userId.trim()) return profile.userId;
    return userIdFromName(typeof profile?.name === "string" ? profile.name : "");
  } catch {
    return "";
  }
}
