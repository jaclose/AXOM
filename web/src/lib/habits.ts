// ===========================================================================
// Habit logic (directive §6). Pure, deterministic, and deliberately calm:
// streaks survive intentional skips and non-scheduled days, "missed" is the only
// thing that breaks a chain, and recovery habits never break at all. No
// shame-heavy mechanics — a miss returns a gentle restart message, not a scolding.
// ===========================================================================
import type { Habit, HabitEntry, HabitCheckStatus, HabitType } from "./types";
import { isoDate } from "./scoring";
import { addLocalDays, localDateKey } from "./dailyRollover";
import { namedSlotProgress, weeklyHabitSummary, weekStartKey } from "./goalCadence";
import type { StudyLog } from "./types";

export const HABIT_TYPE_META: Record<HabitType, { label: string; hint: string; needsTarget: boolean }> = {
  binary: { label: "Yes / No", hint: "Did it or didn't.", needsTarget: false },
  duration: { label: "Duration", hint: "Minutes toward a daily target.", needsTarget: true },
  count: { label: "Count", hint: "Reps/units toward a daily target.", needsTarget: true },
  avoidance: { label: "Avoidance", hint: "Success = you avoided it today.", needsTarget: false },
  weekly: { label: "Flexible weekly", hint: "A minimum and preferred number of distinct days, with rest days.", needsTarget: false },
  slots: { label: "Named daily", hint: "Mark individually named occurrences. Unreported is not a failure.", needsTarget: false },
  scheduled: { label: "Scheduled days", hint: "Specific weekdays only.", needsTarget: false },
  recovery: { label: "Recovery", hint: "Gentle restart — never punishes a miss.", needsTarget: false },
  milestone: { label: "Milestone", hint: "A cumulative one-time goal.", needsTarget: true },
};

export const STATUS_META: Record<HabitCheckStatus, { label: string; tone: "green" | "cyan" | "neutral" | "orange" }> = {
  done: { label: "Done", tone: "green" },
  partial: { label: "Partial", tone: "cyan" },
  skipped: { label: "Skipped", tone: "neutral" },
  missed: { label: "Missed", tone: "orange" },
};

/** Is this habit expected on the given local date? (scheduled habits only fire on their weekdays) */
export function isScheduledDay(habit: Habit, date: string): boolean {
  if (habit.type !== "scheduled" || !habit.schedule?.length) return true;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return habit.schedule.includes(weekday);
}

/**
 * Normalize a stored date/timestamp to a LOCAL calendar-date key (YYYY-MM-DD).
 * A bare date key is trusted verbatim (it was authored in local time); a full
 * ISO timestamp is converted to the viewer's local day so a habit created at
 * 12:10 AM begins tracking on the new local date, not the UTC one. Malformed
 * input returns undefined.
 */
function toLocalDateKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : localDateKey(parsed);
}

/**
 * The local day a habit starts being evaluated. A habit can never be "missed"
 * for a day before it existed. Resolution order (smallest safe model):
 *   1. explicit habit.trackingStartsAt
 *   2. the local calendar date of createdAt
 *   3. the earliest recorded log for this habit
 *   4. today (malformed legacy record — never penalize the past)
 */
export function trackingStartKey(habit: Habit, entries: HabitEntry[], today: string = localDateKey()): string {
  const explicit = toLocalDateKey(habit.trackingStartsAt);
  if (explicit) return explicit;
  const created = toLocalDateKey(habit.createdAt);
  if (created) return created;
  let earliest: string | undefined;
  for (const entry of entries) {
    if (entry.habitId !== habit.id) continue;
    const key = toLocalDateKey(entry.date);
    if (key && (!earliest || key < earliest)) earliest = key;
  }
  return earliest ?? today;
}

export function entryFor(entries: HabitEntry[], habitId: string, date: string): HabitEntry | undefined {
  return entries.find((e) => e.habitId === habitId && e.date === date);
}

export function statusOn(habit: Habit, entries: HabitEntry[], date: string): HabitCheckStatus | "none" {
  const entry = entryFor(entries, habit.id, date);
  if (entry) return entry.status;
  return "none";
}

/**
 * Current streak counting back from `today`. Non-punitive: done/partial extend
 * it; an intentional skip and a non-scheduled day hold it; an explicit "missed"
 * or an unlogged scheduled past day breaks it. Today being unlogged never breaks
 * (you may still do it), and the creation day being unlogged never breaks (the
 * habit only existed for part of it). Recovery habits never break. Avoidance
 * habits count "done" (avoided) days.
 */
export function currentStreak(habit: Habit, entries: HabitEntry[], today: string = localDateKey(), logs: StudyLog[] = []): number {
  if (habit.type === "weekly") {
    let end = today;
    let streak = 0;
    for (let i = 0; i < 104; i++) {
      const week = weeklyHabitSummary(habit, entries, end, logs);
      if (!week.minimum) break;
      if (!week.metMinimum) {
        if (i > 0) break;
        end = addLocalDays(week.weekStart, -1); // Ongoing week is pending, never missed on a rest day.
        continue;
      }
      streak++;
      end = addLocalDays(week.weekStart, -1);
    }
    return streak;
  }
  const start = trackingStartKey(habit, entries, today);
  const recovery = habit.type === "recovery";
  let streak = 0;
  let cursor = today;
  let isToday = true;
  // Walk backwards up to 2 years to stay bounded.
  for (let i = 0; i < 730; i++) {
    // Never evaluate days before the habit began — they can neither extend nor
    // break the chain.
    if (cursor < start) break;
    const past = !isToday;
    if (!isScheduledDay(habit, cursor)) {
      cursor = addLocalDays(cursor, -1);
      isToday = false;
      continue;
    }
    const status = statusOn(habit, entries, cursor);
    if (status === "done" || status === "partial") {
      streak++;
    } else if (status === "missed") {
      if (!recovery) break; // an explicit miss is a real signal, even on day one
    } else if (status === "skipped") {
      // intentional skip holds the chain without extending it
    } else if (past && cursor > start && !recovery) {
      // an unlogged, scheduled, past day AFTER the creation day breaks the chain;
      // the creation day (cursor === start) and today are grace days.
      break;
    }
    cursor = addLocalDays(cursor, -1);
    isToday = false;
  }
  return streak;
}

export interface HabitWeekStats {
  done: number;
  partial: number;
  skipped: number;
  missed: number;
  scheduledDays: number;
  adherence: number; // 0–100 over scheduled days
}

/** Aggregate a habit's status across a set of local dates (e.g. the last 7 days). */
export function weekStats(habit: Habit, entries: HabitEntry[], dates: string[], logs: StudyLog[] = []): HabitWeekStats {
  if (habit.type === "weekly") {
    const end = [...dates].sort().at(-1) ?? localDateKey();
    const goal = weeklyHabitSummary(habit, entries, end, logs);
    return {
      done: goal.completedDays, partial: 0, skipped: 0, missed: 0,
      scheduledDays: goal.minimum,
      adherence: goal.minimum ? Math.min(100, Math.round(goal.completedDays / goal.minimum * 100)) : 0,
    };
  }
  const start = trackingStartKey(habit, entries);
  let done = 0, partial = 0, skipped = 0, missed = 0, scheduledDays = 0;
  for (const date of dates) {
    if (date < start) continue; // before the habit existed — not evaluable
    if (!isScheduledDay(habit, date)) continue;
    scheduledDays++;
    const status = statusOn(habit, entries, date);
    if (status === "done") done++;
    else if (status === "partial") partial++;
    else if (status === "skipped") skipped++;
    else if (status === "missed") missed++;
  }
  // Adherence credits done fully and partial at half, over scheduled (non-skipped) days.
  const effective = Math.max(0, scheduledDays - skipped);
  const adherence = effective > 0 ? Math.round(((done + partial * 0.5) / effective) * 100) : 0;
  return { done, partial, skipped, missed, scheduledDays, adherence };
}

export interface HeatCell {
  date: string;
  status: HabitCheckStatus | "none";
  scheduled: boolean;
  /** 0 (none) – 1 (done) intensity for rendering. */
  intensity: number;
}

const INTENSITY: Record<HabitCheckStatus, number> = { done: 1, partial: 0.6, skipped: 0.25, missed: 0.12 };

/** Last `days` cells (oldest → newest) for a habit heatmap. */
export function heatmapCells(habit: Habit, entries: HabitEntry[], days = 35, today: string = localDateKey()): HeatCell[] {
  const start = trackingStartKey(habit, entries, today);
  const cells: HeatCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addLocalDays(today, -i);
    // Days before the habit began read as inert, never as a missed slot.
    if (date < start) {
      cells.push({ date, status: "none", scheduled: false, intensity: 0 });
      continue;
    }
    const scheduled = isScheduledDay(habit, date);
    const status = statusOn(habit, entries, date);
    cells.push({
      date,
      status,
      scheduled,
      intensity: status === "none" ? 0 : INTENSITY[status],
    });
  }
  return cells;
}

/** A short, non-punitive nudge based on the last few days. Never shames a miss. */
export function recoveryMessage(habit: Habit, entries: HabitEntry[], today: string = localDateKey(), logs: StudyLog[] = []): string {
  if (habit.type === "weekly") {
    const week = weeklyHabitSummary(habit, entries, today, logs);
    return week.metPreferred ? "Preferred weekly rhythm reached." : week.metMinimum
      ? "Weekly minimum reached. Further sessions are optional."
      : `${week.completedDays} of ${week.minimum} distinct days recorded this week. Rest days are part of the plan.`;
  }
  if (habit.type === "slots") {
    const progress = namedSlotProgress(habit, entryFor(entries, habit.id, today));
    return `${progress.completed} of ${progress.total} reported complete. Unreported occurrences stay unconfirmed.`;
  }
  const streak = currentStreak(habit, entries, today);
  const start = trackingStartKey(habit, entries, today);
  const yesterday = addLocalDays(today, -1);
  const yStatus = statusOn(habit, entries, yesterday);
  if (habit.examMode) return "Exam mode: logging only, no pressure. Do what you can.";
  // An explicit miss is always a real signal, even on the first day.
  if (yStatus === "missed") {
    return "Missed yesterday — that's fine. Restart today; one rep rebuilds momentum.";
  }
  // A habit created yesterday-or-later was never expected yesterday, so an
  // unlogged yesterday is not a miss — welcome it instead of scolding.
  if (yesterday <= start) {
    return "Fresh start. Pick the smallest version you can't say no to.";
  }
  if (yStatus === "none") {
    return "Missed yesterday — that's fine. Restart today; one rep rebuilds momentum.";
  }
  if (streak >= 21) return `${streak}-day rhythm. This is who you are now — protect it, don't grind it.`;
  if (streak >= 7) return `${streak} days steady. Consistency is compounding.`;
  if (streak >= 1) return `${streak} day${streak === 1 ? "" : "s"} going. Keep it light and repeatable.`;
  return "Fresh start. Pick the smallest version you can't say no to.";
}

/** Default schedule (every day) and helpers for the creation flow. */
export function newHabitDefaults(name: string, type: HabitType): Omit<Habit, "id" | "createdAt" | "updatedAt"> {
  return {
    name: name.trim(),
    type,
    target: type === "weekly" ? 1 : HABIT_TYPE_META[type].needsTarget ? (type === "duration" ? 20 : 1) : undefined,
    unit: type === "duration" ? "min" : type === "count" ? "reps" : undefined,
    weeklyTarget: type === "weekly" ? 3 : undefined,
    weeklyMinimum: type === "weekly" ? 3 : undefined,
    weeklyPreferred: type === "weekly" ? 3 : undefined,
    schedule: undefined,
    quietMode: false,
  };
}

/** Today's local date key (re-exported so the page doesn't import two date utils). */
export function todayKey(): string {
  return isoDate(new Date());
}
