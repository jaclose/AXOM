import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import { flushLocalVaultWrites, localVaultStorage, resetLocalVaultRuntimeForTests, resolveVaultSnapshotRecord, resolveWorkspaceSnapshotRecord, STORE_NAME } from "./localVault";
import { readLocalBackup } from "./localBackup";
import { createUpdateCheckpoint } from "./updateCheckpoint";
import { saveNativeSnapshot } from "../services/nativeSqlite";
import { packedFallbackKey } from "./packedVaultFallback";

const runtime = vi.hoisted(() => ({
  hydrated: true,
  state: {
    profile: { name: "Test", userId: "test" },
    schemaVersion: 32,
    tasks: [{ id: "unsaved-latest" }],
    libraryText: "",
  },
}));
vi.mock("./store", () => ({ useStore: {
  getState: () => runtime.state,
  persist: { hasHydrated: () => runtime.hydrated, getOptions: () => ({ version: 32 }) },
} }));
vi.mock("../services/nativeSqlite", () => ({ saveNativeSnapshot: vi.fn(async () => ({ ok: true })) }));

beforeEach(async () => {
  // The previous synthetic IndexedDB lifetime can still have queued writes.
  // Drain it before replacing the database, then discard only test-only CAS
  // observations; production conflict guards remain unchanged.
  await flushLocalVaultWrites();
  resetLocalVaultRuntimeForTests();
  runtime.hydrated = true;
  runtime.state = {
    profile: { name: "Test", userId: "test" },
    schemaVersion: 32,
    tasks: [{ id: "unsaved-latest" }],
    libraryText: "",
  };
  vi.mocked(saveNativeSnapshot).mockReset().mockResolvedValue({ ok: true });
  const values = new Map<string, string>();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});
afterEach(async () => {
  await flushLocalVaultWrites();
  resetLocalVaultRuntimeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pre-update workspace checkpoint", () => {
  it("does not reuse an earlier synthetic IDB snapshot lineage after a verified test-only database replacement", async () => {
    const key = STORAGE_KEYS.persistedState;
    const oldState = JSON.stringify({ state: { ...runtime.state, tasks: [{ id: "synthetic-old" }] }, version: 32 });
    await localVaultStorage.setItem(key, oldState);
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBe(oldState);

    // This models the isolation boundary between tests, not a real browser
    // account switch. A production tab never resets CAS without verification.
    await flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", new IDBFactory());
    resetLocalVaultRuntimeForTests();

    runtime.state = { ...runtime.state, tasks: [{ id: "synthetic-new" }] };
    const checkpoint = await createUpdateCheckpoint(false);
    const snapshot = await readLocalBackup(checkpoint);
    const persisted = JSON.parse(resolveVaultSnapshotRecord(
      snapshot!.indexedDb!.records, key,
    )!);
    expect(persisted.state.tasks).toEqual([{ id: "synthetic-new" }]);
    expect(await localVaultStorage.getItem(key)).toBe(JSON.stringify({ state: runtime.state, version: 32 }));
  });

  it("flushes earlier writes and verifies the latest in-memory workspace in a readable snapshot", async () => {
    runtime.state.libraryText = "private source review ".repeat(60_000);
    const earlier = localVaultStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { tasks: [] }, version: 32 }));
    const key = await createUpdateCheckpoint(false);
    await earlier;
    const snapshot = await readLocalBackup(key);
    const physical = snapshot!.indexedDb!.records[STORAGE_KEYS.persistedState];
    expect(JSON.parse(physical)).toMatchObject({ format: "axom-local-vault-chunks", version: 1 });
    const saved = JSON.parse(resolveVaultSnapshotRecord(
      snapshot!.indexedDb!.records,
      STORAGE_KEYS.persistedState,
    )!);
    expect(saved.state.tasks).toEqual([{ id: "unsaved-latest" }]);
    expect(saved.state.libraryText).toBe(runtime.state.libraryText);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(JSON.stringify({ state: runtime.state, version: 32 }));
  });

  it("verifies the latest packed workspace in a safety snapshot while the old IDB base cannot be replaced", async () => {
    const key = STORAGE_KEYS.persistedState;
    await localVaultStorage.getItem(key);
    const base = JSON.stringify({ state: runtime.state, version: 32 });
    await localVaultStorage.setItem(key, base);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === STORE_NAME) throw new DOMException("State quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    });
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((name, value) => {
      if (name === key && value.length > 4_096) throw new DOMException("Raw fallback quota", "QuotaExceededError");
      originalSetItem(name, value);
    });
    runtime.state.libraryText = "Retain this synthetic source text. ".repeat(6_000);
    const latest = JSON.stringify({ state: runtime.state, version: 32 });
    const backupKey = await createUpdateCheckpoint(false);
    const snapshot = await readLocalBackup(backupKey);
    expect(snapshot?.localStorage[packedFallbackKey(key)]).toBeTruthy();
    expect(resolveVaultSnapshotRecord(snapshot!.indexedDb!.records, key)).toBe(base);
    expect(await resolveWorkspaceSnapshotRecord(snapshot!.indexedDb!.records, snapshot!.localStorage, key)).toBe(latest);
    expect(await localVaultStorage.getItem(key)).toBe(latest);
  });

  it("also awaits a native recovery snapshot for desktop updates", async () => {
    await createUpdateCheckpoint(true);
    expect(saveNativeSnapshot).toHaveBeenCalledWith(runtime.state, "Before app update");
  });

  it("does not authorize an update when its native recovery snapshot fails", async () => {
    vi.mocked(saveNativeSnapshot).mockResolvedValueOnce({ ok: false, reason: "Disk full" });
    await expect(createUpdateCheckpoint(true)).rejects.toThrow("desktop recovery snapshot could not be saved");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(JSON.stringify({ state: runtime.state, version: 32 }));
  });

  it("rejects a checkpoint if the live workspace changes while its snapshot is being saved", async () => {
    vi.mocked(saveNativeSnapshot).mockImplementationOnce(async () => {
      runtime.state = { ...runtime.state, tasks: [{ id: "edited-during-save" }] };
      await localVaultStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: runtime.state, version: 32 }));
      return { ok: true };
    });
    await expect(createUpdateCheckpoint(true)).rejects.toThrow("workspace changed while saving");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(JSON.stringify({ state: runtime.state, version: 32 }));
    await expect(createUpdateCheckpoint(true)).resolves.toBeTypeOf("string");
  });

  it("blocks updating until hydration has finished", async () => {
    runtime.hydrated = false;
    await expect(createUpdateCheckpoint(false)).rejects.toThrow("still loading");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
  });

  it("fails closed when persisted data cannot be read back", async () => {
    vi.spyOn(localVaultStorage, "getItem").mockResolvedValue(null);
    await expect(createUpdateCheckpoint(false)).rejects.toThrow("Could not verify");
  });

  it("allows a web refresh after quota blocks only the extra snapshot and saved data verifies", async () => {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      originalSetItem(key, value);
    });
    vi.stubGlobal("indexedDB", undefined);

    await expect(createUpdateCheckpoint(false)).rejects.toMatchObject({
      name: "RecoverySnapshotQuotaError",
      canContinueWithoutRecoverySnapshot: true,
    });
    const persisted = JSON.stringify({ state: runtime.state, version: 32 });
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    await expect(createUpdateCheckpoint(false, { skipRecoverySnapshot: true })).resolves.toBe("verified-persisted-state");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("offers web refresh after a verified save when an extra recovery copy fails for a non-quota reason", async () => {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        throw new Error("Browser policy blocked the additional recovery copy.");
      }
      originalSetItem(key, value);
    });
    vi.stubGlobal("indexedDB", undefined);

    await expect(createUpdateCheckpoint(false)).rejects.toMatchObject({
      name: "RecoverySnapshotUnavailableError",
      canContinueWithoutRecoverySnapshot: true,
    });
    const persisted = JSON.stringify({ state: runtime.state, version: 32 });
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    await expect(createUpdateCheckpoint(false, { skipRecoverySnapshot: true })).resolves.toBe("verified-persisted-state");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("refuses a refresh fallback if the workspace changes while the extra recovery copy fails", async () => {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(STORAGE_KEYS.localBackupPrefix)) {
        runtime.state = { ...runtime.state, tasks: [{ id: "newer-unsaved-edit" }] };
        throw new Error("Recovery copy failed.");
      }
      originalSetItem(key, value);
    });
    vi.stubGlobal("indexedDB", undefined);

    await expect(createUpdateCheckpoint(false)).rejects.toThrow("workspace changed while saving");
    const saved = await localVaultStorage.getItem(STORAGE_KEYS.persistedState);
    expect(JSON.parse(saved!).state.tasks).toEqual([{ id: "unsaved-latest" }]);
    expect(runtime.state.tasks).toEqual([{ id: "newer-unsaved-edit" }]);
  });

  it("keeps a full verified fallback snapshot when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const key = await createUpdateCheckpoint(false);
    const snapshot = await readLocalBackup(key);
    expect(JSON.parse(snapshot!.localStorage[STORAGE_KEYS.persistedState]).state).toEqual(runtime.state);
  });
});
