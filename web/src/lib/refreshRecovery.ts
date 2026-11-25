import { useStore, type Store } from "./store";
import type { NoctyriumState } from "./types";
import type { exportStateWithAttachments } from "./backup";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, subscribeQuestionAttachmentScope, type QuestionAttachmentScope } from "./questionAttachmentScope";

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

interface Coverage { at: string; length: number; fingerprint: string; scope: QuestionAttachmentScope }
type BackupReceipt = Awaited<ReturnType<typeof exportStateWithAttachments>>;

let coverage: Coverage | null = null;
let backupAttempt = 0;
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

/** Revoke earlier coverage before exporting. Only this attempt can grant a new
 * receipt, and only for a complete export of the same open account/workspace.
 * A rejected export never calls the returned function. Partial files remain
 * downloadable, but cannot waive the unsaved-work safeguard. */
export function beginPortableBackupAttempt(state: NoctyriumState): (result: BackupReceipt, at?: Date) => boolean {
  const attempt = ++backupAttempt;
  const scope = getQuestionAttachmentScope();
  let snapshot: string | null = null;
  try { snapshot = persistedForm(state); } catch { /* exporting may still recover some work */ }
  if (coverage) {
    coverage = null;
    for (const listener of listeners) listener();
  }
  let finished = false;
  return (result, at = new Date()) => {
    if (finished) return false;
    finished = true;
    if (attempt !== backupAttempt || !isQuestionAttachmentScopeCurrent(scope) || snapshot === null) return false;
    if (result.missingBlobKeys.length || result.missingOriginalIds.length || result.deferredSourceCount !== 0) return false;
    try {
      if (snapshot !== persistedForm(useStore.getState())) return false;
      coverage = { at: at.toISOString(), length: snapshot.length, fingerprint: fingerprint(snapshot), scope };
    } catch { return false; }
    for (const listener of listeners) listener();
    return true;
  };
}

export function subscribePortableBackup(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeScope = subscribeQuestionAttachmentScope(listener);
  return () => { listeners.delete(listener); unsubscribeScope(); };
}

/** When the latest complete backup in this tab was downloaded; null when there is none. */
export function lastPortableBackupAt(): string | null {
  return coverage && isQuestionAttachmentScopeCurrent(coverage.scope) ? coverage.at : null;
}

/** True only while the open workspace is exactly what the latest complete backup holds. */
export function backupCoversOpenWorkspace(): boolean {
  if (!coverage || !isQuestionAttachmentScopeCurrent(coverage.scope)) return false;
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

const WORKSPACE_CHANGED = "Your workspace changed after the backup was downloaded. Download a new backup, then refresh.";

/**
 * Reload into the newest build after a covering backup. A waiting web update
 * is activated when possible; a failure there never blocks the refresh itself.
 * Activating can take seconds, and the workspace stays editable meanwhile, so
 * the backup is checked again after it, immediately before the reload.
 */
export async function refreshAfterPortableBackup(
  activate: () => Promise<void> = async () => (await import("./webUpdates")).activateWaitingWebUpdate(),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  const covering = coverage;
  if (!covering || !backupCoversOpenWorkspace()) throw new Error(WORKSPACE_CHANGED);
  try { await activate(); } catch { /* the reload below still loads the newest build */ }
  if (coverage !== covering || !backupCoversOpenWorkspace()) throw new Error(WORKSPACE_CHANGED);
  try { sessionStorage.setItem(REFRESH_NOTICE_KEY, covering.at); } catch { /* the notice is optional */ }
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
  backupAttempt += 1;
  unloadAllowed = false;
  listeners.clear();
}
