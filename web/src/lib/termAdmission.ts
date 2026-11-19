import type { Term, TrackerItem } from "./types";
import type { PrimaryTrackerScope } from "./trackerFocus";
import { trackerPathKey } from "./pathUtils";

export type TermAdmission =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/**
 * Admit a new Course Tracker term only when its normalized path root has a
 * unique owner. Historical rows and pinned focus scopes store labels rather
 * than immutable term IDs; adding another matching label would reinterpret
 * attendance and quiz/progress ownership without changing the stored bytes.
 *
 * This is deliberately non-destructive. Existing imported collisions are
 * review-held, never cleaned up or silently claimed by a new term.
 */
export function planTermAdmission(
  terms: readonly Term[],
  tracker: readonly TrackerItem[],
  primaryTrackerScopes: readonly PrimaryTrackerScope[] | undefined,
  requestedName: string,
): TermAdmission {
  if (typeof requestedName !== "string" || requestedName.includes("/") || requestedName.includes("\\")) {
    return { ok: false, reason: "Use a term name without path separators." };
  }
  const name = requestedName.trim().replace(/\s+/g, " ");
  const key = trackerPathKey(name);
  if (!key) return { ok: false, reason: "Enter a term name." };

  const overlaps = (existing: string): boolean => {
    const other = trackerPathKey(existing);
    return other === key || other.startsWith(`${key}/`) || key.startsWith(`${other}/`);
  };

  if (terms.some((term) => overlaps(term.name))) {
    return { ok: false, reason: "Another term already owns this name or an overlapping tracker root. Resolve the existing term first." };
  }

  // A missing course/term owner does not make saved tracker rows expendable.
  // This includes rows imported before a term shell existed, and irregular
  // historical paths whose leading slash is normalized away at hydration.
  const belongsToRoot = (path: string): boolean => {
    const normalized = trackerPathKey(path);
    return normalized === key || normalized.startsWith(`${key}/`);
  };
  if (tracker.some((item) => belongsToRoot(item.path))
    || (primaryTrackerScopes ?? []).some((scope) => belongsToRoot(scope.path))) {
    return { ok: false, reason: "Existing Course Tracker activity or pinned study focus already uses this term name. Review its ownership before adding a term." };
  }

  return { ok: true, name };
}
