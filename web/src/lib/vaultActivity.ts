import { STORAGE_KEYS } from "./brand";

/**
 * The exact time of the latest successful local workspace write, so Settings
 * can say "Saved on this device at 8:42:13 PM" instead of a vague "autosave
 * is on". Stores only versioned workspace-write metadata, never content.
 * Legacy unscoped markers are not evidence of a workspace save.
 */
export type VaultWriteTarget = "indexeddb" | "local-fallback";
/** v2 prevents old auxiliary cache writes from impersonating workspace saves. */
const WORKSPACE_WRITE_MARKER_VERSION = 2 as const;
export interface VaultWriteRecord {
  at: string;
  target: VaultWriteTarget;
  version: typeof WORKSPACE_WRITE_MARKER_VERSION;
  scope: "workspace";
}

/** The exact receipt observed before asynchronous vault hydration begins. */
export interface VaultWriteObservation {
  readonly rawMarker: string | null;
  readonly memoryRecord: VaultWriteRecord | null;
}

export const VAULT_WRITE_EVENT = "axom:vault-write";
export const VAULT_WRITE_FAILURE_EVENT = "axom:vault-write-failure";
let lastWrite: VaultWriteRecord | null = null;
/** A post-startup workspace save was confirmed by this runtime, not inferred from shared metadata. */
let currentRuntimeConfirmedWrite = false;
let lastPersistedAt = 0;
/** Only advertise quota-only in-memory save receipts with an active cross-tab invalidation channel. */
let memoryOnlyConfirmedWrite = false;
let failingSince: string | null = null;
/** A removed/missing workspace must not rehydrate stale save-success metadata. */
let statusInvalidated = false;
/** Reject an invalidated marker that storage permissions prevented us removing. */
let invalidatedMarkerValue: string | null = null;
/** Same-origin, content-free notifications when quota blocks the optional localStorage marker. */
const VAULT_STATUS_CHANNEL = "axom:vault-status";
/** A missing hydration must not erase another tab's throttled, origin-wide
 * save marker. Remember ambiguity per tab and through same-tab reload only. */
const HYDRATION_TOMBSTONE_KEY = `${STORAGE_KEYS.lastVaultWriteAt}:hydration-invalidated`;
let hydrationSessionWritable: boolean | null = null;
/** A readable sessionStorage can still reject writes. Verify both once per module. */
function canPersistHydrationTombstone(): boolean {
  if (hydrationSessionWritable !== null) return hydrationSessionWritable;
  try {
    const storage = window.sessionStorage;
    const probe = `${HYDRATION_TOMBSTONE_KEY}:probe`;
    const previous = storage.getItem(probe);
    storage.setItem(probe, "1");
    if (storage.getItem(probe) !== "1") throw new Error("sessionStorage write not retained");
    if (previous === null) storage.removeItem(probe);
    else storage.setItem(probe, previous);
    hydrationSessionWritable = true;
  } catch {
    hydrationSessionWritable = false;
  }
  return hydrationSessionWritable;
}
/** undefined means tombstones cannot be trusted across a module reload. */
function readHydrationTombstone(): string | null | undefined {
  if (!canPersistHydrationTombstone()) return undefined;
  try { return window.sessionStorage.getItem(HYDRATION_TOMBSTONE_KEY); }
  catch { hydrationSessionWritable = false; return undefined; }
}
function rememberHydrationTombstone(raw: string | null): void {
  if (raw === null || !canPersistHydrationTombstone()) return;
  try { window.sessionStorage.setItem(HYDRATION_TOMBSTONE_KEY, raw); }
  catch { hydrationSessionWritable = false; }
}
function clearHydrationTombstone(): void {
  if (!canPersistHydrationTombstone()) return;
  try { window.sessionStorage.removeItem(HYDRATION_TOMBSTONE_KEY); }
  catch { hydrationSessionWritable = false; }
}
let statusChannel: BroadcastChannel | null = null;
function rawStoredMarker(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt); }
  catch { return null; }
}

/** Capture both persisted and in-tab status before the first awaited read. */
export function captureVaultWriteObservation(): VaultWriteObservation {
  return { rawMarker: rawStoredMarker(), memoryRecord: lastWrite };
}
/**
 * Browser-frozen tabs can miss BroadcastChannel invalidations. A quota-only
 * successful workspace write has no persistent status receipt to reconcile on
 * resume, so never carry its optimistic badge across a visibility/freeze edge.
 * Do not touch the persisted workspace or its valid on-disk marker.
 */
let lifecycleMonitoringInstalled = false;
function retireUnverifiableMemoryReceipt(): void {
  if (!memoryOnlyConfirmedWrite) return;
  invalidatedMarkerValue = rawStoredMarker();
  statusInvalidated = true;
  memoryOnlyConfirmedWrite = false;
  currentRuntimeConfirmedWrite = false;
  lastWrite = null;
  lastPersistedAt = 0;
  window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
}
function watchMemoryReceiptLifecycle(): void {
  if (lifecycleMonitoringInstalled || typeof window === "undefined") return;
  lifecycleMonitoringInstalled = true;
  window.addEventListener("pagehide", retireUnverifiableMemoryReceipt);
  window.addEventListener("pageshow", (event: PageTransitionEvent) => {
    if (event.persisted) retireUnverifiableMemoryReceipt();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") retireUnverifiableMemoryReceipt();
  });
}

function listenForCrossTabInvalidation(): void {
  if (statusChannel || typeof window === "undefined" || typeof window.BroadcastChannel !== "function") return;
  try {
    const channel = new window.BroadcastChannel(VAULT_STATUS_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data !== "workspace-invalidated") return;
      // Local metadata may never have existed (IndexedDB succeeded but the
      // optional status key was quota-blocked). Native storage events cannot
      // report that removal; this channel can, even while Settings is hidden.
      invalidatedMarkerValue = rawStoredMarker();
      statusInvalidated = true;
      lastWrite = null;
      lastPersistedAt = 0;
      memoryOnlyConfirmedWrite = false;
      currentRuntimeConfirmedWrite = false;
      window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
    };
    // A partially initialized/throwing constructor must not count as coverage.
    statusChannel = channel;
  } catch { /* Optional cross-tab channel unavailable; stored marker stays authoritative. */ }
}


/**
 * A save reached neither IndexedDB nor the browser-storage fallback. Ordinary
 * saves are best-effort, so without this the only sign was a "Saved at" time
 * in Settings that had quietly stopped moving.
 */
export function markVaultWriteFailure(now: Date = new Date()): void {
  failingSince ??= now.toISOString();
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_FAILURE_EVENT));
  }
}

/** When the current run of failed saves began; null while saves are landing. */
export function readVaultWriteFailure(): string | null {
  return failingSince;
}

export function markVaultWrite(target: VaultWriteTarget, now: Date = new Date()): void {
  // PR #128 only calls this after the persisted workspace key actually landed.
  listenForCrossTabInvalidation();
  statusInvalidated = false;
  invalidatedMarkerValue = null;
  lastWrite = { at: now.toISOString(), target, version: WORKSPACE_WRITE_MARKER_VERSION, scope: "workspace" };
  currentRuntimeConfirmedWrite = true;
  failingSince = null;
  // Keep the tiny localStorage marker current without hammering it on every
  // keystroke: at most once per second.
  if (now.getTime() - lastPersistedAt >= 1000) {
    lastPersistedAt = now.getTime();
    try {
      window.localStorage.setItem(STORAGE_KEYS.lastVaultWriteAt, JSON.stringify(lastWrite));
      clearHydrationTombstone();
      memoryOnlyConfirmedWrite = false;
    } catch {
      // IndexedDB may have saved the bytes, but without a persistent marker
      // AND cross-tab invalidation we cannot trust an unqualified green badge.
      // Fail closed on status only; never remove or repeat the workspace write.
      // A backgrounded tab cannot establish that invalidations are received.
      // If it is still foregrounded, monitor lifecycle transitions so a
      // suspended/BFCache tab does not revive an unverifiable in-memory badge.
      memoryOnlyConfirmedWrite = statusChannel !== null && document.visibilityState === "visible";
      if (memoryOnlyConfirmedWrite) watchMemoryReceiptLifecycle();
      if (!memoryOnlyConfirmedWrite) {
        lastWrite = null;
        currentRuntimeConfirmedWrite = false;
        // Reject an earlier valid marker: it describes an older workspace,
        // not the quota-only write that just completed. Do not throttle the
        // next confirmed write's attempt to restore persistent evidence.
        lastPersistedAt = 0;
        statusInvalidated = true;
        invalidatedMarkerValue = rawStoredMarker();
      }
    }
  }
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
}

/**
 * Clear only the small save-success marker when the workspace is removed or
 * hydration finds no durable workspace. Never erase workspace or backup bytes.
 * The next confirmed write renews the marker, even inside the throttle window.
 */
export function invalidateVaultWrite(): void {
  listenForCrossTabInvalidation();
  const invalidatedRaw = rawStoredMarker();
  const hadMemoryRecord = lastWrite !== null;
  let hadStoredRecord = false;
  try {
    hadStoredRecord = window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) !== null;
  } catch { /* Optional metadata may be unavailable. */ }
  lastWrite = null;
  lastPersistedAt = 0;
  memoryOnlyConfirmedWrite = false;
  currentRuntimeConfirmedWrite = false;
  statusInvalidated = true;
  invalidatedMarkerValue = invalidatedRaw;
  clearHydrationTombstone();
  try {
    window.localStorage.removeItem(STORAGE_KEYS.lastVaultWriteAt);
  } catch {
    // Storage shims may forbid removal but allow a fail-closed replacement.
    try { window.localStorage.setItem(STORAGE_KEYS.lastVaultWriteAt, "null"); } catch { /* optional */ }
  }
  // No marker-key storage event exists for a confirmed IndexedDB write whose
  // optional status marker was quota-blocked. Send a content-free invalidation.
  try { statusChannel?.postMessage("workspace-invalidated"); } catch { /* optional */ }
  if ((hadMemoryRecord || hadStoredRecord) && typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
}

/**
 * Missing/unreadable hydration is not evidence that every other tab's
 * workspace was removed. Another tab may commit while its optional marker
 * stays identical within the 1s throttle. Fail closed here, but never remove
 * or broadcast invalidation for a shared marker on this ambiguous evidence.
 * Explicit removal still uses invalidateVaultWrite().
 */
export function invalidateVaultWriteIfUnchanged(observed: VaultWriteObservation): boolean {
  if (rawStoredMarker() !== observed.rawMarker || lastWrite !== observed.memoryRecord) return false;
  const hadReceipt = lastWrite !== null || observed.rawMarker !== null;
  lastWrite = null;
  lastPersistedAt = 0;
  memoryOnlyConfirmedWrite = false;
  currentRuntimeConfirmedWrite = false;
  statusInvalidated = true;
  invalidatedMarkerValue = observed.rawMarker;
  rememberHydrationTombstone(observed.rawMarker);
  if (hadReceipt && typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
  return true;
}

/** Read only a valid workspace-specific marker, never a legacy auxiliary write. */
function readStoredWorkspaceMarker(): VaultWriteRecord | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const marker = parsed as Record<string, unknown>;
    if (
      marker.version !== WORKSPACE_WRITE_MARKER_VERSION ||
      marker.scope !== "workspace" ||
      typeof marker.at !== "string" ||
      !Number.isFinite(Date.parse(marker.at)) ||
      (marker.target !== "indexeddb" && marker.target !== "local-fallback")
    ) return null;
    return {
      at: marker.at,
      target: marker.target,
      version: WORKSPACE_WRITE_MARKER_VERSION,
      scope: "workspace",
    };
  } catch {
    return null;
  }
}

/**
 * The in-memory marker must be rechecked against browser storage. A different
 * tab can remove the workspace while Settings is unmounted (no subscriber).
 * Keep a newer same-tab write: the local metadata marker is throttled to 1/s.
 */
export function readLastVaultWrite(): VaultWriteRecord | null {
  listenForCrossTabInvalidation();
  const raw = rawStoredMarker();
  const tombstone = readHydrationTombstone();
  if (tombstone === undefined) {
    // Without durable tab-local tombstones, an old origin-wide marker could
    // survive an unreadable hydration across module/page reload. Only a save
    // confirmed in THIS runtime can establish a positive receipt.
    if (!currentRuntimeConfirmedWrite || statusInvalidated) return null;
    const stored = readStoredWorkspaceMarker();
    if (!memoryOnlyConfirmedWrite && !stored) return null;
    // An actual write in this runtime can still coexist with another tab's
    // newer verified marker. Preserve that newer status without requiring a
    // session tombstone; only cold-start raw receipts remain untrusted.
    if (stored && lastWrite && Date.parse(stored.at) > Date.parse(lastWrite.at)) lastWrite = stored;
    return lastWrite;
  }
  if (tombstone !== null) {
    if (raw === tombstone) {
      // A same-byte marker is ambiguous even if another tab saved new bytes.
      lastWrite = null;
      memoryOnlyConfirmedWrite = false;
      currentRuntimeConfirmedWrite = false;
      statusInvalidated = true;
      invalidatedMarkerValue = tombstone;
      return null;
    }
    clearHydrationTombstone();
  }
  const stored = readStoredWorkspaceMarker();
  if (statusInvalidated) {
    // A newer verified marker can arrive while Settings is unmounted. Do not
    // revive the exact invalidated value when removal was blocked.
    if (!stored || rawStoredMarker() === invalidatedMarkerValue) return null;
    lastWrite = stored;
    memoryOnlyConfirmedWrite = false;
    statusInvalidated = false;
    invalidatedMarkerValue = null;
  }
  // A confirmed in-process IndexedDB write is locally valid even when the
  // optional status marker could not persist. Cross-tab invalidation clears it.
  if (lastWrite && memoryOnlyConfirmedWrite) return lastWrite;
  if (!stored) {
    lastWrite = null;
    currentRuntimeConfirmedWrite = false;
    return null;
  }
  if (!lastWrite || Date.parse(stored.at) > Date.parse(lastWrite.at)) lastWrite = stored;
  return lastWrite;
}

/**
 * React subscribers hear same-tab write/failure events AND native storage
 * events from other tabs. StorageEvent never fires in the tab that wrote the
 * key. Only the workspace marker and whole-store clear affect saved status.
 * A sessionStorage or unrelated-key event must not erase a good local save.
 */
export function subscribeVaultWriteStatus(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listenForCrossTabInvalidation();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.lastVaultWriteAt && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch {
      // Storage access is now blocked: discard optimistic status instead.
    }
    lastWrite = null;
    lastPersistedAt = 0;
    memoryOnlyConfirmedWrite = false;
    currentRuntimeConfirmedWrite = false;
    // Reconcile with the latest persisted value rather than the queued event.
    // When absent, a later valid renewal can be recognized even if Settings
    // unsubscribed before its event arrived.
    statusInvalidated = rawStoredMarker() === null;
    invalidatedMarkerValue = statusInvalidated ? event.oldValue : null;
    listener();
  };
  window.addEventListener(VAULT_WRITE_EVENT, listener);
  window.addEventListener(VAULT_WRITE_FAILURE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(VAULT_WRITE_EVENT, listener);
    window.removeEventListener(VAULT_WRITE_FAILURE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
