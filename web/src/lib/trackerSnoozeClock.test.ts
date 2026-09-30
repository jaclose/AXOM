import { beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { rankTrackerItems } from "./recommendationFactors";

beforeEach(() => {
  const seed = makeSeed();
  // Items last studied a while ago, so any accidental re-stamp shows up.
  seed.tracker = seed.tracker.map((row) => ({ ...row, updated: "2026-09-01T12:00:00.000Z" }));
  useStore.setState(seed);
});

describe("resting a suggestion (I3-27)", () => {
  it("leaves the item's study clock alone, so Undo restores the exact order", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const before = rankTrackerItems(useStore.getState().tracker, { now }).map((row) => row.item.id);
    const item = useStore.getState().tracker.find((row) => row.id === before[0])!;
    useStore.getState().updateTrackerItem(item.id, { recommendationSnoozedUntil: "2026-10-01T08:00:00.000Z" });
    expect(useStore.getState().tracker.find((row) => row.id === item.id)!.updated).toBe(item.updated);
    expect(rankTrackerItems(useStore.getState().tracker, { now }).map((row) => row.item.id)).not.toContain(item.id);
    useStore.getState().updateTrackerItem(item.id, { recommendationSnoozedUntil: undefined });
    expect(rankTrackerItems(useStore.getState().tracker, { now }).map((row) => row.item.id)).toEqual(before);
  });

  it("still stamps real study changes", () => {
    const item = useStore.getState().tracker[0];
    useStore.getState().updateTrackerItem(item.id, { passes: item.passes + 1 });
    expect(useStore.getState().tracker[0].updated).not.toBe(item.updated);
  });
});
