import { describe, it, expect } from "vitest";
import type { Habit, HabitEntry, HabitCheckStatus, HabitType } from "./types";
import {
  isScheduledDay,
  entryFor,
  statusOn,
  currentStreak,
  weekStats,
  heatmapCells,
  recoveryMessage,
  trackingStartKey,
  newHabitDefaults,
  HABIT_TYPE_META,
} from "./habits";
import { addLocalDays } from "./dailyRollover";

/** A local-time ISO timestamp (round-trips to the given local calendar day
 * regardless of the test runner's timezone). */
function localIso(y: number, m: number, d: number, hh = 12, mm = 0): string {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const TODAY = "2026-06-25"; // Thursday (getDay === 4)

function habit(partial: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Test habit",
    type: "binary",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

let ec = 0;
function entry(date: string, status: HabitCheckStatus, habitId = "h1"): HabitEntry {
  return { id: `e${ec++}`, habitId, date, status, createdAt: "" };
}

/** Build a run of statuses ending on `end` going backwards. */
function chain(end: string, statuses: HabitCheckStatus[]): HabitEntry[] {
  return statuses.map((status, i) => entry(addLocalDays(end, -i), status));
}

describe("metadata + scheduling", () => {
  it("exposes meta for every habit type", () => {
    (Object.keys(HABIT_TYPE_META) as HabitType[]).forEach((t) => {
      expect(HABIT_TYPE_META[t].label).toBeTruthy();
    });
  });
  it("treats every day as scheduled unless a schedule is set", () => {
    expect(isScheduledDay(habit(), TODAY)).toBe(true);
  });
  it("respects a weekday schedule", () => {
    const h = habit({ type: "scheduled", schedule: [4] }); // Thursdays only
    expect(isScheduledDay(h, TODAY)).toBe(true); // 2026-06-25 is Thu
    expect(isScheduledDay(h, "2026-06-26")).toBe(false); // Fri
  });
});

describe("entryFor / statusOn", () => {
  const entries = [entry(TODAY, "done"), entry("2026-06-24", "missed")];
  it("finds the entry for a date", () => {
    expect(entryFor(entries, "h1", TODAY)?.status).toBe("done");
  });
  it("returns none when no entry exists", () => {
    expect(statusOn(habit(), entries, "2026-06-20")).toBe("none");
  });
});

describe("flexible weekly habit semantics", () => {
  it("counts completed weeks, not consecutive weekdays, for a gym four-days-per-week habit", () => {
    const gym = habit({type:"weekly",weeklyTarget:4,trackingStartsAt:"2026-06-08"});
    const entries = ["2026-06-15","2026-06-17","2026-06-19","2026-06-20"].map(date=>entry(date,"done"));
    expect(currentStreak(gym,entries,"2026-06-25")).toBe(1);
    const dates=Array.from({length:7},(_,i)=>addLocalDays("2026-06-21",-i));
    expect(weekStats(gym,entries,dates).adherence).toBe(100);
  });
});

describe("currentStreak", () => {
  it("counts a consecutive done chain", () => {
    expect(currentStreak(habit(), chain(TODAY, ["done", "done", "done"]), TODAY)).toBe(3);
  });
  it("does not break when today is still unlogged", () => {
    // today empty, prior 3 days done
    const entries = chain("2026-06-24", ["done", "done", "done"]);
    expect(currentStreak(habit(), entries, TODAY)).toBe(3);
  });
  it("breaks on an explicit miss", () => {
    expect(currentStreak(habit(), chain(TODAY, ["done", "done", "missed", "done"]), TODAY)).toBe(2);
  });
  it("holds (but does not increment) through an intentional skip", () => {
    expect(currentStreak(habit(), chain(TODAY, ["done", "skipped", "done", "done"]), TODAY)).toBe(3);
  });
  it("counts a partial toward the streak", () => {
    expect(currentStreak(habit(), chain(TODAY, ["partial", "done"]), TODAY)).toBe(2);
  });
  it("breaks on an unlogged past scheduled day", () => {
    // today done, yesterday done, then a gap (nothing logged) two days back
    const entries = [entry(TODAY, "done"), entry("2026-06-24", "done")];
    expect(currentStreak(habit(), entries, TODAY)).toBe(2);
  });
  it("never breaks for a recovery habit", () => {
    const h = habit({ type: "recovery" });
    expect(currentStreak(h, chain(TODAY, ["done", "missed", "done"]), TODAY)).toBe(2);
  });
});

describe("weekStats", () => {
  it("computes adherence with partial at half and skips excluded", () => {
    const dates = Array.from({ length: 7 }, (_, i) => addLocalDays(TODAY, -i));
    const entries = [
      entry(dates[0], "done"),
      entry(dates[1], "done"),
      entry(dates[2], "partial"),
      entry(dates[3], "skipped"),
      entry(dates[4], "missed"),
      entry(dates[5], "done"),
      entry(dates[6], "done"),
    ];
    const stats = weekStats(habit(), entries, dates);
    expect(stats.done).toBe(4);
    expect(stats.partial).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.missed).toBe(1);
    expect(stats.scheduledDays).toBe(7);
    // (4 + 0.5) / (7 - 1 skipped) = 4.5/6 = 75%
    expect(stats.adherence).toBe(75);
  });
});

describe("heatmapCells", () => {
  it("returns the requested number of cells ending today", () => {
    const cells = heatmapCells(habit(), [entry(TODAY, "done")], 35, TODAY);
    expect(cells).toHaveLength(35);
    expect(cells[cells.length - 1].date).toBe(TODAY);
    expect(cells[cells.length - 1].intensity).toBe(1);
    expect(cells[0].intensity).toBe(0);
  });
});

describe("recoveryMessage", () => {
  it("is gentle and non-punitive after a miss", () => {
    const entries = [entry(addLocalDays(TODAY, -1), "missed")];
    expect(recoveryMessage(habit(), entries, TODAY).toLowerCase()).toContain("restart");
  });
  it("acknowledges a long streak without grinding language", () => {
    const entries = chain(TODAY, Array(10).fill("done"));
    expect(recoveryMessage(habit(), entries, TODAY).toLowerCase()).toContain("steady");
  });
  it("honors exam mode", () => {
    expect(recoveryMessage(habit({ examMode: true }), [], TODAY).toLowerCase()).toContain("exam mode");
  });
});

describe("newHabitDefaults", () => {
  it("sets a target only for target-based types", () => {
    expect(newHabitDefaults("Read", "binary").target).toBeUndefined();
    expect(newHabitDefaults("Study", "duration").target).toBe(20);
    expect(newHabitDefaults("Pushups", "count").unit).toBe("reps");
    expect(newHabitDefaults("Gym", "weekly").weeklyTarget).toBe(3);
  });
});

describe("first-day / tracking-start correctness", () => {
  it("derives the tracking start from createdAt's LOCAL calendar day", () => {
    const created = habit({ createdAt: localIso(2026, 6, 25, 9, 0) });
    expect(trackingStartKey(created, [], TODAY)).toBe("2026-06-25");
  });

  it("prefers an explicit trackingStartsAt (bare date key honored verbatim)", () => {
    const h = habit({ trackingStartsAt: "2026-06-22", createdAt: localIso(2026, 6, 25) });
    expect(trackingStartKey(h, [], TODAY)).toBe("2026-06-22");
  });

  it("falls back to the earliest log, then today, for a malformed legacy createdAt", () => {
    const legacy = habit({ createdAt: "" });
    expect(trackingStartKey(legacy, [entry("2026-06-23", "done")], TODAY)).toBe("2026-06-23");
    expect(trackingStartKey(habit({ createdAt: "not-a-date" }), [], TODAY)).toBe(TODAY);
  });

  it("does not say 'missed yesterday' for a habit created today", () => {
    const created = habit({ createdAt: localIso(2026, 6, 25, 9, 0) });
    const message = recoveryMessage(created, [], TODAY).toLowerCase();
    expect(message).toContain("fresh start");
    expect(message).not.toContain("missed");
    expect(currentStreak(created, [], TODAY)).toBe(0);
  });

  it("does not penalize a habit created late at night for the prior day", () => {
    // created 2026-06-24 at 11:50 PM local; evaluated the next day.
    const created = habit({ createdAt: localIso(2026, 6, 24, 23, 50) });
    expect(trackingStartKey(created, [], TODAY)).toBe("2026-06-24");
    expect(recoveryMessage(created, [], TODAY).toLowerCase()).toContain("fresh start");
    // The unlogged creation day is a grace day, so the chain is not broken to -1.
    expect(currentStreak(created, [], TODAY)).toBe(0);
  });

  it("begins tracking on the new local day for a just-after-midnight creation", () => {
    const created = habit({ createdAt: localIso(2026, 6, 25, 0, 10) });
    expect(trackingStartKey(created, [], TODAY)).toBe("2026-06-25");
    expect(recoveryMessage(created, [], TODAY).toLowerCase()).toContain("fresh start");
  });

  it("credits the first completion with no historical penalty", () => {
    const created = habit({ createdAt: localIso(2026, 6, 25, 9, 0) });
    const entries = [entry(TODAY, "done")];
    expect(currentStreak(created, entries, TODAY)).toBe(1);
    const week = weekStats(created, entries, Array.from({ length: 7 }, (_, i) => addLocalDays(TODAY, -i)));
    // Only the creation day is in range: one scheduled day, done → 100% adherence.
    expect(week.scheduledDays).toBe(1);
    expect(week.adherence).toBe(100);
    expect(week.missed).toBe(0);
  });

  it("evaluates only post-creation scheduled days after several absent days", () => {
    const created = habit({ createdAt: localIso(2026, 6, 20, 9, 0) });
    // No logs since creation; today is 2026-06-25.
    expect(currentStreak(created, [], TODAY)).toBe(0);
    // Yesterday (06-24) is a genuine post-creation miss.
    expect(recoveryMessage(created, [], TODAY).toLowerCase()).toContain("missed");
    const week = weekStats(created, [], Array.from({ length: 7 }, (_, i) => addLocalDays(TODAY, -i)));
    // 06-19 precedes creation and is excluded; 06-20..06-25 count (6 days).
    expect(week.scheduledDays).toBe(6);
  });

  it("excludes pre-creation days from the weekday-scheduled adherence window", () => {
    // Thursdays only, created this past Monday (2026-06-22).
    const created = habit({ type: "scheduled", schedule: [4], createdAt: localIso(2026, 6, 22, 9, 0) });
    const dates = Array.from({ length: 14 }, (_, i) => addLocalDays(TODAY, -i));
    const week = weekStats(created, [entry(TODAY, "done")], dates);
    // Only 2026-06-25 (Thu, ≥ creation) is a scheduled evaluable day in range.
    expect(week.scheduledDays).toBe(1);
    expect(week.done).toBe(1);
  });

  it("renders pre-creation heatmap cells as inert, never missed", () => {
    const created = habit({ createdAt: localIso(2026, 6, 24, 9, 0) });
    const cells = heatmapCells(created, [entry(TODAY, "done")], 35, TODAY);
    const beforeCreation = cells.filter((c) => c.date < "2026-06-24");
    expect(beforeCreation.every((c) => c.status === "none" && !c.scheduled && c.intensity === 0)).toBe(true);
    expect(cells[cells.length - 1].intensity).toBe(1);
  });

  it("still breaks the chain on an explicit miss on the creation day", () => {
    const created = habit({ createdAt: localIso(2026, 6, 24, 9, 0) });
    // Explicitly marked missed on the creation day → a real signal.
    expect(recoveryMessage(created, [entry("2026-06-24", "missed")], TODAY).toLowerCase()).toContain("missed");
  });
});
