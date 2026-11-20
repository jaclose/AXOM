import type { StateStorage } from "zustand/middleware";
import { userIdFromName } from "./userIdentity";
import { STORAGE_KEYS } from "./brand";
import { captureVaultWriteObservation, invalidateVaultWrite, invalidateVaultWriteIfUnchanged, markVaultWrite, markVaultWriteFailure } from "./vaultActivity";

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

/** Invalid physical chunk metadata is not an ordinary unavailable-IDB event:
 * a pre-existing, unmarked localStorage mirror is not safe hydration input. */
class InvalidVaultManifestError extends Error {
  constructor(message = "The local vault workspace has an invalid chunk manifest.") {
    super(message);
    this.name = "InvalidVaultManifestError";
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
  if (!(error instanceof Error)) return "unknown error";
  const detail = error.message.replace(/\s+/g, " ").trim();
  return (detail || error.name).slice(0, 180);
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

/** A malformed physical chunk manifest must never become an ordinary
 * hydrated workspace or an unverified logical export. Retain its bytes for
 * manual recovery; this classifier never repairs or deletes storage.
 *
 * Ordinary learner JSON may legitimately mention the format token within
 * notes/questions. Only a root object declaring the manifest format counts.
 */
function isMalformedChunkedValueManifest(value: string): boolean {
  if (!value.includes(CHUNKED_VALUE_FORMAT)) return false;
  // Generated manifests begin with "format". Avoid parsing multi-megabyte
  // learner workspaces merely to classify a malformed physical record.
  const canonicalPrefix = /^\s*\{\s*"format"\s*:\s*"axom-local-vault-chunks"/;
  if (value.length > 8192) return canonicalPrefix.test(value);
  try {
    const parsed = JSON.parse(value) as { format?: unknown } | null;
    return parsed !== null && typeof parsed === "object"
      && !Array.isArray(parsed) && parsed.format === CHUNKED_VALUE_FORMAT;
  } catch {
    // A truncated canonical manifest is still physical recovery material.
    return canonicalPrefix.test(value);
  }
}

function chunkPrefix(name: string, userId: string): string {
  // Physical chunk keys MUST be injective over stable profile identities.
  // The previous 32-bit fingerprint can collide for different user IDs,
  // causing later saves to overwrite another owner's retained scoped chunks.
  // Every UTF-16 code unit becomes exactly four hex digits; distinct IDs
  // and the explicit no-ID namespace cannot alias. Existing v1 manifests
  // keep their recorded legacy prefix and remain readable without migration.
  const ownerKey = userId
    ? "id:" + Array.from({ length: userId.length }, (_, index) =>
      userId.charCodeAt(index).toString(16).padStart(4, "0")).join("")
    : "no-id";
  return `${name}:chunks:owner-v2:${ownerKey}`;
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
  const storedValue = JSON.stringify(manifest);
  // Recovery readers cap manifest JSON at 4096 characters. A malformed or
  // excessively long legacy profile ID must fail before the IDB transaction
  // rather than record a manifest that future reads cannot reconstruct.
  if (storedValue.length > 4096) {
    throw new Error("The profile identity is too long for a chunked local workspace.");
  }
  return { storedValue, manifest, chunks };
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
  if (!manifest) {
    if (isMalformedChunkedValueManifest(stored)) {
      throw new InvalidVaultManifestError();
    }
    return stored;
  }
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

/** Legacy name slugs are storage locators, not immutable owner identities:
 * two different names can normalize to the same slug. */
function stablePersistedUserId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { state?: { profile?: { userId?: unknown } } };
    const id = parsed.state?.profile?.userId;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/** Preserve an acknowledged fallback across account changes, including
 * legacy snapshots whose owner cannot be established by a stable user ID.
 * Exact-byte retries are harmless; changed unkeyed bytes require recovery. */
function assertFallbackOwnerUnchanged(name: string, current: NewerFallbackCopy | null, incomingValue: string): void {
  if (!observesWorkspace(name) || current === null) return;
  if (current.value === incomingValue) return;
  const previousId = stablePersistedUserId(current.value);
  const nextId = stablePersistedUserId(incomingValue);
  if (previousId !== null && previousId === nextId) return;
  conflictedWorkspaceKeys.add(name);
  throw new VaultConflictError();
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
function newerFallbackCopy(fallbackStore: Storage | null, name: string): NewerFallbackCopy | null {
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


/**
 * Inspect the physical IndexedDB workspace and acknowledged browser fallback
 * independently, without promoting, hydrating, clearing, or replacing either.
 * Intended as a read-only prerequisite for an explicit export/recovery flow.
 *
 * expectedProfileUserId is an exact privacy filter, NOT authentication.
 * Callers must obtain this ID from a verified session before exposing raw data.
 * Legacy name-only records are withheld for manual account-identity review.
 */
export type LocalVaultRecoveryCopy = Readonly<{
  source: "indexeddb" | "indexeddb-scoped" | "local-fallback";
  fingerprint: string;
  value: string;
}>;

/** Not an authenticated or integrity-verified backup. Never auto-restore it.
 * The caller must verify the active session's stable user ID before showing
 * these exact bytes for explicit user-reviewed manual recovery/export. */
export type LocalVaultUnverifiedScopedFallback = Readonly<{
  source: "local-fallback-scoped-unverified";
  fingerprint: string;
  value: string;
}>;

/** Reasons for a manual recovery review, not proof that any unverified bytes
 * belong to the signed-in learner. Only the caller can authenticate a session. */
export type LocalVaultRecoveryReviewReason =
  | "trusted-copies-diverge"
  | "unverified-owner-scoped-copy"
  | "other-owner-or-unverifiable-bytes"
  | "storage-source-unreadable";

export type LocalVaultRecoveryInspection = Readonly<{
  copies: readonly LocalVaultRecoveryCopy[];
  /** Exhaustive observed reasons, never a command to restore or delete data. */
  reviewReasons: readonly LocalVaultRecoveryReviewReason[];
  /** An explicit user decision is needed before an eventual recovery/export UI
   * treats the observed copies as interchangeable. Does NOT grant authorization. */
  requiresExplicitReview: boolean;
  unverifiedScopedFallback: LocalVaultUnverifiedScopedFallback | null;
  indexedDbReadable: boolean;
  fallbackReadable: boolean;
  unverifiedOrOtherOwnerCopyPresent: boolean;
  divergent: boolean;
}>;

export async function inspectLocalVaultRecoveryCopies(
  expectedProfileUserId: string,
): Promise<LocalVaultRecoveryInspection> {
  if (typeof expectedProfileUserId !== "string" || !expectedProfileUserId.trim()) {
    throw new Error("A verified stable profile ID is required to inspect workspace recovery copies.");
  }

  const name = STORAGE_KEYS.persistedState;
  const copies: LocalVaultRecoveryCopy[] = [];
  let indexedDbReadable = false;
  let primaryIndexedDbReadFailed = false;
  let fallbackReadable = false;
  let unverifiedOrOtherOwnerCopyPresent = false;

  // Bypass the adapter's fallback selection and conflict latch. A damaged vault
  // cannot hide a valid offline backup, and a readable vault does not mean
  // the fallback is redundant.
  try {
    const value = await readVaultSnapshot(name, openVaultForInspection);
    indexedDbReadable = true;
    if (value !== null) {
      if (stablePersistedUserId(value) === expectedProfileUserId) {
        copies.push({ source: "indexeddb", fingerprint: snapshotFingerprint(value), value });
      } else {
        unverifiedOrOtherOwnerCopyPresent = true;
      }
    }
  } catch {
    // An unavailable or damaged primary vault is not proof that the owner's
    // separately retained scoped record is empty.
    primaryIndexedDbReadFailed = true;
  }

  // Switching A -> B changes the generic active vault, but A's per-account
  // record can still hold unique edits. Inspect that record directly under
  // the same read-only, no-create guard, rather than trusting the active
  // pointer or exposing B's generic snapshot as A's recovery data.
  try {
    const scoped = await readVaultRecord(scopedStateKey(name, expectedProfileUserId), openVaultForInspection);
    indexedDbReadable = true;
    // A readable scoped copy does not establish that an unreadable generic
    // manifest contained no other unique edits or owner records.
    if (primaryIndexedDbReadFailed) unverifiedOrOtherOwnerCopyPresent = true;
    if (scoped !== undefined) {
      if (stablePersistedUserId(scoped) === expectedProfileUserId) {
        // The primary and scoped copies can be different revisions of the
        // same owner. Never choose a winner or discard either here.
        if (!copies.some(copy => copy.source === "indexeddb" && copy.value === scoped)) {
          copies.push({ source: "indexeddb-scoped", fingerprint: snapshotFingerprint(scoped), value: scoped });
        }
      } else {
        unverifiedOrOtherOwnerCopyPresent = true;
      }
    }
  } catch {
    // A corrupted scoped manifest may contain unique bytes; do not claim a
    // readable primary proves it is redundant. Neither path writes or clears.
    if (indexedDbReadable) unverifiedOrOtherOwnerCopyPresent = true;
  }

  let unverifiedScopedFallback: LocalVaultUnverifiedScopedFallback | null = null;
  const fallbackStore = localFallback();
  if (fallbackStore) {
    try {
      const raw = fallbackStore.getItem(name);
      const marker = fallbackStore.getItem(fallbackMarkerKey(name));
      fallbackReadable = true;
      if (raw !== null || marker !== null) {
        const copy = newerFallbackCopy(fallbackStore, name);
        if (copy && stablePersistedUserId(copy.value) === expectedProfileUserId) {
          copies.push({ source: "local-fallback", fingerprint: copy.fingerprint, value: copy.value });
        } else {
          // Do not elevate unmarked/tampered/foreign snapshots into recovery.
          // Leave their bytes untouched for manual identity/integrity review.
          unverifiedOrOtherOwnerCopyPresent = true;
        }
      }
    } catch {
      // Denied generic browser storage is not equivalent to a missing copy.
    }

    // An account A -> B transition can leave A's account-specific localStorage
    // copy behind even though B replaced the generic fallback and its marker.
    // The generic marker NEVER verifies a different scoped copy. Surface A's
    // owner-matching bytes in a separate unverified lane for manual export,
    // without admitting them to the trusted candidates above.
    try {
      const scopedKey = scopedStateKey(name, expectedProfileUserId);
      const first = fallbackStore.getItem(scopedKey);
      const second = fallbackStore.getItem(scopedKey);
      if (first !== second) {
        // This is only a read-read stability check, not a cross-tab lock.
        unverifiedOrOtherOwnerCopyPresent = true;
      } else if (first !== null && !copies.some(copy => copy.value === first)) {
        unverifiedOrOtherOwnerCopyPresent = true;
        if (stablePersistedUserId(first) === expectedProfileUserId) {
          unverifiedScopedFallback = {
            source: "local-fallback-scoped-unverified",
            fingerprint: snapshotFingerprint(first),
            value: first,
          };
        }
        // Foreign-owner or invalid JSON bytes are intentionally withheld.
      }
    } catch {
      // Scoped storage may be denied even when the generic fallback is readable.
      unverifiedOrOtherOwnerCopyPresent = true;
    }
  }

  // A trusted-only "divergent=false" does not mean the owner's unverified
  // scoped fallback has no unique bytes. Keep the trusted divergence contract
  // unchanged, but make competing/unverifiable evidence impossible to mistake
  // for a safe, automatically reconcilable single copy.
  const divergent = copies.length > 1 && copies.some(copy => copy.value !== copies[0].value);
  const reviewReasons: LocalVaultRecoveryReviewReason[] = [];
  if (divergent) reviewReasons.push("trusted-copies-diverge");
  if (unverifiedScopedFallback !== null) reviewReasons.push("unverified-owner-scoped-copy");
  if (unverifiedOrOtherOwnerCopyPresent) reviewReasons.push("other-owner-or-unverifiable-bytes");
  // A readable copy cannot prove completeness while another storage tier is
  // inaccessible. Report uncertainty, never silently classify it as safe.
  if (!indexedDbReadable || !fallbackReadable) reviewReasons.push("storage-source-unreadable");

  return {
    copies,
    unverifiedScopedFallback,
    indexedDbReadable,
    fallbackReadable,
    unverifiedOrOtherOwnerCopyPresent,
    divergent,
    reviewReasons,
    requiresExplicitReview: reviewReasons.length > 0,
  };
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


/**
 * Open an existing vault for inspection only. IndexedDB.open(name) normally
 * creates a new database when none exists, even for a readonly transaction.
 * Abort that implicit versionchange transaction so recovery inspection cannot
 * create a new vault or mask a missing one.
 */
function openVaultForInspection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.close();
        reject(new Error("The existing local vault has no workspace store."));
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("No existing local vault is available to inspect."));
    req.onblocked = () => reject(new Error("The existing local vault is blocked by another tab."));
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
        // Never throw out of an IndexedDB event handler. Reject through the
        // transaction completion path while preserving the stored bytes.
        if (isMalformedChunkedValueManifest(primary.result)) {
          failure ??= new InvalidVaultManifestError();
          return;
        }
        result = primary.result;
        return;
      }
      const chunks = new Array<string>(manifest.chunkCount);
      chunked = { manifest, chunks };
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const request = store.get(`${manifest.chunkPrefix}:${index}`);
        request.onsuccess = () => {
          if (typeof request.result !== "string") {
            // A readable manifest with a missing physical chunk is corruption,
            // not an unavailable IndexedDB tier. Never hydrate an unmarked
            // browser mirror over the retained damaged physical record.
            failure ??= new InvalidVaultManifestError("The local vault workspace is missing one or more storage chunks.");
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
        catch (error) {
          // Failed length/fingerprint reconstruction is also a damaged
          // physical workspace, rather than a transient storage failure.
          // The caller must quarantine it and retain every raw record.
          failure = new InvalidVaultManifestError(
            error instanceof Error ? error.message : "Unable to rebuild the local workspace.",
          );
        }
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

    const write = (current: string | undefined, previous: readonly (string | undefined)[]) => {
      // Missing data is a competing revision when this tab hydrated a concrete
      // workspace. Otherwise a stale tab could resurrect another tab's explicit
      // deletion. A genuinely empty hydrated vault still expects null.
      if (
        expected
        && !expected.fingerprints.includes(workspaceFingerprint(current ?? null))
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

// IndexedDB owns the workspace, but a second tab may write an acknowledged
// offline fallback while this tab awaits its IndexedDB transaction. Never
// treat an earlier, successful IDB commit as authority to delete that newer
// fallback. localStorage has no compare-and-delete transaction, so this
// conditional cleanup narrows the race but is NOT a cross-tab atomic lock.
type FallbackCleanupSnapshot = {
  value: string | null;
  marker: string | null;
  pointer: string | null;
  scoped: string | null;
};

function captureFallbackCleanup(
  fallbackStore: Storage | null,
  name: string,
  userId: string,
): FallbackCleanupSnapshot | null {
  if (!fallbackStore) return null;
  try {
    return {
      value: fallbackStore.getItem(name),
      marker: fallbackStore.getItem(fallbackMarkerKey(name)),
      pointer: fallbackStore.getItem(activeUserKey(name)),
      scoped: userId ? fallbackStore.getItem(scopedStateKey(name, userId)) : null,
    };
  } catch {
    // If the prior state cannot be observed, never clean recovery bytes.
    return null;
  }
}

function clearFallbackCopy(
  fallbackStore: Storage | null,
  name: string,
  userId: string,
  expected: FallbackCleanupSnapshot | null,
): void {
  // An acknowledged workspace fallback may contain the only copy of edits
  // saved by another tab immediately AFTER the checks below but BEFORE any
  // removeItem call. Web Storage has no compare-and-delete transaction, and
  // IndexedDB success cannot authorize deleting bytes written by another tab.
  // Retain workspace recovery copies until an explicit, user-reviewed recovery
  // or pruning operation can reconcile their revisions. This is a fail-closed
  // durability policy: a stale retained marker may require manual reconciliation
  // before subsequent saves, but must never silently lose unique edits.
  if (observesWorkspace(name)) {
    // Preserve the historical lightweight profile locator only when there is
    // no acknowledged generic fallback to reassign. This is metadata, not
    // permission to delete a different tab's recovery payload or marker.
    if (fallbackStore && userId && expected?.value === null && expected.marker === null) {
      try {
        if (fallbackStore.getItem(name) === null
          && fallbackStore.getItem(fallbackMarkerKey(name)) === null
          && (!fallbackStore.getItem(activeUserKey(name))
            || fallbackStore.getItem(activeUserKey(name)) === userId)) {
          fallbackStore.setItem(activeUserKey(name), userId);
        }
      } catch { /* Optional locator; never misreport a confirmed IndexedDB save. */ }
    }
    return;
  }
  // Optional cleanup of non-workspace cache must not make a confirmed IDB save fail.
  if (!fallbackStore || !expected) return;
  try {
    if (
      fallbackStore.getItem(name) !== expected.value
      || fallbackStore.getItem(fallbackMarkerKey(name)) !== expected.marker
      || fallbackStore.getItem(activeUserKey(name)) !== expected.pointer
      || (userId && fallbackStore.getItem(scopedStateKey(name, userId)) !== expected.scoped)
    ) return;
    fallbackStore.removeItem(fallbackMarkerKey(name));
    fallbackStore.removeItem(name);
    if (userId) {
      fallbackStore.setItem(activeUserKey(name), userId);
      fallbackStore.removeItem(scopedStateKey(name, userId));
    }
  } catch { /* Preserve the available fallback if optional cleanup fails. */ }
}

async function readVaultSnapshot(
  name: string,
  open: () => Promise<IDBDatabase> = openExistingVault,
): Promise<string | null> {
  const primary = await readVaultRecord(name, open);
  if (primary) return primary;
  const activeUser = await withStore<string | undefined>("readonly", (store) => store.get(activeUserKey(name)), open);
  if (!activeUser) return null;
  return await readVaultRecord(scopedStateKey(name, activeUser), open) ?? null;
}

/** A delete is a write: authorize it against the exact workspace revision
 * observed by this runtime, in the same transaction as deleting its records.
 * Reading the active pointer and scoped snapshot inside that transaction also
 * prevents a stale localStorage pointer from targeting another account. */
async function removeVaultRecords(name: string, expected?: VaultExpectation): Promise<void> {
  const db = await openExistingVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let conflict: VaultConflictError | null = null;
    let settled = false;

    const deny = () => {
      conflict = new VaultConflictError();
      if (expected?.latchConflict !== false && observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
      tx.abort();
    };

    const removeVerified = (primary: string | undefined, scoped: string | undefined, active: string | undefined) => {
      const current = primary ?? scoped ?? null;
      // Neither a missing record nor a separately advanced scoped mirror is
      // equivalent to the workspace the deleting tab previously hydrated.
      if (expected && (
        !expected.fingerprints.includes(workspaceFingerprint(current))
        || (scoped !== undefined && !expected.fingerprints.includes(workspaceFingerprint(scoped)))
        || (primary !== undefined && !expected.fingerprints.includes(workspaceFingerprint(primary)))
        || (active !== undefined && primary !== undefined
          && stablePersistedUserId(primary) !== null && stablePersistedUserId(primary) !== active)
      )) {
        deny();
        return;
      }

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
    };

    const primary = store.get(name);
    primary.onsuccess = () => {
      const primaryValue = typeof primary.result === "string" ? primary.result : undefined;
      const active = store.get(activeUserKey(name));
      active.onsuccess = () => {
        const currentActive = typeof active.result === "string" && active.result ? active.result : undefined;
        if (!currentActive) {
          removeVerified(primaryValue, undefined, undefined);
          return;
        }
        const scoped = store.get(scopedStateKey(name, currentActive));
        scoped.onsuccess = () => {
          const scopedValue = typeof scoped.result === "string" ? scoped.result : undefined;
          removeVerified(primaryValue, scopedValue, currentActive);
        };
      };
    };

    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve();
      settled = true;
    };
    tx.onerror = () => {
      if (conflict || settled) return;
      db.close();
      reject(tx.error ?? new Error("Unable to remove the local workspace."));
      settled = true;
    };
    tx.onabort = () => {
      db.close();
      if (!settled) reject(conflict ?? tx.error ?? new Error("Unable to remove the local workspace."));
      settled = true;
    };
  });
}

const vaultStorage: StateStorage = {
  async getItem(name) {
    const initialReceipt = observesWorkspace(name) ? captureVaultWriteObservation() : null;
    // A save that could not reach IndexedDB leaves its snapshot here, ahead of
    // the vault. Reading the vault first used to hand back the older copy, and
    // the next successful save then deleted the newer one.
    const fallbackStore = localFallback();
    const newer = newerFallbackCopy(fallbackStore, name);
    if (newer !== null) {
      const userId = persistedUserId(newer.value);
      try {
        // The marker records the IndexedDB snapshot on which this fallback was
        // based. Comparing that base and the fallback itself in one transaction
        // prevents a late promotion from replacing a newer tab's commit.
        const cleanupSnapshot = captureFallbackCleanup(fallbackStore, name, userId);
        // The promoted bytes/marker must match the copy selected at getItem
        // start, even if a competing tab replaced them before this capture.
        const expectedCleanup = cleanupSnapshot === null ? null : {
          ...cleanupSnapshot, value: newer.value, marker: newer.marker,
        };
        await writeVault(name, newer.value, userId, fallbackExpectation(newer, false));
        clearFallbackCopy(fallbackStore, name, userId, expectedCleanup);
      } catch (promotionError) {
        if (isVaultConflictError(promotionError)) {
          try {
            const current = await readVaultSnapshot(name);
            if (current !== null) {
              // A conflict's subsequent readonly observation is not an
              // atomic proof of redundancy: another tab can advance the
              // vault again before cleanup. Never delete an acknowledged
              // fallback after any failed promotion. A successful writeVault
              // transaction below is the sole automatic cleanup authority.
              if (current !== newer.value && observesWorkspace(name)) {
                // Both versions may hold unique edits. Keep the marker and
                // scoped copy and block follow-up autosave until reconciliation.
                // Legacy bare markers must fail closed as well.
                conflictedWorkspaceKeys.add(name);
                if (initialReceipt !== null) invalidateVaultWriteIfUnchanged(initialReceipt);
                markVaultWriteFailure(); // Existing watcher offers export.
              }
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
    } catch (error) {
      if (observesWorkspace(name) && error instanceof InvalidVaultManifestError) {
        // A corrupt physical manifest is not proof that an unmarked browser
        // mirror is the right account's latest revision. Never hydrate it as a
        // workspace, nor grant a subsequent autosave authority over the raw
        // physical record. Leave IDB and localStorage bytes for manual review.
        conflictedWorkspaceKeys.add(name);
        if (initialReceipt !== null) invalidateVaultWriteIfUnchanged(initialReceipt);
        markVaultWriteFailure();
        return null;
      }
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
          } catch { /* Keep the legacy mirror if the winner is still unreadable. */ }
        }
        // Keep the mirror for recovery on any failed migration.
      }
    }
    // A delayed empty or inaccessible hydration must not erase another tab's
    // valid receipt, including a save inside the shared marker's 1s throttle.
    // Recheck the live v5 vault before retiring only this tab's stale status.
    if (fallback === null && initialReceipt !== null) {
      try {
        const recovered = await readVaultSnapshot(name);
        if (recovered !== null) {
          rememberVaultSnapshot(name, recovered);
          return recovered;
        }
      } catch { /* Temporarily unavailable IndexedDB is not proof of data loss. */ }
      invalidateVaultWriteIfUnchanged(initialReceipt);
    }
    rememberVaultSnapshot(name, fallback);
    return fallback;
  },

  async setItem(name, value) {
    const writeSequence = ++vaultWriteSequence;
    const userId = persistedUserId(value);
    const fallbackStore = localFallback();
    const cleanupSnapshot = captureFallbackCleanup(fallbackStore, name, userId);
    let fallbackBaseFingerprint: string | null | undefined;
    try {
      const expected = workspaceExpectation(name);
      const currentFallback = newerFallbackCopy(fallbackStore, name);
      assertFallbackStillCurrent(name, currentFallback, expected);
      assertFallbackOwnerUnchanged(name, currentFallback, value);
      fallbackBaseFingerprint = currentFallback !== null
        ? currentFallback.baseFingerprint
        : observedVaultFingerprint(name);
      if (currentFallback === null && fallbackBaseFingerprint === undefined) {
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
      const vaultExpectation = currentFallback !== null
        ? fallbackExpectation(currentFallback)
        : expected;
      await writeVault(name, value, userId, vaultExpectation);
      clearFallbackCopy(fallbackStore, name, userId, cleanupSnapshot);
      rememberVaultSnapshot(name, value);
      if (name === STORAGE_KEYS.persistedState) markVaultWrite("indexeddb");
    } catch (indexedDbError) {
      if (isVaultConflictError(indexedDbError)) {
        if (observesWorkspace(name)) conflictedWorkspaceKeys.add(name);
        vaultWriteFailures.set(writeSequence, indexedDbError);
        if (name === STORAGE_KEYS.persistedState) markVaultWriteFailure();
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
        assertFallbackOwnerUnchanged(name, previousFallback, value);
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
        if (name === STORAGE_KEYS.persistedState) markVaultWrite("local-fallback");
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
        vaultWriteFailures.set(
          writeSequence,
          isVaultConflictError(failure)
            ? failure
            : combinedStorageFailure(indexedDbError, failure),
        );
        // Ordinary saves are best-effort, so say so: this one is on no disk.
        if (name === STORAGE_KEYS.persistedState) markVaultWriteFailure();
      }
    }
  },

  async removeItem(name) {
    const workspace = observesWorkspace(name);
    const writeSequence = ++vaultWriteSequence;
    const fail = (error: unknown): Error => {
      const failure = error instanceof Error ? error : new Error("AXOM could not remove the local workspace.");
      vaultWriteFailures.set(writeSequence, failure);
      if (workspace) markVaultWriteFailure();
      return failure;
    };
    let expected: VaultExpectation | undefined;
    try {
      expected = workspace ? workspaceExpectation(name) : undefined;
    } catch (error) {
      throw fail(error);
    }
    const fallback = localFallback();
    const markerKey = fallbackMarkerKey(name);
    const pointerKey = activeUserKey(name);
    // Capture optional recovery bytes. A concurrent fallback writer must not
    // lose its only acknowledged copy if this tab deletes a different revision.
    const beforeValue = fallback?.getItem(name) ?? null;
    const beforeMarker = fallback?.getItem(markerKey) ?? null;
    const beforeActive = fallback?.getItem(pointerKey) ?? null;
    const scopeKey = beforeActive ? scopedStateKey(name, beforeActive) : null;
    const beforeScoped = scopeKey ? fallback?.getItem(scopeKey) ?? null : null;

    if (expected && [beforeValue, beforeScoped].some((value) =>
      value !== null && !expected.fingerprints.includes(workspaceFingerprint(value))
    )) {
      conflictedWorkspaceKeys.add(name);
      throw fail(new VaultConflictError());
    }

    try {
      // This compares the live primary, scoped snapshot and pointer *inside*
      // IndexedDB's write transaction before any record is deleted.
      await removeVaultRecords(name, expected);
    } catch (error) {
      if (workspace) {
        if (isVaultConflictError(error)) conflictedWorkspaceKeys.add(name);
        throw fail(error);
      }
      // Non-workspace cache cleanup remains best effort when IDB is absent.
    }

    // A failed or conflicting delete never clears a recovery copy. Even after
    // a verified IDB delete, leave a fallback written by another tab untouched.
    try {
      if (fallback?.getItem(name) === beforeValue
        && fallback?.getItem(markerKey) === beforeMarker
        && fallback?.getItem(pointerKey) === beforeActive
        && (!scopeKey || fallback?.getItem(scopeKey) === beforeScoped)) {
        fallback?.removeItem(name);
        fallback?.removeItem(markerKey);
        fallback?.removeItem(pointerKey);
        if (scopeKey) fallback?.removeItem(scopeKey);
      }
    } catch {
      // Preserving a redundant local copy is safer than masking IDB success.
    }
    if (workspace) {
      invalidateVaultWrite();
      // A confirmed delete permits this tab to intentionally create a new
      // workspace, while a rejected delete retains the older observation.
      rememberVaultSnapshot(name, null);
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
  const fallbackStore = localFallback();
  const cleanupSnapshot = captureFallbackCleanup(fallbackStore, name, userId);
  try {
    await writeVault(name, value, userId);
    clearFallbackCopy(fallbackStore, name, userId, cleanupSnapshot);
    conflictedWorkspaceKeys.delete(name);
    rememberVaultSnapshot(name, value);
    if (name === STORAGE_KEYS.persistedState) markVaultWrite("indexeddb");
  } catch (error) {
    vaultWriteFailures.set(
      writeSequence,
      error instanceof Error ? error : new Error("AXOM could not replace the local workspace."),
    );
    if (name === STORAGE_KEYS.persistedState) markVaultWriteFailure();
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
