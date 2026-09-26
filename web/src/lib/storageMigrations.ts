import { BUILD_INFO, type BuildInfo } from "./buildInfo";
import { STORAGE_KEYS } from "./brand";
import { createLocalBackup } from "./localBackup";
import { migrateAiGenerationStorage } from "./aiGenerations";

export const STORAGE_SCHEMA_KEY = STORAGE_KEYS.storageSchemaVersion;

type Migration = {
  from: number;
  to: number;
  run: () => Promise<void> | void;
};

/**
 * The one canonical unresolved startup-recovery marker. This is intentionally
 * device metadata rather than workspace state: a failed migration must remain
 * visible even when the persisted workspace cannot be hydrated yet.
 */
export interface StorageMigrationFailure {
  fromVersion: number;
  toVersion: number;
  backupKey: string | null;
  errorMessage: string;
  at: string;
  build: BuildInfo;
}

export type StorageMigrationResult =
  | {
      ok: true;
      fromVersion: number;
      toVersion: number;
      backupKey: string | null;
      migrated: boolean;
      buildChanged: boolean;
      commitChanged: boolean;
      schemaChanged: boolean;
      currentBuild: BuildInfo;
      previousBuild: BuildInfo | null;
    }
  | {
      ok: false;
      fromVersion: number;
      toVersion: number;
      backupKey: string | null;
      errorMessage: string;
      recoveryMessage: string;
      buildChanged: boolean;
      commitChanged: boolean;
      schemaChanged: boolean;
      currentBuild: BuildInfo;
      previousBuild: BuildInfo | null;
    };

const migrations: Migration[] = [
  {
    from: 0,
    to: 1,
    run: () => migrateAiGenerationStorage(),
  },
  {
    from: 1,
    to: BUILD_INFO.schemaVersion,
    run: () => migrateAiGenerationStorage(),
  },
].filter((migration) => migration.from < migration.to);

export async function runStorageMigrations(): Promise<StorageMigrationResult> {
  const fromVersion = readStoredSchemaVersion();
  const previousBuild = readLastSeenBuild();
  const commitChanged = Boolean(previousBuild && previousBuild.commitSha !== BUILD_INFO.commitSha);
  const buildChanged = Boolean(previousBuild && (
    previousBuild.commitSha !== BUILD_INFO.commitSha ||
    previousBuild.version !== BUILD_INFO.version
  ));
  const schemaChanged = fromVersion < BUILD_INFO.schemaVersion;
  let backupKey: string | null = null;

  try {
    if (fromVersion > BUILD_INFO.schemaVersion) {
      throw new Error("This workspace was saved by a newer AXOM data format. Install the latest compatible app; do not clear local data or downgrade it.");
    }
    if (schemaChanged) {
      backupKey = await withTimeout(createLocalBackup(fromVersion), 5000);
      await runSequentialMigrations(fromVersion, BUILD_INFO.schemaVersion);
      writeStoredSchemaVersion(BUILD_INFO.schemaVersion);
    }
    writeLastSeenBuild(BUILD_INFO);
    clearMigrationFailure();
    return {
      ok: true,
      fromVersion,
      toVersion: BUILD_INFO.schemaVersion,
      backupKey,
      migrated: schemaChanged,
      buildChanged,
      commitChanged,
      schemaChanged,
      currentBuild: BUILD_INFO,
      previousBuild,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown migration error";
    writeMigrationFailure({ fromVersion, toVersion: BUILD_INFO.schemaVersion, errorMessage, backupKey });
    console.error("[AXOM] Local data migration failed", { fromVersion, toVersion: BUILD_INFO.schemaVersion, error });
    return {
      ok: false,
      fromVersion,
      toVersion: BUILD_INFO.schemaVersion,
      backupKey,
      errorMessage,
      recoveryMessage: "Your existing local data was left in place. Export a backup from Settings before clearing browser data.",
      buildChanged,
      commitChanged,
      schemaChanged,
      currentBuild: BUILD_INFO,
      previousBuild,
    };
  }
}

async function runSequentialMigrations(fromVersion: number, toVersion: number) {
  let version = fromVersion;
  while (version < toVersion) {
    const migration = migrations.find((candidate) =>
      candidate.to > version && candidate.from <= version,
    );
    if (!migration) {
      throw new Error(`No local storage migration registered from schema ${version} to ${toVersion}.`);
    }
    await migration.run();
    version = migration.to;
  }
}

function readStoredSchemaVersion(): number {
  const storage = getLocalStorage();
  if (!storage) return 0;
  const raw = storage.getItem(STORAGE_SCHEMA_KEY);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function writeStoredSchemaVersion(version: number) {
  getLocalStorage()?.setItem(STORAGE_SCHEMA_KEY, String(version));
}

export function readLastSeenBuild(): BuildInfo | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEYS.lastSeenBuild);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (!isBuildInfo(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read and validate the existing failure marker without creating new state. */
export function readMigrationFailure(): StorageMigrationFailure | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEYS.migrationFailure);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (!isRecord(parsed) || !isBuildInfo(parsed.build)) return null;
    if (
      !isNonNegativeInteger(parsed.fromVersion) ||
      !isNonNegativeInteger(parsed.toVersion) ||
      typeof parsed.errorMessage !== "string" ||
      typeof parsed.at !== "string" ||
      !(parsed.backupKey === null || typeof parsed.backupKey === "string")
    ) return null;
    return {
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      backupKey: parsed.backupKey,
      errorMessage: parsed.errorMessage,
      at: parsed.at,
      build: parsed.build,
    };
  } catch {
    return null;
  }
}

function writeLastSeenBuild(build: BuildInfo) {
  getLocalStorage()?.setItem(STORAGE_KEYS.lastSeenBuild, JSON.stringify(build));
}

function writeMigrationFailure(input: { fromVersion: number; toVersion: number; errorMessage: string; backupKey: string | null }) {
  try {
    getLocalStorage()?.setItem(STORAGE_KEYS.migrationFailure, JSON.stringify({
      ...input,
      at: new Date().toISOString(),
      build: BUILD_INFO,
    }));
  } catch {
    /* best effort */
  }
}

function clearMigrationFailure() {
  try {
    getLocalStorage()?.removeItem(STORAGE_KEYS.migrationFailure);
  } catch {
    /* best effort */
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("Local backup timed out.")), ms);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isBuildInfo(value: unknown): value is BuildInfo {
  if (!isRecord(value)) return false;
  return (
    value.appName === BUILD_INFO.appName &&
    typeof value.version === "string" &&
    typeof value.schemaVersion === "number" &&
    typeof value.commitSha === "string" &&
    typeof value.buildTime === "string"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
