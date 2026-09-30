import type { ProductivityTracker } from "./types";
import type { TrackerSummary } from "./trackerStats";

/**
 * How the tracker board reads once it settles (useSettledOrder keeps it still
 * while you are tapping). Negative = `a` first.
 */
export function compareTrackersForBoard(
  a: ProductivityTracker, b: ProductivityTracker,
  summaryA: TrackerSummary, summaryB: TrackerSummary,
): number {
  // TODO(human): decide how the settled board reads (replace the line below).
  // Available: summary.todayMet (true / false / null = no goal today),
  // summary.today vs summary.goal, summary.weeklyProgress (0-1+, null if no
  // weekly target), summary.streak, summary.activeDays30, a.name.
  // Your Ideas 3 note: "it will move up based on how much has been completed".
  // Most-used first so the board reflects what you actually track.
  return (summaryB.activeDays30 - summaryA.activeDays30) || a.name.localeCompare(b.name);
}
