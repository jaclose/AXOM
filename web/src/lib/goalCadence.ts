/**
 * Cadence projections for personal goals. Reads authoritative activity and
 * habit receipts; never writes a second completion record or infers effort.
 */
import { addLocalDays, localDateAtNoon } from "./dailyRollover";
import type { Habit, HabitEntry, StudyLog } from "./types";

const clampWeekly = (value: unknown, fallback: number) =>
  Math.max(1, Math.min(7, Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback));

export function weekStartKey(date: string, weekStartsOn: 0 | 1 = 1): string {
  const day = localDateAtNoon(date).getDay();
  return addLocalDays(date, -((day - weekStartsOn + 7) % 7));
}

function startKey(habit: Habit): string {
  const explicit = habit.trackingStartsAt?.slice(0, 10);
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const created = habit.createdAt?.slice(0, 10);
  return created && /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : "9999-12-31";
}

export interface WeeklyGoalSummary {
  weekStart: string;
  weekEnd: string;
  completedDays: number;
  minimum: number;
  preferred: number;
  remainingMinimum: number;
  remainingPreferred: number;
  metMinimum: boolean;
  metPreferred: boolean;
  sourceEntryIds: string[];
  isPartialFirstWeek: boolean;
}

/**
 * Weekly means distinct local dates, not an obligation on every weekday.
 * Multiple manual check-ins, imported duplicates and tracker logs on the
 * same date count once. First partial weeks are prorated to eligible days.
 */
export function weeklyHabitSummary(
  habit: Habit,
  entries: readonly HabitEntry[],
  today: string,
  logs: readonly StudyLog[] = [],
): WeeklyGoalSummary {
  const weekStart = weekStartKey(today);
  const weekEnd = addLocalDays(weekStart, 6);
  const begins = startKey(habit);
  const firstEligible = begins > weekStart ? begins : weekStart;
  const daysAvailable = firstEligible > weekEnd
    ? 0
    : Math.max(0, 7 - Math.round((localDateAtNoon(firstEligible).getTime() - localDateAtNoon(weekStart).getTime()) / 86_400_000));
  const goalMinimum = clampWeekly(habit.weeklyMinimum ?? habit.weeklyTarget, 3);
  const goalPreferred = Math.max(goalMinimum, clampWeekly(habit.weeklyPreferred, goalMinimum));
  const minimum = Math.min(goalMinimum, daysAvailable);
  const preferred = Math.min(goalPreferred, daysAvailable);
  const byDay = new Map<string, Set<string>>();
  const add = (date: string, id: string) => {
    if (date < firstEligible || date > today || date > weekEnd) return;
    const source = byDay.get(date) ?? new Set<string>();
    source.add(id);
    byDay.set(date, source);
  };
  for (const item of entries) {
    if (item.habitId !== habit.id || (item.status !== "done" && !(item.status === "partial" && (item.value ?? 0) >= 1))) continue;
    add(item.date, item.id);
  }
  if (habit.linkedTrackerId) {
    for (const log of logs) {
      if (log.trackerId !== habit.linkedTrackerId || log.minutes <= 0 && (log.quantity ?? 0) <= 0 && log.cards <= 0) continue;
      add(log.dayKey, log.id);
    }
  }
  const completedDays = byDay.size;
  const sourceEntryIds = [...byDay.entries()].sort(([a],[b])=>a.localeCompare(b))
    .flatMap(([,ids]) => [...ids].sort());
  return {
    weekStart, weekEnd, completedDays, minimum, preferred,
    remainingMinimum: Math.max(0, minimum - completedDays),
    remainingPreferred: Math.max(0, preferred - completedDays),
    metMinimum: minimum > 0 && completedDays >= minimum,
    metPreferred: preferred > 0 && completedDays >= preferred,
    sourceEntryIds,
    isPartialFirstWeek: firstEligible > weekStart && firstEligible <= weekEnd,
  };
}

export type NamedSlotStatus = "done" | "skipped" | "unreported";
export interface NamedSlotSummary {
  total: number;
  completed: number;
  skipped: number;
  unreported: number;
  slots: Array<{ id: string; label: string; status: NamedSlotStatus; sourceId?: string }>;
}

/**
 * Named subdaily slots are independently addressable, without inferred
 * completion, timestamps, religious judgments or externally calculated times.
 */
export function namedSlotProgress(habit: Habit, entry?: HabitEntry): NamedSlotSummary {
  const seen = new Set<string>();
  const defined = (habit.occurrenceSlots ?? []).filter(slot => {
    if (!slot.id || !slot.label || seen.has(slot.id)) return false;
    seen.add(slot.id);
    return true;
  });
  const latest = new Map<string, NonNullable<HabitEntry["slotCheckIns"]>[number]>();
  for (const check of entry?.slotCheckIns ?? []) {
    if (!seen.has(check.slotId)) continue;
    const old = latest.get(check.slotId);
    if (!old || check.at > old.at || (check.at === old.at && check.id > old.id)) {
      latest.set(check.slotId, check);
    }
  }
  const slots = defined.map(slot => ({
    id: slot.id, label: slot.label,
    status: (latest.get(slot.id)?.status ?? "unreported") as NamedSlotStatus,
    sourceId: latest.get(slot.id)?.id,
  }));
  const completed = slots.filter(slot => slot.status === "done").length;
  const skipped = slots.filter(slot => slot.status === "skipped").length;
  return { total: slots.length, completed, skipped, unreported: slots.length - completed - skipped, slots };
}

export const PRAYER_OCCURRENCE_SLOTS = [
  { id: "fajr", label: "Fajr" }, { id: "dhuhr", label: "Dhuhr" },
  { id: "asr", label: "Asr" }, { id: "maghrib", label: "Maghrib" },
  { id: "isha", label: "Isha" },
] as const;
