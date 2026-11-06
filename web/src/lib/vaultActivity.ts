import { STORAGE_KEYS } from "./brand";

/**
 * The exact time of the latest successful local workspace write, so Settings
 * can say "Saved on this device at 8:42:13 PM" instead of a vague "autosave
 * is on". Stores only versioned workspace-write metadata, never content.
 * Legacy unscoped markers are not evidence of a workspace save.
 */
export type VaultWriteTarget = "indexeddb" | "local-fallback";
/** v2 prevents old auxiliary cache writes from impersonating workspace saves. */
const WORKSPACE_WRITE_MARKER_VERSION = 2 as const;
export interface VaultWriteRecord {
  at: string;
  target: VaultWriteTarget;
  version: typeof WORKSPACE_WRITE_MARKER_VERSION;
  scope: "workspace";
}

export const VAULT_WRITE_EVENT = "axom:vault-write";
export const VAULT_WRITE_FAILURE_EVENT = "axom:vault-write-failure";
let lastWrite: VaultWriteRecord | null = null;
let lastPersistedAt = 0;
let failingSince: string | null = null;
/** A removed/missing workspace must not rehydrate stale save-success metadata. */
let statusInvalidated = false;

/**
 * A save reached neither IndexedDB nor the browser-storage fallback. Ordinary
 * saves are best-effort, so without this the only sign was a "Saved at" time
 * in Settings that had quietly stopped moving.
 */
export function markVaultWriteFailure(now: Date = new Date()): void {
  failingSince ??= now.toISOString();
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_FAILURE_EVENT));
  }
}

/** When the current run of failed saves began; null while saves are landing. */
export function readVaultWriteFailure(): string | null {
  return failingSince;
}

export function markVaultWrite(target: VaultWriteTarget, now: Date = new Date()): void {
  // PR #128 only calls this after the persisted workspace key actually landed.
  statusInvalidated = false;
  lastWrite = { at: now.toISOString(), target, version: WORKSPACE_WRITE_MARKER_VERSION, scope: "workspace" };
  failingSince = null;
  // Keep the tiny localStorage marker current without hammering it on every
  // keystroke: at most once per second.
  if (now.getTime() - lastPersistedAt >= 1000) {
    lastPersistedAt = now.getTime();
    try { window.localStorage.setItem(STORAGE_KEYS.lastVaultWriteAt, JSON.stringify(lastWrite)); } catch { /* optional */ }
  }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
}

/**
 * Clear only the small save-success marker when the workspace is removed or
 * hydration finds no durable workspace. Never erase workspace or backup bytes.
 * The next confirmed write renews the marker, even inside the throttle window.
 */
export function invalidateVaultWrite(): void {
  const hadMemoryRecord = lastWrite !== null;
  let hadStoredRecord = false;
  try {
    hadStoredRecord = window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) !== null;
  } catch { /* Optional metadata may be unavailable. */ }
  lastWrite = null;
  lastPersistedAt = 0;
  statusInvalidated = true;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
  } catch {
    // Storage shims may forbid removal but allow a fail-closed replacement.
    try { window.localStorage.setItem(STORAGE_KEYS.lastVaultWriteAt, "null"); } catch { /* optional */ }
  }
  if ((hadMemoryRecord || hadStoredRecord) && typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
}

/** Read only a valid workspace-specific marker, never a legacy auxiliary write. */
function readStoredWorkspaceMarker(): VaultWriteRecord | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const marker = parsed as Record<string, unknown>;
    if (
      marker.version !== WORKSPACE_WRITE_MARKER_VERSION ||
      marker.scope !== "workspace" ||
      typeof marker.at !== "string" ||
      !Number.isFinite(Date.parse(marker.at)) ||
      (marker.target !== "indexeddb" && marker.target !== "local-fallback")
    ) return null;
    return {
      at: marker.at,
      target: marker.target,
      version: WORKSPACE_WRITE_MARKER_VERSION,
      scope: "workspace",
    };
  } catch {
    return null;
  }
}

/**
 * The in-memory marker must be rechecked against browser storage. A different
 * tab can remove the workspace while Settings is unmounted (no subscriber).
 * Keep a newer same-tab write: the local metadata marker is throttled to 1/s.
 */
export function readLastVaultWrite(): VaultWriteRecord | null {
  if (statusInvalidated) return null;
  const stored = readStoredWorkspaceMarker();
  if (!stored) {
    lastWrite = null;
    return null;
  }
  if (!lastWrite || Date.parse(stored.at) > Date.parse(lastWrite.at)) lastWrite = stored;
  return lastWrite;
}

/**
 * React subscribers hear same-tab write/failure events AND native storage
 * events from other tabs. StorageEvent never fires in the tab that wrote the
 * key. Only the workspace marker and whole-store clear affect saved status.
 * A sessionStorage or unrelated-key event must not erase a good local save.
 */
export function subscribeVaultWriteStatus(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.lastVaultWriteAt && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch {
      // Storage access is now blocked: discard optimistic status instead.
    }
    lastWrite = null;
    lastPersistedAt = 0;
    try {
      // Reconcile with the latest persisted value, rather than assuming
      // one queued event is newer than every write from another tab.
      statusInvalidated = window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) === null;
    } catch {
      statusInvalidated = true;
    }
    listener();
  };
  window.addEventListener(VAULT_WRITE_EVENT, listener);
  window.addEventListener(VAULT_WRITE_FAILURE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(VAULT_WRITE_EVENT, listener);
    window.removeEventListener(VAULT_WRITE_FAILURE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
