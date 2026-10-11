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

export async function createLocalBackup(
  oldSchemaVersion: number,
  backupLimit = DEFAULT_BACKUP_LIMIT,
): Promise<string | null> {
  const savedAt = new Date().toISOString();
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

  const key = `${STORAGE_KEYS.localBackupPrefix}${savedAt}`;
  const storage = getLocalStorage();
  const serialized = JSON.stringify(snapshot);
  try {
    // Move any snapshots created by older builds out of localStorage first.
    // A failed migration leaves the legacy payload untouched and recoverable.
    await migrateLegacyBackupsToIndexedDb(storage);
    await writeBackupRecord(key, serialized);
    storage?.setItem(key, JSON.stringify(toMarker(key, snapshot, serialized.length)));
  } catch {
    // Private browsing and storage policies can disable IndexedDB. Keep a full
    // localStorage fallback in that case rather than losing the safety copy.
    if (!storage) throw new Error("No browser storage is available for the migration backup.");
    storage.setItem(key, serialized);
  }
  await pruneLocalBackups(backupLimit);
  return key;
}

export function listLocalBackups(): LocalBackupSummary[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  return localStorageKeys(storage)
    .filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix))
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const fallbackSavedAt = key.slice(STORAGE_KEYS.localBackupPrefix.length);
      try {
        const raw = storage.getItem(key);
        const parsed = raw ? JSON.parse(raw) as unknown : null;
        if (isBackupSnapshot(parsed)) {
          return {
            key,
            savedAt: parsed.savedAt,
            oldSchemaVersion: parsed.oldSchemaVersion,
            appVersion: parsed.build.version,
            commitSha: parsed.build.commitSha,
          };
        }
        if (isBackupMarker(parsed)) {
          return {
            key,
            savedAt: parsed.savedAt,
            oldSchemaVersion: parsed.oldSchemaVersion,
            appVersion: parsed.appVersion,
            commitSha: parsed.commitSha,
          };
        }
      } catch {
        /* ignore malformed backup metadata */
      }
      return {
        key,
        savedAt: fallbackSavedAt,
        oldSchemaVersion: 0,
        appVersion: "unknown",
        commitSha: "unknown",
      };
    });
}

export async function readLocalBackup(key: string): Promise<LocalBackupSnapshot | null> {
  const storage = getLocalStorage();
  const local = storage?.getItem(key);
  if (local) {
    try {
      const parsed = JSON.parse(local) as unknown;
      if (isBackupSnapshot(parsed)) return parsed;
    } catch {
      /* try the IndexedDB record below */
    }
  }
  try {
    const serialized = await readBackupRecord(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    return isBackupSnapshot(parsed) ? parsed : null;
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
  const keys = [...new Set([...localKeys, ...indexedDbKeys])].sort((a, b) => b.localeCompare(a));
  const recoverable: string[] = [];
  for (const key of keys) {
    if (await readLocalBackup(key)) recoverable.push(key);
  }
  // Unreadable markers never count toward retention. A temporary IndexedDB
  // outage must not let newer metadata displace the last verified snapshot.
  for (const key of recoverable.slice(Math.max(0, keep))) {
    storage?.removeItem(key);
    await deleteBackupRecord(key).catch(() => undefined);
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
    return { dbName: DB_NAME, storeName: VAULT_STORE_NAME, records };
  } finally {
    db.close();
  }
}

function openVault(): Promise<IDBDatabase> {
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
    request.onerror = () => reject(request.error ?? new Error("Unable to open local vault"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local vault is blocked by another tab"));
    };
  });
}

function openExistingVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => ensureVaultStores(request.result);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open existing local vault"));
  });
}

async function writeBackupRecord(key: string, value: string): Promise<void> {
  const packed = await compressText(value);
  await withBackupStore("readwrite", (store) => store.put(packed, key));
}

async function readBackupRecord(key: string): Promise<string | undefined> {
  const stored = await withBackupStore<string | undefined>("readonly", (store) => store.get(key));
  return stored === undefined ? undefined : decompressText(stored);
}

async function listBackupRecordKeys(): Promise<string[]> {
  const keys = await withBackupStore("readonly", (store) => store.getAllKeys());
  return keys.map(String).filter((key) => key.startsWith(STORAGE_KEYS.localBackupPrefix));
}

async function deleteBackupRecord(key: string): Promise<void> {
  await withBackupStore("readwrite", (store) => store.delete(key));
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
      await writeBackupRecord(key, raw);
      storage.setItem(key, JSON.stringify(toMarker(key, parsed, raw.length)));
    } catch {
      // Keep the full legacy snapshot in localStorage if it cannot be moved.
    }
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
