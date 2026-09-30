import { describe, expect, it } from "vitest";
import { compareTrackersForBoard, completedShare } from "./trackerOrder";
import type { TrackerSummary } from "./trackerStats";
import type { ProductivityTracker } from "./types";

const tracker = (name: string, patch: Partial<ProductivityTracker> = {}) => ({ id: name, name, unitType: "minutes", goal: "at-least", ...patch }) as ProductivityTracker;
const summary = (patch: Partial<TrackerSummary> = {}) => ({ today: 0, week: 0, weeklyProgress: null, activeDays30: 0, ...patch }) as TrackerSummary;

function order(rows: Array<[ProductivityTracker, TrackerSummary]>) {
  const byId = new Map(rows.map(([t, s]) => [t.id, s]));
  return rows.map(([t]) => t).sort((a, b) => compareTrackersForBoard(a, b, byId.get(a.id)!, byId.get(b.id)!)).map((t) => t.name);
}

describe("tracker board order", () => {
  it("puts the most-completed goal first, past 100% included", () => {
    expect(order([
      [tracker("Study", { dailyTarget: 240 }), summary({ today: 120 })],
      [tracker("Gym", { dailyTarget: 45 }), summary({ today: 63 })],
      [tracker("Questions", { dailyTarget: 40 }), summary({ today: 40 })],
    ])).toEqual(["Gym", "Questions", "Study"]);
  });

  it("reads weekly-only goals by the week, and keeps limits and goal-less trackers after, most-used first", () => {
    expect(completedShare(tracker("Run"), summary({ weeklyProgress: 50 }))).toBe(0.5);
    expect(completedShare(tracker("Screen time", { goal: "at-most", dailyTarget: 60 }), summary({ today: 30 }))).toBeNull();
    expect(order([
      [tracker("Screen time", { goal: "at-most", dailyTarget: 60 }), summary({ today: 30, activeDays30: 20 })],
      [tracker("Journal"), summary({ activeDays30: 25 })],
      [tracker("Run"), summary({ weeklyProgress: 50 })],
      [tracker("Study", { dailyTarget: 240 }), summary({ today: 60 })],
    ])).toEqual(["Run", "Study", "Journal", "Screen time"]);
  });

  it("breaks ties by use, then name", () => {
    expect(order([
      [tracker("B", { dailyTarget: 10 }), summary({ today: 5, activeDays30: 3 })],
      [tracker("A", { dailyTarget: 10 }), summary({ today: 5, activeDays30: 3 })],
      [tracker("C", { dailyTarget: 10 }), summary({ today: 5, activeDays30: 9 })],
    ])).toEqual(["C", "A", "B"]);
  });
});
