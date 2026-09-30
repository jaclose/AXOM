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
  // Most-used first so the board reflects what you actually track.
  return (summaryB.activeDays30 - summaryA.activeDays30) || a.name.localeCompare(b.name);
}
