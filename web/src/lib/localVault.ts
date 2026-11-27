import type { StateStorage } from "zustand/middleware";
import { userIdFromName } from "./userIdentity";
import { STORAGE_KEYS } from "./brand";
import { markVaultWrite, markVaultWriteFailure } from "./vaultActivity";
import {
  isPackedFallbackError, PackedFallbackError, packedFallbackKey, packVaultFallback, unpackVaultFallback,
  type LegacyFallbackBinding, type PackedFallbackCopy,
} from "./packedVaultFallback";
import { isVaultWriteTimeout, VaultWriteTimeout } from "./saveCeiling";

export { isVaultWriteTimeout, UI_SAVE_CEILING_MS, VaultWriteTimeout, withSaveCeiling } from "./saveCeiling";

/**
 * How long the IndexedDB part of one save may stall before AXOM abandons it
 * and uses the browser-storage fallback. A write that never settles used to
 * hold the single write queue forever: every later save waited behind it and
 * every flushLocalVaultWrites() caller froze (INC-04, fault F2). This is longer
 * than a slow but healthy write (fault F4 is 15 s), so a working save is never
 * abandoned and repeated.
 */
export const VAULT_WRITE_STALL_MS = 20_000;
/** After a stall, saves skip IndexedDB for this long and go straight to the
 * fallback, so hung requests do not pile up while browser storage is wedged. */
export const VAULT_STALL_COOLDOWN_MS = 60_000;
let indexedDbStalledUntil = 0;

/** Wait for `work` unless `signal` aborts first. Work that finishes after it
 * was abandoned is handed to `onLate` (for example, to close a connection). */
function untilAbandoned<T>(work: Promise<T>, signal: AbortSignal | undefined, onLate?: (value: T) => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const abandon = () => {
      if (done) return;
      done = true;
      // Always observe the abandoned work, so its own later rejection is
      // handled here instead of surfacing as an unhandled error.
      work.then(onLate ?? (() => undefined), () => { /* nothing to release */ });
      reject(isVaultWriteTimeout(signal.reason) ? signal.reason : new VaultWriteTimeout(VAULT_WRITE_STALL_MS));
    };
    if (signal.aborted) {
      abandon();
      return;
    }
    signal.addEventListener("abort", abandon, { once: true });
    work.then(
      (value) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", abandon);
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", abandon);
        reject(error);
      },
    );
  });
}

/** One stall budget shared by every IndexedDB step of a single save. */
function stallBudget(): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new VaultWriteTimeout(VAULT_WRITE_STALL_MS)), VAULT_WRITE_STALL_MS);
  return { signal: controller.signal, release: () => clearTimeout(timer) };
}

export const DB_NAME = STORAGE_KEYS.vaultDb;
export const STORE_NAME = "state";
export const BACKUP_STORE_NAME = "backups";
/** Question-note image bytes live here, keyed by blobKey — never in the JSON
 * workspace state and never in localStorage (Q2b-2). */
export const ATTACHMENT_STORE_NAME = "questionAttachmentBlobs";
/**
 * Physical vault schema version. Version 5 also closes older tabs whose image
 * reads and maintenance are not account-scoped. Existing stores and bytes
 * stay intact; a version-4 client cannot reopen this upgraded vault.
 * This is independent from the logical Zustand store schema.
 */
export const DB_VERSION = 5;

/** Shared upgrade path: create any missing stores without touching existing data. */
export function ensureVaultStores(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) db.createObjectStore(BACKUP_STORE_NAME);
  if (!db.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) db.createObjectStore(ATTACHMENT_STORE_NAME);
}
const activeUserKey = (name: string) => `${name}:active-user`;
const scopedStateKey = (name: string, userId: string) => `${name}:user:${userId}`;
/** Present only while the localStorage copy is ahead of IndexedDB. */
const fallbackMarkerKey = (name: string) => `${name}:fallback-newer`;
let vaultWriteSequence = 0;
const vaultWriteFailures = new Map<number, Error>();
const observedVaultSnapshots = new Map<string, string | null>();
const observedVaultUsers = new Map<string, string>();
const conflictedWorkspaceKeys = new Set<string>();
/** A blocked versionchange request cannot be cancelled. Fail later upgrade
 * attempts promptly until that queued request either succeeds or errors. */
let vaultUpgradeBlocked = false;

export const VAULT_CONFLICT_MESSAGE = "Another AXOM tab saved a newer workspace. This tab did not overwrite it. Keep this tab open, export or copy any unsaved work, then reload AXOM and retry.";

class VaultConflictError extends Error {
  readonly code = "AXOM_VAULT_CONFLICT";

  constructor() {
    super(VAULT_CONFLICT_MESSAGE);
    this.name = "VaultConflictError";
  }
}

export function isVaultConflictError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && (
    error.name === "VaultConflictError"
    || ("code" in error && error.code === "AXOM_VAULT_CONFLICT")
  );
}

/** Test isolation for the one module-local runtime that represents a browser tab. */
export function resetLocalVaultRuntimeForTests(): void {
  observedVaultSnapshots.clear();
  observedVaultUsers.clear();
  conflictedWorkspaceKeys.clear();
  vaultUpgradeBlocked = false;
  indexedDbStalledUntil = 0;
}

/** Capture the current adapter position before a write that must be durable. */
export function getVaultWriteCheckpoint(): number {
  return vaultWriteSequence;
}

/** Assert the outcome of one exact adapter write, without attributing a later
 * unrelated write failure to this operation. */
export function assertVaultWrite(sequence: number): void {
  if (vaultWriteSequence < sequence) {
    throw new Error("AXOM could not confirm that the expected local vault write started.");
  }
  const failure = vaultWriteFailures.get(sequence);
  if (failure) throw failure;
}

/**
 * Ordinary store writes remain best-effort for non-browser/test environments,
 * but finalization can explicitly require that every adapter write since its
 * checkpoint reached IndexedDB or the localStorage fallback.
 */
export function assertVaultWritesSince(checkpoint: number): void {
  const failed = [...vaultWriteFailures.entries()]
    .filter(([sequence]) => sequence > checkpoint)
    .sort(([left], [right]) => left - right)[0];
  if (failed) throw failed[1];
}

function localFallback(): Storage | null {
  try {
    // Node 25 exposes an unusable experimental global `localStorage` unless a
    // file flag is supplied. In browsers/jsdom, the Window-owned storage is the
    // real fallback and must take precedence over that process-level getter.
    if (typeof window !== "undefined") return window.localStorage;
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function describeStorageFailure(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error) || typeof error.message !== "string") return "unknown error";
  const detail = error.message.replace(/\s+/g, " ").trim();
  const name = "name" in error && typeof error.name === "string" ? error.name : "unknown error";
  return (detail || name).slice(0, 180);
}

function combinedStorageFailure(indexedDbError: unknown, fallbackError: unknown): Error {
  return new Error(
    `IndexedDB save failed: ${describeStorageFailure(indexedDbError)}. Browser fallback failed: ${describeStorageFailure(fallbackError)}.`,
    { cause: indexedDbError },
  );
}

export function writeLocalFallback(
  fallbackStore: Storage | null,
  name: string,
  value: string,
  userId: string,
  indexedDbError?: unknown,
): void {
  if (!fallbackStore) {
    throw new Error("AXOM could not write to IndexedDB and no local storage fallback is available.", {
      cause: indexedDbError,
    });
  }
  fallbackStore.setItem(name, value);
  if (userId) {
    fallbackStore.setItem(activeUserKey(name), userId);
    fallbackStore.setItem(scopedStateKey(name, userId), value);
  }
}

/** Enough to tell one saved snapshot from another; never a security measure. */
function snapshotFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

const CHUNKED_VALUE_FORMAT = "axom-local-vault-chunks";
const CHUNKED_VALUE_VERSION = 1;
/** Keep each IndexedDB value well below Chromium's large-value failure edge. */
const VAULT_CHUNK_CHARACTERS = 1024 * 1024;

interface ChunkedValueManifest {
  format: typeof CHUNKED_VALUE_FORMAT;
  version: typeof CHUNKED_VALUE_VERSION;
  fingerprint: string;
  length: number;
  chunkPrefix: string;
  chunkCount: number;
}

interface StoredValuePlan {
  storedValue: string;
  manifest?: ChunkedValueManifest;
  chunks: string[];
}

function readChunkedValueManifest(value: string | null | undefined): ChunkedValueManifest | undefined {
  if (typeof value !== "string" || value.length > 4096 || !value.includes(CHUNKED_VALUE_FORMAT)) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkedValueManifest>;
    if (
      parsed.format !== CHUNKED_VALUE_FORMAT
      || parsed.version !== CHUNKED_VALUE_VERSION
      || typeof parsed.fingerprint !== "string"
      || typeof parsed.length !== "number"
      || !Number.isSafeInteger(parsed.length)
      || parsed.length < 0
      || typeof parsed.chunkPrefix !== "string"
      || !parsed.chunkPrefix.includes(":chunks:")
      || typeof parsed.chunkCount !== "number"
      || !Number.isSafeInteger(parsed.chunkCount)
      || parsed.chunkCount < 1
      || parsed.chunkCount > 100_000
    ) return undefined;
    return parsed as ChunkedValueManifest;
  } catch {
    return undefined;
  }
}

function chunkPrefix(name: string, userId: string): string {
  return `${name}:chunks:${snapshotFingerprint(userId || "local-workspace")}`;
}

function storedValuePlan(name: string, value: string, userId: string): StoredValuePlan {
  if (!observesWorkspace(name) || value.length <= VAULT_CHUNK_CHARACTERS) {
    return { storedValue: value, chunks: [] };
  }
  const prefix = chunkPrefix(name, userId);
  const chunks: string[] = [];
  for (let at = 0; at < value.length; at += VAULT_CHUNK_CHARACTERS) {
    chunks.push(value.slice(at, at + VAULT_CHUNK_CHARACTERS));
  }
  const manifest: ChunkedValueManifest = {
    format: CHUNKED_VALUE_FORMAT,
    version: CHUNKED_VALUE_VERSION,
    fingerprint: snapshotFingerprint(value),
    length: value.length,
    chunkPrefix: prefix,
    chunkCount: chunks.length,
  };
  return { storedValue: JSON.stringify(manifest), manifest, chunks };
}

function validateReassembledValue(manifest: ChunkedValueManifest, chunks: readonly string[]): string {
  if (chunks.length !== manifest.chunkCount || chunks.some(chunk => typeof chunk !== "string")) {
    throw new Error("The local vault workspace is missing one or more storage chunks.");
  }
  const value = chunks.join("");
  if (value.length !== manifest.length || snapshotFingerprint(value) !== manifest.fingerprint) {
    throw new Error("The local vault workspace chunks failed their integrity check.");
  }
  return value;
}

/** Resolve one record captured from the physical IndexedDB state store.
 * Migration backups include the store's chunk records verbatim, while their
 * recovery consumers need the same logical string returned by this adapter. */
export function resolveVaultSnapshotRecord(
  records: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  const stored = records[key];
  if (typeof stored !== "string") return undefined;
  const manifest = readChunkedValueManifest(stored);
  if (!manifest) return stored;
  const chunks: string[] = [];
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const chunk = records[`${manifest.chunkPrefix}:${index}`];
    if (typeof chunk !== "string") {
      throw new Error("The local vault workspace is missing one or more storage chunks.");
    }
    chunks.push(chunk);
  }
  return validateReassembledValue(manifest, chunks);
}

function workspaceFingerprint(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return readChunkedValueManifest(value)?.fingerprint ?? snapshotFingerprint(value);
}

type VaultExpectation = {
  fingerprints: readonly (string | null)[];
  latchConflict?: boolean;
};

type NewerFallbackCopy = {
  value: string;
  marker: string;
  fingerprint: string;
  baseFingerprint?: string | null;
};

function observesWorkspace(name: string): boolean {
  return name === STORAGE_KEYS.persistedState;
}

function rememberVaultSnapshot(name: string, value: string | null): void {
  if (!observesWorkspace(name) || !conflictedWorkspaceKeys.has(name)) {
    observedVaultSnapshots.set(name, workspaceFingerprint(value));
    if (value !== null) observedVaultUsers.set(name, persistedUserId(value));
    else observedVaultUsers.delete(name);
  }
}

function observedVaultFingerprint(name: string): string | null | undefined {
  return observedVaultSnapshots.has(name) ? observedVaultSnapshots.get(name) : undefined;
}

function workspaceExpectation(name: string): VaultExpectation | undefined {
  if (!observesWorkspace(name)) return undefined;
  if (conflictedWorkspaceKeys.has(name)) throw new VaultConflictError();
  return {
    // A runtime that has not hydrated cannot safely replace an existing vault.
    // Zustand hydrates before normal writes; null only permits a genuinely new vault.
    fingerprints: [observedVaultFingerprint(name) ?? null],
  };
}

function assertFallbackStillCurrent(name: string, current: NewerFallbackCopy | null, expected: VaultExpectation | undefined): void {
  if (!expected || current === null) return;
  if (!expected.fingerprints.includes(current.fingerprint)) {
    conflictedWorkspaceKeys.add(name);
    throw new VaultConflictError();
  }
}

function fallbackExpectation(copy: NewerFallbackCopy, latchConflict = true): VaultExpectation {
  const fingerprints = copy.baseFingerprint === undefined
    ? [copy.fingerprint]
    : [copy.baseFingerprint, copy.fingerprint];
  return { fingerprints, latchConflict };
}

function encodeFallbackMarker(valueFingerprint: string, baseFingerprint: string | null | undefined): string {
  if (baseFingerprint === undefined) return valueFingerprint;
  return JSON.stringify({ version: 1, valueFingerprint, baseFingerprint });
}

/**
 * The localStorage copy, but only when a save marked it as newer than
 * IndexedDB. A copy mirrored by an older build carries no marker and can be
 * stale, so it never overrides the vault.
 */
function newerFallbackCopy(fallbackStore: Pick<Storage, "getItem"> | null, name: string): NewerFallbackCopy | null {
  try {
    const marker = fallbackStore?.getItem(fallbackMarkerKey(name));
    if (!marker) return null;
    const value = fallbackStore?.getItem(name) ?? null;
    if (value === null) return null;

    let valueFingerprint = marker;
    let baseFingerprint: string | null | undefined;
    try {
      const parsed = JSON.parse(marker) as {
        version?: unknown;
        valueFingerprint?: unknown;
        baseFingerprint?: unknown;
      };
      if (
        parsed.version === 1
        && typeof parsed.valueFingerprint === "string"
        && (typeof parsed.baseFingerprint === "string" || parsed.baseFingerprint === null)
      ) {
        valueFingerprint = parsed.valueFingerprint;
        baseFingerprint = parsed.baseFingerprint;
      }
    } catch {
      // Legacy markers contain only the fallback snapshot fingerprint.
    }
    return snapshotFingerprint(value) === valueFingerprint
      ? { value, marker, fingerprint: valueFingerprint, baseFingerprint }
      : null;
  } catch {
    return null;
  }
}

/** Resolve a marked fallback from an immutable safety snapshot without writing
 * either storage tier. A modern marker identifies the vault base it supersedes;
 * a competing vault commit keeps precedence just as it does during hydration.
 * Unmarked mirrors remain subject to the caller's existing vault-first lookup. */
export function resolveMarkedVaultSnapshotRecord(
  indexedDb: Readonly<Record<string, string>> | undefined,
  local: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  if (local[fallbackMarkerKey(name)] === undefined) return undefined;
  const newer = newerFallbackCopy({ getItem: key => local[key] ?? null }, name);
  if (!newer) throw new Error("The safety snapshot has an invalid newer-fallback marker.");

  let current = indexedDb ? resolveVaultSnapshotRecord(indexedDb, name) : undefined;
  if (!current && indexedDb) {
    const activeUser = indexedDb[activeUserKey(name)];
    if (activeUser) current = resolveVaultSnapshotRecord(indexedDb, scopedStateKey(name, activeUser));
  }
  if (!current || current === newer.value || workspaceFingerprint(current) === newer.baseFingerprint) return newer.value;
  if (newer.baseFingerprint === undefined) {
    throw new Error("The safety snapshot cannot establish which workspace copy is newer.");
  }
  return current;
}

function legacyFallbackBinding(storage: Pick<Storage, "getItem">, name: string, userId: string): LegacyFallbackBinding {
  return {
    primaryFingerprint: workspaceFingerprint(storage.getItem(name)),
    scopedFingerprint: workspaceFingerprint(storage.getItem(scopedStateKey(name, userId))),
    activeUser: storage.getItem(activeUserKey(name)),
    marker: storage.getItem(fallbackMarkerKey(name)),
  };
}

function sameLegacyBinding(left: LegacyFallbackBinding, right: LegacyFallbackBinding): boolean {
  return left.primaryFingerprint === right.primaryFingerprint && left.scopedFingerprint === right.scopedFingerprint
    && left.activeUser === right.activeUser && left.marker === right.marker;
}

async function readPackedFallback(storage: Pick<Storage, "getItem"> | null, name: string): Promise<PackedFallbackCopy | null> {
  if (!storage || !observesWorkspace(name)) return null;
  const raw = storage.getItem(packedFallbackKey(name));
  if (raw === null) return null;
  const copy = await unpackVaultFallback(raw, name);
  if (persistedUserId(copy.value) !== copy.userId || snapshotFingerprint(copy.value) !== copy.valueFingerprint
    || (copy.legacy.activeUser !== null && copy.legacy.activeUser !== copy.userId)) throw new PackedFallbackError();
  return copy;
}

function assertPackedLegacyCurrent(storage: Pick<Storage, "getItem"> | null, copy: PackedFallbackCopy): void {
  if (!storage || !sameLegacyBinding(legacyFallbackBinding(storage, copy.name, copy.userId), copy.legacy)) {
    throw new VaultConflictError();
  }
}

function packedExpectation(copy: PackedFallbackCopy): VaultExpectation {
  return { fingerprints: [copy.baseFingerprint, copy.valueFingerprint] };
}

/** Only the new current fallback is retired, after its logical bytes reached IDB.
 * Historical backups and legacy records are never deleted to make this save fit. */
function retirePackedFallback(storage: Storage | null, name: string, previousRaw: string | null): void {
  if (!storage || !observesWorkspace(name)) return;
  const raw = storage.getItem(packedFallbackKey(name));
  if (raw !== previousRaw) throw new VaultConflictError();
  if (raw === null) return;
  storage.removeItem(packedFallbackKey(name));
}

/** All asynchronous work precedes a fresh comparison of both fallback records.
 * The final set is one self-contained value, so a failed write keeps the old one. */
async function writePackedFallback(
  storage: Storage | null, name: string, value: string, userId: string,
  baseFingerprint: string | null | undefined, previous: PackedFallbackCopy | null,
): Promise<void> {
  if (!storage || !observesWorkspace(name)) throw new PackedFallbackError("A compressed workspace fallback is unavailable.");
  const previousRaw = previous?.raw ?? null;
  if (storage.getItem(packedFallbackKey(name)) !== previousRaw) throw new VaultConflictError();
  if (previous) assertPackedLegacyCurrent(storage, previous);
  const expected = workspaceExpectation(name);
  if (previous && !expected?.fingerprints.includes(previous.valueFingerprint)) throw new VaultConflictError();
  if (!previous) assertFallbackStillCurrent(name, newerFallbackCopy(storage, name), expected);
  const observedUser = observedVaultUsers.get(name);
  if ((previous && previous.userId !== userId) || (observedUser !== undefined && observedUser !== userId)) throw new PackedFallbackError("The compressed workspace belongs to a different local profile. Keep both copies and export saved work.");
  const legacy = previous?.legacy ?? legacyFallbackBinding(storage, name, userId);
  if (legacy.activeUser !== null && legacy.activeUser !== userId) throw new PackedFallbackError("The browser fallback belongs to a different local profile. Keep both copies and export saved work.");
  const base = previous ? previous.baseFingerprint : baseFingerprint;
  if (base === undefined) throw new PackedFallbackError("AXOM cannot establish the saved base for this fallback. Keep this tab open and export saved work.");
  const encoded = await packVaultFallback(value, { name, userId, valueFingerprint: snapshotFingerprint(value), baseFingerprint: base, legacy });
  if (!encoded) throw new PackedFallbackError("This browser could not create a smaller, restorable workspace fallback.");

  // A competing IDB commit during compression is authoritative conflict evidence.
  // Unavailable IDB is why a fallback exists; its recorded base still gates promotion.
  const allowed = [base, previous?.valueFingerprint, snapshotFingerprint(value)];
  await assertPackedVaultBase(name, allowed);
  if (storage.getItem(packedFallbackKey(name)) !== previousRaw
    || !sameLegacyBinding(legacyFallbackBinding(storage, name, userId), legacy)) throw new VaultConflictError();
  storage.setItem(packedFallbackKey(name), encoded);
  const readback = storage.getItem(packedFallbackKey(name));
  if (readback !== encoded) throw new PackedFallbackError("The compressed workspace could not be read back after saving.");
  const decoded = await readPackedFallback(storage, name);
  if (!decoded || decoded.value !== value) throw new PackedFallbackError();
  await assertPackedVaultBase(name, allowed);
  if (storage.getItem(packedFallbackKey(name)) !== encoded
    || !sameLegacyBinding(legacyFallbackBinding(storage, name, userId), legacy)) throw new VaultConflictError();
}

async function assertPackedVaultBase(name: string, allowed: readonly (string | null | undefined)[]): Promise<void> {
  if (vaultUpgradeBlocked) return; // A second open would queue behind that blocked upgrade.
  let fingerprint: string | null | undefined;
  try {
    // Chunk manifests already bind the complete logical value. Avoid loading a
    // multi-megabyte source library twice merely to compare its recorded base.
    let raw = await withStore<string | undefined>("readonly", store => store.get(name), openExistingVault);
    if (!raw) {
      const active = await withStore<string | undefined>("readonly", store => store.get(activeUserKey(name)), openExistingVault);
      if (active) raw = await withStore<string | undefined>("readonly", store => store.get(scopedStateKey(name, active)), openExistingVault);
    }
    fingerprint = workspaceFingerprint(raw);
  } catch { /* An unreadable vault is why this separate fallback exists. */ }
  if (fingerprint !== undefined && !allowed.includes(fingerprint)) throw new VaultConflictError();
}

/** One read-only selector for captured backups and update checkpoints. Plain and
 * chunked legacy snapshots retain their existing order; a packed copy must prove
 * its identity and its relationship to both captured storage tiers. */
export async function resolveWorkspaceSnapshotRecord(
  indexedDb: Readonly<Record<string, string>> | undefined,
  local: Readonly<Record<string, string>>,
  name: string,
): Promise<string | undefined> {
  const storage = { getItem: (key: string) => local[key] ?? null };
  const packed = await readPackedFallback(storage, name);
  if (packed) {
    assertPackedLegacyCurrent(storage, packed);
    let vault = indexedDb ? resolveVaultSnapshotRecord(indexedDb, name) : undefined;
    if (!vault && indexedDb?.[activeUserKey(name)]) {
      vault = resolveVaultSnapshotRecord(indexedDb, scopedStateKey(name, indexedDb[activeUserKey(name)]));
    }
    if (vault !== undefined && !packedExpectation(packed).fingerprints.includes(workspaceFingerprint(vault))) throw new VaultConflictError();
    return packed.value;
  }
  const marked = resolveMarkedVaultSnapshotRecord(indexedDb, local, name);
  if (marked !== undefined) return marked;
  for (const records of [indexedDb, local]) {
    if (!records) continue;
    const primary = resolveVaultSnapshotRecord(records, name);
    if (primary) return primary;
    const scoped = Object.keys(records).sort().find(key => key.startsWith(`${name}:user:`));
    if (scoped) {
      const value = resolveVaultSnapshotRecord(records, scoped);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Workspace JSON only needs the long-lived `state` store. Open the current
 * database version instead of forcing a schema upgrade on every save: an
 * older AXOM tab may legitimately keep v1/v2 open, and that must not divert a
 * multi-megabyte workspace into localStorage while the upgrade is blocked.
 * New databases still create every current store in `onupgradeneeded`;
 * feature-specific boundaries request an upgrade only when their store is absent.
 */
function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(req.result);
    };
    req.onsuccess = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.close();
        reject(new Error("The local vault is missing its workspace store"));
        return;
      }
      // A brand-new database has no competing connection, so finish at the
      // canonical schema version. Only pre-existing databases use their
      // current store without demanding an upgrade from older open tabs.
      if (created && req.result.version < DB_VERSION) {
        req.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open local vault"));
    req.onblocked = () => reject(new Error("Local vault access is blocked by another tab"));
  });
}

function openUpgradedVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (vaultUpgradeBlocked) {
      reject(new Error("Local vault upgrade is blocked by another tab"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
      // A blocked request can succeed later after its caller already fell back.
      // Do not leak that late database connection or resolve a settled promise.
      if (blocked) {
        vaultUpgradeBlocked = false;
        req.result.close();
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => {
      if (blocked) vaultUpgradeBlocked = false;
      reject(req.error ?? new Error("Unable to upgrade local vault"));
    };
    req.onblocked = () => {
      blocked = true;
      vaultUpgradeBlocked = true;
      reject(new Error("Local vault upgrade is blocked by another tab"));
    };
  });
}

function openExistingVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
      ensureVaultStores(req.result);
    };
    req.onsuccess = () => {
      if (created && req.result.version < DB_VERSION) {
        req.result.close();
        openUpgradedVault().then(resolve, reject);
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open existing local vault"));
    req.onblocked = () => reject(new Error("Local vault access is blocked by another tab"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  open: () => Promise<IDBDatabase> = openVault,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = run(tx.objectStore(STORE_NAME));
    let result: T;
    let settled = false;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => {
      if (!settled) reject(req.error ?? new Error("Local vault request failed"));
      settled = true;
    };
    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve(result);
      settled = true;
    };
    tx.onerror = () => {
      db.close();
      if (!settled) reject(tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
    tx.onabort = tx.onerror;
  });
}

/** Read either a legacy single-value record or an atomically stored chunk set. */
async function readVaultRecord(
  key: string,
  open: () => Promise<IDBDatabase> = openExistingVault,
): Promise<string | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const primary = store.get(key);
    let result: string | undefined;
    let failure: Error | undefined;
    let chunked: { manifest: ChunkedValueManifest; chunks: string[] } | undefined;
    primary.onsuccess = () => {
      if (typeof primary.result !== "string") return;
      const manifest = readChunkedValueManifest(primary.result);
      if (!manifest) {
        result = primary.result;
        return;
      }
      const chunks = new Array<string>(manifest.chunkCount);
      chunked = { manifest, chunks };
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const request = store.get(`${manifest.chunkPrefix}:${index}`);
        request.onsuccess = () => {
          if (typeof request.result !== "string") {
            failure ??= new Error("The local vault workspace is missing one or more storage chunks.");
            return;
          }
          chunks[index] = request.result;
        };
        request.onerror = () => { failure ??= request.error ?? new Error("Unable to read a local vault chunk."); };
      }
    };
    primary.onerror = () => { failure = primary.error ?? new Error("Unable to read the local workspace."); };
    tx.oncomplete = () => {
      db.close();
      if (!failure && chunked) {
        try { result = validateReassembledValue(chunked.manifest, chunked.chunks); }
        catch (error) { failure = error instanceof Error ? error : new Error("Unable to rebuild the local workspace."); }
      }
      if (failure) reject(failure);
      else resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? failure ?? new Error("Local vault read failed"));
    };
    tx.onabort = tx.onerror;
  });
}

/** One transaction: compare the hydrated workspace, then replace its primary,
 * active-profile pointer and per-profile copy. IndexedDB keeps the comparison
 * and writes atomic across browser tabs. */
async function writeVault(
  name: string,
  value: string,
  userId: string,
  expected?: VaultExpectation,
  signal?: AbortSignal,
): Promise<void> {
  const plan = storedValuePlan(name, value, userId);
  // A chunk manifest is only safe after the physical v4 upgrade succeeds.
  // Otherwise an already-open v3 writer could replace the manifest with a
  // legacy single value while leaving its chunks behind. Small legacy values
  // can continue using the long-lived state store while an upgrade is blocked.
  // An open that never answers is abandoned; if it succeeds later, that
  // connection is closed without writing.
  const db = await untilAbandoned(plan.manifest ? openUpgradedVault() : openVault(), signal, (late) => late.close());
  if (plan.manifest && db.version < DB_VERSION) {
    db.close();
    throw new Error("The local vault must finish its storage upgrade before saving this large workspace.");
  }
  if (signal?.aborted) {
    db.close();
    throw isVaultWriteTimeout(signal.reason) ? signal.reason : new VaultWriteTimeout(VAULT_WRITE_STALL_MS);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let conflict: VaultConflictError | null = null;
    let chunkWriteFailure: Error | null = null;
    let settled = false;
    // An abandoned save is rolled back, never left to land after a newer one.
    const onAbandon = () => failWrite(isVaultWriteTimeout(signal?.reason) ? signal!.reason : new VaultWriteTimeout(VAULT_WRITE_STALL_MS));
    signal?.addEventListener("abort", onAbandon, { once: true });
    const release = () => signal?.removeEventListener("abort", onAbandon);

    const write = (current: string | undefined, previous: readonly (string | undefined)[]) => {
      // A missing record is a fresh/recreated vault, not a competing revision.
      // Conflicts only exist when another concrete workspace replaced the one
      // this runtime hydrated.
      if (
        expected
        && typeof current === "string"
        && !expected.fingerprints.includes(workspaceFingerprint(current))
      ) {
        conflict = new VaultConflictError();
        if (expected.latchConflict !== false && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        tx.abort();
        return;
      }
      try {
        const currentPrefix = chunkPrefix(name, userId);
        const nextChunkCount = plan.manifest?.chunkPrefix === currentPrefix ? plan.manifest.chunkCount : 0;
        for (const raw of previous) {
          const manifest = readChunkedValueManifest(raw);
          if (!manifest || manifest.chunkPrefix !== currentPrefix) continue;
          for (let index = nextChunkCount; index < manifest.chunkCount; index += 1) {
            store.delete(`${manifest.chunkPrefix}:${index}`);
          }
        }
        if (plan.manifest) {
          // Preserve unchanged chunks so a small edit does not rewrite megabytes.
          plan.chunks.forEach((chunk, index) => {
            const key = `${plan.manifest!.chunkPrefix}:${index}`;
            const existing = store.get(key);
            existing.onsuccess = () => {
              if (existing.result === chunk) return;
              try {
                store.put(chunk, key);
              } catch (error) {
                failWrite(error);
              }
            };
          });
        }
        store.put(plan.storedValue, name);
        if (userId) {
          store.put(userId, activeUserKey(name));
          store.put(plan.storedValue, scopedStateKey(name, userId));
        }
      } catch (error) {
        // A browser can refuse a write synchronously (quota, a value it cannot
        // clone, a closing database). Thrown from this request callback, that
        // escaped as an uncaught page error, and the save was rejected as a
        // bare AbortError instead of its real cause.
        failWrite(error);
      }
    };
    const failWrite = (error: unknown) => {
      chunkWriteFailure ??= error instanceof Error ? error : new Error(String(error));
      try { tx.abort(); } catch { /* already aborted or finished; onabort/onerror settle the promise */ }
    };

    const primary = store.get(name);
    primary.onsuccess = () => {
      const primaryValue = typeof primary.result === "string" ? primary.result : undefined;
      const userScoped = userId ? store.get(scopedStateKey(name, userId)) : undefined;
      const finish = (userScopedValue?: string) => {
        if (primaryValue !== undefined) {
          write(primaryValue, [primaryValue, userScopedValue]);
          return;
        }
        const active = store.get(activeUserKey(name));
        active.onsuccess = () => {
          if (typeof active.result !== "string" || !active.result) {
            write(userScopedValue, [userScopedValue]);
            return;
          }
          const scoped = store.get(scopedStateKey(name, active.result));
          scoped.onsuccess = () => {
            const activeValue = typeof scoped.result === "string" ? scoped.result : undefined;
            write(activeValue ?? userScopedValue, [userScopedValue, activeValue]);
          };
        };
      };
      if (!userScoped) finish();
      else userScoped.onsuccess = () => finish(typeof userScoped.result === "string" ? userScoped.result : undefined);
    };

    tx.oncomplete = () => {
      release();
      db.close();
      if (!settled) resolve();
      settled = true;
    };
    tx.onerror = () => {
      if (conflict || settled) return;
      release();
      db.close();
      reject(chunkWriteFailure ?? tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
    tx.onabort = () => {
      release();
      db.close();
      if (!settled) reject(conflict ?? chunkWriteFailure ?? tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
  });
}

// IndexedDB owns the large serialized workspace. localStorage keeps only the
// tiny active-profile pointer and device preferences; remove the mirrored
// state, and the marker that called it newer, after a confirmed vault write.
function clearFallbackCopy(fallbackStore: Storage | null, name: string, userId: string): void {
  // These optional mirrors must not turn a confirmed IndexedDB write into a
  // failed save when localStorage is full or unavailable.
  try {
    fallbackStore?.removeItem(name);
    fallbackStore?.removeItem(fallbackMarkerKey(name));
    if (userId) {
      fallbackStore?.setItem(activeUserKey(name), userId);
      fallbackStore?.removeItem(scopedStateKey(name, userId));
    }
  } catch { /* IndexedDB already holds the durable workspace. */ }
}

async function readVaultSnapshot(name: string): Promise<string | null> {
  const primary = await readVaultRecord(name, openExistingVault);
  if (primary) return primary;
  const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
  if (!activeUser) return null;
  return await readVaultRecord(scopedStateKey(name, activeUser), openExistingVault) ?? null;
}

async function removeVaultRecords(name: string, active?: string, signal?: AbortSignal): Promise<void> {
  // A removal abandoned before its transaction opens never runs later: it
  // could otherwise delete a newer workspace saved in the meantime.
  const db = await untilAbandoned(openExistingVault(), signal, (late) => late.close());
  if (signal?.aborted) {
    db.close();
    throw isVaultWriteTimeout(signal.reason) ? signal.reason : new VaultWriteTimeout(VAULT_WRITE_STALL_MS);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const abandon = () => { try { tx.abort(); } catch { /* finished already */ } };
    signal?.addEventListener("abort", abandon, { once: true });
    const store = tx.objectStore(STORE_NAME);
    const keys = [name, ...(active ? [scopedStateKey(name, active)] : [])];
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        const manifest = readChunkedValueManifest(typeof request.result === "string" ? request.result : undefined);
        if (!manifest) return;
        for (let index = 0; index < manifest.chunkCount; index += 1) {
          store.delete(`${manifest.chunkPrefix}:${index}`);
        }
      };
      store.delete(key);
    }
    store.delete(activeUserKey(name));
    tx.oncomplete = () => { signal?.removeEventListener("abort", abandon); db.close(); resolve(); };
    tx.onerror = () => {
      signal?.removeEventListener("abort", abandon);
      db.close();
      reject(tx.error ?? new Error("Unable to remove the local workspace."));
    };
    tx.onabort = tx.onerror;
  });
}

function clearFallbackCopyIfUnchanged(
  fallbackStore: Storage | null,
  name: string,
  copy: NewerFallbackCopy,
  currentUserId: string,
): void {
  try {
    if (
      fallbackStore?.getItem(fallbackMarkerKey(name)) !== copy.marker
      || fallbackStore.getItem(name) !== copy.value
    ) return;
    const fallbackUserId = persistedUserId(copy.value);
    fallbackStore.removeItem(name);
    fallbackStore.removeItem(fallbackMarkerKey(name));
    if (fallbackUserId) fallbackStore.removeItem(scopedStateKey(name, fallbackUserId));
    if (currentUserId) fallbackStore.setItem(activeUserKey(name), currentUserId);
  } catch { /* The durable IndexedDB snapshot remains authoritative. */ }
}

const vaultStorage: StateStorage = {
  async getItem(name) {
    // A save that could not reach IndexedDB leaves its snapshot here, ahead of
    // the vault. Reading the vault first used to hand back the older copy, and
    // the next successful save then deleted the newer one.
    const fallbackStore = localFallback();
    const packed = await readPackedFallback(fallbackStore, name);
    if (packed) {
      assertPackedLegacyCurrent(fallbackStore, packed);
      try {
        await writeVault(name, packed.value, packed.userId, packedExpectation(packed));
        assertPackedLegacyCurrent(fallbackStore, packed);
        retirePackedFallback(fallbackStore, name, packed.raw);
        clearFallbackCopy(fallbackStore, name, packed.userId);
      } catch (error) {
        // Keep both competing records. Choosing either would conceal work from
        // a newer/older tab that cannot understand the other's storage format.
        if (isVaultConflictError(error)) {
          conflictedWorkspaceKeys.add(name);
          throw error;
        }
        // A verified packed copy remains durable while IDB is unavailable/full.
      }
      rememberVaultSnapshot(name, packed.value);
      return packed.value;
    }
    const newer = newerFallbackCopy(fallbackStore, name);
    if (newer !== null) {
      const userId = persistedUserId(newer.value);
      try {
        // The marker records the IndexedDB snapshot on which this fallback was
        // based. Comparing that base and the fallback itself in one transaction
        // prevents a late promotion from replacing a newer tab's commit.
        await writeVault(name, newer.value, userId, fallbackExpectation(newer, false));
        clearFallbackCopy(fallbackStore, name, userId);
      } catch (promotionError) {
        if (isVaultConflictError(promotionError) && newer.baseFingerprint !== undefined) {
          try {
            const current = await readVaultSnapshot(name);
            if (current !== null) {
              clearFallbackCopyIfUnchanged(fallbackStore, name, newer, persistedUserId(current));
              rememberVaultSnapshot(name, current);
              return current;
            }
          } catch {
            // Keep the fallback below when the winning vault cannot be reread.
          }
        }
        // Still not writable: the copy stays in localStorage for the next start.
      }
      rememberVaultSnapshot(name, newer.value);
      return newer.value;
    }

    try {
      const value = await readVaultRecord(name, openExistingVault);
      if (value) {
        rememberVaultSnapshot(name, value);
        return value;
      }

      const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
      if (activeUser) {
        const scoped = await readVaultRecord(scopedStateKey(name, activeUser), openExistingVault);
        if (scoped) {
          rememberVaultSnapshot(name, scoped);
          return scoped;
        }
      }
    } catch {
      // Fall back below.
    }

    const fallback = fallbackStore?.getItem(name) ??
      fallbackStore?.getItem(scopedStateKey(name, fallbackStore?.getItem(activeUserKey(name)) ?? "")) ??
      null;
    if (fallback) {
      try {
        await writeVault(name, fallback, persistedUserId(fallback));
      } catch {
        // localStorage still has the data; no need to interrupt app load.
      }
    }
    rememberVaultSnapshot(name, fallback);
    return fallback;
  },

  async setItem(name, value) {
    const writeSequence = ++vaultWriteSequence;
    const userId = persistedUserId(value);
    const fallbackStore = localFallback();
    let fallbackBaseFingerprint: string | null | undefined;
    let currentPacked: PackedFallbackCopy | null = null;
    const stall = stallBudget();
    const indexedDbCoolingDown = Date.now() < indexedDbStalledUntil;
    try {
      const expected = workspaceExpectation(name);
      currentPacked = await readPackedFallback(fallbackStore, name);
      if (currentPacked) {
        assertPackedLegacyCurrent(fallbackStore, currentPacked);
        if (currentPacked.userId !== userId) throw new PackedFallbackError("The compressed workspace belongs to a different local profile. Keep both copies and export saved work.");
        if (!expected?.fingerprints.includes(currentPacked.valueFingerprint)) throw new VaultConflictError();
      }
      const currentFallback = newerFallbackCopy(fallbackStore, name);
      if (!currentPacked) assertFallbackStillCurrent(name, currentFallback, expected);
      fallbackBaseFingerprint = currentPacked !== null ? currentPacked.baseFingerprint : currentFallback !== null
        ? currentFallback.baseFingerprint
        : observedVaultFingerprint(name);
      if (currentPacked === null && currentFallback === null && fallbackBaseFingerprint === undefined && !indexedDbCoolingDown) {
        try {
          fallbackBaseFingerprint = workspaceFingerprint(await untilAbandoned(readVaultSnapshot(name), stall.signal));
        } catch {
          // The write attempt below decides whether a local fallback is needed.
        }
      }
      if (fallbackBaseFingerprint === undefined) {
        fallbackBaseFingerprint = expected?.fingerprints[0];
      }
      // A fallback save can replace only the vault snapshot on which its chain
      // began, or an idempotent promotion of the same fallback. A competing
      // commit is rejected inside the IndexedDB transaction.
      const vaultExpectation = currentPacked !== null ? packedExpectation(currentPacked) : currentFallback !== null
        ? fallbackExpectation(currentFallback)
        : expected;
      if (indexedDbCoolingDown) {
        throw new VaultWriteTimeout(VAULT_WRITE_STALL_MS, "Browser storage stopped answering moments ago, so this save went to the fallback.");
      }
      await untilAbandoned(writeVault(name, value, userId, vaultExpectation, stall.signal), stall.signal);
      if (currentPacked) assertPackedLegacyCurrent(fallbackStore, currentPacked);
      retirePackedFallback(fallbackStore, name, currentPacked?.raw ?? null);
      clearFallbackCopy(fallbackStore, name, userId);
      rememberVaultSnapshot(name, value);
      markVaultWrite("indexeddb");
    } catch (indexedDbError) {
      // A stalled IndexedDB is skipped for a while; later saves go straight to the fallback.
      if (stall.signal.aborted && isVaultWriteTimeout(indexedDbError)) indexedDbStalledUntil = Date.now() + VAULT_STALL_COOLDOWN_MS;
      if (isVaultConflictError(indexedDbError) || isPackedFallbackError(indexedDbError)) {
        if (isVaultConflictError(indexedDbError) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        vaultWriteFailures.set(writeSequence, indexedDbError);
        markVaultWriteFailure(new Date(), indexedDbError);
        return;
      }
      if (currentPacked) {
        try {
          await writePackedFallback(fallbackStore, name, value, userId, fallbackBaseFingerprint, currentPacked);
          rememberVaultSnapshot(name, value);
          markVaultWrite("local-fallback");
        } catch (error) {
          if (isVaultConflictError(error)) conflictedWorkspaceKeys.add(name);
          const failure = isVaultConflictError(error) ? error : combinedStorageFailure(indexedDbError, error);
          vaultWriteFailures.set(writeSequence, failure);
          markVaultWriteFailure(new Date(), failure);
        }
        return;
      }
      // Try the established localStorage recovery path for any workspace.
      // Browser quotas vary, and medium multi-megabyte snapshots can still fit;
      // the storage implementation itself is the authority on available room.
      let saved: boolean;
      let failure: unknown;
      const previousFallback = newerFallbackCopy(fallbackStore, name);
      try {
        const expected = workspaceExpectation(name);
        assertFallbackStillCurrent(name, previousFallback, expected);
        // Marker first: it is tiny, and one that does not match the copy beside
        // it is ignored, so a copy that failed to land is never read as newer.
        // Retain the original vault base across a chain of fallback-only saves.
        const baseFingerprint = previousFallback !== null
          ? previousFallback.baseFingerprint
          : fallbackBaseFingerprint === undefined
            ? expected?.fingerprints[0]
            : fallbackBaseFingerprint;
        fallbackStore?.setItem(
          fallbackMarkerKey(name),
          encodeFallbackMarker(snapshotFingerprint(value), baseFingerprint),
        );
        writeLocalFallback(fallbackStore, name, value, userId, indexedDbError);
        saved = true;
      } catch (fallbackError) {
        failure = fallbackError;
        const conflict = isVaultConflictError(fallbackError);
        if (conflict && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        // The workspace copy can land before the per-profile copy runs out of room.
        try { saved = !conflict && fallbackStore?.getItem(name) === value; } catch { saved = false; }
      }
      if (saved) {
        rememberVaultSnapshot(name, value);
        markVaultWrite("local-fallback");
      } else {
        // A quota failure leaves the preceding workspace in place. Keep its
        // valid marker too, or the next start would prefer the older vault.
        try {
          if (previousFallback !== null && fallbackStore?.getItem(name) === previousFallback.value) {
            if (fallbackStore.getItem(fallbackMarkerKey(name)) !== previousFallback.marker) {
              fallbackStore.setItem(fallbackMarkerKey(name), previousFallback.marker);
            }
          } else {
            fallbackStore?.removeItem(fallbackMarkerKey(name));
          }
        } catch { /* the last successful copy remains available for recovery */ }
        if (!isVaultConflictError(failure) && observesWorkspace(name)) {
          try {
            await writePackedFallback(fallbackStore, name, value, userId, fallbackBaseFingerprint, null);
            rememberVaultSnapshot(name, value);
            markVaultWrite("local-fallback");
            return;
          } catch (packedError) {
            if (isVaultConflictError(packedError)) {
              conflictedWorkspaceKeys.add(name);
              failure = packedError;
            } else if (fallbackStore) {
              failure = new Error(`Plain fallback: ${describeStorageFailure(failure).replace(/\.+$/, "")}. Compressed fallback: ${describeStorageFailure(packedError).replace(/\.+$/, "")}`, { cause: packedError });
            }
          }
        }
        const recordedFailure = isVaultConflictError(failure) ? failure : combinedStorageFailure(indexedDbError, failure);
        vaultWriteFailures.set(writeSequence, recordedFailure);
        // Ordinary saves are best-effort, so say so: this one is on no disk.
        markVaultWriteFailure(new Date(), recordedFailure);
      }
    } finally {
      stall.release();
    }
  },

  async removeItem(name) {
    const fallback = localFallback();
    const stall = stallBudget();
    try {
      let active = fallback?.getItem(activeUserKey(name)) ?? undefined;
      if (!active) {
        try {
          active = await untilAbandoned(
            withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault),
            stall.signal,
          );
        } catch {
          // Continue with the localStorage cleanup path below.
        }
      }
      fallback?.removeItem(name);
      fallback?.removeItem(fallbackMarkerKey(name));
      if (observesWorkspace(name)) fallback?.removeItem(packedFallbackKey(name));
      fallback?.removeItem(activeUserKey(name));
      if (active) fallback?.removeItem(scopedStateKey(name, active));
      try {
        await untilAbandoned(removeVaultRecords(name, active, stall.signal), stall.signal);
        conflictedWorkspaceKeys.delete(name);
        rememberVaultSnapshot(name, null);
      } catch {
        // No-op; best effort cleanup.
      }
    } finally {
      stall.release();
    }
  },
};

/** Replace a verified workspace backup even when the live chunk manifest can
 * no longer be reconstructed. This intentionally bypasses the ordinary
 * hydrated-snapshot conflict check; callers must validate and explicitly
 * authorize the replacement before scheduling it. A failed IndexedDB write is
 * reported instead of leaving a forced restore in a fallback that cannot be
 * promoted safely later. */
async function replaceVaultItem(name: string, value: string): Promise<void> {
  const writeSequence = ++vaultWriteSequence;
  const userId = persistedUserId(value);
  const stall = stallBudget();
  try {
    const fallback = localFallback();
    const previousPacked = observesWorkspace(name) ? fallback?.getItem(packedFallbackKey(name)) ?? null : null;
    await untilAbandoned(writeVault(name, value, userId, undefined, stall.signal), stall.signal);
    // Explicit verified restore already authorizes replacing the live workspace;
    // retire only the fallback captured before that write. A concurrent save
    // remains available and makes this replacement fail explicitly.
    retirePackedFallback(fallback, name, previousPacked);
    clearFallbackCopy(fallback, name, userId);
    conflictedWorkspaceKeys.delete(name);
    rememberVaultSnapshot(name, value);
    markVaultWrite("indexeddb");
  } catch (error) {
    if (isVaultConflictError(error) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
    vaultWriteFailures.set(
      writeSequence,
      error instanceof Error ? error : new Error("AXOM could not replace the local workspace."),
    );
    markVaultWriteFailure(new Date(), error);
  } finally {
    stall.release();
  }
}

// Writes are coalesced per key, newest wins: at most one IndexedDB write is in
// flight, and a burst of saves collapses into the latest snapshot. An older
// save can therefore never land after a newer one (the update checkpoint relies
// on that), and a quick reload or tab close is not stuck behind a backlog of
// stale full-workspace writes.
type VaultOp = { kind: "set" | "replace"; value: string } | { kind: "remove" };
const pendingVaultOps = new Map<string, VaultOp>();
let vaultDrain: Promise<void> | null = null;

async function drainVaultWrites(): Promise<void> {
  try {
    while (pendingVaultOps.size) {
      const [name, op] = pendingVaultOps.entries().next().value as [string, VaultOp];
      pendingVaultOps.delete(name);
      try {
        if (op.kind === "set") await vaultStorage.setItem(name, op.value);
        else if (op.kind === "replace") await replaceVaultItem(name, op.value);
        else await vaultStorage.removeItem(name);
      } catch {
        // setItem records failures itself (assertVaultWrite); keep draining.
      }
    }
  } finally {
    vaultDrain = null;
  }
}

function scheduleVaultWrite(name: string, op: VaultOp): Promise<void> {
  pendingVaultOps.set(name, op);
  vaultDrain ??= drainVaultWrites();
  return vaultDrain;
}

/** Resolves once every save requested so far (or a newer one) is on disk. */
export function flushLocalVaultWrites(): Promise<void> {
  return vaultDrain ?? Promise.resolve();
}

export const localVaultStorage: StateStorage = {
  getItem: (name) => vaultStorage.getItem(name),
  setItem: (name, value) => scheduleVaultWrite(name, { kind: "set", value }),
  removeItem: (name) => scheduleVaultWrite(name, { kind: "remove" }),
};

/** Schedule an explicit verified-backup replacement after earlier writes. */
export function replaceLocalVaultItem(name: string, value: string): Promise<void> {
  return scheduleVaultWrite(name, { kind: "replace", value });
}

function persistedUserId(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      state?: { profile?: { userId?: unknown; name?: unknown } };
    };
    const profile = parsed.state?.profile;
    if (!profile) return "";
    if (typeof profile?.userId === "string" && profile.userId.trim()) return profile.userId;
    return userIdFromName(typeof profile?.name === "string" ? profile.name : "");
  } catch {
    return "";
  }
}
