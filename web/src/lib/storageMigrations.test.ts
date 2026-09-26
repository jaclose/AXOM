import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_INFO } from "./buildInfo";
import { STORAGE_KEYS } from "./brand";
import {
  readLastSeenBuild,
  readMigrationFailure,
  runStorageMigrations,
  STORAGE_SCHEMA_KEY,
} from "./storageMigrations";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => vi.unstubAllGlobals());

describe("storage migration recovery metadata", () => {
  it("refuses to downgrade newer workspace data or overwrite its build metadata", async () => {
    const previous = { ...BUILD_INFO, version: "99.0.0", schemaVersion: BUILD_INFO.schemaVersion + 1 };
    localStorage.setItem(STORAGE_SCHEMA_KEY, String(previous.schemaVersion));
    localStorage.setItem(STORAGE_KEYS.lastSeenBuild, JSON.stringify(previous));
    const result = await runStorageMigrations();
    expect(result.ok).toBe(false);
    expect(localStorage.getItem(STORAGE_SCHEMA_KEY)).toBe(String(previous.schemaVersion));
    expect(readLastSeenBuild()?.version).toBe("99.0.0");
  });
  it("reads only the existing validated failure marker and previous build", () => {
    const previousBuild = { ...BUILD_INFO, version: "0.0.0-previous", commitSha: "previous" };
    localStorage.setItem(STORAGE_KEYS.lastSeenBuild, JSON.stringify(previousBuild));
    localStorage.setItem(STORAGE_KEYS.migrationFailure, JSON.stringify({
      fromVersion: 31,
      toVersion: 32,
      backupKey: `${STORAGE_KEYS.localBackupPrefix}2026-07-11T10:00:00.000Z`,
      errorMessage: "Upgrade could not finish",
      at: "2026-07-11T10:00:01.000Z",
      build: BUILD_INFO,
    }));

    expect(readLastSeenBuild()).toMatchObject({ version: "0.0.0-previous", commitSha: "previous" });
    expect(readMigrationFailure()).toMatchObject({
      fromVersion: 31,
      toVersion: 32,
      errorMessage: "Upgrade could not finish",
    });

    localStorage.setItem(STORAGE_KEYS.migrationFailure, JSON.stringify({ fromVersion: -1, build: BUILD_INFO }));
    expect(readMigrationFailure()).toBeNull();
  });

  it("removes the unresolved marker only after a successful startup retry", async () => {
    localStorage.setItem(STORAGE_SCHEMA_KEY, String(BUILD_INFO.schemaVersion));
    localStorage.setItem(STORAGE_KEYS.migrationFailure, JSON.stringify({
      fromVersion: 31,
      toVersion: 32,
      backupKey: null,
      errorMessage: "Previous failure",
      at: "2026-07-11T10:00:01.000Z",
      build: BUILD_INFO,
    }));

    const result = await runStorageMigrations();
    expect(result.ok).toBe(true);
    expect(readMigrationFailure()).toBeNull();
  });
});
