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

export function readLastVaultWrite(): VaultWriteRecord | null {
  if (lastWrite) return lastWrite;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const marker = parsed as Record<string, unknown>;
    // Legacy {at,target} may represent only an auxiliary/cache save. Fail closed
    // until the next actual workspace write, preserving all stored learner data.
    if (
      marker.version === WORKSPACE_WRITE_MARKER_VERSION &&
      marker.scope === "workspace" &&
      typeof marker.at === "string" &&
      Number.isFinite(Date.parse(marker.at)) &&
      (marker.target === "indexeddb" || marker.target === "local-fallback")
    ) {
      lastWrite = {
        at: marker.at,
        target: marker.target,
        version: WORKSPACE_WRITE_MARKER_VERSION,
        scope: "workspace",
      };
      return lastWrite;
    }
  } catch {
    // Fall through.
  }
  return null;
}
