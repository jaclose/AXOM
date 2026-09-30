// ===========================================================================
// Productivity trackers: what each one adds up to.
//
// A tracker is a named variable ("Exercise", "Reading", "Social media")
// with a unit, an optional daily/weekly goal and a direction: build it up
// ("at least") or keep it under a limit ("at most", the Streaks/Habitify
// "negative habit"). Everything here is derived from the study log, so a
// tracker never keeps a second copy of the truth.
// ===========================================================================
import { addLocalDays } from "./dailyRollover";
import type { HabitCheckStatus, HabitType, ProductivityTracker, StudyLog } from "./types";

export type TrackerGoal = "at-least" | "at-most";

export function trackerGoal(tracker: Pick<ProductivityTracker, "goal">): TrackerGoal {
  return tracker.goal === "at-most" ? "at-most" : "at-least";
}

/** How much one log adds to its tracker, in the tracker's own unit. */
export function trackerLogValue(log: StudyLog, tracker: Pick<ProductivityTracker, "unitType">): number {
  if (tracker.unitType === "minutes") return Number.isFinite(log.minutes) ? log.minutes : 0;
  const quantity = Number(log.quantity);
  if (log.quantity != null && Number.isFinite(quantity)) return quantity;
  if (tracker.unitType === "yesno") return 1;
  return (Number.isFinite(log.cards) ? log.cards : 0) || (log.minutes ? 0 : 1);
}

/** Totals per local day for one tracker. Yes/no trackers cap at 1 per day. */
export function trackerDayTotals(tracker: ProductivityTracker, logs: readonly StudyLog[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const log of logs) {
    if (log.trackerId !== tracker.id) continue;
    totals.set(log.dayKey, (totals.get(log.dayKey) ?? 0) + trackerLogValue(log, tracker));
  }
  // Clamp after summing so a correction has the same effect in either log order.
  for (const [day, value] of totals) totals.set(day, tracker.unitType === "yesno" ? (value > 0 ? 1 : 0) : Math.max(0, value));
  return totals;
}

/**
 * Did this day meet the goal? `null` means there is nothing to judge (no
 * goal and no activity). A limit tracker with no entries on a day it
 * existed counts as kept.
 */
export function dayMet(tracker: ProductivityTracker, value: number): boolean | null {
  const target = tracker.dailyTarget && tracker.dailyTarget > 0 ? tracker.dailyTarget : undefined;
  if (trackerGoal(tracker) === "at-most") return value <= (target ?? 0);
  if (target !== undefined) return value >= target;
  return value > 0 ? true : null;
}

export interface TrackerSummary {
  goal: TrackerGoal;
  today: number;
  /** Last 7 local days including today. */
  week: number;
  previousWeek: number;
  todayMet: boolean | null;
  /** Consecutive days meeting the goal, ending today (if already met) or yesterday. */
  streak: number;
  bestStreak: number;
  /** Oldest → newest, one value per day. */
  last14: Array<{ day: string; value: number; met: boolean | null }>;
  /** Oldest → newest, one total per 7-day window. */
  last8Weeks: number[];
  activeDays30: number;
  weeklyProgress: number | null;
}

export function summarizeTracker(tracker: ProductivityTracker, logs: readonly StudyLog[], today: string): TrackerSummary {
  const totals = trackerDayTotals(tracker, logs);
  const goal = trackerGoal(tracker);
  const since = tracker.createdAt ? localDay(tracker.createdAt) : undefined;
  const value = (day: string) => totals.get(day) ?? 0;
  const judged = (day: string) => (since && day < since && !totals.has(day) ? null : dayMet(tracker, value(day)));
  const sumRange = (endOffset: number, days: number) => {
    let sum = 0;
    for (let offset = endOffset - days + 1; offset <= endOffset; offset++) sum += value(addLocalDays(today, offset));
    return sum;
  };

  // Streaks: a limit only counts completed days; a build-up goal can count today once met.
  const todayMet = judged(today);
  let streak = 0;
  if (goal === "at-least" && todayMet) streak = 1;
  for (let offset = -1; offset > -400; offset--) {
    const met = judged(addLocalDays(today, offset));
    if (!met) break;
    streak += 1;
  }
  let bestStreak = streak;
  let run = 0;
  const firstDay = [...totals.keys()].sort()[0] ?? since ?? today;
  for (let day = firstDay; day <= today; day = addLocalDays(day, 1)) {
    if (day === today && goal === "at-most") break;
    run = judged(day) ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }

  const weeklyTarget = tracker.weeklyTarget && tracker.weeklyTarget > 0 ? tracker.weeklyTarget : undefined;
  const week = sumRange(0, 7);
  let activeDays30 = 0;
  for (let offset = -29; offset <= 0; offset++) if (value(addLocalDays(today, offset)) > 0) activeDays30 += 1;
  return {
    goal,
    today: value(today),
    week,
    previousWeek: sumRange(-7, 7),
    todayMet,
    streak,
    bestStreak,
    last14: Array.from({ length: 14 }, (_, index) => {
      const day = addLocalDays(today, index - 13);
      return { day, value: value(day), met: judged(day) };
    }),
    last8Weeks: Array.from({ length: 8 }, (_, index) => sumRange(-7 * (7 - index), 7)),
    activeDays30,
    weeklyProgress: weeklyTarget ? Math.round((week / weeklyTarget) * 100) : null,
  };
}

export function trackerUnitLabel(tracker: Pick<ProductivityTracker, "unitType" | "customUnit">, value = 2): string {
  switch (tracker.unitType) {
    case "minutes": return "min";
    case "yesno": return value === 1 ? "day" : "days";
    case "distance": return "km";
    case "custom": return tracker.customUnit?.trim() || "units";
    default: return value === 1 ? "time" : "times";
  }
}

export function formatTrackerValue(tracker: Pick<ProductivityTracker, "unitType" | "customUnit">, value: number): string {
  if (tracker.unitType === "minutes" && value >= 90) {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${trackerUnitLabel(tracker, rounded)}`;
}

/** One-tap increments that make sense for the unit. */
export function quickIncrements(tracker: Pick<ProductivityTracker, "unitType" | "dailyTarget">): number[] {
  switch (tracker.unitType) {
    case "minutes": return [15, 30];
    case "yesno": return [1];
    case "distance": return [1, 5];
    default: {
      const target = tracker.dailyTarget ?? 0;
      return target >= 20 ? [5, 10] : [1, 5];
    }
  }
}

// --- Habit link -----------------------------------------------------------

export function habitTypeForTracker(tracker: Pick<ProductivityTracker, "unitType" | "goal">): HabitType {
  if (trackerGoal(tracker) === "at-most") return "avoidance";
  if (tracker.unitType === "minutes") return "duration";
  if (tracker.unitType === "yesno") return "binary";
  return "count";
}

/**
 * The habit check a tracker's day implies. Returns `null` when the day
 * should carry no automatic check (nothing logged toward a build-up goal).
 */
export function habitCheckForDay(tracker: ProductivityTracker, dayTotal: number): { status: HabitCheckStatus; value?: number } | null {
  const target = tracker.dailyTarget && tracker.dailyTarget > 0 ? tracker.dailyTarget : undefined;
  if (trackerGoal(tracker) === "at-most") {
    return { status: dayTotal <= (target ?? 0) ? "done" : "missed", value: dayTotal };
  }
  if (dayTotal <= 0) return null;
  if (target === undefined || dayTotal >= target) return { status: "done", value: dayTotal };
  return { status: "partial", value: dayTotal };
}

function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
