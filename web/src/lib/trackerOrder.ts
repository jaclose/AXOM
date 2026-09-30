import type { ProductivityTracker } from "./types";
import { trackerGoal, type TrackerSummary } from "./trackerStats";

/**
 * Share of a build-up goal done so far: today against the daily target, or
 * the week for weekly-only goals. Limits ("at most") and trackers without a
 * goal have none. Not capped, so 140% leads 100%.
 */
export function completedShare(tracker: ProductivityTracker, summary: TrackerSummary): number | null {
  if (trackerGoal(tracker) !== "at-least") return null;
  if (tracker.dailyTarget && tracker.dailyTarget > 0) return summary.today / tracker.dailyTarget;
  return summary.weeklyProgress === null ? null : summary.weeklyProgress / 100;
}

/**
 * How the tracker board reads once it settles (useSettledOrder keeps it still
 * while you are tapping). JD: "after 10 seconds of not touching those buttons
 * it will move up based on how much has been completed." The most-complete
 * goal leads; trackers without a share follow, most-used first. Negative =
 * `a` first.
 */
export function compareTrackersForBoard(
  a: ProductivityTracker, b: ProductivityTracker,
  summaryA: TrackerSummary, summaryB: TrackerSummary,
): number {
  const shareA = completedShare(a, summaryA);
  const shareB = completedShare(b, summaryB);
  if (shareA !== null && shareB !== null && shareA !== shareB) return shareB - shareA;
  if (shareA !== null && shareB === null) return -1;
  if (shareA === null && shareB !== null) return 1;
  return (summaryB.activeDays30 - summaryA.activeDays30) || a.name.localeCompare(b.name);
}
