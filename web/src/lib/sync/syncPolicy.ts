import type { ProtectionStatus, SyncMetadata } from "./syncTypes";

/**
 * How often AXOM is allowed to upload. Every number that bounds background
 * protection lives here, so "how hard can a device hit the account?" has one
 * answer:
 *
 * - While things work, automatic uploads average at most 5 MB a minute.
 * - After a failure the waits are 5 s, 15 s, 45 s, 2 min, 5 min, 15 min, then
 *   one try every half hour.
 * - After a refusal (the same upload would be refused again) one try an hour.
 * - "Protect now" is the learner's decision and always runs at once.
 */

/** The account refuses snapshots over 15,000,000 bytes. Its measure pads separators, so the device stops a little earlier. */
export const MAX_SNAPSHOT_BYTES = 14_000_000;

/** Waits after the first, second, third... consecutive failed upload. */
export const RETRY_STEPS_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000];
/** Once the steps run out. */
export const PAUSED_RECHECK_MS = 30 * 60_000;
/** After a refusal. */
export const BLOCKED_RECHECK_MS = 60 * 60_000;
/** After the network returns, so every open tab does not start in the same instant. */
export const RECONNECT_DELAY_MS = 2_000;

const UPLOAD_BYTES_PER_MINUTE = 5_000_000;
const MAX_UPLOAD_GAP_MS = 5 * 60_000;
/** No wait is ever longer than this, whatever the clock or the stored state says. */
const LONGEST_WAIT_MS = BLOCKED_RECHECK_MS;

/** Minimum time between the starts of two automatic uploads of this size. */
export function uploadGap(bytes: number | undefined): number {
  if (!bytes || bytes <= 0) return 0;
  return Math.min(MAX_UPLOAD_GAP_MS, Math.round((bytes / UPLOAD_BYTES_PER_MINUTE) * 60_000));
}

/**
 * Wait before the next try after `attempt` consecutive failures, or null when
 * the short steps are used up. Spread by a fifth either way so tabs and
 * devices that failed together do not return together.
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number | null {
  const step = RETRY_STEPS_MS[attempt - 1];
  if (step === undefined) return null;
  return Math.round(step * (0.8 + 0.4 * random()));
}

/** Milliseconds until an automatic upload may start. 0 means now. */
export function waitBeforeAutomatic(meta: SyncMetadata, now: number): number {
  const until = Math.max(time(meta.nextAttemptAt), time(meta.lastAttemptAt) + uploadGap(meta.lastPayloadBytes));
  return Math.min(LONGEST_WAIT_MS, Math.max(0, until - now));
}

/** What the stored state says protection is doing when no upload is running. */
export function restingStatus(meta: SyncMetadata): ProtectionStatus {
  if (meta.conflictServerRevision !== undefined) return "conflict";
  if (meta.pending && meta.lastError) {
    if (meta.lastError.kind === "rejected") return "blocked";
    return meta.attempt > RETRY_STEPS_MS.length ? "paused" : "retrying";
  }
  if (meta.pending) return "saved-locally";
  return meta.lastProtectedAt ? "protected" : "saved-locally";
}

function time(iso: string | undefined): number {
  const value = iso ? Date.parse(iso) : 0;
  return Number.isFinite(value) ? value : 0;
}
