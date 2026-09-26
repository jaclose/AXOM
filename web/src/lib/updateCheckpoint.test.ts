import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import { localVaultStorage } from "./localVault";
import { readLocalBackup } from "./localBackup";
import { createUpdateCheckpoint } from "./updateCheckpoint";
import { saveNativeSnapshot } from "../services/nativeSqlite";

const runtime = vi.hoisted(() => ({
  hydrated: true,
  state: { profile: { name: "Test", userId: "test" }, schemaVersion: 32, tasks: [{ id: "unsaved-latest" }] },
}));
vi.mock("./store", () => ({ useStore: {
  getState: () => runtime.state,
  persist: { hasHydrated: () => runtime.hydrated, getOptions: () => ({ version: 32 }) },
} }));
vi.mock("../services/nativeSqlite", () => ({ saveNativeSnapshot: vi.fn(async () => ({ ok: true })) }));

beforeEach(() => {
  runtime.hydrated = true;
  runtime.state = { profile: { name: "Test", userId: "test" }, schemaVersion: 32, tasks: [{ id: "unsaved-latest" }] };
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pre-update workspace checkpoint", () => {
  it("flushes earlier writes and verifies the latest in-memory workspace in a readable snapshot", async () => {
    const earlier = localVaultStorage.setItem(STORAGE_KEYS.persistedState, JSON.stringify({ state: { tasks: [] }, version: 32 }));
    const key = await createUpdateCheckpoint(false);
    await earlier;
    const snapshot = await readLocalBackup(key);
    const saved = JSON.parse(snapshot!.indexedDb!.records[STORAGE_KEYS.persistedState]);
    expect(saved.state.tasks).toEqual([{ id: "unsaved-latest" }]);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(JSON.stringify({ state: runtime.state, version: 32 }));
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

  it("keeps a full verified fallback snapshot when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const key = await createUpdateCheckpoint(false);
    const snapshot = await readLocalBackup(key);
    expect(JSON.parse(snapshot!.localStorage[STORAGE_KEYS.persistedState]).state).toEqual(runtime.state);
  });
});
