import { trackerPathKey } from "./pathUtils";
import { isCourseActivity, TRACKER_KIND_FOR_ACTIVITY, type CourseActivity } from "./course-engine/activity";
import type { TrackerKind } from "./types";

/**
 * Proposed versioned schedule provenance contract. A claim records the decoded
 * source observation, not a globally unique event or a verified occurrence ID.
 * Do not derive this from a learner note or reconstruct it for a legacy row.
 * The surrounding account-scoped Tracker record is the authority for ownership.
 */
export interface ScheduleSourceClaimV1 {
  version: 1;
  source: {
    title: string;
    date: string | null;
    kind: TrackerKind;
    activity: CourseActivity | null;
  };
  reviewedDate: string | null;
  destinationKey: string;
}

export type ScheduleClaimRead =
  | { state: "legacy-unknown" | "invalid" }
  | { state: "valid"; claim: ScheduleSourceClaimV1 };

export type ScheduleReplayStatus =
  | "possible-replay"
  | "different"
  | "legacy-unknown"
  | "invalid-claim"
  | "moved";

const trackerKinds: ReadonlySet<string> = new Set<TrackerKind>([
  "Lecture", "DLA", "PQ", "Lab", "Reading", "Requirement", "Milestone",
  "Evidence", "Question Block", "Assessment", "Review Loop",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** Read only: malformed/unsupported metadata is not silently converted to a legacy claim. */
export function readScheduleSourceClaim(value: unknown): ScheduleClaimRead {
  if (value === undefined) return { state: "legacy-unknown" };
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.source)) return { state: "invalid" };
  const { source, reviewedDate, destinationKey } = value;
  const { title, date, kind, activity } = source;
  if (typeof title !== "string" || !title.trim() ||
      !isDateOrNull(date) || !isDateOrNull(reviewedDate) ||
      typeof kind !== "string" || !trackerKinds.has(kind) ||
      (activity !== null && (!isCourseActivity(activity) || TRACKER_KIND_FOR_ACTIVITY[activity] !== kind)) ||
      typeof destinationKey !== "string" || !destinationKey || trackerPathKey(destinationKey) !== destinationKey) {
    return { state: "invalid" };
  }
  // Return detached metadata; do not mutate or coerce the stored record.
  return { state: "valid", claim: {
    version: 1, source: { title, date, kind: kind as TrackerKind, activity },
    reviewedDate, destinationKey,
  } };
}

function observedTitle(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A matching unkeyed observation needs explicit duplicate review, not automatic
 * suppression or creation. Classification and reviewed dates can change.
 * Call only with records from the current account. A path is not an account ID.
 * A row moved to another destination does not certify that destination's source.
 */
export function scheduleSourceReplayStatus(
  candidateValue: unknown,
  existingValue: unknown,
  existingPath: string,
): ScheduleReplayStatus {
  const candidate = readScheduleSourceClaim(candidateValue);
  if (candidate.state !== "valid") return "invalid-claim";
  if (trackerPathKey(existingPath) !== candidate.claim.destinationKey) return "different";
  const existing = readScheduleSourceClaim(existingValue);
  if (existing.state === "legacy-unknown") return "legacy-unknown";
  if (existing.state !== "valid") return "invalid-claim";
  if (existing.claim.destinationKey !== candidate.claim.destinationKey) return "moved";
  const a = candidate.claim.source;
  const b = existing.claim.source;
  return a.date === b.date && observedTitle(a.title) === observedTitle(b.title)
    ? "possible-replay" : "different";
}

/** Only records from the active account may be passed to this selector. */
export interface ScheduleSourceReviewRow {
  recordId: string;
  path: string;
  sourceClaim: unknown;
  /** Existing editable-field duplicate signal; never trusted source evidence. */
  legacyIdentityMatches?: boolean;
}

export interface ScheduleSourceReviewMatch {
  recordId: string;
  currentPathKey: string;
  status: "possible-replay" | "moved-away" | "moved-in";
}

export interface ScheduleSourceUnresolvedRow {
  recordId: string;
  status: "legacy-unknown" | "invalid-claim";
  legacyIdentityMatches: boolean;
}

export type ScheduleSourceReviewEvidence =
  | { state: "invalid-candidate" }
  | { state: "valid"; matches: ScheduleSourceReviewMatch[]; unresolvedAtDestination: ScheduleSourceUnresolvedRow[] };

/**
 * Collect review evidence, not a decision to import, skip, merge or delete.
 * A moved-away observation remains visible when its original destination is
 * reimported. A moved-in observation must match the source, not just the path.
 * Unkeyed equal observations and repeated row IDs are not deduplicated.
 * Missing or invalid claims at the destination remain explicitly unresolved;
 * editable identity can prioritize review but cannot establish provenance.
 */
export function collectScheduleSourceReviewEvidence(
  candidateValue: unknown,
  rows: readonly ScheduleSourceReviewRow[],
): ScheduleSourceReviewEvidence {
  const candidate = readScheduleSourceClaim(candidateValue);
  if (candidate.state !== "valid") return { state: "invalid-candidate" };
  const destination = candidate.claim.destinationKey;
  const matches: ScheduleSourceReviewMatch[] = [];
  const unresolvedAtDestination: ScheduleSourceUnresolvedRow[] = [];
  for (const row of rows) {
    const currentPathKey = trackerPathKey(row.path);
    const existing = readScheduleSourceClaim(row.sourceClaim);
    if (existing.state !== "valid") {
      if (currentPathKey === destination) {
        unresolvedAtDestination.push({
          recordId: row.recordId,
          status: existing.state === "legacy-unknown" ? "legacy-unknown" : "invalid-claim",
          legacyIdentityMatches: row.legacyIdentityMatches === true,
        });
      }
      continue;
    }
    const originalPathKey = existing.claim.destinationKey;
    if (currentPathKey !== destination && originalPathKey !== destination) continue;
    const a = candidate.claim.source;
    const b = existing.claim.source;
    if (a.date !== b.date || observedTitle(a.title) !== observedTitle(b.title)) continue;
    matches.push({
      recordId: row.recordId,
      currentPathKey,
      status: currentPathKey !== destination ? "moved-away" :
        originalPathKey !== destination ? "moved-in" : "possible-replay",
    });
  }
  // A stable presentation order preserves multiplicity and never selects a winner.
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  matches.sort((a, b) => compare(a.recordId, b.recordId) ||
    compare(a.currentPathKey, b.currentPathKey) || compare(a.status, b.status));
  unresolvedAtDestination.sort((a, b) => compare(a.recordId, b.recordId) ||
    compare(a.status, b.status) || Number(b.legacyIdentityMatches) - Number(a.legacyIdentityMatches));
  return { state: "valid", matches, unresolvedAtDestination };
}

/**
 * Ephemeral confirmation guard, not a persisted token or authorization check.
 * The caller must supply a non-reused lease for the active account/workspace,
 * full ordered candidate-batch bytes, and exact full-record snapshots for ALL
 * current Tracker rows in that scope (not the lossy review evidence above).
 * Capture and recheck against authoritative state; commit only in the same
 * atomic boundary as the final check. Never persist or log these snapshots.
 */
export interface ScheduleReviewBindingInput {
  workspaceLease: object;
  candidateBatchSnapshot: string;
  rows: readonly { recordId: string; recordSnapshot: string }[];
}

export interface ScheduleReviewBinding {
  readonly workspaceLease: object;
  readonly candidateBatchSnapshot: string;
  readonly rows: readonly Readonly<{ recordId: string; recordSnapshot: string }>[];
}

export type ScheduleReviewBindingFailure = "invalid-input" | "duplicate-record-id";
export type ScheduleReviewBindingCapture =
  | { state: ScheduleReviewBindingFailure }
  | { state: "captured"; binding: ScheduleReviewBinding };
export type ScheduleReviewBindingCheck =
  | ScheduleReviewBindingFailure | "stale-scope" | "stale-candidates" | "stale-records" | "current";

// Aggregate limits apply to a whole confirmation, not independently to each row.
const MAX_REVIEW_NODES = 100_000;
const MAX_REVIEW_CHARACTERS = 2_000_000;

export function captureScheduleReviewBinding(input: ScheduleReviewBindingInput): ScheduleReviewBindingCapture {
  if (!isRecord(input.workspaceLease) || typeof input.candidateBatchSnapshot !== "string" ||
      input.candidateBatchSnapshot.length > MAX_REVIEW_CHARACTERS ||
      !input.candidateBatchSnapshot.trim() || !Array.isArray(input.rows) || input.rows.length > MAX_REVIEW_NODES) {
    return { state: "invalid-input" };
  }
  let remainingCharacters = MAX_REVIEW_CHARACTERS - input.candidateBatchSnapshot.length;
  const ids = new Set<string>();
  const rows: { recordId: string; recordSnapshot: string }[] = [];
  for (const row of input.rows) {
    if (!row || typeof row.recordId !== "string" || typeof row.recordSnapshot !== "string" ||
        row.recordId.length + row.recordSnapshot.length > remainingCharacters ||
        !row.recordId.trim() || !row.recordSnapshot.trim()) {
      return { state: "invalid-input" };
    }
    if (ids.has(row.recordId)) return { state: "duplicate-record-id" };
    remainingCharacters -= row.recordId.length + row.recordSnapshot.length;
    ids.add(row.recordId);
    rows.push(Object.freeze({ recordId: row.recordId, recordSnapshot: row.recordSnapshot }));
  }
  rows.sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0);
  return { state: "captured", binding: Object.freeze({
    workspaceLease: input.workspaceLease,
    candidateBatchSnapshot: input.candidateBatchSnapshot,
    rows: Object.freeze(rows),
  }) };
}

export function checkScheduleReviewBinding(
  binding: ScheduleReviewBinding,
  current: ScheduleReviewBindingInput,
): ScheduleReviewBindingCheck {
  // Reference identity is deliberate. The caller must renew this lease on
  // logout, account/workspace change, or rehydration, including A -> B -> A.
  if (binding.workspaceLease !== current.workspaceLease) return "stale-scope";
  const result = captureScheduleReviewBinding(current);
  if (result.state !== "captured") return result.state;
  const next = result.binding;
  if (binding.candidateBatchSnapshot !== next.candidateBatchSnapshot) return "stale-candidates";
  if (binding.rows.length !== next.rows.length || binding.rows.some((row, index) =>
    row.recordId !== next.rows[index].recordId || row.recordSnapshot !== next.rows[index].recordSnapshot)) {
    return "stale-records";
  }
  return "current";
}

/**
 * Strict structural snapshot of trusted plain JSON data, not a recovery codec.
 * JSON.stringify alone loses undefined, non-finite numbers, negative zero,
 * sparse slots and custom properties. Refuse these rather than normalizing
 * them. Object property order is irrelevant; array order is significant.
 * Shared acyclic subobjects are equivalent to their expanded JSON tree.
 * Do not call on untrusted executable objects/proxies or log the result.
 * Limits bound traversal and encoded UTF-16 code units; exceeding
 * them means confirmation needs a different authoritative revision mechanism.
 */
export type ScheduleReviewValueDomain = "json" | "tracker-memory-v1";
type ScheduleSnapshotBudget = { nodes: number; characters: number; domain?: ScheduleReviewValueDomain };

function snapshotScalar(value: string | number | boolean | null, budget: ScheduleSnapshotBudget): string | undefined {
  if (typeof value === "string" && value.length > budget.characters) return undefined;
  const encoded = JSON.stringify(value);
  budget.characters -= encoded.length;
  return budget.characters < 0 ? undefined : encoded;
}

function encodeScheduleSnapshot(
  value: unknown, active: WeakSet<object>, budget: ScheduleSnapshotBudget, depth: number, objectProperty = false,
): string | undefined {
  if (--budget.nodes < 0 || depth > 64) return undefined;
  // Admit own optional data properties only in the ephemeral Tracker domain.
  // Bare undefined differs from absence, null and the quoted string.
  if (value === undefined && objectProperty && budget.domain === "tracker-memory-v1") {
    budget.characters -= 9;
    return budget.characters < 0 ? undefined : "undefined";
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return snapshotScalar(value, budget);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0) ? snapshotScalar(value, budget) : undefined;
  }
  if (typeof value !== "object" || active.has(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length > budget.nodes + (array ? 1 : 0)) return undefined;
  const entries = keys.length - (array ? 1 : 0);
  // Charge brackets/braces, separators and object colons before descending.
  budget.characters -= 2 + Math.max(0, entries - 1) + (array ? 0 : entries);
  if (budget.characters < 0) return undefined;
  active.add(value);
  try {
    const parts: string[] = [];
    if (Array.isArray(value)) {
      // Dense ordinary arrays only, with no extra properties or symbols.
      if (keys.length !== value.length + 1) return undefined;
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return undefined;
        const encoded = encodeScheduleSnapshot(descriptor.value, active, budget, depth + 1);
        if (encoded === undefined) return undefined;
        parts.push(encoded);
      }
      return "[" + parts.join(",") + "]";
    }
    const names = keys.filter((key): key is string => typeof key === "string");
    if (names.length !== keys.length) return undefined;
    for (const key of names.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return undefined;
      const name = snapshotScalar(key, budget);
      const encoded = encodeScheduleSnapshot(descriptor.value, active, budget, depth + 1, true);
      if (name === undefined || encoded === undefined) return undefined;
      parts.push(name + ":" + encoded);
    }
    return "{" + parts.join(",") + "}";
  } finally {
    active.delete(value);
  }
}

function snapshotWithBudget(value: unknown, budget: ScheduleSnapshotBudget): string | undefined {
  try {
    return encodeScheduleSnapshot(value, new WeakSet(), budget, 0);
  } catch {
    return undefined;
  }
}

export function snapshotScheduleReviewValue(value: unknown): string | undefined {
  return snapshotWithBudget(value, { nodes: MAX_REVIEW_NODES, characters: MAX_REVIEW_CHARACTERS });
}

/**
 * Preferred value-based adapter for capture and final check. The caller still
 * supplies ALL authoritative records and the ordered batch under its current
 * non-reused workspace lease. This does not supply a transaction/CAS or prove
 * that the records are complete. Unsupported values block confirmation; never
 * remove unknown fields or serialize a projection to make admission succeed.
 */
export interface ScheduleReviewValueInput {
  workspaceLease: object;
  candidateBatch: readonly unknown[];
  rows: readonly { recordId: string; record: unknown }[];
}

function snapshotScheduleReviewInput(input: ScheduleReviewValueInput, domain: ScheduleReviewValueDomain): ScheduleReviewBindingInput | undefined {
  if (!Array.isArray(input.candidateBatch) || !Array.isArray(input.rows)) return undefined;
  if (domain !== "json" && domain !== "tracker-memory-v1") return undefined;
  const prefix = domain === "tracker-memory-v1" ? "tracker-memory-v1:" : "";
  const budget = { nodes: MAX_REVIEW_NODES, characters: MAX_REVIEW_CHARACTERS - prefix.length, domain };
  if (input.rows.length > budget.nodes) return undefined;
  const candidateBatchSnapshot = snapshotWithBudget(input.candidateBatch, budget);
  if (candidateBatchSnapshot === undefined) return undefined;
  const rows: { recordId: string; recordSnapshot: string }[] = [];
  for (const row of input.rows) {
    if (!row || typeof row.recordId !== "string" || --budget.nodes < 0 ||
        row.recordId.length > budget.characters || !row.recordId.trim()) return undefined;
    budget.characters -= row.recordId.length;
    const recordSnapshot = snapshotWithBudget(row.record, budget);
    if (recordSnapshot === undefined) return undefined;
    rows.push({ recordId: row.recordId, recordSnapshot });
  }
  return { workspaceLease: input.workspaceLease, candidateBatchSnapshot: prefix + candidateBatchSnapshot, rows };
}

/** Explicit Tracker domain is ephemeral, not a persistence codec.
 * The caller still needs an authoritative revision, non-reused hydration
 * lease and atomic durable receipt, especially for large workspaces.
 */
export function captureScheduleReviewValueBinding(
  input: ScheduleReviewValueInput, domain: ScheduleReviewValueDomain = "json",
): ScheduleReviewBindingCapture {
  const snapshots = snapshotScheduleReviewInput(input, domain);
  return snapshots ? captureScheduleReviewBinding(snapshots) : { state: "invalid-input" };
}

export function checkScheduleReviewValueBinding(
  binding: ScheduleReviewBinding, current: ScheduleReviewValueInput, domain: ScheduleReviewValueDomain = "json",
): ScheduleReviewBindingCheck {
  if (binding.workspaceLease !== current.workspaceLease) return "stale-scope";
  const snapshots = snapshotScheduleReviewInput(current, domain);
  return snapshots ? checkScheduleReviewBinding(binding, snapshots) : "invalid-input";
}
