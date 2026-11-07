import { describe, expect, it } from "vitest";
import type { Habit, HabitEntry } from "./types";
import { namedSlotProgress, weeklyHabitSummary } from "./goalCadence";

const weekly: Habit = {
  id: "gym", name: "Gym", type: "weekly",
  weeklyTarget: 4, weeklyMinimum: 4, weeklyPreferred: 5,
  includeInReports: true, trackingStartsAt: "2026-10-26",
  createdAt: "2026-10-26T12:00:00.000Z", updatedAt: "2026-10-26T12:00:00.000Z",
};
const entry = (date: string, status: HabitEntry["status"] = "done"): HabitEntry => ({
  id: `gym-${date}`, habitId: weekly.id, date, status, createdAt: `${date}T12:00:00.000Z`,
});

describe("canonical flexible-weekly goal projection", () => {
  it("counts distinct completed training days, meeting the minimum before the preferred goal", () => {
    const checkIns = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-07"].map(day => entry(day));
    const result = weeklyHabitSummary(weekly, checkIns, "2026-11-07");
    expect(result).toMatchObject({
      weekStart: "2026-11-02", weekEnd: "2026-11-08",
      completedDays: 4, minimum: 4, preferred: 5,
      metMinimum: true, metPreferred: false, remainingMinimum: 0, remainingPreferred: 1,
    });
    expect(result.sourceEntryIds).toHaveLength(4);
  });

  it("keeps a rest day unpenalized, deduplicates duplicate same-day identities, and never counts a skipped event", () => {
    const entries = [
      entry("2026-11-02"),
      entry("2026-11-02"),
      entry("2026-11-04"),
      entry("2026-11-06"),
      entry("2026-11-07", "skipped"),
    ];
    const result = weeklyHabitSummary(weekly, entries, "2026-11-07");
    expect(result.completedDays).toBe(3);
    expect(result.metMinimum).toBe(false);
    expect(result.remainingMinimum).toBe(1);
    expect(result.sourceEntryIds).toHaveLength(3);
  });

  it("counts a same-day tracker event and explicit habit check-in as one training day", () => {
    const gym = { ...weekly, linkedTrackerId: "tracker-gym" };
    const result = weeklyHabitSummary(gym, [entry("2026-11-04")], "2026-11-07", [
      { id: "gym-tracker-log", dayKey: "2026-11-04", ts: "2026-11-04T18:00:00.000Z",
        type: "Gym", minutes: 45, cards: 0, trackerId: "tracker-gym", academic: false },
      { id: "gym-tracker-day2", dayKey: "2026-11-05", ts: "2026-11-05T18:00:00.000Z",
        type: "Gym", minutes: 30, cards: 0, trackerId: "tracker-gym", academic: false },
    ]);
    expect(result.completedDays).toBe(2);
    expect(result.sourceEntryIds).toContain("gym-tracker-day2");
    expect(result.sourceEntryIds).toContain("gym-2026-11-04");
  });

  it("uses effective-week revisions so editing a goal cannot rescore completed weeks", () => {
    const changed = {
      ...weekly, weeklyMinimum: 3, weeklyPreferred: 4,
      weeklyRevisions: [
        { effectiveWeek: "2026-10-26", minimum: 4, preferred: 5 },
        { effectiveWeek: "2026-11-02", minimum: 3, preferred: 4 },
      ],
    };
    const checkIns = [
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
      "2026-11-02", "2026-11-03", "2026-11-04",
    ].map((day) => entry(day));
    const previous = weeklyHabitSummary(changed, checkIns, "2026-11-01");
    expect(previous).toMatchObject({ completedDays: 4, minimum: 4, preferred: 5, metMinimum: true });
    const current = weeklyHabitSummary(changed, checkIns, "2026-11-07");
    expect(current).toMatchObject({ completedDays: 3, minimum: 3, preferred: 4, metMinimum: true });
  });

  it("uses the local civil date for creation timestamps near midnight", () => {
    const nearMidnight = new Date(2026, 10, 1, 23, 30).toISOString();
    const fresh = { ...weekly, trackingStartsAt: undefined, createdAt: nearMidnight };
    const result = weeklyHabitSummary(fresh, [entry("2026-11-01")], "2026-11-01");
    expect(result).toMatchObject({ completedDays: 1, minimum: 1, metMinimum: true, isPartialFirstWeek: true });
  });

  it("does not hold the user responsible for sessions before a weekly habit was created", () => {
    const fresh = { ...weekly, trackingStartsAt: "2026-11-07", createdAt: "2026-11-07T08:00:00.000Z" };
    const result = weeklyHabitSummary(fresh, [entry("2026-11-07")], "2026-11-07");
    expect(result.completedDays).toBe(1);
    expect(result.minimum).toBeLessThanOrEqual(2);
    expect(result.metPreferred).toBe(false);
  });
});

describe("named daily occurrences", () => {
  const prayer: Habit = {
    id: "prayer", name: "Daily prayers", type: "slots",
    occurrenceSlots: [
      { id: "fajr", label: "Fajr" }, { id: "dhuhr", label: "Dhuhr" },
      { id: "asr", label: "Asr" }, { id: "maghrib", label: "Maghrib" }, { id: "isha", label: "Isha" },
    ],
    includeInReports: false,
    createdAt: "2026-11-01T12:00:00.000Z", updatedAt: "2026-11-01T12:00:00.000Z",
  };

  it("identifies the five named occurrences independently and leaves unreported slots unknown", () => {
    const progress = namedSlotProgress(prayer, {
      id: "day1", habitId: prayer.id, date: "2026-11-07",
      status: "partial", value: 3, createdAt: "2026-11-07T12:00:00.000Z",
      slotCheckIns: [
        { id: "fajr-event", slotId: "fajr", status: "done", at: "2026-11-07T07:00:00.000Z" },
        { id: "dhuhr-event", slotId: "dhuhr", status: "done", at: "2026-11-07T13:00:00.000Z" },
        { id: "asr-event", slotId: "asr", status: "done", at: "2026-11-07T17:00:00.000Z" },
      ],
    });
    expect(progress).toMatchObject({ completed: 3, total: 5, unreported: 2 });
    expect(progress.slots.map(slot => slot.status)).toEqual(["done","done","done","unreported","unreported"]);
  });

  it("never allows a repeated or unknown slot identity to inflate the count", () => {
    const progress = namedSlotProgress(prayer, {
      id: "day2", habitId: prayer.id, date: "2026-11-07", status: "partial", createdAt: "2026-11-07T12:00:00.000Z",
      slotCheckIns: [
        { id: "fajr-v1", slotId: "fajr", status: "done", at: "2026-11-07T07:00:00.000Z" },
        { id: "fajr-v2", slotId: "fajr", status: "done", at: "2026-11-07T07:01:00.000Z" },
        { id: "unknown", slotId: "other", status: "done", at: "2026-11-07T08:00:00.000Z" },
      ],
    });
    expect(progress.completed).toBe(1);
  });
});
