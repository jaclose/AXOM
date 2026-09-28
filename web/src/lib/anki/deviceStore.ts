// ===========================================================================
// Small device-local JSON stores for the Anki link. The link is to THIS
// computer's Anki collection, so its settings, note mappings and stats live in
// localStorage: never in the synced workspace vault, never in a JSON backup.
// Keys use the "axom-anki" prefix, which the pre-migration safety copy (it
// collects "axom." and "noctyrium" keys) deliberately does not match, so the
// optional AnkiConnect API key stays out of every copy.
//
// Each store caches its value, notifies subscribers (React reads it through
// useSyncExternalStore), and refreshes when another tab writes the same key.
// ===========================================================================

export interface DeviceStore<T> {
  get(): T;
  set(next: T): void;
  update(change: (current: T) => T): T;
  /** Re-read from storage (another tab may have written). */
  reload(): T;
  subscribe(listener: () => void): () => void;
  /** Forget the stored value (tests, unlinking). */
  clear(): void;
}

const stores = new Map<string, { reload(): void }>();
let storageListenerInstalled = false;

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function installStorageListener() {
  if (storageListenerInstalled || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  storageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      for (const store of stores.values()) store.reload();
      return;
    }
    stores.get(event.key)?.reload();
  });
}

export function createDeviceStore<T>(key: string, normalize: (raw: unknown) => T, fallback: () => T): DeviceStore<T> {
  let cache: T | undefined;
  const listeners = new Set<() => void>();

  function read(): T {
    const store = storage();
    try {
      const raw = store?.getItem(key);
      return raw ? normalize(JSON.parse(raw)) : fallback();
    } catch {
      return fallback();
    }
  }

  function emit() {
    for (const listener of [...listeners]) listener();
  }

  const api: DeviceStore<T> = {
    get() {
      if (cache === undefined) cache = read();
      return cache;
    },
    set(next) {
      cache = next;
      try {
        storage()?.setItem(key, JSON.stringify(next));
      } catch {
        // Quota or privacy mode: keep the in-memory value for this session.
      }
      emit();
    },
    update(change) {
      const next = change(api.get());
      api.set(next);
      return next;
    },
    reload() {
      cache = read();
      emit();
      return cache;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      cache = undefined;
      try { storage()?.removeItem(key); } catch { /* storage unavailable */ }
      emit();
    },
  };
  stores.set(key, { reload: () => { api.reload(); } });
  installStorageListener();
  return api;
}
