import type { StateStorage } from "zustand/middleware";
import { sha256 } from "./compressedText";
import { userIdFromName } from "./userIdentity";
import { STORAGE_KEYS } from "./brand";
import { markVaultWrite, markVaultWriteFailure } from "./vaultActivity";
import {
  isPackedFallbackError, PackedFallbackError, packedFallbackKey, packVaultFallback, unpackVaultFallback,
  type LegacyFallbackBinding, type PackedFallbackCopy,
} from "./packedVaultFallback";

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
/** Persisted before cross-store workspace deletion; cleared only after every tier confirms cleanup. */
const removalIntentKey = (name: string) => `${name}:removal-pending`;
/** Durable deletion lineage. Unlike the plain workspace bytes, this survives
 * successful deletion, so null -> saved -> deleted cannot fool an old tab. */
const deletionGenerationKey = (name: string) => `${name}:deletion-generation`;
let vaultWriteSequence = 0;
const vaultWriteFailures = new Map<number, Error>();
const observedVaultSnapshots = new Map<string, string | null>();
const observedVaultUsers = new Map<string, string>();
const observedDeletionGenerations = new Map<string, string | null>();
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
  observedDeletionGenerations.clear();
  conflictedWorkspaceKeys.clear();
  vaultUpgradeBlocked = false;
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

function localFallback(name?: string): Storage | null {
  try {
    // Node 25 exposes an unusable experimental global `localStorage` unless a
    // file flag is supplied. In browsers/jsdom, the Window-owned storage is the
    // real fallback and must take precedence over that process-level getter.
    if (typeof window !== "undefined") return window.localStorage;
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A denied Window.localStorage getter is not evidence that this browser
    // lacks an acknowledged recovery copy. Never fall through to older IDB.
    if (name && observesWorkspace(name)) {
      conflictedWorkspaceKeys.add(name);
      throw new VaultConflictError();
    }
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
  assertNoPendingVaultRemoval(fallbackStore, name);
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
  /** Atomic empty-workspace lineage, read on a verified empty hydration. */
  deletionGeneration?: string | null;
};

type NewerFallbackCopy = {
  value: string;
  marker: string;
  fingerprint: string;
  baseFingerprint?: string | null;
  deletionGeneration?: string | null;
};

function observesWorkspace(name: string): boolean {
  return name === STORAGE_KEYS.persistedState;
}

/** A partial or interrupted removal must not silently hydrate stale IDB data
 * or allow a new save. Presence is sufficient: malformed receipts fail closed. */
function assertNoPendingVaultRemoval(storage: Pick<Storage, "getItem"> | null, name: string): void {
  if (!observesWorkspace(name) || !storage) return;
  try {
    if (storage.getItem(removalIntentKey(name)) === null) return;
  } catch {
    // An unreadable deletion receipt is not proof that deletion completed.
  }
  conflictedWorkspaceKeys.add(name);
  throw new VaultConflictError();
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
    deletionGeneration: observedDeletionGenerations.get(name) ?? null,
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
  return { fingerprints, latchConflict,
    deletionGeneration: copy.baseFingerprint === null ? copy.deletionGeneration ?? null : undefined };
}

function encodeFallbackMarker(
  valueFingerprint: string, baseFingerprint: string | null | undefined,
  deletionGeneration?: string | null,
): string {
  if (baseFingerprint === undefined) return valueFingerprint;
  return JSON.stringify({ version: 1, valueFingerprint, baseFingerprint,
    ...(baseFingerprint === null ? { deletionGeneration: deletionGeneration ?? null } : {}) });
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
    let deletionGeneration: string | null | undefined;
    try {
      const parsed = JSON.parse(marker) as {
        version?: unknown;
        valueFingerprint?: unknown;
        baseFingerprint?: unknown;
        deletionGeneration?: unknown;
      };
      if (parsed.version === 1 && parsed.deletionGeneration !== undefined && (
        (parsed.deletionGeneration !== null && typeof parsed.deletionGeneration !== "string")
        || parsed.deletionGeneration === ""
      )) throw new VaultConflictError();
      if (
        parsed.version === 1
        && typeof parsed.valueFingerprint === "string"
        && (typeof parsed.baseFingerprint === "string" || parsed.baseFingerprint === null)
      ) {
        valueFingerprint = parsed.valueFingerprint;
        baseFingerprint = parsed.baseFingerprint;
        deletionGeneration = parsed.deletionGeneration as string | null | undefined;
      }
    } catch (error) {
      if (isVaultConflictError(error)) throw error;
      // Legacy markers contain only the fallback snapshot fingerprint.
    }
    return snapshotFingerprint(value) === valueFingerprint
      ? { value, marker, fingerprint: valueFingerprint, baseFingerprint, deletionGeneration }
      : null;
  } catch (error) {
    // A marked recovery copy may still exist when the marker or payload read
    // raises SecurityError. Treating that ambiguity as no fallback can hydrate
    // an older IndexedDB workspace or acknowledge a blind competing save.
    if (observesWorkspace(name)) {
      // Do not let a later apparently healthy read authorize this unhydrated
      // tab to save blindly. A fresh verified hydration must reconcile it.
      conflictedWorkspaceKeys.add(name);
      throw isVaultConflictError(error) ? error : new VaultConflictError();
    }
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
  if (local[removalIntentKey(name)] !== undefined) throw new VaultConflictError();
  if (local[fallbackMarkerKey(name)] === undefined) return undefined;
  const capturedStore = { getItem: (key: string) => local[key] ?? null };
  const newer = newerFallbackCopy(capturedStore, name);
  let current = indexedDb ? resolveVaultSnapshotRecord(indexedDb, name) : undefined;
  if (!current && indexedDb) {
    const activeUser = indexedDb[activeUserKey(name)];
    if (activeUser) current = resolveVaultSnapshotRecord(indexedDb, scopedStateKey(name, activeUser));
  }
  if (!newer) {
    // A user-authorized restore may follow an interrupted delete that already
    // removed the plain primary but left the marker and an account-scoped copy.
    // A matching retirement receipt distinguishes it from an invalid orphan.
    // The original bytes remain present and are never deleted by inspection.
    let receipt: { fallbackUserId?: unknown } | null = null;
    try { receipt = JSON.parse(local[`${name}:fallback-retired`] ?? "null") as { fallbackUserId?: unknown } | null; }
    catch { /* An invalid receipt is not an authorized recovery. */ }
    if (local[name] === undefined && typeof receipt?.fallbackUserId === "string") {
      const scoped = local[scopedStateKey(name, receipt.fallbackUserId)];
      if (typeof scoped === "string") {
        const scopedCopy = newerFallbackCopy({
          getItem: key => key === name ? scoped : capturedStore.getItem(key),
        }, name);
        const retired = scopedCopy && retiredFallbackReceipt(capturedStore, name, scopedCopy);
        if (retired && current && persistedUserId(current) === retired.committedUserId) {
          return current;
        }
      }
    }
    throw new Error("The safety snapshot has an invalid newer-fallback marker.");
  }
  // Successful saves and explicit restores retain the previous recovery bytes
  // rather than risk a cross-tab multi-key delete. The retirement receipt must
  // govern snapshot exports and update checkpoints as well as live hydration.
  // An unreadable, competing, or differently owned vault cannot prove that
  // these retained bytes were superseded; keep both copies and fail closed.
  const retired = retiredFallbackReceipt(capturedStore, name, newer);
  if (retired) {
    if (
      current !== undefined
      && snapshotFingerprint(current) === retired.committedFingerprint
      && persistedUserId(current) === retired.committedUserId
    ) return current;
    throw new VaultConflictError();
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
  let raw: string | null;
  try { raw = storage.getItem(packedFallbackKey(name)); }
  catch { throw new VaultConflictError(); }
  if (raw === null) return null;
  const copy = await unpackVaultFallback(raw, name);
  // Decoding and SHA-256 are asynchronous. A peer can atomically replace the
  // packed record while this tab verifies the captured bytes. Never hydrate Y
  // once a distinct, acknowledged packed Z has arrived.
  let rawAfterDecode: string | null;
  try { rawAfterDecode = storage.getItem(packedFallbackKey(name)); }
  catch { throw new VaultConflictError(); }
  if (rawAfterDecode !== raw) throw new VaultConflictError();
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
  return { fingerprints: [copy.baseFingerprint, copy.valueFingerprint],
    deletionGeneration: copy.baseFingerprint === null ? copy.deletionGeneration ?? null : undefined };
}

// Deleting a packed record after a separate comparison is unsafe across tabs.
// Retain original bytes; logically retire only the exact record whose SHA-256
// identity and committed vault revision are verified. v1 full-raw receipts
// already written by older clients stay readable; v2 never duplicates the
// potentially multi-megabyte packed envelope in localStorage.
interface RetiredPackedReceipt {
  version: 1 | 2;
  raw?: string;
  rawSha256?: string;
  committedFingerprint: string;
  committedUserId: string;
}
const packedRetiredKey = (name: string) => `${name}:packed-retired`;

async function retiredPackedReceipt(
  storage: Pick<Storage, "getItem"> | null, name: string, copy: PackedFallbackCopy,
): Promise<RetiredPackedReceipt | null> {
  if (!storage) return null;
  // Only a confirmed missing key is an absent retirement receipt. Security
  // errors, malformed JSON or a damaged receipt cannot authorize repromotion
  // of potentially older packed bytes over a separately restored workspace.
  let raw: string | null;
  try { raw = storage.getItem(packedRetiredKey(name)); }
  catch { throw new VaultConflictError(); }
  if (raw === null) return null;

  let parsed: Partial<RetiredPackedReceipt>;
  try { parsed = JSON.parse(raw) as Partial<RetiredPackedReceipt>; }
  catch { throw new VaultConflictError(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || typeof parsed.committedFingerprint !== "string"
    || typeof parsed.committedUserId !== "string") throw new VaultConflictError();

  if (parsed.version === 1) {
    if (typeof parsed.raw !== "string") throw new VaultConflictError();
    if (parsed.raw !== copy.raw) return null;
  } else if (parsed.version === 2) {
    if (typeof parsed.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.rawSha256)) {
      throw new VaultConflictError();
    }
    let actualDigest: string;
    try { actualDigest = await sha256(new TextEncoder().encode(copy.raw)); }
    catch { throw new VaultConflictError(); }
    // A structurally valid receipt for another newly acknowledged packed
    // record is not a retirement of this one. Let normal CAS/identity gates
    // decide whether the new record can be promoted.
    if (actualDigest !== parsed.rawSha256) return null;
  } else throw new VaultConflictError();
  return parsed as RetiredPackedReceipt;
}

function verifiedRetiredPackedValue(receipt: RetiredPackedReceipt, value: string | null | undefined): value is string {
  return typeof value === "string"
    && snapshotFingerprint(value) === receipt.committedFingerprint
    && persistedUserId(value) === receipt.committedUserId;
}

async function retirePackedFallback(
  storage: Storage | null, name: string, previousRaw: string | null,
  committedUserId: string, committedValue: string,
): Promise<void> {
  if (!storage || !observesWorkspace(name)) return;
  if (storage.getItem(packedFallbackKey(name)) !== previousRaw) throw new VaultConflictError();
  if (previousRaw === null) return;
  // Hash before the single receipt write and recheck the packed key afterward:
  // a peer's acknowledged packed record must never inherit this receipt.
  const rawSha256 = await sha256(new TextEncoder().encode(previousRaw));
  if (storage.getItem(packedFallbackKey(name)) !== previousRaw) throw new VaultConflictError();
  storage.setItem(packedRetiredKey(name), JSON.stringify({
    version: 2,
    rawSha256,
    committedFingerprint: snapshotFingerprint(committedValue),
    committedUserId,
  } satisfies RetiredPackedReceipt));
  if (storage.getItem(packedFallbackKey(name)) !== previousRaw) throw new VaultConflictError();
}

/** All asynchronous work precedes a fresh comparison of both fallback records.
 * The final set is one self-contained value, so a failed write keeps the old one. */
async function writePackedFallback(
  storage: Storage | null, name: string, value: string, userId: string,
  baseFingerprint: string | null | undefined, previous: PackedFallbackCopy | null,
  previousRetiredRaw: string | null = null,
): Promise<void> {
  if (!storage || !observesWorkspace(name)) throw new PackedFallbackError("A compressed workspace fallback is unavailable.");
  assertNoPendingVaultRemoval(storage, name);
  const previousRaw = previous?.raw ?? previousRetiredRaw;
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
  const packedDeletionGeneration = base === null
    ? (previous ? previous.deletionGeneration ?? null : observedDeletionGenerations.get(name) ?? null)
    : undefined;
  const encoded = await packVaultFallback(value, {
    name, userId, valueFingerprint: snapshotFingerprint(value), baseFingerprint: base,
    deletionGeneration: packedDeletionGeneration, legacy,
  });
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
  if (local[removalIntentKey(name)] !== undefined) throw new VaultConflictError();
  const storage = { getItem: (key: string) => local[key] ?? null };
  const packed = await readPackedFallback(storage, name);
  if (packed) {
    assertPackedLegacyCurrent(storage, packed);
    let vault = indexedDb ? resolveVaultSnapshotRecord(indexedDb, name) : undefined;
    if (!vault && indexedDb?.[activeUserKey(name)]) {
      vault = resolveVaultSnapshotRecord(indexedDb, scopedStateKey(name, indexedDb[activeUserKey(name)]));
    }
    const retired = await retiredPackedReceipt(storage, name, packed);
    if (retired) {
      if (!verifiedRetiredPackedValue(retired, vault)) throw new VaultConflictError();
      return vault;
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
): Promise<void> {
  const plan = storedValuePlan(name, value, userId);
  // A chunk manifest is only safe after the physical v4 upgrade succeeds.
  // Otherwise an already-open v3 writer could replace the manifest with a
  // legacy single value while leaving its chunks behind. Small legacy values
  // can continue using the long-lived state store while an upgrade is blocked.
  const db = await (plan.manifest ? openUpgradedVault() : openVault());
  if (plan.manifest && db.version < DB_VERSION) {
    db.close();
    throw new Error("The local vault must finish its storage upgrade before saving this large workspace.");
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let conflict: VaultConflictError | null = null;
    let chunkWriteFailure: Error | null = null;
    let settled = false;
    // Request before the primary read so its result is available when the
    // primary CAS runs, in this very same readwrite transaction.
    const deletionGenerationRead = expected?.fingerprints.includes(null)
      ? store.get(deletionGenerationKey(name)) : undefined;

    const write = (current: string | undefined, previous: readonly (string | undefined)[]) => {
      // A missing record can also mean another tab intentionally deleted the
      // hydrated workspace. Only an expectation that explicitly includes null
      // may initialize an empty vault; accepting every missing record would
      // let a stale tab resurrect deleted learner data. Keep this comparison
      // inside the same readwrite transaction as the actual write.
      const currentFingerprint = workspaceFingerprint(current);
      const storedDeletionGeneration = deletionGenerationRead?.result;
      const invalidDeletionGeneration = deletionGenerationRead !== undefined
        && storedDeletionGeneration !== undefined && (
          typeof storedDeletionGeneration !== "string" || storedDeletionGeneration.length === 0
        );
      // A tab that observed an empty vault before another tab created and
      // deleted a workspace must not treat the final null as the same revision.
      // The tombstone is compared atomically with the primary write.
      const staleEmptyGeneration = currentFingerprint === null
        && deletionGenerationRead !== undefined
        && (invalidDeletionGeneration
          || (storedDeletionGeneration ?? null) !== (expected?.deletionGeneration ?? null));
      if (
        expected
        && (!expected.fingerprints.includes(currentFingerprint) || staleEmptyGeneration)
      ) {
        conflict = new VaultConflictError();
        if (expected.latchConflict !== false && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        tx.abort();
        return;
      }
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
              chunkWriteFailure = error instanceof Error ? error : new Error(String(error));
              tx.abort();
            }
          };
        });
      }
      store.put(plan.storedValue, name);
      if (userId) {
        store.put(userId, activeUserKey(name));
        store.put(plan.storedValue, scopedStateKey(name, userId));
      }
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
      db.close();
      if (!settled) resolve();
      settled = true;
    };
    tx.onerror = () => {
      if (conflict || settled) return;
      db.close();
      reject(chunkWriteFailure ?? tx.error ?? new Error("Local vault transaction failed"));
      settled = true;
    };
    tx.onabort = () => {
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

/** Verify *both* workspace locations absent and read the deletion generation
 * in one transaction. Do not certify an empty hydration by a later epoch-only
 * read: another tab could have created and deleted data between those reads. */
async function readVerifiedEmptyDeletionGeneration(name: string): Promise<string | null> {
  const db = await openExistingVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const primary = store.get(name);
    const active = store.get(activeUserKey(name));
    const generation = store.get(deletionGenerationKey(name));
    let scoped: IDBRequest | null = null;
    active.onsuccess = () => {
      if (typeof active.result === "string" && active.result) {
        scoped = store.get(scopedStateKey(name, active.result));
      }
    };
    tx.oncomplete = () => {
      db.close();
      if (primary.result !== undefined
        || (scoped !== null && scoped.result !== undefined)
        || (generation.result !== undefined
          && (typeof generation.result !== "string" || generation.result.length === 0))) {
        reject(new VaultConflictError());
        return;
      }
      resolve(typeof generation.result === "string" ? generation.result : null);
    };
    tx.onerror = () => { db.close(); reject(tx.error ?? new VaultConflictError()); };
    tx.onabort = tx.onerror;
  });
}

async function readVaultSnapshot(name: string): Promise<string | null> {
  const primary = await readVaultRecord(name, openExistingVault);
  if (primary) return primary;
  const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
  if (!activeUser) return null;
  return await readVaultRecord(scopedStateKey(name, activeUser), openExistingVault) ?? null;
}

async function removeVaultRecords(name: string, active?: string): Promise<string | null> {
  // The UUID never grants account permission; it only makes deletion history
  // distinguishable even after the primary returns to null.
  const deletionGeneration = observesWorkspace(name) ? globalThis.crypto.randomUUID() : null;
  const db = await openExistingVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
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
    if (deletionGeneration !== null) store.put(deletionGeneration, deletionGenerationKey(name));
    tx.oncomplete = () => { db.close(); resolve(deletionGeneration); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Unable to remove the local workspace.")); };
    tx.onabort = tx.onerror;
  });
}

// A localStorage fallback has three independently written keys (payload,
// marker, account-scoped mirror). No amount of read-before-remove can make
// deleting them atomic with another tab's acknowledgment. Retire the *known*
// marker without deleting any bytes. A newer marker never matches this receipt.
interface RetiredFallbackReceipt {
  version: 1;
  marker: string;
  valueFingerprint: string;
  fallbackUserId: string;
  committedFingerprint: string;
  committedUserId: string;
}
function retiredFallbackReceipt(
  fallbackStore: Pick<Storage, "getItem"> | null, name: string, copy: NewerFallbackCopy,
): RetiredFallbackReceipt | null {
  // Only a genuinely absent receipt permits unretired fallback promotion.
  // A storage read failure or malformed receipt is ambiguous: choosing the
  // older marked copy could undo an explicit restore in another tab.
  let raw: string | null | undefined;
  try { raw = fallbackStore?.getItem(`${name}:fallback-retired`); }
  catch { throw new VaultConflictError(); }
  if (raw == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new VaultConflictError(); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VaultConflictError();
  }
  const receipt = parsed as Partial<RetiredFallbackReceipt>;
  if (
    receipt.version !== 1
    || typeof receipt.marker !== "string"
    || typeof receipt.valueFingerprint !== "string"
    || typeof receipt.fallbackUserId !== "string"
    || typeof receipt.committedFingerprint !== "string"
    || typeof receipt.committedUserId !== "string"
  ) throw new VaultConflictError();
  // A fully valid receipt for an earlier marker does not retire a new,
  // separately acknowledged fallback. A malformed same-marker binding must
  // never be treated as proof that no retirement occurred.
  if (receipt.marker !== copy.marker) return null;
  if (
    receipt.valueFingerprint !== copy.fingerprint
    || receipt.fallbackUserId !== persistedUserId(copy.value)
  ) throw new VaultConflictError();
  return receipt as RetiredFallbackReceipt;
}

function retireFallbackCopyIfUnchanged(
  fallbackStore: Storage | null,
  name: string,
  copy: NewerFallbackCopy,
  currentUserId: string,
  committedValue: string,
): void {
  if (
    !fallbackStore
    || fallbackStore.getItem(fallbackMarkerKey(name)) !== copy.marker
    || fallbackStore.getItem(name) !== copy.value
  ) throw new VaultConflictError();
  // The one-key receipt is an optimization for selecting the known committed
  // vault on reload. A failed receipt write is a visible save failure, not
  // permission to delete backup material or silently choose one copy.
  fallbackStore.setItem(`${name}:fallback-retired`, JSON.stringify({
    version: 1,
    marker: copy.marker,
    valueFingerprint: copy.fingerprint,
    fallbackUserId: persistedUserId(copy.value),
    committedFingerprint: snapshotFingerprint(committedValue),
    committedUserId: currentUserId,
  } satisfies RetiredFallbackReceipt));
  if (
    fallbackStore.getItem(fallbackMarkerKey(name)) !== copy.marker
    || fallbackStore.getItem(name) !== copy.value
  ) throw new VaultConflictError();
}

const vaultStorage: StateStorage = {
  async getItem(name) {
    // A save that could not reach IndexedDB leaves its snapshot here, ahead of
    // the vault. Reading the vault first used to hand back the older copy, and
    // the next successful save then deleted the newer one.
    const fallbackStore = localFallback(name);
    let packed: PackedFallbackCopy | null;
    try {
      packed = await readPackedFallback(fallbackStore, name);
    } catch (error) {
      if (isVaultConflictError(error) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
      throw error;
    }
    if (packed) {
      assertPackedLegacyCurrent(fallbackStore, packed);
      let retired: RetiredPackedReceipt | null;
      try { retired = await retiredPackedReceipt(fallbackStore, name, packed); }
      catch (error) {
        if (isVaultConflictError(error) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        throw error;
      }
      if (retired) {
        let current: string | null = null;
        try { current = await readVaultSnapshot(name); } catch { /* preserve both copies */ }
        if (!verifiedRetiredPackedValue(retired, current)
          || fallbackStore?.getItem(packedFallbackKey(name)) !== packed.raw) {
          if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
          throw new VaultConflictError();
        }
        assertPackedLegacyCurrent(fallbackStore, packed);
        rememberVaultSnapshot(name, current);
        return current;
      }
      // The pre-promotion plain marker is part of the captured packed chain.
      // A separately acknowledged marker arriving later must not be retired
      // as if it were the old, already-committed recovery copy.
      const plainBeforePromotion = newerFallbackCopy(fallbackStore, name);
      try {
        await writeVault(name, packed.value, packed.userId, packedExpectation(packed));
        assertPackedLegacyCurrent(fallbackStore, packed);
        await retirePackedFallback(fallbackStore, name, packed.raw, packed.userId, packed.value);
        // Packed retirement is a single localStorage receipt write, but a peer may
        // acknowledge a *plain* fallback during that call. Recheck the full
        // plain/scoped binding and never delete any of its independent keys.
        assertPackedLegacyCurrent(fallbackStore, packed);
        if (plainBeforePromotion) {
          // An existing, unchanged plain fallback may be retired by one
          // revision-bound receipt. A new peer marker cannot match this
          // receipt and is never erased or silently accepted.
          retireFallbackCopyIfUnchanged(fallbackStore, name, plainBeforePromotion, packed.userId, packed.value);
        }
      } catch (error) {
        // Keep both competing records. Choosing either would conceal work from
        // a newer/older tab that cannot understand the other's storage format.
        if (isVaultConflictError(error)) {
          conflictedWorkspaceKeys.add(name);
          throw error;
        }
        // A failed promotion can await IndexedDB after successful decoding.
        // Recheck the raw atomic packed key and plain binding before allowing
        // the captured bytes to hydrate the UI. A peer's newer copy survives.
        if (fallbackStore?.getItem(packedFallbackKey(name)) !== packed.raw) {
          if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
          throw new VaultConflictError();
        }
        try {
          assertPackedLegacyCurrent(fallbackStore, packed);
        } catch (bindingError) {
          if (isVaultConflictError(bindingError) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
          throw bindingError;
        }
        // A verified packed copy remains durable while IDB is unavailable/full.
      }
      rememberVaultSnapshot(name, packed.value);
      return packed.value;
    }
    const newer = newerFallbackCopy(fallbackStore, name);
    if (newer !== null) {
      let retired: RetiredFallbackReceipt | null;
      try { retired = retiredFallbackReceipt(fallbackStore, name, newer); }
      catch (error) {
        if (isVaultConflictError(error) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        throw error;
      }
      if (retired) {
        // A previous successful write committed newer bytes to IndexedDB and
        // retired this exact earlier marker. Never remove the old recovery
        // bytes, and never ignore a different marker from a competing tab.
        let current: string | null = null;
        try { current = await readVaultSnapshot(name); } catch { /* fail closed */ }
        if (
          current !== null
          && snapshotFingerprint(current) === retired.committedFingerprint
          && persistedUserId(current) === retired.committedUserId
          && fallbackStore?.getItem(fallbackMarkerKey(name)) === newer.marker
          && fallbackStore.getItem(name) === newer.value
        ) {
          rememberVaultSnapshot(name, current);
          return current;
        }
        if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        throw new VaultConflictError();
      }
      const userId = persistedUserId(newer.value);
      let promoted = false;
      try {
        // The marker records the IndexedDB snapshot on which this fallback was
        // based. Comparing that base and the fallback itself in one transaction
        // prevents a late promotion from replacing a newer tab's commit.
        await writeVault(name, newer.value, userId, fallbackExpectation(newer, false));
        promoted = true;
        if (observesWorkspace(name)) {
          // A second tab may have acknowledged a newer fallback while this
          // IndexedDB transaction was pending. There is no atomic compare-
          // and-delete across localStorage keys, so a read must NEVER retire
          // an acknowledged workspace copy. The next verified save may do so.
          if (
            fallbackStore?.getItem(fallbackMarkerKey(name)) !== newer.marker
            || fallbackStore?.getItem(name) !== newer.value
          ) throw new VaultConflictError();
        } else {
          retireFallbackCopyIfUnchanged(fallbackStore, name, newer, userId, newer.value);
        }
      } catch (promotionError) {
        if (promoted && observesWorkspace(name)) {
          // The vault now holds the captured bytes, but a later fallback or an
          // unreadable marker may contain independent edits. Keep both copies.
          conflictedWorkspaceKeys.add(name);
          throw isVaultConflictError(promotionError) ? promotionError : new VaultConflictError();
        }
        if (isVaultConflictError(promotionError)) {
          try {
            const current = await readVaultSnapshot(name);
            if (current !== null) {
              // Both copies may contain edits that the other never received.
              // Never erase the marked fallback or silently select the vault
              // when a different tab committed a byte-distinct workspace.
              if (current !== newer.value) {
                // A peer that explicitly retired the marker already resolved
                // this fallback; its unmarked mirror cannot supersede IDB.
                if (fallbackStore?.getItem(fallbackMarkerKey(name)) === null) {
                  rememberVaultSnapshot(name, current);
                  return current;
                }
                if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
                throw promotionError;
              }
              // An equal vault record is not proof that a second tab has not
              // acknowledged a different fallback during the winner readback.
              if (observesWorkspace(name) && (
                fallbackStore?.getItem(fallbackMarkerKey(name)) !== newer.marker
                || fallbackStore?.getItem(name) !== newer.value
              )) {
                conflictedWorkspaceKeys.add(name);
                throw promotionError;
              }
              // Idempotent promotion is safe: the vault already holds these
              // exact bytes. Legacy bare markers also use this equality path.
              if (newer.baseFingerprint !== undefined && !observesWorkspace(name)) {
                retireFallbackCopyIfUnchanged(fallbackStore, name, newer, persistedUserId(current), current);
              }
              rememberVaultSnapshot(name, current);
              return current;
            }
          } catch (readError) {
            if (isVaultConflictError(readError)) throw readError;
            // Once IndexedDB rejected the promotion for a competing revision,
            // a failed winner readback cannot prove that the fallback is safe.
            // Preserve both copies and require explicit reconciliation.
          }
          if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
          throw promotionError;
        }
        // Still not writable: the copy stays in localStorage for the next start.
      }
      rememberVaultSnapshot(name, newer.value);
      return newer.value;
    }

    // An unmarked legacy localStorage mirror is not proof that IndexedDB is
    // empty. A transient read failure must never become a write authorization.
    let verifiedVaultEmpty = false;
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
      // Both the primary and the active-profile snapshot were read successfully
      // and neither exists. Only this state may migrate an unmarked legacy copy.
      verifiedVaultEmpty = true;
    } catch {
      // An inaccessible vault may still hold newer bytes. Keep any old mirror
      // readable below, but do not promote it until an empty vault is verified.
    }

    const fallback = fallbackStore?.getItem(name) ??
      fallbackStore?.getItem(scopedStateKey(name, fallbackStore?.getItem(activeUserKey(name)) ?? "")) ??
      null;
    if (fallback && !verifiedVaultEmpty) {
      // A transient read error may clear immediately. Prefer the authoritative
      // live vault over an unmarked, potentially stale mirror if it recovers.
      // If it stays unavailable, return the mirror without writing it to IDB.
      try {
        const recovered = await readVaultSnapshot(name);
        if (recovered !== null) {
          rememberVaultSnapshot(name, recovered);
          return recovered;
        }
      } catch { /* Keep the legacy copy for a future verified recovery. */ }
    }
    if (fallback && verifiedVaultEmpty) {
      try {
        // The validation above happens before this transaction. A concurrent
        // tab may save in between, so compare against an EMPTY vault atomically.
        await writeVault(name, fallback, persistedUserId(fallback), {
          fingerprints: [null],
          latchConflict: false,
        });
      } catch (promotionError) {
        if (isVaultConflictError(promotionError)) {
          try {
            const current = await readVaultSnapshot(name);
            if (current !== null) {
              rememberVaultSnapshot(name, current);
              return current;
            }
          } catch {
            // A rejected CAS proves another transaction won. If that winner
            // cannot be read back, returning the old unmarked mirror would
            // falsely hydrate it as authoritative. Keep both copies and stop
            // subsequent writes until the conflict can be reconciled.
          }
          if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
          throw promotionError;
        }
        // Ordinary unavailable/quota failures do not prove a competing
        // revision; keep the mirror readable but do not call it a saved vault.
      }
    }
    rememberVaultSnapshot(name, fallback);
    return fallback;
  },

  async setItem(name, value) {
    const writeSequence = ++vaultWriteSequence;
    const userId = persistedUserId(value);
    let fallbackStore: Storage | null = null;
    let fallbackBaseFingerprint: string | null | undefined;
    let currentPacked: PackedFallbackCopy | null = null;
    let previousRetiredRaw: string | null = null;
    try {
      fallbackStore = localFallback(name);
      assertNoPendingVaultRemoval(fallbackStore, name);
      const expected = workspaceExpectation(name);
      currentPacked = await readPackedFallback(fallbackStore, name);
      if (currentPacked) {
        assertPackedLegacyCurrent(fallbackStore, currentPacked);
        const retired = await retiredPackedReceipt(fallbackStore, name, currentPacked);
        if (retired) {
          // A confirmed older packed copy is not a new local edit. New writes
          // compare against the current committed IDB, never the retired bytes.
          let current: string | null = null;
          try { current = await readVaultSnapshot(name); } catch { /* conflict below */ }
          if (!verifiedRetiredPackedValue(retired, current)
            || fallbackStore?.getItem(packedFallbackKey(name)) !== currentPacked.raw) throw new VaultConflictError();
          assertPackedLegacyCurrent(fallbackStore, currentPacked);
          previousRetiredRaw = currentPacked.raw;
          currentPacked = null;
        } else {
          if (currentPacked.userId !== userId) throw new PackedFallbackError("The compressed workspace belongs to a different local profile. Keep both copies and export saved work.");
          if (!expected?.fingerprints.includes(currentPacked.valueFingerprint)) throw new VaultConflictError();
        }
      }
      const currentFallback = newerFallbackCopy(fallbackStore, name);
      const retiredAtStart = currentFallback && retiredFallbackReceipt(fallbackStore, name, currentFallback);
      const activeFallback = retiredAtStart && expected?.fingerprints.includes(retiredAtStart.committedFingerprint)
        ? null : currentFallback;
      if (!currentPacked) assertFallbackStillCurrent(name, activeFallback, expected);
      fallbackBaseFingerprint = currentPacked !== null ? currentPacked.baseFingerprint : activeFallback !== null
        ? activeFallback.baseFingerprint
        : observedVaultFingerprint(name);
      if (currentPacked === null && activeFallback === null && fallbackBaseFingerprint === undefined) {
        try {
          fallbackBaseFingerprint = workspaceFingerprint(await readVaultSnapshot(name));
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
      const vaultExpectation = currentPacked !== null ? packedExpectation(currentPacked) : activeFallback !== null
        ? fallbackExpectation(activeFallback)
        : expected;
      await writeVault(name, value, userId, vaultExpectation);
      assertNoPendingVaultRemoval(fallbackStore, name);
      if (currentPacked) assertPackedLegacyCurrent(fallbackStore, currentPacked);
      await retirePackedFallback(fallbackStore, name, currentPacked?.raw ?? previousRetiredRaw, userId, value);
      if (observesWorkspace(name)) {
        const latestFallback = newerFallbackCopy(fallbackStore, name);
        // A different tab can acknowledge its own offline copy while the
        // IndexedDB transaction is in flight. A successful vault commit must
        // never clear that subsequently written recovery copy or claim that
        // the two independent edits were reconciled.
        if (
          currentFallback?.marker !== latestFallback?.marker
          || currentFallback?.value !== latestFallback?.value
        ) throw new VaultConflictError();
        if (currentFallback) {
          retireFallbackCopyIfUnchanged(fallbackStore, name, currentFallback, userId, value);
        } else if (userId && !currentPacked && previousRetiredRaw === null) {
          // A retained packed receipt binds the original legacy active-user
          // pointer. Changing it would make a valid receipt unrecoverable on
          // the next tab start; the committed IDB already records this user.
          // Unmarked mirrors are not deleted across tabs.
          try { fallbackStore?.setItem(activeUserKey(name), userId); } catch { /* IDB is durable. */ }
        }
      } else {
        clearFallbackCopy(fallbackStore, name, userId);
      }
      rememberVaultSnapshot(name, value);
      markVaultWrite("indexeddb");
    } catch (indexedDbError) {
      if (isVaultConflictError(indexedDbError) || isPackedFallbackError(indexedDbError)) {
        if (isVaultConflictError(indexedDbError) && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        vaultWriteFailures.set(writeSequence, indexedDbError);
        markVaultWriteFailure(new Date(), indexedDbError);
        return;
      }
      if (currentPacked) {
        try {
          await writePackedFallback(fallbackStore, name, value, userId, fallbackBaseFingerprint, currentPacked, previousRetiredRaw);
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
      let fallbackBeforeRetry: NewerFallbackCopy | null;
      let retiredBeforeRetry: RetiredFallbackReceipt | null;
      try {
        fallbackBeforeRetry = newerFallbackCopy(fallbackStore, name);
        retiredBeforeRetry = fallbackBeforeRetry && retiredFallbackReceipt(fallbackStore, name, fallbackBeforeRetry);
      } catch (recoveryReadError) {
        // A peer may update the receipt while the IndexedDB write is pending.
        // A failed/malformed retry read is a rejected save, not a swallowed
        // exception from the background write drain or permission to overwrite
        // an independently acknowledged recovery copy.
        const conflict = isVaultConflictError(recoveryReadError)
          ? recoveryReadError : new VaultConflictError();
        if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        vaultWriteFailures.set(writeSequence, conflict);
        markVaultWriteFailure(new Date(), conflict);
        return;
      }
      const retryExpected = workspaceExpectation(name);
      const previousFallback = retiredBeforeRetry && retryExpected?.fingerprints.includes(retiredBeforeRetry.committedFingerprint)
        ? null : fallbackBeforeRetry;
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
        assertNoPendingVaultRemoval(fallbackStore, name);
        fallbackStore?.setItem(
          fallbackMarkerKey(name),
          encodeFallbackMarker(snapshotFingerprint(value), baseFingerprint,
            previousFallback ? previousFallback.deletionGeneration : observedDeletionGenerations.get(name) ?? null),
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
            await writePackedFallback(fallbackStore, name, value, userId, fallbackBaseFingerprint, null, previousRetiredRaw);
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
    }
  },

  async removeItem(name) {
    const writeSequence = ++vaultWriteSequence;
    try {
      const fallback = localFallback(name);
      let active = fallback?.getItem(activeUserKey(name)) ?? undefined;
      if (!active) {
        try {
          active = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), openExistingVault);
        } catch {
          // The fallback may be the only readable account pointer.
        }
      }
      let deletionIntent: string | null = null;
      let recoveryBefore: readonly (string | null)[] | null = null;
      if (observesWorkspace(name)) {
        // A failed IDB readwrite transaction must not strand an older X after
        // erasing a newer acknowledged local fallback Y. Reserve the removal
        // durably first, then delete IDB atomically, THEN clean localStorage.
        // If either phase fails the receipt survives a cold reload and blocks
        // stale hydration or a blind competing write.
        if (!fallback) throw new VaultConflictError();
        assertNoPendingVaultRemoval(fallback, name);
        recoveryBefore = [
          fallback.getItem(name),
          fallback.getItem(fallbackMarkerKey(name)),
          fallback.getItem(packedFallbackKey(name)),
          fallback.getItem(activeUserKey(name)),
          active ? fallback.getItem(scopedStateKey(name, active)) : null,
        ];
        deletionIntent = JSON.stringify({
          version: 1,
          activeUser: active ?? null,
          primaryFingerprint: workspaceFingerprint(recoveryBefore[0]),
        });
        fallback.setItem(removalIntentKey(name), deletionIntent);
        if (fallback.getItem(removalIntentKey(name)) !== deletionIntent) throw new VaultConflictError();
      }
      const completedDeletionGeneration = await removeVaultRecords(name, active);
      if (recoveryBefore && fallback) {
        if (fallback.getItem(removalIntentKey(name)) !== deletionIntent
          || fallback.getItem(name) !== recoveryBefore[0]
          || fallback.getItem(fallbackMarkerKey(name)) !== recoveryBefore[1]
          || fallback.getItem(packedFallbackKey(name)) !== recoveryBefore[2]
          || fallback.getItem(activeUserKey(name)) !== recoveryBefore[3]
          || (active && fallback.getItem(scopedStateKey(name, active)) !== recoveryBefore[4])) {
          throw new VaultConflictError();
        }
      }
      fallback?.removeItem(name);
      fallback?.removeItem(fallbackMarkerKey(name));
      if (observesWorkspace(name)) {
        fallback?.removeItem(packedFallbackKey(name));
        fallback?.removeItem(packedRetiredKey(name));
      }
      fallback?.removeItem(activeUserKey(name));
      if (active) fallback?.removeItem(scopedStateKey(name, active));
      // Removal is complete only when all prior cleanup succeeded and this
      // specific receipt still owns the operation. Clear it strictly last.
      if (deletionIntent !== null) {
        if (fallback?.getItem(removalIntentKey(name)) !== deletionIntent) throw new VaultConflictError();
        fallback.removeItem(removalIntentKey(name));
      }
      conflictedWorkspaceKeys.delete(name);
      rememberVaultSnapshot(name, null);
      if (completedDeletionGeneration !== null) observedDeletionGenerations.set(name, completedDeletionGeneration);
    } catch (error) {
      // A partial localStorage cleanup is not proof that the IndexedDB or
      // recovery copy was fully deleted. The next write must rehydrate and
      // reconcile this account instead of reporting a successful removal.
      const failure = isVaultConflictError(error) ? error
        : observesWorkspace(name) ? new VaultConflictError()
          : error instanceof Error ? error : new Error("AXOM could not remove local vault data.");
      if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
      vaultWriteFailures.set(writeSequence, failure);
      markVaultWriteFailure(new Date(), failure);
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
  try {
    const fallback = localFallback(name);
    // An explicitly authorized backup replacement may reconcile an aborted
    // removal; ordinary reads and writes must continue to refuse its receipt.
    const removalIntentAtStart = observesWorkspace(name) ? fallback?.getItem(removalIntentKey(name)) ?? null : null;
    const previousPacked = observesWorkspace(name) ? fallback?.getItem(packedFallbackKey(name)) ?? null : null;
    const previousPlain = observesWorkspace(name) ? newerFallbackCopy(fallback, name) : null;
    const previousMarker = observesWorkspace(name) ? fallback?.getItem(fallbackMarkerKey(name)) ?? null : null;
    const previousPlainValue = observesWorkspace(name) ? fallback?.getItem(name) ?? null : null;
    // An interrupted removal can leave the marker behind after deleting the
    // primary plain fallback. An explicit verified restore must be able to
    // reconcile that exact orphan without treating arbitrary marker bytes as
    // recovery authorization or deleting the account-scoped recovery copy.
    let orphanedMarkerEvidence: { activeUser: string; scopedValue: string } | null = null;
    if (previousMarker !== null && previousPlain === null && observesWorkspace(name)) {
      let receipt: unknown = null;
      try { receipt = removalIntentAtStart === null ? null : JSON.parse(removalIntentAtStart); }
      catch { /* Invalid removal receipts do not authorize reconciliation. */ }
      if (receipt !== null && typeof receipt === "object" && !Array.isArray(receipt)) {
        const intent = receipt as { version?: unknown; activeUser?: unknown; primaryFingerprint?: unknown };
        if (
          intent.version === 1
          && typeof intent.activeUser === "string"
          && intent.activeUser.length > 0
          && intent.activeUser === userId
          && typeof intent.primaryFingerprint === "string"
          && fallback?.getItem(activeUserKey(name)) === intent.activeUser
        ) {
          const scopedValue = fallback?.getItem(scopedStateKey(name, intent.activeUser)) ?? null;
          if (
            scopedValue !== null
            && snapshotFingerprint(scopedValue) === intent.primaryFingerprint
            && persistedUserId(scopedValue) === intent.activeUser
          ) {
            // Validate the orphan against the retained scoped bytes using the
            // same marker decoder as ordinary recovery, without writing keys.
            const copy = newerFallbackCopy({
              getItem: key => key === name ? scopedValue
                : key === fallbackMarkerKey(name) ? previousMarker : null,
            }, name);
            if (copy?.value === scopedValue && copy.marker === previousMarker) {
              orphanedMarkerEvidence = { activeUser: intent.activeUser, scopedValue };
            }
          }
        }
      }
      if (orphanedMarkerEvidence === null) throw new VaultConflictError();
    }
    await writeVault(name, value, userId);
    // Explicit verified restore already authorizes replacing the live workspace;
    // retire only the fallback captured before that write. A concurrent save
    // remains available and makes this replacement fail explicitly.
    await retirePackedFallback(fallback, name, previousPacked, userId, value);
    if (observesWorkspace(name)) {
      // A peer can acknowledge a new marked fallback while writeVault is
      // pending. Never retire a different marker, value or malformed record
      // merely because this explicit restore reached IndexedDB.
      const markerNow = fallback?.getItem(fallbackMarkerKey(name)) ?? null;
      const valueNow = fallback?.getItem(name) ?? null;
      if (markerNow !== previousMarker || valueNow !== previousPlainValue) {
        throw new VaultConflictError();
      }
      if (markerNow !== null) {
        if (previousPlain) {
          if (previousPlain.marker !== markerNow || previousPlain.value !== valueNow) {
            throw new VaultConflictError();
          }
          // A fully intact, captured fallback can be revision-bound as retired.
          retireFallbackCopyIfUnchanged(fallback, name, previousPlain, userId, value);
        } else {
          // The unchanged orphan marker is not sufficient on its own. Recheck
          // the matching account-scoped payload after the asynchronous IDB
          // write, then leave both original recovery keys untouched.
          if (
            !orphanedMarkerEvidence
            || fallback?.getItem(scopedStateKey(name, orphanedMarkerEvidence.activeUser))
              !== orphanedMarkerEvidence.scopedValue
            || fallback?.getItem(activeUserKey(name)) !== orphanedMarkerEvidence.activeUser
          ) throw new VaultConflictError();
          // One atomic retirement receipt makes a later immutable backup
          // distinguish this captured orphan from an arbitrary corrupt marker.
          // Retain the marker and original account-scoped bytes for recovery;
          // deleting the marker across tabs would be an unsafe compare/remove.
          fallback?.setItem(`${name}:fallback-retired`, JSON.stringify({
            version: 1,
            marker: markerNow,
            valueFingerprint: snapshotFingerprint(orphanedMarkerEvidence.scopedValue),
            fallbackUserId: orphanedMarkerEvidence.activeUser,
            committedFingerprint: snapshotFingerprint(value),
            committedUserId: userId,
          } satisfies RetiredFallbackReceipt));
          if (
            fallback?.getItem(fallbackMarkerKey(name)) !== markerNow
            || fallback?.getItem(name) !== null
            || fallback?.getItem(scopedStateKey(name, orphanedMarkerEvidence.activeUser))
              !== orphanedMarkerEvidence.scopedValue
          ) throw new VaultConflictError();
        }
      } else if (userId && previousPacked === null) {
        // The retained packed receipt keeps its captured legacy user binding.
        // IndexedDB already holds the restored user's authoritative pointer.
        try { fallback?.setItem(activeUserKey(name), userId); } catch { /* IndexedDB is durable. */ }
      }
    } else {
      clearFallbackCopy(fallback, name, userId);
    }
    if (observesWorkspace(name)) {
      if (fallback?.getItem(removalIntentKey(name)) !== removalIntentAtStart) throw new VaultConflictError();
      if (removalIntentAtStart !== null) fallback?.removeItem(removalIntentKey(name));
    }
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
  getItem: async (name) => {
    // Check before the asynchronous read and again before returning to the
    // hydrated application; another tab may begin a removal during that read.
    assertNoPendingVaultRemoval(localFallback(name), name);
    const value = await vaultStorage.getItem(name);
    assertNoPendingVaultRemoval(localFallback(name), name);
    if (observesWorkspace(name) && value === null) {
      try {
        // A successful empty read is a new baseline only when the *same*
        // transaction also confirms its deletion lineage.
        const generation = await readVerifiedEmptyDeletionGeneration(name);
        assertNoPendingVaultRemoval(localFallback(name), name);
        if (!conflictedWorkspaceKeys.has(name)) observedDeletionGenerations.set(name, generation);
      } catch {
        // A previous chunk read may have failed while the primary manifest
        // remains present. The recovery UI needs a null result so that an
        // explicitly authorized verified-backup replacement can repair it.
        // This is NOT a verified empty read and never grants ordinary writes.
        conflictedWorkspaceKeys.add(name);
        return null;
      }
    }
    return value;
  },
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
