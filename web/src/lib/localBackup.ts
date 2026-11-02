import { compressText, decompressText } from "./compressedText";
import { BUILD_INFO, type BuildInfo } from "./buildInfo";
import { STORAGE_KEYS } from "./brand";
import {
  BACKUP_STORE_NAME,
  DB_NAME,
  DB_VERSION as VAULT_DB_VERSION,
  ensureVaultStores,
  STORE_NAME as VAULT_STORE_NAME,
} from "./localVault";

const BACKUP_SCHEMA_VERSION = 1;
const DEFAULT_BACKUP_LIMIT = 8;
const CHUNKED_BACKUP_FORMAT = "axom-local-backup-chunks";
const CHUNKED_BACKUP_VERSION = 1;
/** Keep an individual backup value comfortably below browser large-value edges. */
const BACKUP_CHUNK_CHARACTERS = 1024 * 1024;
const COMPACT_BACKUP_MARKER = "idb";
const BACKUP_SUMMARY_FORMAT = "axom-local-backup-summary";
const BACKUP_SUMMARY_VERSION = 1;
const BACKUP_SUMMARY_KEY_PREFIX = "axom.backups.summary.";

interface ChunkedBackupManifest {
  format: typeof CHUNKED_BACKUP_FORMAT;
  version: typeof CHUNKED_BACKUP_VERSION;
  fingerprint: string;
  length: number;
  chunkPrefix: string;
  chunkCount: number;
}

interface StoredBackupSummary extends LocalBackupSummary {
  format: typeof BACKUP_SUMMARY_FORMAT;
  version: typeof BACKUP_SUMMARY_VERSION;
}

export interface LocalBackupSnapshot {
  schemaVersion: number;
  savedAt: string;
  oldSchemaVersion: number;
  build: BuildInfo;
  localStorage: Record<string, string>;
  indexedDb?: {
    dbName: string;
    storeName: string;
    records: Record<string, string>;
  };
}

export interface LocalBackupSummary {
  key: string;
  savedAt: string;
  oldSchemaVersion: number;
  appVersion: string;
  commitSha: string;
}

interface LocalBackupMarker extends LocalBackupSummary {
  schemaVersion: number;
  storage: "indexeddb";
  sizeBytes: number;
}

type CompactLocalBackupMarker = [
  typeof COMPACT_BACKUP_MARKER,
  oldSchemaVersion: number,
  appVersion: string,
  commitSha: string,
];

/** Keeps a durable IndexedDB backup visible during the current session even
 * when localStorage has no room for either metadata marker. */
const runtimeBackupSummaries = new Map<string, LocalBackupSummary>();
let backupSummaryHydration: Promise<void> | null = null;
let backupSummariesHydrated = false;
let lastBackupEpoch = 0;

export function resetLocalBackupRuntimeForTests(): void {
  runtimeBackupSummaries.clear();
  backupSummaryHydration = null;
  backupSummariesHydrated = false;
  lastBackupEpoch = 0;
}

export async function createLocalBackup(
  oldSchemaVersion: number,
  backupLimit = DEFAULT_BACKUP_LIMIT,
): Promise<string | null> {
  let savedAt = nextBackupSavedAt();
  const snapshot: LocalBackupSnapshot = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    savedAt,
    oldSchemaVersion,
    build: BUILD_INFO,
    localStorage: collectRelevantLocalStorage(),
  };

  const indexedDb = await readVaultIndexedDb().catch(() => undefined);
  if (indexedDb && Object.keys(indexedDb.records).length > 0) {
    snapshot.indexedDb = indexedDb;
  }

  if (Object.keys(snapshot.localStorage).length === 0 && !snapshot.indexedDb) {
    return null;
  }

  const storage = getLocalStorage();
  let key = `${STORAGE_KEYS.localBackupPrefix}${savedAt}`;
  while (storage?.getItem(key) !== null || runtimeBackupSummaries.has(key)) {
    savedAt = nextBackupSavedAt();
    snapshot.savedAt = savedAt;
    key = `${STORAGE_KEYS.localBackupPrefix}${savedAt}`;
  }
  let serialized = JSON.stringify(snapshot);
  let indexedDbStored = false;
  try {
    for (let attempts = 0; attempts < 1_000; attempts += 1) {
      try {
        await writeBackupRecord(key, serialized, toSummary(key, snapshot), true);
        indexedDbStored = true;
        break;
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        savedAt = nextBackupSavedAt();
        snapshot.savedAt = savedAt;
        key = `${STORAGE_KEYS.localBackupPrefix}${savedAt}`;
        serialized = JSON.stringify(snapshot);
      }
    }
    if (!indexedDbStored) throw new Error("AXOM could not allocate a unique local backup key.");
    runtimeBackupSummaries.set(key, toSummary(key, snapshot));
  } catch {
    // Private browsing and storage policies can disable IndexedDB. Keep a full
    // localStorage fallback in that case rather than losing the safety copy.
    if (!storage) throw new Error("No browser storage is available for the migration backup.");
    storage.setItem(key, serialized);
    runtimeBackupSummaries.set(key, toSummary(key, snapshot));
    // Do not immediately retry IndexedDB from pruning. A blocked upgrade stays
    // queued until the older tab closes, so another open here could hang after
    // the full localStorage fallback already succeeded. Retention can still be
    // enforced synchronously over self-contained local snapshots.
    pruneLocalStorageFallbackSnapshots(storage, backupLimit);
    return key;
  }
  // Migrating older snapshots is opportunistic and runs only after the new
  // backup succeeds, so a blocked legacy move cannot stall this safety copy.
  await migrateLegacyBackupsToIndexedDb(storage).catch(() => undefined);
  // The large payload is already durable. Metadata pressure must never send it
  // through the full localStorage fallback or abort the import that requested it.
  storeBackupMarker(storage, key, snapshot, serialized.length);
  await pruneLocalBackups(backupLimit);
  return key;
}

export function listLocalBackups(): LocalBackupSummary[] {
  // IndexedDB cannot be read synchronously. Start durable discovery without
  // changing this API; callers that need a complete first result after reload
  // can await refreshLocalBackupSummaries().
  void hydrateBackupSummaries();
  return currentLocalBackupSummaries();
}

/** Populate the synchronous backup list from durable IndexedDB metadata.
 * This is the reload-safe path when localStorage could not fit any marker. */
export async function refreshLocalBackupSummaries(): Promise<LocalBackupSummary[]> {
  await hydrateBackupSummaries();
  return currentLocalBackupSummaries();
}

function currentLocalBackupSummaries(): LocalBackupSummary[] {
  const storage = getLocalStorage();
  const localKeys = storage
    ? localStorageKeys(storage).filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix))
    : [];
  return [...new Set([...localKeys, ...runtimeBackupSummaries.keys()])]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => summaryForKey(key, storage));
}

export async function readLocalBackup(key: string): Promise<LocalBackupSnapshot | null> {
  const storage = getLocalStorage();
  const local = storage?.getItem(key);
  if (local) {
    try {
      const parsed = JSON.parse(local) as unknown;
      if (isBackupSnapshot(parsed)) {
        runtimeBackupSummaries.set(key, toSummary(key, parsed));
        return parsed;
      }
    } catch {
      /* try the IndexedDB record below */
    }
  }
  try {
    const serialized = await readBackupRecord(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    if (!isBackupSnapshot(parsed)) return null;
    runtimeBackupSummaries.set(key, toSummary(key, parsed));
    return parsed;
  } catch {
    return null;
  }
}

export async function pruneLocalBackups(keep = DEFAULT_BACKUP_LIMIT): Promise<void> {
  const storage = getLocalStorage();
  const localKeys = storage
    ? localStorageKeys(storage).filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix))
    : [];
  const indexedDbKeys = await listBackupRecordKeys().catch(() => []);
  const keys = [...new Set([...localKeys, ...indexedDbKeys, ...runtimeBackupSummaries.keys()])]
    .sort((a, b) => b.localeCompare(a));
  const recoverable: string[] = [];
  for (const key of keys) {
    if (await readLocalBackup(key)) recoverable.push(key);
    else runtimeBackupSummaries.delete(key);
  }
  // Unreadable markers never count toward retention. A temporary IndexedDB
  // outage must not let newer metadata displace the last verified snapshot.
  for (const key of recoverable.slice(Math.max(0, keep))) {
    storage?.removeItem(key);
    await deleteBackupRecord(key).catch(() => undefined);
    runtimeBackupSummaries.delete(key);
  }
}

function collectRelevantLocalStorage(): Record<string, string> {
  const storage = getLocalStorage();
  if (!storage) return {};
  const snapshot: Record<string, string> = {};
  for (const key of localStorageKeys(storage)) {
    if (!isRelevantStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
}

function isRelevantStorageKey(key: string): boolean {
  if (key.startsWith(STORAGE_KEYS.localBackupPrefix)) return false;
  return (
    key === STORAGE_KEYS.persistedState ||
    key.startsWith(`${STORAGE_KEYS.persistedState}:`) ||
    key.startsWith("noctyrium") ||
    key.startsWith("noctyrium:") ||
    key.startsWith("axom.")
  );
}

function localStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

/** Prune only full, independently recoverable localStorage snapshots. This is
 * deliberately IndexedDB-free so a blocked upgrade cannot stall retention. */
function pruneLocalStorageFallbackSnapshots(storage: Storage, keep: number): void {
  const snapshots = localStorageKeys(storage)
    .filter(key => key.startsWith(STORAGE_KEYS.localBackupPrefix))
    .filter(key => {
      try {
        const raw = storage.getItem(key);
        return raw !== null && isBackupSnapshot(JSON.parse(raw));
      } catch {
        return false;
      }
    })
    .sort((left, right) => right.localeCompare(left));
  for (const key of snapshots.slice(Math.max(0, keep))) {
    storage.removeItem(key);
    runtimeBackupSummaries.delete(key);
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

async function readVaultIndexedDb(): Promise<NonNullable<LocalBackupSnapshot["indexedDb"]>> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable");
  const db = await openExistingVault();
  try {
    const tx = db.transaction(VAULT_STORE_NAME, "readonly");
    const store = tx.objectStore(VAULT_STORE_NAME);
    const [keys, values] = await Promise.all([
      requestResult(store.getAllKeys()),
      requestResult(store.getAll()),
    ]);
    const records: Record<string, string> = {};
    keys.forEach((key, index) => {
      records[String(key)] = serializeStoredValue(values[index]);
    });
    if (db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
      rememberBackupSummaries(await readStoredBackupSummaries(db));
      backupSummariesHydrated = true;
    }
    return { dbName: DB_NAME, storeName: VAULT_STORE_NAME, records };
  } finally {
    db.close();
  }
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let created = false;
    let blocked = false;
    request.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(request.result);
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      if (!request.result.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        request.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      if (created && request.result.version < VAULT_DB_VERSION) {
        request.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open local vault"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local vault access is blocked by another tab"));
    };
  });
}

function openUpgradedVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VAULT_DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => ensureVaultStores(request.result);
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to upgrade local vault"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local vault upgrade is blocked by another tab"));
    };
  });
}

function openExistingVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(request.result);
    };
    request.onsuccess = () => {
      if (created && request.result.version < VAULT_DB_VERSION) {
        request.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open existing local vault"));
  });
}

async function writeBackupRecord(
  key: string,
  value: string,
  summary: LocalBackupSummary,
  exclusive = false,
): Promise<void> {
  const packed = await compressText(value);
  const db = await openVault();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, "readwrite");
    const store = tx.objectStore(BACKUP_STORE_NAME);
    store.put(JSON.stringify(toStoredSummary(summary)), backupSummaryKey(key));
    if (packed.length <= BACKUP_CHUNK_CHARACTERS) {
      if (exclusive) store.add(packed, key);
      else store.put(packed, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error("IndexedDB backup transaction failed")); };
      tx.onabort = tx.onerror;
      return;
    }
    const prefix = `${key}:chunks`;
    const chunks: string[] = [];
    for (let at = 0; at < packed.length; at += BACKUP_CHUNK_CHARACTERS) {
      chunks.push(packed.slice(at, at + BACKUP_CHUNK_CHARACTERS));
    }
    const manifest: ChunkedBackupManifest = {
      format: CHUNKED_BACKUP_FORMAT,
      version: CHUNKED_BACKUP_VERSION,
      fingerprint: backupFingerprint(packed),
      length: packed.length,
      chunkPrefix: prefix,
      chunkCount: chunks.length,
    };
    chunks.forEach((chunk, index) => store.put(chunk, `${prefix}:${index}`));
    if (exclusive) store.add(JSON.stringify(manifest), key);
    else store.put(JSON.stringify(manifest), key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("IndexedDB backup transaction failed")); };
    tx.onabort = tx.onerror;
  });
}

async function readBackupRecord(key: string): Promise<string | undefined> {
  const db = await openVault();
  const stored = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, "readonly");
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const primary = store.get(key);
    let result: string | undefined;
    let failure: Error | undefined;
    let chunked: { manifest: ChunkedBackupManifest; chunks: string[] } | undefined;
    primary.onsuccess = () => {
      if (typeof primary.result !== "string") return;
      const manifest = readChunkedBackupManifest(primary.result, key);
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
            failure ??= new Error("The local backup is missing one or more storage chunks.");
            return;
          }
          chunks[index] = request.result;
        };
        request.onerror = () => { failure ??= request.error ?? new Error("Unable to read a local backup chunk."); };
      }
    };
    primary.onerror = () => { failure = primary.error ?? new Error("Unable to read the local backup."); };
    tx.oncomplete = () => {
      db.close();
      if (!failure && chunked) {
        try {
          const packed = chunked.chunks.join("");
          if (
            packed.length !== chunked.manifest.length
            || backupFingerprint(packed) !== chunked.manifest.fingerprint
          ) throw new Error("The local backup chunks failed their integrity check.");
          result = packed;
        } catch (error) {
          failure = error instanceof Error ? error : new Error("Unable to rebuild the local backup.");
        }
      }
      if (failure) reject(failure);
      else resolve(result);
    };
    tx.onerror = () => { db.close(); reject(tx.error ?? failure ?? new Error("IndexedDB backup read failed")); };
    tx.onabort = tx.onerror;
  });
  return stored === undefined ? undefined : decompressText(stored);
}

async function listBackupRecordKeys(): Promise<string[]> {
  const keys = await withBackupStore("readonly", (store) => store.getAllKeys());
  return keys.map(String).filter((key) => (
    key.startsWith(STORAGE_KEYS.localBackupPrefix)
    && !key.includes(":chunks:")
  ));
}

async function deleteBackupRecord(key: string): Promise<void> {
  const db = await openVault();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, "readwrite");
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const manifest = readChunkedBackupManifest(
        typeof request.result === "string" ? request.result : undefined,
        key,
      );
      if (manifest) {
        for (let index = 0; index < manifest.chunkCount; index += 1) {
          store.delete(`${manifest.chunkPrefix}:${index}`);
        }
      }
      store.delete(key);
      store.delete(backupSummaryKey(key));
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("IndexedDB backup deletion failed")); };
    tx.onabort = tx.onerror;
  });
}

function backupSummaryKey(key: string): string {
  return `${BACKUP_SUMMARY_KEY_PREFIX}${key}`;
}

function toStoredSummary(summary: LocalBackupSummary): StoredBackupSummary {
  return {
    format: BACKUP_SUMMARY_FORMAT,
    version: BACKUP_SUMMARY_VERSION,
    ...summary,
  };
}

function readStoredBackupSummary(value: unknown): StoredBackupSummary | undefined {
  if (typeof value !== "string" || value.length > 4096 || !value.includes(BACKUP_SUMMARY_FORMAT)) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBackupSummary>;
    if (
      parsed.format !== BACKUP_SUMMARY_FORMAT
      || parsed.version !== BACKUP_SUMMARY_VERSION
      || typeof parsed.key !== "string"
      || !parsed.key.startsWith(STORAGE_KEYS.localBackupPrefix)
      || typeof parsed.savedAt !== "string"
      || typeof parsed.oldSchemaVersion !== "number"
      || typeof parsed.appVersion !== "string"
      || typeof parsed.commitSha !== "string"
    ) return undefined;
    return parsed as StoredBackupSummary;
  } catch {
    return undefined;
  }
}

async function readStoredBackupSummaries(db: IDBDatabase): Promise<StoredBackupSummary[]> {
  if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, "readonly");
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const keysRequest = store.getAllKeys();
    const summaries: StoredBackupSummary[] = [];
    let failure: Error | undefined;
    keysRequest.onsuccess = () => {
      for (const rawKey of keysRequest.result) {
        const storedKey = String(rawKey);
        if (!storedKey.startsWith(BACKUP_SUMMARY_KEY_PREFIX)) continue;
        const request = store.get(storedKey);
        request.onsuccess = () => {
          const summary = readStoredBackupSummary(request.result);
          if (summary) summaries.push(summary);
        };
        request.onerror = () => { failure ??= request.error ?? new Error("Unable to read backup metadata."); };
      }
    };
    keysRequest.onerror = () => { failure = keysRequest.error ?? new Error("Unable to list backup metadata."); };
    tx.oncomplete = () => failure ? reject(failure) : resolve(summaries);
    tx.onerror = () => reject(tx.error ?? failure ?? new Error("Unable to read backup metadata."));
    tx.onabort = tx.onerror;
  });
}

function rememberBackupSummaries(summaries: readonly LocalBackupSummary[]): void {
  for (const summary of summaries) runtimeBackupSummaries.set(summary.key, summary);
}

function hydrateBackupSummaries(): Promise<void> {
  if (backupSummariesHydrated || typeof indexedDB === "undefined") return Promise.resolve();
  if (backupSummaryHydration) return backupSummaryHydration;
  backupSummaryHydration = (async () => {
    try {
      const db = await openExistingVault();
      try {
        if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) return;
        rememberBackupSummaries(await readStoredBackupSummaries(db));
        backupSummariesHydrated = true;
      } finally {
        db.close();
      }
    } catch {
      // Discovery is best-effort while another tab blocks an IndexedDB upgrade.
      // Direct reads and localStorage fallbacks remain available.
    } finally {
      backupSummaryHydration = null;
    }
  })();
  return backupSummaryHydration;
}

function summaryForKey(key: string, storage: Storage | null): LocalBackupSummary {
  const fallbackSavedAt = key.slice(STORAGE_KEYS.localBackupPrefix.length);
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (isBackupSnapshot(parsed)) return toSummary(key, parsed);
    if (isBackupMarker(parsed)) {
      return {
        key,
        savedAt: parsed.savedAt,
        oldSchemaVersion: parsed.oldSchemaVersion,
        appVersion: parsed.appVersion,
        commitSha: parsed.commitSha,
      };
    }
    if (isCompactBackupMarker(parsed)) {
      return {
        key,
        savedAt: fallbackSavedAt,
        oldSchemaVersion: parsed[1],
        appVersion: parsed[2],
        commitSha: parsed[3],
      };
    }
  } catch {
    /* ignore malformed backup metadata */
  }
  return runtimeBackupSummaries.get(key) ?? {
    key,
    savedAt: fallbackSavedAt,
    oldSchemaVersion: 0,
    appVersion: "unknown",
    commitSha: "unknown",
  };
}

function nextBackupSavedAt(): string {
  const epoch = Math.max(Date.now(), lastBackupEpoch + 1);
  lastBackupEpoch = epoch;
  return new Date(epoch).toISOString();
}

function isConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    && error.name === "ConstraintError";
}

function backupFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

function readChunkedBackupManifest(value: string | undefined, key: string): ChunkedBackupManifest | undefined {
  if (typeof value !== "string" || value.length > 4096 || !value.includes(CHUNKED_BACKUP_FORMAT)) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkedBackupManifest>;
    if (
      parsed.format !== CHUNKED_BACKUP_FORMAT
      || parsed.version !== CHUNKED_BACKUP_VERSION
      || typeof parsed.fingerprint !== "string"
      || typeof parsed.length !== "number"
      || !Number.isSafeInteger(parsed.length)
      || parsed.length < 0
      || typeof parsed.chunkPrefix !== "string"
      || parsed.chunkPrefix !== `${key}:chunks`
      || typeof parsed.chunkCount !== "number"
      || !Number.isSafeInteger(parsed.chunkCount)
      || parsed.chunkCount < 1
      || parsed.chunkCount > 100_000
    ) return undefined;
    return parsed as ChunkedBackupManifest;
  } catch {
    return undefined;
  }
}

async function withBackupStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, mode);
    const request = run(tx.objectStore(BACKUP_STORE_NAME));
    let result: T;
    let settled = false;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {
      if (!settled) reject(request.error ?? new Error("IndexedDB backup request failed"));
      settled = true;
    };
    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve(result);
      settled = true;
    };
    tx.onerror = () => {
      db.close();
      if (!settled) reject(tx.error ?? new Error("IndexedDB backup transaction failed"));
      settled = true;
    };
    tx.onabort = tx.onerror;
  });
}

async function migrateLegacyBackupsToIndexedDb(storage: Storage | null): Promise<void> {
  if (!storage) return;
  const keys = localStorageKeys(storage).filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix));
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isBackupSnapshot(parsed)) continue;
      const summary = toSummary(key, parsed);
      await writeBackupRecord(key, raw, summary);
      runtimeBackupSummaries.set(key, summary);
      storeBackupMarker(storage, key, parsed, raw.length);
    } catch {
      // Keep the full legacy snapshot in localStorage if it cannot be moved.
    }
  }
}

function storeBackupMarker(
  storage: Storage | null,
  key: string,
  snapshot: LocalBackupSnapshot,
  sizeBytes: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(toMarker(key, snapshot, sizeBytes)));
    return;
  } catch {
    // The compact marker preserves the fields needed by the synchronous list
    // across reloads while using much less localStorage than the rich marker.
  }
  try {
    const compact: CompactLocalBackupMarker = [
      COMPACT_BACKUP_MARKER,
      snapshot.oldSchemaVersion,
      snapshot.build.version,
      snapshot.build.commitSha,
    ];
    storage.setItem(key, JSON.stringify(compact));
  } catch {
    // The in-memory summary still lists the durable payload this session.
  }
}

function toSummary(key: string, snapshot: LocalBackupSnapshot): LocalBackupSummary {
  return {
    key,
    savedAt: snapshot.savedAt,
    oldSchemaVersion: snapshot.oldSchemaVersion,
    appVersion: snapshot.build.version,
    commitSha: snapshot.build.commitSha,
  };
}

function toMarker(key: string, snapshot: LocalBackupSnapshot, sizeBytes: number): LocalBackupMarker {
  return {
    key,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    storage: "indexeddb",
    sizeBytes,
    savedAt: snapshot.savedAt,
    oldSchemaVersion: snapshot.oldSchemaVersion,
    appVersion: snapshot.build.version,
    commitSha: snapshot.build.commitSha,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function serializeStoredValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isBackupSnapshot(value: unknown): value is LocalBackupSnapshot {
  if (!isRecord(value) || !isRecord(value.build)) return false;
  return (
    typeof value.savedAt === "string" &&
    typeof value.oldSchemaVersion === "number" &&
    typeof value.build.version === "string" &&
    typeof value.build.commitSha === "string"
  );
}

function isBackupMarker(value: unknown): value is LocalBackupMarker {
  if (!isRecord(value)) return false;
  return (
    value.storage === "indexeddb" &&
    typeof value.savedAt === "string" &&
    typeof value.oldSchemaVersion === "number" &&
    typeof value.appVersion === "string" &&
    typeof value.commitSha === "string"
  );
}

function isCompactBackupMarker(value: unknown): value is CompactLocalBackupMarker {
  return (
    Array.isArray(value)
    && value.length === 4
    && value[0] === COMPACT_BACKUP_MARKER
    && typeof value[1] === "number"
    && typeof value[2] === "string"
    && typeof value[3] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
