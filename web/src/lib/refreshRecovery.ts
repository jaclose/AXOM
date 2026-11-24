import { useStore, type Store } from "./store";
import type { NoctyriumState } from "./types";

/**
 * Refreshing AXOM normally waits for a verified local save, because a reload
 * reopens whatever this device stored last. When the browser refuses to store
 * anything, that wait never ends and the learner cannot reach a newer build:
 * every screen that was not loaded yet stays broken.
 *
 * A complete portable backup of exactly what is open is an equally safe
 * checkpoint: it is a file the learner holds. This module remembers what the
 * latest such backup covered and allows a refresh only while the open
 * workspace still matches it. Nothing is written to storage except a one-line
 * session notice that explains the refresh after it happens.
 */
const REFRESH_NOTICE_KEY = "axom.refresh-after-backup.v1";

interface Coverage { at: string; length: number; fingerprint: string }

let coverage: Coverage | null = null;
let unloadAllowed = false;
const listeners = new Set<() => void>();

function persistedForm(state: NoctyriumState): string {
  const options = useStore.persist.getOptions();
  // partialize only reads data fields; the actions it is typed for are not needed.
  return JSON.stringify({ state: options.partialize ? options.partialize(state as Store) : state, version: options.version });
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Called once a complete backup of `state` has been handed to the browser as a download. */
export function recordPortableBackup(state: NoctyriumState, at: Date = new Date()): void {
  try {
    const value = persistedForm(state);
    coverage = { at: at.toISOString(), length: value.length, fingerprint: fingerprint(value) };
  } catch {
    coverage = null;
  }
  for (const listener of listeners) listener();
}

export function subscribePortableBackup(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** When the latest complete backup in this tab was downloaded; null when there is none. */
export function lastPortableBackupAt(): string | null {
  return coverage?.at ?? null;
}

/** True only while the open workspace is exactly what the latest complete backup holds. */
export function backupCoversOpenWorkspace(): boolean {
  if (!coverage) return false;
  try {
    const value = persistedForm(useStore.getState());
    return value.length === coverage.length && fingerprint(value) === coverage.fingerprint;
  } catch {
    return false;
  }
}

/** An explicit refresh after a covering backup may skip unsaved-work prompts. */
export function isUnloadAllowedForRefresh(): boolean {
  return unloadAllowed;
}

/**
 * Reload into the newest build after a covering backup. A waiting web update
 * is activated when possible; a failure there never blocks the refresh itself.
 */
export async function refreshAfterPortableBackup(
  activate: () => Promise<void> = async () => (await import("./webUpdates")).activateWaitingWebUpdate(),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  if (!coverage || !backupCoversOpenWorkspace()) {
    throw new Error("Your workspace changed after the backup was downloaded. Download a new backup, then refresh.");
  }
  try { sessionStorage.setItem(REFRESH_NOTICE_KEY, coverage.at); } catch { /* the notice is optional */ }
  try { await activate(); } catch { /* the reload below still loads the newest build */ }
  unloadAllowed = true;
  reload();
}

/** The backup time behind a refresh that just happened, once; null otherwise. */
export function takeRefreshAfterBackupNotice(): string | null {
  try {
    const at = sessionStorage.getItem(REFRESH_NOTICE_KEY);
    if (at) sessionStorage.removeItem(REFRESH_NOTICE_KEY);
    return at && Number.isFinite(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

/** Test isolation for the module state that represents one browser tab. */
export function resetRefreshRecoveryForTests(): void {
  coverage = null;
  unloadAllowed = false;
  listeners.clear();
}
