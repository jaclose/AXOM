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
