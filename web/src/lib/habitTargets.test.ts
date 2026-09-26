import { describe, expect, it } from "vitest";
import { habitSchedule, habitTargetId, linkHabitToTargets, linkedRequirement, syncHabitTargetLabel, unlinkHabitFromTargets } from "./habitTargets";
import { evaluateDailySuccess } from "./dailySuccess";
import { makeSeed } from "./seed";
import type { Habit } from "./types";

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: "h1", name: "Morning walk", type: "binary", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
  trackingStartsAt: "2026-09-01", ...patch,
});

describe("habit ↔ daily target link", () => {
  it("links idempotently, keeps one requirement per habit, and unlinks without touching others", () => {
    const once = linkHabitToTargets(undefined, habit(), "2026-09-26");
    const twice = linkHabitToTargets(once, habit(), "2026-09-26");
    expect(twice.requirements).toHaveLength(1);
    expect(linkedRequirement(twice, "h1")).toMatchObject({ id: habitTargetId("h1"), source: { kind: "habit", habitId: "h1" }, target: 1, unit: "check-in" });
    const withOther = linkHabitToTargets(twice, habit({ id: "h2", name: "Read", type: "count", target: 20, unit: "pages" }), "2026-09-26");
    expect(linkedRequirement(withOther, "h2")).toMatchObject({ target: 20, unit: "pages" });
    expect(unlinkHabitFromTargets(withOther, "h1")?.requirements.map((item) => item.id)).toEqual([habitTargetId("h2")]);
  });

  it("maps weekly and scheduled habits onto target schedules and follows renames", () => {
    expect(habitSchedule(habit({ type: "weekly", weeklyTarget: 4 }))).toEqual({ kind: "times-per-week", times: 4 });
    expect(habitSchedule(habit({ type: "scheduled", schedule: [1, 3, 5] }))).toEqual({ kind: "weekdays", weekdays: [1, 3, 5] });
    const config = linkHabitToTargets(undefined, habit(), "2026-09-26");
    expect(linkedRequirement(syncHabitTargetLabel(config, habit({ name: "Sunrise walk" })), "h1")?.label).toBe("Sunrise walk");
  });

  it("fills the Productivity target when the habit is checked — one source of truth", () => {
    const state = makeSeed();
    const h = habit();
    state.activeDayKey = "2026-09-26";
    state.habits = [h];
    state.profile.dailySuccess = linkHabitToTargets(undefined, h, "2026-09-26");
    const before = evaluateDailySuccess(state, "2026-09-26", "2026-09-26");
    expect(before.requirements[0].status).not.toBe("met");
    state.habitEntries = [{ id: "e1", habitId: "h1", date: "2026-09-26", status: "done", createdAt: "2026-09-26T09:00:00Z" }];
    const after = evaluateDailySuccess(state, "2026-09-26", "2026-09-26");
    expect(after.requirements[0].status).toBe("met");
  });
});
