import { STORAGE_KEYS } from "./brand";
import { createLocalBackup, readLocalBackup } from "./localBackup";
import { flushLocalVaultWrites, localVaultStorage, resolveVaultSnapshotRecord } from "./localVault";
import { useStore } from "./store";
import { saveNativeSnapshot } from "../services/nativeSqlite";

export interface UpdateCheckpointOptions {
  /** Used only after a browser-storage quota error and an explicit user choice. */
  skipRecoverySnapshot?: boolean;
}

export class RecoverySnapshotQuotaError extends Error {
  readonly canContinueWithoutRecoverySnapshot = true;

  constructor() {
    super("This browser is out of storage, so AXOM could not create an extra recovery copy.");
    this.name = "RecoverySnapshotQuotaError";
  }
}

/** Fail closed: never reload or install if the live workspace cannot be saved
 * and read back. Local snapshots cover workspace data and device settings;
 * question-image blobs stay in their existing store (portable exports include
 * those bytes). Nothing here clears, moves, or migrates the live workspace. */
export async function createUpdateCheckpoint(desktop: boolean, checkpointOptions: UpdateCheckpointOptions = {}): Promise<string> {
  if (desktop && checkpointOptions.skipRecoverySnapshot) {
    throw new Error("Desktop updates still require an on-device recovery snapshot.");
  }
  if (!useStore.persist.hasHydrated()) {
    throw new Error("Your workspace is still loading. Wait a moment before updating.");
  }
  await flushLocalVaultWrites();
  const state = useStore.getState();
  const options = useStore.persist.getOptions();
  const serialized = JSON.stringify({
    state: options.partialize ? options.partialize(state) : state,
    version: options.version,
  });
  let saved = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  if (saved !== serialized) {
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, serialized);
    saved = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  }
  if (saved !== serialized) {
    throw new Error("Could not verify the saved workspace. Export a backup in Settings before retrying.");
  }
  let key: string | null = null;
  if (!checkpointOptions.skipRecoverySnapshot) {
    try {
      key = await createLocalBackup(state.schemaVersion);
      const snapshot = key ? await readLocalBackup(key) : null;
      let snapshotState: string | undefined;
      try {
        snapshotState = snapshot?.indexedDb
          ? resolveVaultSnapshotRecord(snapshot.indexedDb.records, STORAGE_KEYS.persistedState)
            ?? snapshot.localStorage[STORAGE_KEYS.persistedState]
          : snapshot?.localStorage[STORAGE_KEYS.persistedState];
      } catch {
        // Missing or damaged chunks make the checkpoint unverifiable below.
      }
      if (!key || snapshotState !== serialized) {
        throw new Error("Could not verify the recovery snapshot. The update has been paused; your current workspace is still open.");
      }
    } catch (error) {
      if (!desktop && isStorageQuotaError(error)) {
        await verifyWorkspaceStillMatches(serialized);
        throw new RecoverySnapshotQuotaError();
      }
      throw error;
    }
  }
  if (desktop) {
    const native = await saveNativeSnapshot(state, "Before app update");
    if (!native.ok) throw new Error("The desktop recovery snapshot could not be saved. Retry the update after exporting a backup.");
  }
  await verifyWorkspaceStillMatches(serialized);
  return key ?? "verified-persisted-state";
}

async function verifyWorkspaceStillMatches(serialized: string): Promise<void> {
  await flushLocalVaultWrites();
  const options = useStore.persist.getOptions();
  const state = useStore.getState();
  const current = JSON.stringify({
    state: options.partialize ? options.partialize(state) : state,
    version: options.version,
  });
  if (current !== serialized) {
    throw new Error("Your workspace changed while saving. Finish your edit and try the update again.");
  }
  if (await localVaultStorage.getItem(STORAGE_KEYS.persistedState) !== serialized) {
    throw new Error("Could not verify the saved workspace. Export a backup in Settings before retrying.");
  }
}

function isStorageQuotaError(error: unknown): boolean {
  const messages = error instanceof AggregateError
    ? [error.message, ...Array.from(error.errors, String)]
    : [error instanceof Error ? error.name + ": " + error.message : String(error)];
  return messages.some((message) => /QuotaExceededError|exceeded\s+(?:the\s+)?quota|storage\s+(?:is\s+)?full/i.test(message));
}
