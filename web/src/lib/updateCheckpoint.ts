import { STORAGE_KEYS } from "./brand";
import { createLocalBackup, readLocalBackup } from "./localBackup";
import { flushLocalVaultWrites, localVaultStorage } from "./localVault";
import { useStore } from "./store";
import { saveNativeSnapshot } from "../services/nativeSqlite";

/** Fail closed: never reload or install if the live workspace cannot be saved
 * and read back. Local snapshots cover workspace data and device settings;
 * question-image blobs stay in their existing store (portable exports include
 * those bytes). Nothing here clears, moves, or migrates the live workspace. */
export async function createUpdateCheckpoint(desktop: boolean): Promise<string> {
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
  await localVaultStorage.setItem(STORAGE_KEYS.persistedState, serialized);
  const saved = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
  if (saved !== serialized) {
    throw new Error("Could not verify the saved workspace. Export a backup in Settings before retrying.");
  }
  const key = await createLocalBackup(state.schemaVersion);
  const snapshot = key ? await readLocalBackup(key) : null;
  const snapshotState = snapshot?.indexedDb?.records[STORAGE_KEYS.persistedState]
    ?? snapshot?.localStorage[STORAGE_KEYS.persistedState];
  if (!key || snapshotState !== serialized) {
    throw new Error("Could not verify the recovery snapshot. The update has been paused; your current workspace is still open.");
  }
  if (desktop) {
    const native = await saveNativeSnapshot(state, "Before app update");
    if (!native.ok) throw new Error("The desktop recovery snapshot could not be saved. Retry the update after exporting a backup.");
  }
  // A user may have edited while IndexedDB was working. Retain those writes,
  // but require another explicit update attempt for a matching checkpoint.
  await flushLocalVaultWrites();
  if (JSON.stringify({
    state: options.partialize ? options.partialize(useStore.getState()) : useStore.getState(),
    version: options.version,
  }) !== serialized) {
    throw new Error("Your workspace changed while saving. Finish your edit and try the update again.");
  }
  return key;
}
