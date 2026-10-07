import { STORAGE_KEYS } from "./brand";

/**
 * The exact time of the latest successful local workspace write, so Settings
 * can say "Saved on this device at 8:42:13 PM" instead of a vague "autosave
 * is on". Stores one timestamp and the storage tier — never content.
 */
export type VaultWriteTarget = "indexeddb" | "local-fallback";
export interface VaultWriteRecord { at: string; target: VaultWriteTarget }

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
  lastWrite = { at: now.toISOString(), target };
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
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) ?? "null") as VaultWriteRecord | null;
    if (parsed && Number.isFinite(Date.parse(parsed.at)) && (parsed.target === "indexeddb" || parsed.target === "local-fallback")) {
      lastWrite = parsed;
      return parsed;
    }
  } catch {
    // Fall through.
  }
  return null;
}
