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
  /** Supabase account UUID when a signed-in learner wrote this workspace. */
  accountId?: string;
}

export const VAULT_WRITE_EVENT = "axom:vault-write";
/** Account identity is kept out of the workspace and injected by accountStore. */
let vaultAccountId: string | null = null;
export function readVaultAccountIdentity(): string | null { return vaultAccountId; }
/**
 * Switching accounts changes which local save receipt is trustworthy, not the
 * actual device workspace. Never erase local saves merely for an auth switch.
 */
export function setVaultAccountIdentity(accountId: string | null): void {
  const next = typeof accountId === "string" && accountId.trim() ? accountId : null;
  if (vaultAccountId === next) return;
  vaultAccountId = next;
  lastWrite = null;
  lastPersistedAt = 0;
  memoryOnlyConfirmedWrite = false;
  lastObservedMarkerRaw = undefined;
  statusInvalidated = false;
  invalidatedMarkerValue = null;
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(VAULT_WRITE_EVENT));
  }
}
export const VAULT_WRITE_FAILURE_EVENT = "axom:vault-write-failure";
let lastWrite: VaultWriteRecord | null = null;
let lastPersistedAt = 0;
/** Reconcile cached receipts with on-disk marker changes missed while Settings is unmounted. */
let lastObservedMarkerRaw: string | null | undefined;
/** Only advertise quota-only in-memory save receipts with an active cross-tab invalidation channel. */
let memoryOnlyConfirmedWrite = false;
let failingSince: string | null = null;
/** A removed/missing workspace must not rehydrate stale save-success metadata. */
let statusInvalidated = false;
/** Reject an invalidated marker that storage permissions prevented us removing. */
let invalidatedMarkerValue: string | null = null;
/** Same-origin, content-free notifications when quota blocks the optional localStorage marker. */
const VAULT_STATUS_CHANNEL = "axom:vault-status";
let statusChannel: BroadcastChannel | null = null;
function rawStoredMarker(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEYS.lastVaultWriteAt); }
  catch { return null; }
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

export function markVaultWrite(
  target: VaultWriteTarget,
  now: Date = new Date(),
  writeAccountId: string | null = vaultAccountId,
): void {
  // An async save queued under A must never be acknowledged under B.
  // Clearing only the status marker fails closed without removing workspace bytes.
  if (writeAccountId !== vaultAccountId) {
    invalidateVaultWrite();
    return;
  }
  // PR #128 only calls this after the persisted workspace key actually landed.
  listenForCrossTabInvalidation();
  statusInvalidated = false;
  invalidatedMarkerValue = null;
  lastWrite = {
    at: now.toISOString(), target, version: WORKSPACE_WRITE_MARKER_VERSION, scope: "workspace",
    ...(vaultAccountId ? { accountId: vaultAccountId } : {}),
  };
  failingSince = null;
  // Keep the tiny localStorage marker current without hammering it on every
  // keystroke: at most once per second.
  if (now.getTime() - lastPersistedAt >= 1000) {
    lastPersistedAt = now.getTime();
    try {
      const raw = JSON.stringify(lastWrite);
      window.localStorage.setItem(STORAGE_KEYS.lastVaultWriteAt, raw);
      lastObservedMarkerRaw = raw;
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
  statusInvalidated = true;
  invalidatedMarkerValue = invalidatedRaw;
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

/** Read only a valid workspace-specific marker, never a legacy auxiliary write. */
function readStoredWorkspaceMarker(raw: string | null): VaultWriteRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const marker = parsed as Record<string, unknown>;
    if (
      marker.version !== WORKSPACE_WRITE_MARKER_VERSION ||
      marker.scope !== "workspace" ||
      typeof marker.at !== "string" ||
      !Number.isFinite(Date.parse(marker.at)) ||
      (marker.target !== "indexeddb" && marker.target !== "local-fallback") ||
      // Legacy unscoped v2 markers cannot confirm a signed-in account's save.
      (vaultAccountId ? marker.accountId !== vaultAccountId : marker.accountId !== undefined)
    ) return null;
    return {
      at: marker.at,
      target: marker.target,
      version: WORKSPACE_WRITE_MARKER_VERSION,
      scope: "workspace",
      ...(vaultAccountId ? { accountId: vaultAccountId } : {}),
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
  const markerRaw = rawStoredMarker();
  const stored = readStoredWorkspaceMarker(markerRaw);
  // No storage event is delivered to an unmounted Settings subscriber. A tab
  // can replace our last marker with an older but valid receipt, so timestamp
  // ordering alone cannot authorize keeping the previous in-memory badge.
  // An unchanged raw marker still permits a newer same-tab, throttled save.
  if (lastObservedMarkerRaw !== undefined && markerRaw !== lastObservedMarkerRaw) {
    lastWrite = null;
    memoryOnlyConfirmedWrite = false;
    lastPersistedAt = 0;
  }
  lastObservedMarkerRaw = markerRaw;
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
