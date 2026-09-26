import type { StateStorage } from "zustand/middleware";
import { userIdFromName } from "./userIdentity";
import { STORAGE_KEYS } from "./brand";

export const DB_NAME = STORAGE_KEYS.vaultDb;
export const STORE_NAME = "state";
export const BACKUP_STORE_NAME = "backups";
/** Question-note image bytes live here, keyed by blobKey — never in the JSON
 * workspace state and never in localStorage (Q2b-2). */
export const ATTACHMENT_STORE_NAME = "questionAttachmentBlobs";
export const DB_VERSION = 3;

/** Shared upgrade path: create any missing stores without touching existing data. */
export function ensureVaultStores(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) db.createObjectStore(BACKUP_STORE_NAME);
  if (!db.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) db.createObjectStore(ATTACHMENT_STORE_NAME);
}
const activeUserKey = (name: string) => `${name}:active-user`;
const scopedStateKey = (name: string, userId: string) => `${name}:user:${userId}`;

function localFallback(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
      if (blocked) {
        req.result.close();
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open local vault"));
    req.onblocked = () => {
      blocked = true;
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
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
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

const vaultStorage: StateStorage = {
  async getItem(name) {
    try {
      const value = await withStore<string | undefined>("readonly", (store) => store.get(name), openExistingVault);
      if (value) return value;

      const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
      if (activeUser) {
        const scoped = await withStore<string | undefined>("readonly", (store) => store.get(scopedStateKey(name, activeUser)), openExistingVault);
        if (scoped) return scoped;
      }
    } catch {
      // Fall back below.
    }

    const fallbackStore = localFallback();
    const fallback = fallbackStore?.getItem(name) ??
      fallbackStore?.getItem(scopedStateKey(name, fallbackStore?.getItem(activeUserKey(name)) ?? "")) ??
      null;
    if (fallback) {
      try {
        await withStore("readwrite", (store) => store.put(fallback, name));
      } catch {
        // localStorage still has the data; no need to interrupt app load.
      }
    }
    return fallback;
  },

  async setItem(name, value) {
    const userId = persistedUserId(value);
    const fallbackStore = localFallback();
    try {
      await withStore("readwrite", (store) => {
        store.put(value, name);
        if (userId) {
          store.put(userId, activeUserKey(name));
          store.put(value, scopedStateKey(name, userId));
        }
        return store.get(name);
      });
      // IndexedDB owns the large serialized workspace. localStorage keeps only
      // the tiny active-profile pointer and device preferences; remove legacy
      // mirrored state after a confirmed vault write.
      fallbackStore?.removeItem(name);
      if (userId) {
        fallbackStore?.setItem(activeUserKey(name), userId);
        fallbackStore?.removeItem(scopedStateKey(name, userId));
      }
    } catch {
      // IndexedDB can be blocked/private-mode unavailable. In that case retain
      // the full localStorage fallback so the app stays usable and data-safe.
      fallbackStore?.setItem(name, value);
      if (userId) {
        fallbackStore?.setItem(activeUserKey(name), userId);
        fallbackStore?.setItem(scopedStateKey(name, userId), value);
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
    fallback?.removeItem(activeUserKey(name));
    if (active) fallback?.removeItem(scopedStateKey(name, active));
    try {
      await withStore("readwrite", (store) => {
        store.delete(name);
        store.delete(activeUserKey(name));
        if (active) store.delete(scopedStateKey(name, active));
        return store.get(name);
      }, openExistingVault);
    } catch {
      // No-op; best effort cleanup.
    }
  },
};

// Serialize writes so an older asynchronous save cannot land after the update
// checkpoint. A failed write must not poison the queue for later saves.
let pendingVaultWrite: Promise<void> = Promise.resolve();

function enqueueVaultWrite(write: () => void | Promise<void>): Promise<void> {
  const next = pendingVaultWrite.catch(() => undefined).then(write);
  pendingVaultWrite = next;
  // Zustand does not await ordinary action persistence. Mark the rejection as
  // handled, while retaining it on `next` for explicit flush/checkpoint callers.
  void next.catch(() => undefined);
  return next;
}

export function flushLocalVaultWrites(): Promise<void> {
  return pendingVaultWrite;
}

export const localVaultStorage: StateStorage = {
  getItem: (name) => vaultStorage.getItem(name),
  setItem: (name, value) => enqueueVaultWrite(async () => { await vaultStorage.setItem(name, value); }),
  removeItem: (name) => enqueueVaultWrite(async () => { await vaultStorage.removeItem(name); }),
};

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
