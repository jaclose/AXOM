import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertVaultWrite,
  assertVaultWritesSince,
  DB_VERSION,
  getVaultWriteCheckpoint,
  flushLocalVaultWrites,
  localVaultStorage,
  resetLocalVaultRuntimeForTests,
  VAULT_CONFLICT_MESSAGE,
  writeLocalFallback,
} from "./localVault";
import { STORAGE_KEYS } from "./brand";
import { markVaultWrite, readLastVaultWrite, readVaultWriteFailure } from "./vaultActivity";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
};

beforeEach(async () => {
  values.clear();
  resetLocalVaultRuntimeForTests();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteDatabase(STORAGE_KEYS.vaultDb);
});

afterEach(() => vi.unstubAllGlobals());

describe("IndexedDB-first local vault", () => {
  it("prevents a stale second runtime from replacing a newer workspace", async () => {
    const key = STORAGE_KEYS.persistedState;
    const largeLibraryState = "source review ".repeat(90_000);
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label, largeLibraryState }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("shared base"));
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("shared base"));

    vi.resetModules();
    const secondTab = await import("./localVault");
    expect(await secondTab.localVaultStorage.getItem(key)).toBe(snapshot("shared base"));

    await localVaultStorage.setItem(key, snapshot("first tab edit"));
    await flushLocalVaultWrites();
    const staleCheckpoint = secondTab.getVaultWriteCheckpoint();
    await secondTab.localVaultStorage.setItem(key, snapshot("stale second tab edit"));
    await secondTab.flushLocalVaultWrites();

    expect(() => secondTab.assertVaultWritesSince(staleCheckpoint))
      .toThrow(secondTab.VAULT_CONFLICT_MESSAGE);
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("first tab edit"));
  });

  it.each([
    ["single-record", "jd"],
    ["chunked", "jd"],
    ["cross-account", "other"],
  ] as const)(
    "refuses a stale %s delete after another tab saved newer %s data",
    async (layout, winnerId) => {
      const key = STORAGE_KEYS.persistedState;
      const rawText = layout === "chunked" ? "question attachment ".repeat(100_000) : "short";
      const snapshot = (label: string, userId = "jd") => JSON.stringify({
        state: { profile: { userId }, questions: [{ id: label }], rawText },
        version: 34,
      });
      const original = snapshot("original");
      const winner = snapshot("newer-owner-edit", winnerId);
      await localVaultStorage.setItem(key, original);
      await flushLocalVaultWrites();
      expect(await localVaultStorage.getItem(key)).toBe(original);

      vi.resetModules();
      const newerTab = await import("./localVault");
      expect(await newerTab.localVaultStorage.getItem(key)).toBe(original);
      await newerTab.localVaultStorage.setItem(key, winner);
      await newerTab.flushLocalVaultWrites();
      expect(await newerTab.localVaultStorage.getItem(key)).toBe(winner);

      // The removing tab is still hydrated against X. Its delete must not
      // remove the newer Y, the active account pointer, or Y's v5 chunks.
      const deleteCheckpoint = getVaultWriteCheckpoint();
      await localVaultStorage.removeItem(key);
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(deleteCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      const db = await openCurrentVault();
      expect(await getDirect(db, `${key}:active-user`)).toBe(winnerId);
      expect(await getDirect(db, key)).toBeDefined();
      expect(await getDirect(db, `${key}:user:${winnerId}`)).toBeDefined();
      db.close();
      expect(await newerTab.localVaultStorage.getItem(key)).toBe(winner);
      expect(localStorage.getItem(key)).toBeNull();
    },
  );

  it("cannot remove an existing workspace from a tab that has not hydrated it", async () => {
    const key = STORAGE_KEYS.persistedState;
    const original = JSON.stringify({ state: { profile: { userId: "jd" }, notes: ["saved"] }, version: 34 });
    await localVaultStorage.setItem(key, original);
    await flushLocalVaultWrites();

    vi.resetModules();
    const unhydratedTab = await import("./localVault");
    const deleteCheckpoint = unhydratedTab.getVaultWriteCheckpoint();
    await unhydratedTab.localVaultStorage.removeItem(key);
    await unhydratedTab.flushLocalVaultWrites();
    expect(() => unhydratedTab.assertVaultWritesSince(deleteCheckpoint))
      .toThrow(unhydratedTab.VAULT_CONFLICT_MESSAGE);
    expect(await localVaultStorage.getItem(key)).toBe(original);
  });

  it("preserves a different tab's acknowledged fallback when stale deletion is refused", async () => {
    const key = STORAGE_KEYS.persistedState;
    const marker = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: label }] }, version: 34,
    });
    await localVaultStorage.setItem(key, snapshot("base"));
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("base"));

    vi.resetModules();
    const fallbackTab = await import("./localVault");
    expect(await fallbackTab.localVaultStorage.getItem(key)).toBe(snapshot("base"));
    vi.stubGlobal("indexedDB", undefined);
    await fallbackTab.localVaultStorage.setItem(key, snapshot("acknowledged-offline-edit"));
    await fallbackTab.flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const savedMarker = localStorage.getItem(marker);
    expect(savedMarker).not.toBeNull();
    expect(localStorage.getItem(key)).toBe(snapshot("acknowledged-offline-edit"));

    const deleteCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.removeItem(key);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(deleteCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(localStorage.getItem(key)).toBe(snapshot("acknowledged-offline-edit"));
    expect(localStorage.getItem(marker)).toBe(savedMarker);
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(snapshot("base"));
    db.close();
  });

  it.each(["single-record", "chunked"] as const)(
    "does not resurrect a deleted %s workspace from a stale second tab",
    async (layout) => {
      const key = STORAGE_KEYS.persistedState;
      const rawText = layout === "chunked" ? "source ".repeat(180_000) : "short";
      const snapshot = (label: string) => JSON.stringify({
        state: { profile: { userId: "jd" }, questions: [{ id: label }], rawText },
        version: 34,
      });
      const original = snapshot("original-question");
      const staleEdit = snapshot("stale-question");

      await localVaultStorage.setItem(key, original);
      await flushLocalVaultWrites();
      expect(await localVaultStorage.getItem(key)).toBe(original);

      vi.resetModules();
      const deletingTab = await import("./localVault");
      expect(await deletingTab.localVaultStorage.getItem(key)).toBe(original);
      await deletingTab.localVaultStorage.removeItem(key);
      await deletingTab.flushLocalVaultWrites();

      const db = await openCurrentVault();
      expect(await getDirect(db, key)).toBeUndefined();
      expect(await getDirect(db, `${key}:user:jd`)).toBeUndefined();
      db.close();

      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, staleEdit);
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);

      const verification = await openCurrentVault();
      expect(await getDirect(verification, key)).toBeUndefined();
      expect(await getDirect(verification, `${key}:user:jd`)).toBeUndefined();
      verification.close();
      expect(localStorage.getItem(key)).toBeNull();
      expect(localStorage.getItem(`${key}:fallback-newer`)).toBeNull();
      expect(await deletingTab.localVaultStorage.getItem(key)).toBeNull();
    },
  );

  it("allows a verified same-tab delete followed by a new intentional workspace save", async () => {
    const key = STORAGE_KEYS.persistedState;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: label }] },
      version: 34,
    });
    await localVaultStorage.setItem(key, snapshot("before-removal"));
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("before-removal"));

    await localVaultStorage.removeItem(key);
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(key)).toBeNull();

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("intentional-new-workspace"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("intentional-new-workspace"));
    expect(DB_VERSION).toBe(5);
  });

  it("rejects a fallback save when another tab commits before its vault transaction", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("vault base"));

    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("fallback edit"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const competingTab = await openCurrentVault();
    let competingCommit: Promise<void> | null = null;
    const getItem = vi.spyOn(storage, "getItem").mockImplementation((name) => {
      const value = values.get(name) ?? null;
      if (name === key && competingCommit === null && values.has(markerKey)) {
        // This tab already read the valid marker. Before its IndexedDB
        // transaction starts, another tab commits and clears that fallback.
        competingCommit = putDirect(competingTab, key, snapshot("newer tab edit"));
        values.delete(markerKey);
      }
      return value;
    });

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("stale fallback tab edit"));
    await flushLocalVaultWrites();
    await competingCommit;
    const saved = await getDirect(competingTab, key);
    getItem.mockRestore();
    competingTab.close();

    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(saved).toBe(snapshot("newer tab edit"));
  });

  it.each([
    ["same profile", "jd"],
    ["different active profile", "other"],
  ])("preserves acknowledged fallback edits when a %s vault commit wins", async (_scenario, winnerId) => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const snapshot = (label: string, userId = "jd") => JSON.stringify({
      state: { profile: { userId }, questions: [{ id: label }], notes: [label] },
      version: 34,
    });
    const base = snapshot("base");
    const fallback = snapshot("acknowledged-fallback-unique-question");
    const winner = snapshot("competing-vault-unique-question", winnerId);

    await localVaultStorage.setItem(key, base);
    await flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", undefined);
    const saveCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, fallback);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(saveCheckpoint)).not.toThrow();
    const marker = localStorage.getItem(markerKey);
    expect(JSON.parse(marker!)).toMatchObject({
      version: 1,
      baseFingerprint: expect.any(String),
      valueFingerprint: expect.any(String),
    });
    expect(localStorage.getItem(key)).toBe(fallback);
    expect(localStorage.getItem(scopedKey)).toBe(fallback);

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const db = await openCurrentVault();
    await putDirect(db, key, winner);
    await putDirect(db, `${key}:user:${winnerId}`, winner);
    if (winnerId !== "jd") await putDirect(db, `${key}:active-user`, winnerId);
    resetLocalVaultRuntimeForTests(); // a new tab/hydration sees both saved revisions

    expect(await localVaultStorage.getItem(key)).toBe(winner);
    expect(await getDirect(db, key)).toBe(winner);
    expect(await getDirect(db, `${key}:user:${winnerId}`)).toBe(winner);
    expect(localStorage.getItem(key)).toBe(fallback);
    expect(localStorage.getItem(markerKey)).toBe(marker);
    expect(localStorage.getItem(scopedKey)).toBe(fallback);

    // Until an explicit reconciliation, neither a subsequent read nor an
    // ordinary edit may silently overwrite Z or erase the saved Y revision.
    expect(await localVaultStorage.getItem(key)).toBe(winner);
    const editCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("unreconciled-post-conflict-edit", winnerId));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(editCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(await getDirect(db, key)).toBe(winner);
    expect(localStorage.getItem(key)).toBe(fallback);
    expect(localStorage.getItem(markerKey)).toBe(marker);
    expect(localStorage.getItem(scopedKey)).toBe(fallback);
    expect(DB_VERSION).toBe(5);
    db.close();
  });

  it("preserves a competing offline fallback written during a successful IndexedDB promotion", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: label }], notes: [label] },
      version: 34,
    });
    const base = snapshot("vault-base");
    const promoting = snapshot("promoting-edit");
    const competing = snapshot("competing-offline-unique-edit");

    await localVaultStorage.setItem(key, base);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, promoting);
    const promotingMarker = storage.getItem(markerKey);
    expect(promotingMarker).not.toBeNull();
    await localVaultStorage.setItem(key, competing);
    const competingMarker = storage.getItem(markerKey);
    expect(competingMarker).not.toBe(promotingMarker);

    // Stage the older fallback for hydration. Another tab saves a newer,
    // acknowledged fallback after the IDB transaction starts but before the
    // promoting tab performs its localStorage cleanup.
    storage.setItem(key, promoting);
    storage.setItem(markerKey, promotingMarker!);
    storage.setItem(scopedKey, promoting);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();

    const originalPut = IDBObjectStore.prototype.put;
    let competingSaveOccurred = false;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, record, storeKey) {
      if (!competingSaveOccurred && storeKey === key && record === promoting) {
        competingSaveOccurred = true;
        storage.setItem(markerKey, competingMarker!);
        storage.setItem(key, competing);
        storage.setItem(scopedKey, competing);
      }
      return Reflect.apply(originalPut, this, [record, storeKey]);
    });

    try {
      expect(await localVaultStorage.getItem(key)).toBe(promoting);
    } finally {
      spy.mockRestore();
    }

    const db = await openCurrentVault();
    try {
      expect(competingSaveOccurred).toBe(true);
      expect(await getDirect(db, key)).toBe(promoting);
      expect(storage.getItem(key)).toBe(competing);
      expect(storage.getItem(markerKey)).toBe(competingMarker);
      expect(storage.getItem(scopedKey)).toBe(competing);
    } finally {
      db.close(); // Failing RED assertions must not block the next fake-IDB reset.
    }
  });

  it("retains a new account B fallback while account A's IndexedDB save finishes", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const pointerKey = `${key}:active-user`;
    const scopedB = `${key}:user:account-B`;
    const snapshot = (userId: string, label: string) => JSON.stringify({
      state: { profile: { userId }, questions: [{ id: label }], notes: [label] },
      version: 34,
    });
    const baseA = snapshot("account-A", "base-A");
    const nextA = snapshot("account-A", "saved-A");
    const fallbackB = snapshot("account-B", "unmerged-B");
    await localVaultStorage.setItem(key, baseA);
    expect(await localVaultStorage.getItem(key)).toBe(baseA);

    // Obtain a valid acknowledged B marker from the real fallback writer;
    // stage it for delivery while A's pending transaction is committing.
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, fallbackB);
    const markerB = storage.getItem(markerKey);
    expect(markerB).not.toBeNull();
    storage.removeItem(key);
    storage.removeItem(markerKey);
    storage.removeItem(scopedB);
    storage.setItem(pointerKey, "account-A");
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(baseA);

    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, record, storeKey) {
      if (!injected && storeKey === key && record === nextA) {
        injected = true;
        storage.setItem(markerKey, markerB!);
        storage.setItem(key, fallbackB);
        storage.setItem(pointerKey, "account-B");
        storage.setItem(scopedB, fallbackB);
      }
      return Reflect.apply(originalPut, this, [record, storeKey]);
    });
    const checkpoint = getVaultWriteCheckpoint();
    try {
      await localVaultStorage.setItem(key, nextA);
      await flushLocalVaultWrites();
    } finally {
      spy.mockRestore();
    }

    const db = await openCurrentVault();
    try {
      expect(injected).toBe(true);
      expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
      expect(await getDirect(db, key)).toBe(nextA);
      expect(storage.getItem(key)).toBe(fallbackB);
      expect(storage.getItem(markerKey)).toBe(markerB);
      expect(storage.getItem(pointerKey)).toBe("account-B");
      expect(storage.getItem(scopedB)).toBe(fallbackB);
    } finally {
      db.close();
    }
  });

  it("never automatically deletes a marked workspace fallback after an IndexedDB promotion", async () => {
    // Web Storage compares and removes are separate cross-tab operations.
    // If cleanup starts removing keys, another tab may acknowledge B between
    // the final read and the first removal. The only safe automatic policy is
    // retaining the recovery copy until an explicit reconciliation.
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: label }] },
      version: 34,
    });
    const acknowledged = snapshot("unique-offline-question");
    await localVaultStorage.setItem(key, snapshot("base"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, acknowledged);
    const marker = storage.getItem(markerKey);
    expect(marker).not.toBeNull();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();

    const remove = vi.spyOn(storage, "removeItem");
    try {
      expect(await localVaultStorage.getItem(key)).toBe(acknowledged);
      const db = await openCurrentVault();
      try {
        expect(await getDirect(db, key)).toBe(acknowledged);
      } finally {
        db.close();
      }
      expect(remove).not.toHaveBeenCalledWith(markerKey);
      expect(remove).not.toHaveBeenCalledWith(key);
      expect(remove).not.toHaveBeenCalledWith(scopedKey);
      expect(storage.getItem(key)).toBe(acknowledged);
      expect(storage.getItem(markerKey)).toBe(marker);
      expect(storage.getItem(scopedKey)).toBe(acknowledged);
    } finally {
      remove.mockRestore();
    }
  });

  it("retains an acknowledged fallback even after matching bytes become durable", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: {
      profile: { userId: "jd" }, questions: [{ id: label }],
    }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("base"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("same-revision"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const db = await openCurrentVault();
    await putDirect(db, key, snapshot("same-revision"));
    await putDirect(db, `${key}:user:jd`, snapshot("same-revision"));
    resetLocalVaultRuntimeForTests();

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("same-revision"));
    expect(await getDirect(db, key)).toBe(snapshot("same-revision"));
    expect(localStorage.getItem(key)).toBe(snapshot("same-revision"));
    expect(localStorage.getItem(markerKey)).not.toBeNull();
    db.close();
  });

  it("prefers the readable vault but retains an unmerged valid legacy bare-marker fallback", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, questions: [{ id: label }] }, version: 34,
    });
    const fallback = snapshot("unmerged-legacy-edit");
    const winner = snapshot("newer-vault-edit");
    await localVaultStorage.setItem(key, snapshot("base"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, fallback);
    const v1 = JSON.parse(localStorage.getItem(markerKey)!) as { valueFingerprint: string };
    localStorage.setItem(markerKey, v1.valueFingerprint);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const db = await openCurrentVault();
    await putDirect(db, key, winner);
    await putDirect(db, `${key}:user:jd`, winner);
    resetLocalVaultRuntimeForTests();

    expect(await localVaultStorage.getItem(key)).toBe(winner);
    expect(localStorage.getItem(key)).toBe(fallback);
    expect(localStorage.getItem(markerKey)).toBe(v1.valueFingerprint);
    expect(localStorage.getItem(`${key}:user:jd`)).toBe(fallback);
    expect(readVaultWriteFailure()).not.toBeNull(); // Existing backup warning
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("post-conflict-attempt"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(await getDirect(db, key)).toBe(winner);
    expect(localStorage.getItem(key)).toBe(fallback);
    db.close();
  });

  it("does not promote a fallback over a commit that wins before promotion", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    await localVaultStorage.setItem(key, snapshot("vault base"));

    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("fallback edit"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const competingTab = await openCurrentVault();
    let competingCommit: Promise<void> | null = null;
    const getItem = vi.spyOn(storage, "getItem").mockImplementation((name) => {
      const value = values.get(name) ?? null;
      if (name === key && competingCommit === null && values.has(markerKey)) {
        competingCommit = putDirect(competingTab, key, snapshot("newer tab edit"));
        values.delete(markerKey);
      }
      return value;
    });

    const hydrated = await localVaultStorage.getItem(key);
    await competingCommit;
    const saved = await getDirect(competingTab, key);
    getItem.mockRestore();
    competingTab.close();

    expect(hydrated).toBe(snapshot("newer tab edit"));
    expect(saved).toBe(snapshot("newer tab edit"));
  });

  it("promotes and keeps saving an auxiliary-key fallback after IndexedDB recovers", async () => {
    const key = STORAGE_KEYS.aiGenerations;
    const older = JSON.stringify({ schemaVersion: 1, generations: [{ id: "older" }] });
    const fallback = JSON.stringify({ schemaVersion: 1, generations: [{ id: "fallback" }] });
    const next = JSON.stringify({ schemaVersion: 1, generations: [{ id: "next" }] });

    await localVaultStorage.setItem(key, older);
    expect(await localVaultStorage.getItem(key)).toBe(older);

    const db = await openCurrentVault();
    try {
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, fallback);

      expect(await getDirect(db, key)).toBe(older);
      expect(localStorage.getItem(key)).toBe(fallback);
      expect(JSON.parse(localStorage.getItem(`${key}:fallback-newer`) ?? "null"))
        .toMatchObject({ version: 1, baseFingerprint: expect.any(String) });

      vi.stubGlobal("indexedDB", fakeIndexedDb);
      expect(await localVaultStorage.getItem(key)).toBe(fallback);
      expect(localStorage.getItem(key)).toBeNull();
      expect(await getDirect(db, key)).toBe(fallback);

      await localVaultStorage.setItem(key, next);
      await flushLocalVaultWrites();
      expect(await getDirect(db, key)).toBe(next);
      expect(await localVaultStorage.getItem(key)).toBe(next);
    } finally {
      db.close();
    }
  });

  it("keeps a confirmed vault save successful when optional localStorage metadata is full", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" }, value: "durable" } });
    const marker = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(readVaultWriteFailure()).toBeNull();
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    marker.mockRestore();
  });

  it("coalesces a burst of saves: the newest snapshot wins and nothing older lands after it", async () => {
    const snapshot = (n: number) => JSON.stringify({ state: { profile: { userId: "jd" }, n }, version: 32 });
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const saves = [1, 2, 3, 4, 5].map((n) => localVaultStorage.setItem(STORAGE_KEYS.persistedState, snapshot(n)));
    await Promise.all(saves);
    await flushLocalVaultWrites();
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(snapshot(5));
    // The first save was already in flight; 2–4 were superseded before writing.
    const written = put.mock.calls.map(([value]) => value).filter((value) => typeof value === "string" && value.startsWith("{"));
    expect(new Set(written)).toEqual(new Set([snapshot(1), snapshot(5)]));
    put.mockRestore();
  });


  it("stores the large workspace in IndexedDB and keeps only a small profile pointer in localStorage", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" }, questions: [{ id: "q1" }] }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.persistedState}:active-user`)).toBe("jd");
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("uses the full localStorage fallback only when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" } }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("uses a viable localStorage fallback above the IndexedDB chunk threshold", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd", name: "JD" },
        documents: [{ id: "medium", rawText: "r".repeat(1_100_000) }],
      },
      version: 34,
    });

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);

    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("rejects instead of claiming durability when neither storage path is available", () => {
    const persisted = JSON.stringify({ state: { questions: [{ id: "not-durable" }] }, version: 32 });

    expect(() => writeLocalFallback(null, STORAGE_KEYS.persistedState, persisted, ""))
      .toThrow(/no local storage fallback/i);
  });

  it("records an adapter failure for operations that explicitly require durability", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    const checkpoint = getVaultWriteCheckpoint();

    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "not-durable");

    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/no local storage fallback/i);
  });

  it("attributes durability failure to the exact adapter write sequence", async () => {
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "durable");
    const durableSequence = checkpoint + 1;

    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, "not-durable");
    const failedSequence = durableSequence + 1;

    expect(() => assertVaultWrite(durableSequence)).not.toThrow();
    expect(() => assertVaultWrite(failedSequence)).toThrow(/no local storage fallback/i);
  });

  it("removes primary, profile pointer, and scoped IndexedDB records together", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" } }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await localVaultStorage.removeItem(STORAGE_KEYS.persistedState);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.persistedState}:active-user`)).toBeNull();
  });

  it("requires the physical v4 upgrade before writing chunks and falls back while a v3 tab blocks it", async () => {
    const oldConnection = await openVersionThreeVault();
    const key = STORAGE_KEYS.persistedState;
    const base = JSON.stringify({ state: { profile: { userId: "jd" }, label: "v3 base" }, version: 34 });
    await putDirect(oldConnection, key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd" },
        documents: [{
          id: "private-review-large",
          fileType: "axom-private-bank-review",
          libraryOnly: true,
          rawText: "review source ".repeat(500_000),
        }],
      },
      version: 34,
    });
    const latest = persisted.replace("private-review-large", "private-review-latest");
    const checkpoint = getVaultWriteCheckpoint();
    await expect(Promise.race([
      localVaultStorage.setItem(key, persisted),
      new Promise((_, reject) => setTimeout(() => reject(new Error("setItem hung")), 500)),
    ])).resolves.toBeUndefined();
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await getDirect(oldConnection, key)).toBe(base);
    expect(localStorage.getItem(key)).toBe(persisted);

    await expect(Promise.race([
      localVaultStorage.setItem(key, latest),
      new Promise((_, reject) => setTimeout(() => reject(new Error("later setItem hung")), 500)),
    ])).resolves.toBeUndefined();
    expect(await getDirect(oldConnection, key)).toBe(base);
    expect(localStorage.getItem(key)).toBe(latest);
    oldConnection.close();

    // The next read promotes the fallback only after the v4 barrier can land.
    expect(await localVaultStorage.getItem(key)).toBe(latest);
    await waitFor(async () => {
      await localVaultStorage.getItem(key);
      return localStorage.getItem(key) === null;
    });
    expect(localStorage.getItem(key)).toBeNull();
    const upgraded = await openCurrentVault();
    expect(upgraded.version).toBe(DB_VERSION);
    expect(JSON.parse((await getDirect(upgraded, key))!)).toMatchObject({
      format: "axom-local-vault-chunks",
      version: 1,
      length: latest.length,
    });
    upgraded.close();
  });

  it("reports the blocked vault upgrade when the browser fallback also runs out of space", async () => {
    const oldConnection = await openVersionThreeVault();
    const key = STORAGE_KEYS.persistedState;
    const base = JSON.stringify({ state: { profile: { userId: "jd" }, label: "saved" }, version: 34 });
    const next = JSON.stringify({ state: { profile: { userId: "jd" }, rawText: "x".repeat(1_100_000) }, version: 34 });
    await putDirect(oldConnection, key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);

    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === key) throw new DOMException("Setting the workspace exceeded the quota.", "QuotaExceededError");
        storage.setItem(name, value);
      },
    });

    try {
      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, next);
      expect(() => assertVaultWritesSince(checkpoint))
        .toThrow(/IndexedDB save failed: Local vault upgrade is blocked by another tab/);
      expect(() => assertVaultWritesSince(checkpoint))
        .toThrow(/Browser fallback failed: Setting the workspace exceeded the quota/);
      expect(await getDirect(oldConnection, key)).toBe(base);
      expect(localStorage.getItem(key)).toBeNull();
    } finally {
      oldConnection.close();
    }
  });

  it("does not let v3 or v4 writers reopen after the current vault barrier commits", async () => {
    const key = STORAGE_KEYS.persistedState;
    const persisted = JSON.stringify({
      state: { profile: { userId: "jd" }, documents: [{ rawText: "x".repeat(1_100_000) }] },
      version: 34,
    });

    await localVaultStorage.setItem(key, persisted);
    await flushLocalVaultWrites();

    const current = await openCurrentVault();
    expect(current.version).toBe(DB_VERSION);
    expect(JSON.parse((await getDirect(current, key))!)).toMatchObject({ format: "axom-local-vault-chunks" });
    current.close();
    await expect(openVaultAtVersion(3)).rejects.toMatchObject({ name: "VersionError" });
    await expect(openVaultAtVersion(4)).rejects.toMatchObject({ name: "VersionError" });
    expect(await localVaultStorage.getItem(key)).toBe(persisted);
  });

  it("closes a late upgrade connection after the request already reported that it was blocked", async () => {
    const initialClose = vi.fn();
    const lateClose = vi.fn();
    const initialDb = {
      version: 1,
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(),
      close: initialClose,
      onversionchange: null,
    } as unknown as IDBDatabase;
    const lateDb = {
      close: lateClose,
      onversionchange: null,
    } as unknown as IDBDatabase;
    let openCount = 0;
    const open = vi.fn(() => {
      openCount += 1;
      if (openCount > 2) throw new Error("IndexedDB unavailable after blocked upgrade");
      const request = {} as IDBOpenDBRequest;
      Object.defineProperty(request, "result", { value: openCount === 1 ? initialDb : lateDb });
      if (openCount === 1) {
        queueMicrotask(() => {
          request.onupgradeneeded?.call(request, {} as IDBVersionChangeEvent);
          request.onsuccess?.call(request, {} as Event);
        });
      } else {
        queueMicrotask(() => {
          request.onblocked?.call(request, {} as IDBVersionChangeEvent);
          setTimeout(() => request.onsuccess?.call(request, {} as Event), 0);
        });
      }
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    const persisted = JSON.stringify({ state: { profile: { userId: "jd" } }, version: 34 });

    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(initialClose).toHaveBeenCalledOnce();
    expect(lateClose).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEYS.persistedState)).toBe(persisted);
  });

  it("round-trips the live-size private workspace through chunks across a fresh runtime", async () => {
    const key = STORAGE_KEYS.persistedState;
    const persisted = JSON.stringify({
      state: {
        profile: { userId: "jd" },
        documents: [{
          id: "private-review-live-size",
          fileType: "axom-private-bank-review",
          libraryOnly: true,
          rawText: "r".repeat(17_561_151),
        }],
      },
      version: 34,
    });

    await localVaultStorage.setItem(key, persisted);
    await flushLocalVaultWrites();
    const db = await openCurrentVault();
    const manifest = JSON.parse((await getDirect(db, key))!) as { format: string; chunkCount: number; length: number };
    expect(manifest).toMatchObject({ format: "axom-local-vault-chunks", length: persisted.length });
    expect(manifest.chunkCount).toBeGreaterThan(16);
    expect(localStorage.getItem(key)).toBeNull();
    db.close();

    vi.resetModules();
    const freshRuntime = await import("./localVault");
    expect(await freshRuntime.localVaultStorage.getItem(key)).toBe(persisted);
  });

  it("rewrites only changed chunks and reads the complete edit in a fresh runtime", async () => {
    const key = STORAGE_KEYS.persistedState;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label, rawText: "s".repeat(2_200_000) },
      version: 34,
    });
    await localVaultStorage.setItem(key, snapshot("A"));
    await flushLocalVaultWrites();

    const db = await openCurrentVault();
    const manifest = JSON.parse((await getDirect(db, key))!) as { chunkPrefix: string; chunkCount: number };
    expect(manifest.chunkCount).toBeGreaterThan(2);
    db.close();

    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await localVaultStorage.setItem(key, snapshot("B"));
    await flushLocalVaultWrites();
    const chunkKeys = put.mock.calls.map(([, storedKey]) => storedKey)
      .filter((storedKey): storedKey is string => typeof storedKey === "string" && storedKey.startsWith(manifest.chunkPrefix));
    expect(chunkKeys).toEqual([`${manifest.chunkPrefix}:0`]);
    put.mockRestore();

    vi.resetModules();
    const freshRuntime = await import("./localVault");
    expect(await freshRuntime.localVaultStorage.getItem(key)).toBe(snapshot("B"));
  });

  it("keeps the old manifest and chunks when a changed chunk cannot be written", async () => {
    const key = STORAGE_KEYS.persistedState;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label, rawText: "s".repeat(2_200_000) },
      version: 34,
    });
    await localVaultStorage.setItem(key, snapshot("A"));
    await flushLocalVaultWrites();

    const db = await openCurrentVault();
    const beforeManifest = (await getDirect(db, key))!;
    const manifest = JSON.parse(beforeManifest) as { chunkPrefix: string; chunkCount: number };
    const beforeChunks = await Promise.all(Array.from({ length: manifest.chunkCount }, (_, index) =>
      getDirect(db, `${manifest.chunkPrefix}:${index}`)));
    db.close();

    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, storedKey) {
      if (storedKey === `${manifest.chunkPrefix}:0`) {
        throw new DOMException("The changed chunk exceeded storage quota.", "QuotaExceededError");
      }
      return originalPut.call(this, value, storedKey);
    });
    const originalSetItem = storage.setItem;
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === key) throw new DOMException("The fallback exceeded storage quota.", "QuotaExceededError");
        originalSetItem(name, value);
      },
    });

    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("B"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/changed chunk exceeded storage quota/i);
    put.mockRestore();
    vi.stubGlobal("localStorage", storage);

    const after = await openCurrentVault();
    expect(await getDirect(after, key)).toBe(beforeManifest);
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      expect(await getDirect(after, `${manifest.chunkPrefix}:${index}`)).toBe(beforeChunks[index]);
    }
    after.close();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("A"));
  });
});

describe("a save that could not reach IndexedDB", () => {
  const key = STORAGE_KEYS.persistedState;
  const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });

  it("is read back at the next start instead of the older copy still in IndexedDB", async () => {
    // When IndexedDB is unavailable, the next start must not read its older
    // workspace ahead of the marked fallback and then delete the newer copy.
    await localVaultStorage.setItem(key, snapshot("older"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    // Once IndexedDB recovers the copy is durably promoted, while the
    // acknowledged fallback remains available for cross-tab reconciliation.
    const promoted = await openCurrentVault();
    expect(await getDirect(promoted, key)).toBe(snapshot("newer"));
    promoted.close();
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("keeps saving to the fallback while IndexedDB stays unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const saves = (async () => {
      await localVaultStorage.setItem(key, snapshot("first"));
      await localVaultStorage.setItem(key, snapshot("second"));
      await localVaultStorage.setItem(key, snapshot("third"));
    })();
    await expect(Promise.race([
      saves,
      new Promise((_, reject) => setTimeout(() => reject(new Error("a later save hung")), 500)),
    ])).resolves.toBeUndefined();
    expect(localStorage.getItem(key)).toBe(snapshot("third"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    // A resumed IndexedDB save wins without destroying the earlier fallback.
    await localVaultStorage.setItem(key, snapshot("fourth"));
    await flushLocalVaultWrites();
    const resumed = await openCurrentVault();
    expect(await getDirect(resumed, key)).toBe(snapshot("fourth"));
    resumed.close();
    expect(localStorage.getItem(key)).toBe(snapshot("third"));
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("fourth"));
  });

  it("stays readable from the fallback while IndexedDB is still not writable", async () => {
    await localVaultStorage.setItem(key, snapshot("older"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer"));

    // IndexedDB is still unavailable, so the copy cannot be moved across yet.
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);
  });

  it.each(["unmarked", "invalid marker"])(
    "does not overwrite a newer vault from a %s legacy mirror after a transient read failure",
    async (marker) => {
      const durable = snapshot("newer durable");
      const stale = snapshot("older mirror");
      await localVaultStorage.setItem(key, durable);
      await flushLocalVaultWrites();
      localStorage.setItem(key, stale);
      if (marker === "invalid marker") localStorage.setItem(`${key}:fallback-newer`, "12:deadbeef");

      // The first open fails during hydration, but the subsequent write path
      // can reach the SAME real fake-IndexedDB database. An unguarded promotion
      // must not replace the workspace already present there.
      resetLocalVaultRuntimeForTests();
      let failFirstOpen = true;
      vi.stubGlobal("indexedDB", {
        open: (database: string, version?: number) => {
          if (failFirstOpen) {
            failFirstOpen = false;
            throw new Error("Transient IndexedDB hydration read failure");
          }
          return version === undefined
            ? fakeIndexedDb.open(database)
            : fakeIndexedDb.open(database, version);
        },
      });
      // If the transient outage clears on the read-only recheck, hydrate the
      // authoritative newer workspace, not the ambiguous legacy mirror.
      expect(await localVaultStorage.getItem(key)).toBe(durable);
      vi.stubGlobal("indexedDB", fakeIndexedDb);

      const db = await openCurrentVault();
      expect(await getDirect(db, key)).toBe(durable);
      expect(await getDirect(db, `${key}:user:jd`)).toBe(durable);
      db.close();
      expect(localStorage.getItem(key)).toBe(stale);
      expect(await localVaultStorage.getItem(key)).toBe(durable);
    },
  );

  it("never promotes an unverified mirror even when two reads fail before writes recover", async () => {
    const durable = snapshot("newer durable");
    const stale = snapshot("old unmarked mirror");
    await localVaultStorage.setItem(key, durable);
    await flushLocalVaultWrites();
    localStorage.setItem(key, stale);
    resetLocalVaultRuntimeForTests();
    let failedReads = 0;
    vi.stubGlobal("indexedDB", {
      open: (database: string, version?: number) => {
        if (failedReads < 2) {
          failedReads += 1;
          throw new Error("Transient IndexedDB reads unavailable");
        }
        return version === undefined ? fakeIndexedDb.open(database) : fakeIndexedDb.open(database, version);
      },
    });
    expect(await localVaultStorage.getItem(key)).toBe(stale);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(durable);
    expect(await getDirect(db, `${key}:user:jd`)).toBe(durable);
    db.close();
    expect(localStorage.getItem(key)).toBe(stale);
    expect(await localVaultStorage.getItem(key)).toBe(durable);
  });

  it("keeps an unmarked legacy fallback readable while the vault is inaccessible", async () => {
    const legacy = snapshot("only surviving legacy copy");
    localStorage.setItem(key, legacy);
    vi.stubGlobal("indexedDB", undefined);
    expect(await localVaultStorage.getItem(key)).toBe(legacy);
    expect(localStorage.getItem(key)).toBe(legacy);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    expect(await localVaultStorage.getItem(key)).toBe(legacy);
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(legacy);
    db.close();
  });

  it("never lets an unmarked localStorage copy override the vault", async () => {
    // A copy mirrored by an older build carries no marker and may be stale.
    await localVaultStorage.setItem(key, snapshot("newer"));
    localStorage.setItem(key, snapshot("stale mirror"));

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it.each(["workspace", "all"])("keeps the last successful fallback after %s writes run out of space", async (failure) => {
    await localVaultStorage.setItem(key, snapshot("older vault"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("saved fallback"));
    const checkpoint = getVaultWriteCheckpoint();
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (failure === "all" || name === key) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });

    await localVaultStorage.setItem(key, snapshot("unsaved change"));
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(/QuotaExceededError/);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("localStorage", storage);

    // A failed later save must not make the last successful save invisible.
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("saved fallback"));
  });

  it("ignores a marker that does not describe the copy beside it", async () => {
    await localVaultStorage.setItem(key, snapshot("newer"));
    localStorage.setItem(key, snapshot("stale mirror"));
    localStorage.setItem(`${key}:fallback-newer`, "12:deadbeef");

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it("is kept when only the per-profile duplicate ran out of room", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const scopedKey = `${key}:user:jd`;
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === scopedKey) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });
    const checkpoint = getVaultWriteCheckpoint();

    await localVaultStorage.setItem(key, snapshot("newer"));

    // The workspace itself is on disk, so this is a save, not a failure.
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
  });

  it.each([
    ["IndexedDB unavailable", false],
    ["IndexedDB recovered", true],
  ])("rejects legacy profile-name collisions against a quota-limited generic fallback (%s)", async (_label, recovered) => {
    const markerKey = `${key}:fallback-newer`;
    const scopedSlug = `${key}:user:a-lex`;
    const legacy = (name: string, id: string) => JSON.stringify({
      state: { profile: { name }, questions: [{ id }], notes: [id] }, version: 34,
    });
    // Both profiles lack userId. Their different names normalize to "a-lex".
    const savedA = legacy("A Léx", "A-unique-question");
    const attemptedB = legacy("A Lex", "B-unique-question");
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === scopedSlug) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });
    const aCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, savedA);
    expect(() => assertVaultWritesSince(aCheckpoint)).not.toThrow();
    expect(storage.getItem(scopedSlug)).toBeNull();
    const markerA = storage.getItem(markerKey);
    expect(markerA).not.toBeNull();

    vi.stubGlobal("localStorage", storage);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(savedA);
    if (recovered) vi.stubGlobal("indexedDB", fakeIndexedDb);
    const bCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, attemptedB);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(bCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(storage.getItem(key)).toBe(savedA);
    expect(storage.getItem(markerKey)).toBe(markerA);
    expect(storage.getItem(scopedSlug)).toBeNull();

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(savedA);
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(savedA);
    expect(DB_VERSION).toBe(5);
    db.close();
  });

  it("fails closed on changed legacy bytes even with identical display names", async () => {
    const legacy = (id: string) => JSON.stringify({
      state: { profile: { name: "Same display name" }, questions: [{ id }] }, version: 34,
    });
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, legacy("first-person-question"));
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(legacy("first-person-question"));
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, legacy("second-person-question"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(storage.getItem(key)).toBe(legacy("first-person-question"));
  });

  it("permits byte-identical legacy retries without an immutable user ID", async () => {
    const snapshot = JSON.stringify({
      state: { profile: { name: "A Léx" }, questions: [{ id: "preserved" }] }, version: 34,
    });
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot);
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(storage.getItem(key)).toBe(snapshot);
  });

  it.each([
    ["IndexedDB unavailable", false],
    ["IndexedDB recovered", true],
  ])("does not erase account A's acknowledged generic-only fallback when B saves (%s)", async (_label, recovered) => {
    const ownerA = "account-A";
    const ownerB = "account-B";
    const markerKey = `${key}:fallback-newer`;
    const scopedA = `${key}:user:${ownerA}`;
    const snapshotFor = (userId: string, label: string) => JSON.stringify({
      state: { profile: { userId }, questions: [{ id: label }], notes: [label] },
      version: 34,
    });
    const savedA = snapshotFor(ownerA, "A-unique-question-and-note");
    const attemptedB = snapshotFor(ownerB, "B-unique-question-and-note");

    // An account A save can be acknowledged even when its optional scoped
    // duplicate hits quota: the generic fallback is its only surviving bytes.
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === scopedA) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });
    const aCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, savedA);
    expect(() => assertVaultWritesSince(aCheckpoint)).not.toThrow();
    expect(storage.getItem(key)).toBe(savedA);
    expect(storage.getItem(scopedA)).toBeNull();
    const markerA = storage.getItem(markerKey);
    expect(markerA).not.toBeNull();

    // B hydrates while IDB is offline, then tries saving its own workspace.
    // The recovered case checks that an available IDB cannot be used to erase
    // A's unpromoted fallback by directly committing B instead.
    vi.stubGlobal("localStorage", storage);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(savedA);
    if (recovered) vi.stubGlobal("indexedDB", fakeIndexedDb);
    const bCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, attemptedB);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(bCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(storage.getItem(key)).toBe(savedA);
    expect(storage.getItem(markerKey)).toBe(markerA);
    expect(storage.getItem(scopedA)).toBeNull();

    // Neither failed B write nor tab reload can erase A. A can still be
    // safely promoted once IndexedDB returns, preserving original IDs.
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(savedA);
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(savedA);
    expect(await getDirect(db, scopedA)).toBe(savedA);
    expect(DB_VERSION).toBe(5);
    db.close();
  });

  it("still allows the same account to advance a generic-only fallback after quota clears", async () => {
    const owner = "account-A";
    const scoped = `${key}:user:${owner}`;
    const snapshotFor = (id: string) => JSON.stringify({
      state: { profile: { userId: owner }, questions: [{ id }], notes: [id] },
      version: 34,
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: (name: string, value: string) => {
        if (name === scoped) throw new Error("QuotaExceededError");
        storage.setItem(name, value);
      },
    });
    await localVaultStorage.setItem(key, snapshotFor("first-A-edit"));
    expect(storage.getItem(scoped)).toBeNull();

    vi.stubGlobal("localStorage", storage);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshotFor("second-A-edit"));
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(storage.getItem(key)).toBe(snapshotFor("second-A-edit"));
    expect(storage.getItem(scoped)).toBe(snapshotFor("second-A-edit"));

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(snapshotFor("second-A-edit"));
    const db = await openCurrentVault();
    expect(await getDirect(db, key)).toBe(snapshotFor("second-A-edit"));
    db.close();
  });

  it("is reported while no store accepts it, and the report clears once saving works", async () => {
    await localVaultStorage.setItem(key, snapshot("saved"));
    expect(readVaultWriteFailure()).toBeNull();

    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", { ...storage, setItem: () => { throw new Error("QuotaExceededError"); } });
    await localVaultStorage.setItem(key, snapshot("lost"));
    expect(readVaultWriteFailure()).not.toBeNull();

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    vi.stubGlobal("localStorage", storage);
    await localVaultStorage.setItem(key, snapshot("saved again"));
    expect(readVaultWriteFailure()).toBeNull();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("saved again"));
  });
});


describe("v5-preserving save receipt integration", () => {
  it("never reports an auxiliary cache write as a new workspace save", async () => {
    // Use the same module instance as the statically imported localVault adapter.
    const start = new Date("2026-11-19T08:00:00.000Z");
    markVaultWrite("indexeddb", start);
    const receipt = readLastVaultWrite();
    await localVaultStorage.setItem(STORAGE_KEYS.aiGenerations, JSON.stringify({ generations: ["synthetic"] }));
    await flushLocalVaultWrites();
    expect(readLastVaultWrite()).toEqual(receipt);
    expect(DB_VERSION).toBe(5);
  });

  it("retires an unverified missing-workspace badge without deleting a newer tab's marker", async () => {
    const key = STORAGE_KEYS.persistedState;
    // This suite runs in Node, unlike vaultActivity.test.ts (jsdom).
    // Model one tab's optional storage without changing the environment
    // of unrelated v5 persistence and conflict tests.
    const tabSession = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: storage,
      sessionStorage: {
        getItem: (name: string) => tabSession.get(name) ?? null,
        setItem: (name: string, value: string) => { tabSession.set(name, value); },
        removeItem: (name: string) => { tabSession.delete(name); },
      },
      dispatchEvent: vi.fn(),
      BroadcastChannel: undefined,
    });
    // Use the same module instance as the statically imported localVault adapter.
    markVaultWrite("indexeddb", new Date("2026-11-19T08:01:00.000Z"));
    const marker = window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt);
    expect(marker).not.toBeNull();
    expect(await localVaultStorage.getItem(key)).toBeNull();
    expect(readLastVaultWrite()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt)).toBe(marker);
    const v5 = await openCurrentVault();
    expect(v5.version).toBe(5);
    v5.close();
  });
});

async function waitFor(check: () => Promise<boolean>, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met in time.");
}

function putDirect(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getDirect(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("state", "readonly").objectStore("state").get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}

function openCurrentVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVaultAtVersion(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openVersionThreeVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.open(STORAGE_KEYS.vaultDb, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
      if (!request.result.objectStoreNames.contains("backups")) request.result.createObjectStore("backups");
      if (!request.result.objectStoreNames.contains("questionAttachmentBlobs")) request.result.createObjectStore("questionAttachmentBlobs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
