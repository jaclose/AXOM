import { parseImport } from "./backup";
import { STORAGE_KEYS } from "./brand";
import { readLocalBackup } from "./localBackup";
import {
  assertVaultWritesSince,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
  localVaultStorage,
  replaceLocalVaultItem,
  resolveVaultSnapshotRecord,
} from "./localVault";
import { SCHEMA_VERSION } from "./seed";
import type { NoctyriumState } from "./types";

export interface LocalWorkspaceBackupInspection {
  key: string;
  savedAt: string;
  oldSchemaVersion: number;
  snapshotAppVersion: string;
  state: NoctyriumState;
}

/**
 * Verify that an automatic local snapshot contains a readable AXOM workspace.
 * `readLocalBackup` validates the snapshot wrapper; `parseImport` then applies
 * the same current-schema validation/normalization used by portable restores.
 */
export async function inspectLocalWorkspaceBackup(
  key: string,
): Promise<LocalWorkspaceBackupInspection | null> {
  if (!key.startsWith(STORAGE_KEYS.localBackupPrefix)) return null;
  const snapshot = await readLocalBackup(key);
  if (!snapshot) return null;

  try {
    const rawWorkspace = findWorkspaceRecord(snapshot.indexedDb?.records, snapshot.localStorage);
    if (!rawWorkspace) return null;
    const decoded = JSON.parse(rawWorkspace) as unknown;
    const workspace = unwrapPersistedWorkspace(decoded);
    if (!workspace) return null;
    const state = parseImport(JSON.stringify(workspace));
    return {
      key,
      savedAt: snapshot.savedAt,
      oldSchemaVersion: snapshot.oldSchemaVersion,
      snapshotAppVersion: snapshot.build.version,
      state,
    };
  } catch {
    return null;
  }
}

/**
 * Restore only the validated workspace record from an automatic snapshot.
 * Preferences, sync metadata, recovery markers, and other captured device keys
 * are deliberately not replayed. The caller remains responsible for explicit
 * confirmation and for reloading after this awaited write completes.
 */
export async function restoreLocalWorkspaceBackup(
  key: string,
): Promise<LocalWorkspaceBackupInspection> {
  const inspection = await inspectLocalWorkspaceBackup(key);
  if (!inspection) throw new Error("The automatic safety snapshot could not be verified.");
  const serialized = JSON.stringify({ state: inspection.state, version: SCHEMA_VERSION });
  const checkpoint = getVaultWriteCheckpoint();
  await replaceLocalVaultItem(STORAGE_KEYS.persistedState, serialized);
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
  if (await localVaultStorage.getItem(STORAGE_KEYS.persistedState) !== serialized) {
    throw new Error("AXOM could not verify the restored workspace in the local vault.");
  }
  return inspection;
}

function findWorkspaceRecord(
  indexedDb: Record<string, string> | undefined,
  local: Record<string, string>,
): string | null {
  for (const records of [indexedDb, local]) {
    if (!records) continue;
    const primary = resolveVaultSnapshotRecord(records, STORAGE_KEYS.persistedState);
    if (primary) return primary;
    const scopedKey = Object.keys(records)
      .sort()
      .find((key) => key.startsWith(`${STORAGE_KEYS.persistedState}:user:`));
    if (scopedKey) {
      const scoped = resolveVaultSnapshotRecord(records, scopedKey);
      if (scoped) return scoped;
    }
  }
  return null;
}

function unwrapPersistedWorkspace(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.state) ? value.state : value;
  return Array.isArray(candidate.terms) ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
