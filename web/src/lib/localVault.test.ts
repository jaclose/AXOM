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
  replaceLocalVaultItem,
  resolveWorkspaceSnapshotRecord,
  VAULT_CONFLICT_MESSAGE,
  writeLocalFallback,
} from "./localVault";
import { STORAGE_KEYS } from "./brand";
import { readVaultWriteFailure } from "./vaultActivity";
import { packedFallbackKey } from "./packedVaultFallback";

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

  it.each(["v1", "legacy"] as const)(
    "keeps both acknowledged copies when a marked fallback conflicts with a newer tab (%s)",
    async (markerFormat) => {
      const key = STORAGE_KEYS.persistedState;
      const markerKey = key + ":fallback-newer";
      const scopedKey = key + ":user:jd";
      const snapshot = (label: string) => JSON.stringify({
        state: { profile: { userId: "jd" }, label },
        version: 34,
      });
      const base = snapshot("original vault");
      const offline = snapshot("acknowledged offline edit");
      const other = snapshot("other tab committed edit");

      await localVaultStorage.setItem(key, base);
      await flushLocalVaultWrites();
      expect(await localVaultStorage.getItem(key)).toBe(base);

      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offline);
      await flushLocalVaultWrites();
      const modernMarker = localStorage.getItem(markerKey);
      expect(modernMarker).not.toBeNull();
      if (markerFormat === "legacy") {
        const parsed = JSON.parse(modernMarker!) as { valueFingerprint: string };
        localStorage.setItem(markerKey, parsed.valueFingerprint);
      }
      const observedMarker = localStorage.getItem(markerKey);
      expect(localStorage.getItem(key)).toBe(offline);
      expect(localStorage.getItem(scopedKey)).toBe(offline);

      vi.stubGlobal("indexedDB", fakeIndexedDb);
      const secondTab = await openCurrentVault();
      try {
        await putDirect(secondTab, key, other);
        // A CAS conflict must not decide which set of unique edits to discard.
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);

        expect(await getDirect(secondTab, key)).toBe(other);
        expect(localStorage.getItem(key)).toBe(offline);
        expect(localStorage.getItem(markerKey)).toBe(observedMarker);
        expect(localStorage.getItem(scopedKey)).toBe(offline);

        const checkpoint = getVaultWriteCheckpoint();
        await localVaultStorage.setItem(key, snapshot("blind overwrite"));
        await flushLocalVaultWrites();
        expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
        expect(await getDirect(secondTab, key)).toBe(other);
        expect(localStorage.getItem(key)).toBe(offline);
      } finally {
        secondTab.close();
      }
    },
  );

  it("keeps an acknowledged fallback written during an IndexedDB commit", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    const base = snapshot("shared base");
    const offline = snapshot("acknowledged offline change");
    const committed = snapshot("other tab committed change");

    await localVaultStorage.setItem(key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);

    // Capture a real acknowledged local fallback, then stage the interleaving
    // without changing this adapter's hydrated IndexedDB base.
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, offline);
    await flushLocalVaultWrites();
    const marker = storage.getItem(markerKey);
    expect(marker).not.toBeNull();
    expect(storage.getItem(key)).toBe(offline);
    values.delete(key);
    values.delete(markerKey);
    values.delete(scopedKey);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    expect(await localVaultStorage.getItem(key)).toBe(base);

    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, storedKey) {
      if (!injected && storedKey === key && value === committed) {
        injected = true;
        // A peer completes its acknowledged fallback after the foreground tab's
        // initial check but before its IndexedDB transaction is committed.
        values.set(markerKey, marker!);
        values.set(key, offline);
        values.set(scopedKey, offline);
      }
      return originalPut.call(this, value, storedKey);
    });
    const checkpoint = getVaultWriteCheckpoint();
    try {
      await localVaultStorage.setItem(key, committed);
      await flushLocalVaultWrites();
    } finally {
      put.mockRestore();
    }
    expect(injected).toBe(true);
    const db = await openCurrentVault();
    try {
      expect(await getDirect(db, key)).toBe(committed);
    } finally {
      db.close();
    }
    // Neither separately acknowledged edit may vanish or be declared resolved.
    expect(storage.getItem(key)).toBe(offline);
    expect(storage.getItem(markerKey)).toBe(marker);
    expect(storage.getItem(scopedKey)).toBe(offline);
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it("does not retire a second tab's acknowledged fallback during read-side promotion", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label }, version: 34,
    });
    const base = snapshot("committed base");
    const first = snapshot("first offline edit");
    const second = snapshot("later acknowledged offline edit");

    await localVaultStorage.setItem(key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);

    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, first);
    await flushLocalVaultWrites();
    const firstMarker = storage.getItem(markerKey);
    expect(firstMarker).not.toBeNull();
    await localVaultStorage.setItem(key, second);
    await flushLocalVaultWrites();
    const secondMarker = storage.getItem(markerKey);
    expect(secondMarker).not.toBeNull();
    expect(secondMarker).not.toBe(firstMarker);
    expect(storage.getItem(scopedKey)).toBe(second);

    // First tab captured Y; a peer subsequently acknowledges Z while Y's
    // IndexedDB promotion is still in flight. Use real fake-IDB put scheduling.
    values.set(key, first);
    values.set(markerKey, firstMarker!);
    values.set(scopedKey, first);
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, storedKey) {
      if (!injected && storedKey === key && value === first) {
        injected = true;
        values.set(key, second);
        values.set(markerKey, secondMarker!);
        values.set(scopedKey, second);
      }
      return originalPut.call(this, value, storedKey);
    });
    try {
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    } finally {
      put.mockRestore();
    }
    expect(injected).toBe(true);
    const db = await openCurrentVault();
    try { expect(await getDirect(db, key)).toBe(first); } finally { db.close(); }
    expect(storage.getItem(key)).toBe(second);
    expect(storage.getItem(markerKey)).toBe(secondMarker);
    expect(storage.getItem(scopedKey)).toBe(second);
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it.each(["read", "write", "verified restore", "remove"] as const)(
    "refuses a hidden acknowledged fallback when the localStorage getter is denied during %s",
    async operation => {
      const key = STORAGE_KEYS.persistedState;
      const markerKey = `${key}:fallback-newer`;
      const scopedKey = `${key}:user:jd`;
      const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
      const base = snapshot("committed original");
      const offline = snapshot("acknowledged offline with source notes");
      await localVaultStorage.setItem(key, base);
      expect(await localVaultStorage.getItem(key)).toBe(base);

      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offline);
      const marker = storage.getItem(markerKey);
      expect(marker).toBeTruthy();
      vi.stubGlobal("indexedDB", fakeIndexedDb);
      resetLocalVaultRuntimeForTests();

      // The repository's focused Vitest suite runs in Node, not jsdom. Stub
      // the Window binding itself to exercise the real adapter's getter path.
      const previousWindow = typeof window === "undefined" ? undefined : window;
      vi.stubGlobal("window", {
        get localStorage() { throw new DOMException("Denied workspace fallback getter", "SecurityError"); },
      });
      const checkpoint = getVaultWriteCheckpoint();
      try {
        if (operation === "read") {
          await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        } else {
          const attempted = snapshot(operation === "write" ? "unsafe blind edit" : "verified restore under denied access");
          if (operation === "verified restore") await replaceLocalVaultItem(key, attempted);
          else if (operation === "remove") await localVaultStorage.removeItem(key);
          else await localVaultStorage.setItem(key, attempted);
          expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
        }
      } finally {
        vi.stubGlobal("window", previousWindow);
      }

      const laterCheckpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, snapshot("edit after getter restored"));
      expect(() => assertVaultWritesSince(laterCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(values.get(markerKey)).toBe(marker);
      expect(values.get(key)).toBe(offline);
      expect(values.get(scopedKey)).toBe(offline);
      const db = await openCurrentVault();
      try { expect(await getDirect(db, key)).toBe(base); } finally { db.close(); }

      resetLocalVaultRuntimeForTests();
      await expect(localVaultStorage.getItem(key)).resolves.toBe(offline);
    },
  );

  it("refuses a disputed fallback if the competing vault becomes unreadable during conflict resolution", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const snapshot = (label: string) => JSON.stringify({ state: { profile: { userId: "jd" }, label }, version: 34 });
    const base = snapshot("shared base");
    const offline = snapshot("acknowledged offline change");
    const committed = snapshot("other tab committed change");

    await localVaultStorage.setItem(key, base);
    expect(await localVaultStorage.getItem(key)).toBe(base);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, offline);
    await flushLocalVaultWrites();
    const marker = storage.getItem(markerKey);
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    const peer = await openCurrentVault();
    try { await putDirect(peer, key, committed); } finally { peer.close(); }

    const originalOpen = fakeIndexedDb.open.bind(fakeIndexedDb);
    let opens = 0;
    vi.stubGlobal("indexedDB", {
      open: (name: string, version?: number) => {
        opens += 1;
        if (opens > 1) throw new Error("IndexedDB winner readback unavailable");
        return version === undefined ? originalOpen(name) : originalOpen(name, version);
      },
    });
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    expect(opens).toBeGreaterThan(1);
    expect(storage.getItem(key)).toBe(offline);
    expect(storage.getItem(markerKey)).toBe(marker);

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const verified = await openCurrentVault();
    try { expect(await getDirect(verified, key)).toBe(committed); } finally { verified.close(); }
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
      // Read-side promotion preserves the older copy without destructive
      // multi-key cleanup; a single-key retirement receipt identifies it.
      expect(localStorage.getItem(key)).toBe(fallback);
      expect(JSON.parse(localStorage.getItem(`${key}:fallback-retired`) ?? "null"))
        .toMatchObject({ version: 1, committedFingerprint: expect.any(String) });
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

  it.each(["active-user read", "primary removal"] as const)(
    "records denied Storage methods during workspace removal: %s",
    async deniedStep => {
      const key = STORAGE_KEYS.persistedState;
      const markerKey = `${key}:fallback-newer`;
      const scopedKey = `${key}:user:jd`;
      const activeKey = `${key}:active-user`;
      const snapshot = (label: string) => JSON.stringify({
        state: { profile: { userId: "jd" }, label }, version: 34,
      });
      const committed = snapshot("original IndexedDB workspace");
      const offline = snapshot("independently acknowledged offline edits");
      await localVaultStorage.setItem(key, committed);
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offline);
      await flushLocalVaultWrites();
      const marker = storage.getItem(markerKey);
      expect(marker).toBeTruthy();
      expect(storage.getItem(scopedKey)).toBe(offline);
      vi.stubGlobal("indexedDB", fakeIndexedDb);
      resetLocalVaultRuntimeForTests();

      // Unlike a denied Window.localStorage getter, this failure happens
      // inside the returned Storage object's own getItem/removeItem method.
      const originalGet = storage.getItem.bind(storage);
      const originalRemove = storage.removeItem.bind(storage);
      const denied = deniedStep === "active-user read"
        ? vi.spyOn(storage, "getItem").mockImplementation(name => {
          if (name === activeKey) throw new DOMException("Denied active-user read", "SecurityError");
          return originalGet(name);
        })
        : vi.spyOn(storage, "removeItem").mockImplementation(name => {
          if (name === key) throw new DOMException("Denied workspace removal", "SecurityError");
          return originalRemove(name);
        });
      const checkpoint = getVaultWriteCheckpoint();
      try {
        await localVaultStorage.removeItem(key);
        await flushLocalVaultWrites();
        expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      } finally {
        denied.mockRestore();
      }

      // The acknowledged fallback and original IndexedDB copy both survive.
      expect(storage.getItem(key)).toBe(offline);
      expect(storage.getItem(markerKey)).toBe(marker);
      expect(storage.getItem(scopedKey)).toBe(offline);
      const db = await openCurrentVault();
      try {
        // A denied read leaves both tiers untouched; a denied deletion now
        // follows a completed IDB transaction but retains the local recovery.
        expect(await getDirect(db, key)).toBe(
          deniedStep === "active-user read" ? committed : undefined,
        );
      } finally { db.close(); }

      // Access recovery alone must not turn a failed removal into implicit
      // permission for the same tab to overwrite an unhydrated workspace.
      const nextCheckpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, snapshot("blind follow-up save"));
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(nextCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(storage.getItem(key)).toBe(offline);
      resetLocalVaultRuntimeForTests();
      if (deniedStep === "active-user read") {
        // No removal-intent record was written before the denied preflight.
        await expect(localVaultStorage.getItem(key)).resolves.toBe(offline);
      } else {
        // Incomplete deletion persists across reload; no stale IDB hydration.
        expect(storage.getItem(`${key}:removal-pending`)).toBeTruthy();
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
      }
    },
  );

  it("preserves an acknowledged offline workspace when the later IndexedDB deletion aborts", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const pendingKey = `${key}:removal-pending`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label }, version: 34,
    });
    const committed = snapshot("original IndexedDB X");
    const offline = snapshot("acknowledged offline Y");
    await localVaultStorage.setItem(key, committed);
    await flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, offline);
    await flushLocalVaultWrites();
    const marker = storage.getItem(markerKey);
    expect(marker).toBeTruthy();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();

    // Fault the actual fake-IDB readwrite delete transaction, not the
    // localStorage adapter. Old X should roll back; offline Y must survive.
    const originalDelete = IDBObjectStore.prototype.delete;
    let aborted = false;
    const fault = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore, recordKey,
    ) {
      const request = originalDelete.call(this, recordKey);
      if (!aborted && recordKey === key) {
        aborted = true;
        this.transaction.abort();
      }
      return request;
    });
    const checkpoint = getVaultWriteCheckpoint();
    try {
      await localVaultStorage.removeItem(key);
      await flushLocalVaultWrites();
    } finally {
      fault.mockRestore();
    }
    expect(aborted).toBe(true);
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    const db = await openCurrentVault();
    try { expect(await getDirect(db, key)).toBe(committed); } finally { db.close(); }
    expect(storage.getItem(key)).toBe(offline);
    expect(storage.getItem(markerKey)).toBe(marker);
    expect(storage.getItem(scopedKey)).toBe(offline);
    expect(storage.getItem(pendingKey)).toBeTruthy();

    // New tabs must not lose the deletion intent and hydrate old X.
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    const blocked = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("blind X to Z save"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(blocked)).toThrow(VAULT_CONFLICT_MESSAGE);

    // An explicitly authorized, verifiable restore can reconcile the
    // incomplete deletion without dropping the original recovery bytes.
    await replaceLocalVaultItem(key, offline);
    await flushLocalVaultWrites();
    expect(storage.getItem(pendingKey)).toBeNull();
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(offline);
  });

  it("keeps a durable removal intent after a later localStorage key deletion fails", async () => {
    const key = STORAGE_KEYS.persistedState;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const pendingKey = `${key}:removal-pending`;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label }, version: 34,
    });
    const committed = snapshot("old IDB X");
    const offline = snapshot("offline Y");
    await localVaultStorage.setItem(key, committed);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, offline);
    await flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    resetLocalVaultRuntimeForTests();
    const originalRemove = storage.removeItem.bind(storage);
    const fault = vi.spyOn(storage, "removeItem").mockImplementation(name => {
      if (name === markerKey) throw new DOMException("Denied later marker deletion", "SecurityError");
      return originalRemove(name);
    });
    const checkpoint = getVaultWriteCheckpoint();
    try {
      await localVaultStorage.removeItem(key);
      await flushLocalVaultWrites();
    } finally {
      fault.mockRestore();
    }
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(markerKey)).not.toBeNull();
    expect(storage.getItem(scopedKey)).toBe(offline);
    expect(storage.getItem(pendingKey)).toBeTruthy();
    resetLocalVaultRuntimeForTests();
    await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    await expect(resolveWorkspaceSnapshotRecord({ [key]: committed }, Object.fromEntries(values), key))
      .rejects.toThrow(VAULT_CONFLICT_MESSAGE);
    const blocked = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("blind follow-on write"));
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(blocked)).toThrow(VAULT_CONFLICT_MESSAGE);
  });

  it.each(["intact", "tampered"] as const)(
    "recovers an orphaned marker after partial deletion only with matching scoped evidence (%s)",
    async markerState => {
      const key = STORAGE_KEYS.persistedState;
      const markerKey = `${key}:fallback-newer`;
      const scopedKey = `${key}:user:jd`;
      const unrelatedAccountKey = `${key}:user:other-learner`;
      const pendingKey = `${key}:removal-pending`;
      const snapshot = (label: string, account = "jd") => JSON.stringify({
        state: { profile: { userId: account }, label }, version: 34,
      });
      const old = snapshot("old committed");
      const offline = snapshot("last acknowledged offline edit");
      const unrelated = snapshot("other user's preserved backup", "other-learner");
      await localVaultStorage.setItem(key, old);
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offline);
      await flushLocalVaultWrites();
      const originalMarker = storage.getItem(markerKey);
      expect(originalMarker).not.toBeNull();
      storage.setItem(unrelatedAccountKey, unrelated);
      vi.stubGlobal("indexedDB", fakeIndexedDb);
      resetLocalVaultRuntimeForTests();

      const originalRemove = storage.removeItem.bind(storage);
      const denied = vi.spyOn(storage, "removeItem").mockImplementation(name => {
        if (name === markerKey) throw new DOMException("Partial deletion marker failure", "SecurityError");
        return originalRemove(name);
      });
      const removeCheckpoint = getVaultWriteCheckpoint();
      try {
        await localVaultStorage.removeItem(key);
        await flushLocalVaultWrites();
      } finally { denied.mockRestore(); }
      expect(() => assertVaultWritesSince(removeCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(storage.getItem(key)).toBeNull();
      expect(storage.getItem(markerKey)).toBe(originalMarker);
      expect(storage.getItem(scopedKey)).toBe(offline);
      expect(storage.getItem(unrelatedAccountKey)).toBe(unrelated);
      expect(storage.getItem(pendingKey)).not.toBeNull();
      resetLocalVaultRuntimeForTests();
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);

      if (markerState === "tampered") storage.setItem(markerKey, "a peer's unmatched marker");
      const restorationCheckpoint = getVaultWriteCheckpoint();
      await replaceLocalVaultItem(key, offline);
      await flushLocalVaultWrites();
      if (markerState === "tampered") {
        expect(() => assertVaultWritesSince(restorationCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
        expect(storage.getItem(pendingKey)).not.toBeNull();
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        expect(storage.getItem(scopedKey)).toBe(offline);
        expect(storage.getItem(unrelatedAccountKey)).toBe(unrelated);
        return;
      }
      expect(() => assertVaultWritesSince(restorationCheckpoint)).not.toThrow();
      expect(storage.getItem(pendingKey)).toBeNull();
      expect(storage.getItem(markerKey)).toBe(originalMarker);
      expect(storage.getItem(scopedKey)).toBe(offline);
      expect(storage.getItem(unrelatedAccountKey)).toBe(unrelated);
      resetLocalVaultRuntimeForTests();
      expect(await localVaultStorage.getItem(key)).toBe(offline);
      const savedCheckpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, snapshot("new ordinary save after recovery"));
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(savedCheckpoint)).not.toThrow();
      expect(await localVaultStorage.getItem(key)).toBe(snapshot("new ordinary save after recovery"));
      expect(storage.getItem(unrelatedAccountKey)).toBe(unrelated);
    },
  );

  it("finishes an explicit workspace deletion without retaining a stale removal intent", async () => {
    const key = STORAGE_KEYS.persistedState;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label }, version: 34,
    });
    await localVaultStorage.setItem(key, snapshot("before deletion"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer offline edit"));
    await flushLocalVaultWrites();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.removeItem(key);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
    expect(storage.getItem(`${key}:removal-pending`)).toBeNull();
    expect(storage.getItem(`${key}:fallback-newer`)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBeNull();
  });

  it("removes primary, profile pointer, and scoped IndexedDB records together", async () => {
    const persisted = JSON.stringify({ state: { profile: { userId: "jd", name: "JD" } }, version: 32 });
    await localVaultStorage.setItem(STORAGE_KEYS.persistedState, persisted);
    await localVaultStorage.removeItem(STORAGE_KEYS.persistedState);
    expect(await localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.persistedState}:active-user`)).toBeNull();
  });

  it("retains a blocked-upgrade fallback until a subsequent verified save after promotion", async () => {
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

    // The blocked versionchange request can settle after the old tab closes.
    // A read may return the intact fallback before its large IDB promotion
    // succeeds; retry until the physical chunk manifest is verified on disk.
    await waitFor(async () => {
      expect(await localVaultStorage.getItem(key)).toBe(latest);
      const current = await openCurrentVault();
      try {
        const raw = await getDirect(current, key);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { format?: string; length?: number };
        return parsed.format === "axom-local-vault-chunks" && parsed.length === latest.length;
      } finally {
        current.close();
      }
    });
    // A read must NOT retire an acknowledged fallback. Another tab might
    // acknowledge a different copy during localStorage's multi-key cleanup.
    expect(localStorage.getItem(key)).toBe(latest);
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    const upgraded = await openCurrentVault();
    try {
      expect(upgraded.version).toBe(DB_VERSION);
      expect(JSON.parse((await getDirect(upgraded, key))!)).toMatchObject({
        format: "axom-local-vault-chunks",
        version: 1,
        length: latest.length,
      });
    } finally {
      upgraded.close();
    }

    // A verified save may record retirement but cannot safely delete the
    // acknowledged multi-key recovery copy while another tab is still open.
    const savedCheckpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, latest);
    await flushLocalVaultWrites();
    expect(() => assertVaultWritesSince(savedCheckpoint)).not.toThrow();
    expect(localStorage.getItem(key)).toBe(latest);
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(`${key}:fallback-retired`) ?? "null"))
      .toMatchObject({ version: 1, committedFingerprint: expect.any(String) });
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(latest);
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
        if (name === key || name === packedFallbackKey(key)) throw new DOMException("Setting the workspace exceeded the quota.", "QuotaExceededError");
        storage.setItem(name, value);
      },
    });

    try {
      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, next);
      expect(() => assertVaultWritesSince(checkpoint))
        .toThrow(/IndexedDB save failed: Local vault upgrade is blocked by another tab/);
      expect(() => assertVaultWritesSince(checkpoint))
        .toThrow(/Browser fallback failed: Plain fallback: Setting the workspace exceeded the quota/);
      expect(() => assertVaultWritesSince(checkpoint))
        .toThrow(/Compressed fallback: Setting the workspace exceeded the quota/);
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
        if (name === key || name === packedFallbackKey(key)) throw new DOMException("The fallback exceeded storage quota.", "QuotaExceededError");
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

  it.each(["receipt read blocked", "malformed receipt", "invalid receipt schema", "empty receipt"] as const)(
    "fails closed on %s after explicit recovery without losing either workspace",
    async (fault) => {
      const markerKey = `${key}:fallback-newer`;
      const receiptKey = `${key}:fallback-retired`;
      const scopedKey = `${key}:user:jd`;
      const base = snapshot("original committed workspace");
      const offlineY = snapshot("older offline edits");
      const restoredX = snapshot("explicitly restored newer notes and attempts");

      await localVaultStorage.setItem(key, base);
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offlineY);
      expect(storage.getItem(key)).toBe(offlineY);
      const marker = storage.getItem(markerKey);
      expect(marker).not.toBeNull();
      vi.stubGlobal("indexedDB", fakeIndexedDb);

      const checkpoint = getVaultWriteCheckpoint();
      await replaceLocalVaultItem(key, restoredX);
      expect(() => assertVaultWritesSince(checkpoint)).not.toThrow();
      const receipt = storage.getItem(receiptKey);
      expect(receipt).not.toBeNull();
      expect(storage.getItem(markerKey)).toBe(marker);
      expect(storage.getItem(scopedKey)).toBe(offlineY);
      const db = await openCurrentVault();
      try {
        expect(await getDirect(db, key)).toBe(restoredX);
        resetLocalVaultRuntimeForTests();
        if (fault === "malformed receipt") values.set(receiptKey, "{bad-json");
        if (fault === "invalid receipt schema") values.set(receiptKey, JSON.stringify({ version: 1, marker }));
        if (fault === "empty receipt") values.set(receiptKey, "");
        const uncertain = values.get(receiptKey);
        const originalGet = storage.getItem.bind(storage);
        const blocked = fault === "receipt read blocked"
          ? vi.spyOn(storage, "getItem").mockImplementation(name => {
            if (name === receiptKey) throw new DOMException("Temporary receipt access denied", "SecurityError");
            return originalGet(name);
          })
          : null;
        try {
          vi.stubGlobal("indexedDB", undefined);
          await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
          const writeCheckpoint = getVaultWriteCheckpoint();
          await localVaultStorage.setItem(key, snapshot("blind edit must be rejected"));
          await flushLocalVaultWrites();
          expect(() => assertVaultWritesSince(writeCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
          expect(values.get(key)).toBe(offlineY);
          expect(values.get(markerKey)).toBe(marker);
          expect(values.get(scopedKey)).toBe(offlineY);
          expect(values.get(receiptKey)).toBe(uncertain);
          expect(await getDirect(db, key)).toBe(restoredX);
          if (fault !== "receipt read blocked") {
            await expect(resolveWorkspaceSnapshotRecord(
              { [key]: restoredX }, Object.fromEntries(values), key,
            )).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
          }
        } finally {
          blocked?.mockRestore();
          vi.stubGlobal("indexedDB", fakeIndexedDb);
          values.set(receiptKey, receipt!);
        }
        resetLocalVaultRuntimeForTests();
        expect(await localVaultStorage.getItem(key)).toBe(restoredX);
        expect(await resolveWorkspaceSnapshotRecord(
          { [key]: restoredX }, Object.fromEntries(values), key,
        )).toBe(restoredX);
      } finally { db.close(); }
    },
  );

  it.each(["marker access blocked", "payload access blocked"] as const)(
    "fails closed when the acknowledged workspace fallback has %s",
    async (fault) => {
      const markerKey = `${key}:fallback-newer`;
      const scopedKey = `${key}:user:jd`;
      const base = snapshot("original durable workspace");
      const offline = snapshot("different tab's acknowledged offline notes");
      const attempted = snapshot("blind write must not be accepted");

      await localVaultStorage.setItem(key, base);
      vi.stubGlobal("indexedDB", undefined);
      await localVaultStorage.setItem(key, offline);
      await flushLocalVaultWrites();
      const marker = storage.getItem(markerKey);
      expect(marker).not.toBeNull();
      expect(storage.getItem(scopedKey)).toBe(offline);
      vi.stubGlobal("indexedDB", fakeIndexedDb);
      resetLocalVaultRuntimeForTests();

      const originalGet = storage.getItem.bind(storage);
      const denied = vi.spyOn(storage, "getItem").mockImplementation(name => {
        if (name === (fault === "marker access blocked" ? markerKey : key)) {
          throw new DOMException("Synthetic intermittent localStorage denial", "SecurityError");
        }
        return originalGet(name);
      });
      try {
        // A fresh tab has not yet hydrated. Even a valid IDB base does not
        // prove that the independently marked offline copy was absent.
        await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
        resetLocalVaultRuntimeForTests();
        const checkpoint = getVaultWriteCheckpoint();
        await localVaultStorage.setItem(key, attempted);
        await flushLocalVaultWrites();
        expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
        expect(values.get(key)).toBe(offline);
        expect(values.get(markerKey)).toBe(marker);
        expect(values.get(scopedKey)).toBe(offline);
        const db = await openCurrentVault();
        try { expect(await getDirect(db, key)).toBe(base); } finally { db.close(); }
      } finally {
        denied.mockRestore();
      }
      // Storage access recovering is not itself proof that this tab ever
      // hydrated the acknowledged offline bytes. A same-runtime blind save
      // must remain blocked until a fresh verified hydration/reload.
      const staleCheckpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, attempted);
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(staleCheckpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(values.get(key)).toBe(offline);
      expect(values.get(markerKey)).toBe(marker);
      expect(values.get(scopedKey)).toBe(offline);
      resetLocalVaultRuntimeForTests();
      await expect(localVaultStorage.getItem(key)).resolves.toBe(offline);
      expect(values.get(key)).toBe(offline);
      expect(values.get(markerKey)).toBe(marker);
    },
  );

  it("records a late malformed retirement receipt as a failed save, not a silent retry success", async () => {
    const receiptKey = `${key}:fallback-retired`;
    const markerKey = `${key}:fallback-newer`;
    const scopedKey = `${key}:user:jd`;
    const base = snapshot("durable IDB base");
    const offline = snapshot("retained offline edits");
    await localVaultStorage.setItem(key, base);
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, offline);
    const marker = storage.getItem(markerKey);
    expect(marker).not.toBeNull();
    expect(storage.getItem(receiptKey)).toBeNull();

    // A different tab writes a malformed receipt only after the first
    // receipt check and before the failed IndexedDB write's retry.
    let injected = false;
    vi.stubGlobal("indexedDB", {
      open: () => {
        injected = true;
        values.set(receiptKey, "{broken-late-receipt");
        throw new DOMException("Synthetic IDB failure", "SecurityError");
      },
    });
    const checkpoint = getVaultWriteCheckpoint();
    await localVaultStorage.setItem(key, snapshot("unsaved attempted edit"));
    await flushLocalVaultWrites();
    expect(injected).toBe(true);
    expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
    expect(storage.getItem(key)).toBe(offline);
    expect(storage.getItem(markerKey)).toBe(marker);
    expect(storage.getItem(scopedKey)).toBe(offline);
    expect(storage.getItem(receiptKey)).toBe("{broken-late-receipt");

    vi.stubGlobal("indexedDB", fakeIndexedDb);
    const db = await openCurrentVault();
    try { expect(await getDirect(db, key)).toBe(base); } finally { db.close(); }
  });

  it("is read back at the next start instead of the older copy still in IndexedDB", async () => {
    // When IndexedDB is unavailable, the next start must not read its older
    // workspace ahead of the marked fallback and then delete the newer copy.
    await localVaultStorage.setItem(key, snapshot("older"));
    vi.stubGlobal("indexedDB", undefined);
    await localVaultStorage.setItem(key, snapshot("newer"));
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    expect(await localVaultStorage.getItem(key)).toBe(snapshot("newer"));
    // Reading can promote the bytes and retain the older marked copy; its
    // single-key retirement receipt makes rereads unambiguous without deletes.
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    await localVaultStorage.setItem(key, snapshot("after recovery"));
    await flushLocalVaultWrites();
    expect(localStorage.getItem(key)).toBe(snapshot("newer"));
    expect(localStorage.getItem(`${key}:fallback-newer`)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(`${key}:fallback-retired`) ?? "null"))
      .toMatchObject({ version: 1, committedFingerprint: expect.any(String) });
    resetLocalVaultRuntimeForTests();
    expect(await localVaultStorage.getItem(key)).toBe(snapshot("after recovery"));
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

    // Once IndexedDB is available the vault takes over again.
    await waitFor(async () => {
      await localVaultStorage.setItem(key, snapshot("fourth"));
      return localStorage.getItem(`${key}:fallback-retired`) !== null;
    });
    resetLocalVaultRuntimeForTests();
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

  it("does not overwrite a newer vault if the first IndexedDB read fails with an unmarked mirror", async () => {
    const key = STORAGE_KEYS.persistedState;
    const newer = snapshot("newer confirmed IndexedDB workspace");
    const stale = snapshot("old unmarked browser mirror");
    await localVaultStorage.setItem(key, newer);
    await flushLocalVaultWrites();

    // Old AXOM versions left an unmarked mirror. A transient error on the
    // first vault read must not promote it over an independently saved value.
    localStorage.setItem(key, stale);
    expect(localStorage.getItem(`${key}:fallback-newer`)).toBeNull();
    resetLocalVaultRuntimeForTests();

    const realOpen = fakeIndexedDb.open.bind(fakeIndexedDb);
    let opens = 0;
    vi.stubGlobal("indexedDB", {
      open: (name: string, version?: number) => {
        opens += 1;
        if (opens === 1) throw new Error("transient first IndexedDB read fails");
        return version === undefined ? realOpen(name) : realOpen(name, version);
      },
    });

    try {
      expect(await localVaultStorage.getItem(key)).toBe(newer);
      const db = await openCurrentVault();
      try {
        expect(await getDirect(db, key)).toBe(newer);
      } finally {
        db.close();
      }
      expect(localStorage.getItem(key)).toBe(stale);
      expect(opens).toBeGreaterThan(1);
    } finally {
      vi.stubGlobal("indexedDB", fakeIndexedDb);
    }
  });

  it("fails closed when stale empty reads lose CAS and the winning record cannot be read", async () => {
    const key = STORAGE_KEYS.persistedState;
    const snapshot = (label: string) => JSON.stringify({
      state: { profile: { userId: "jd" }, label }, version: 34,
    });
    const stale = snapshot("old unmarked local mirror");
    const winner = snapshot("peer's newly committed workspace");
    const markerKey = `${key}:fallback-newer`;
    const shadowName = `${STORAGE_KEYS.vaultDb}-stale-read-race`;

    // Seed two real fake-IDB databases. The shadow provides the stale empty
    // observations that another tab saw before Z committed. The real vault
    // contains Z when the migration CAS transaction executes.
    const openWithStore = async (name: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
      const request = fakeIndexedDb.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const real = await openWithStore(STORAGE_KEYS.vaultDb);
    const shadow = await openWithStore(shadowName);
    await putDirect(real, key, winner);
    storage.setItem(key, stale);
    expect(storage.getItem(markerKey)).toBeNull();
    resetLocalVaultRuntimeForTests();

    const originalOpen = fakeIndexedDb.open.bind(fakeIndexedDb);
    let opens = 0;
    vi.stubGlobal("indexedDB", {
      open: (name: string, version?: number) => {
        opens += 1;
        // Simulate two successful but stale empty reads, then a real CAS
        // against Z. The subsequent authoritative reread is unavailable.
        if (opens >= 4) throw new Error("IndexedDB winner readback is unavailable");
        const target = opens <= 2 ? shadowName : name;
        return version === undefined ? originalOpen(target) : originalOpen(target, version);
      },
    });

    try {
      await expect(localVaultStorage.getItem(key)).rejects.toThrow(VAULT_CONFLICT_MESSAGE);
      expect(opens).toBeGreaterThanOrEqual(4);
      expect(await getDirect(real, key)).toBe(winner);
      expect(storage.getItem(key)).toBe(stale);
      expect(storage.getItem(markerKey)).toBeNull();

      const checkpoint = getVaultWriteCheckpoint();
      await localVaultStorage.setItem(key, snapshot("blind follow-up overwrite"));
      await flushLocalVaultWrites();
      expect(() => assertVaultWritesSince(checkpoint)).toThrow(VAULT_CONFLICT_MESSAGE);
      expect(await getDirect(real, key)).toBe(winner);
      expect(storage.getItem(key)).toBe(stale);
    } finally {
      vi.stubGlobal("indexedDB", fakeIndexedDb);
      real.close();
      shadow.close();
      await deleteDatabase(shadowName);
    }
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
