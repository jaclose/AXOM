import type { DailyArchive, DailyRolloverEvent, EnergyFactor, JournalEntry, AxomState, StudyLog, Task } from "./types";
import { dayTotals, isoDate } from "./scoring";

export type RolloverReason = DailyRolloverEvent["reason"];

export interface RolloverSummary {
  changed: boolean;
  fromDate: string;
  toDate: string;
  daysAway: number;
  carriedTaskIds: string[];
  timezoneChanged: boolean;
}

export const ROLLOVER_DONE_KEY = "noctyrium:last-rollover-local-date";

export function localDateKey(date: Date = new Date()): string {
  return isoDate(date);
}

export function localDateAtNoon(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addLocalDays(key: string, days: number): string {
  const date = localDateAtNoon(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function previousLocalDateKey(key: string): string {
  return addLocalDays(key, -1);
}

export function daysBetweenLocalDates(fromDate: string, toDate: string): number {
  const from = localDateAtNoon(fromDate).getTime();
  const to = localDateAtNoon(toDate).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function millisecondsUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 2, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export function shouldRollover(
  state: Pick<AxomState, "lastActiveLocalDate" | "activeDayKey" | "lastTimezoneOffset">,
  now: Date = new Date(),
): { due: boolean; today: string; lastDate: string; daysAway: number; timezoneChanged: boolean } {
  const today = localDateKey(now);
  const lastDate = state.lastActiveLocalDate || state.activeDayKey || today;
  const daysAway = daysBetweenLocalDates(lastDate, today);
  const timezoneChanged = typeof state.lastTimezoneOffset === "number" && state.lastTimezoneOffset !== now.getTimezoneOffset();
  return {
    due: daysAway > 0 || timezoneChanged || state.activeDayKey !== today,
    today,
    lastDate,
    daysAway,
    timezoneChanged,
  };
}

export function buildDailyArchive(
  state: Pick<AxomState, "logs" | "tasks" | "journal" | "dayPlans"> & { energyFactors?: EnergyFactor[] },
  date: string,
  carriedTaskIds: string[],
  archivedAt: string,
): DailyArchive {
  const totals = dayTotals(state.logs, date);
  return {
    date,
    archivedAt,
    studyMinutes: totals.minutes,
    ankiCards: totals.cards,
    productiveMinutes: productiveMinutesForDay(state.logs, date),
    openTaskIds: state.tasks.filter((task) => !task.done && !task.archived && taskDueOnOrBefore(task, date)).map((task) => task.id),
    carriedTaskIds,
    journalEntryIds: journalEntryIdsForDay(state.journal, date),
    energyFactorIds: (state.energyFactors ?? []).filter((factor) => factor.date === date).map((factor) => factor.id),
    dayPlanOutcome: state.dayPlans.find((plan) => plan.dayKey === date)?.outcome,
  };
}

export function carryOpenTasksForward(tasks: Task[], fromDate: string, toDate: string, carriedAt: string): { tasks: Task[]; carriedTaskIds: string[] } {
  const carriedTaskIds: string[] = [];
  const next = tasks.map((task) => {
    if (task.done || task.archived || !taskDueOnOrBefore(task, fromDate)) return task;
    carriedTaskIds.push(task.id);
    return {
      ...task,
      due: toDate,
      carriedAt,
      carryoverFrom: [...new Set([...(task.carryoverFrom ?? []), task.due ?? fromDate])],
    };
  });
  return { tasks: next, carriedTaskIds };
}

export function mergeDailyArchive(archives: DailyArchive[], archive: DailyArchive): DailyArchive[] {
  return [archive, ...archives.filter((item) => item.date !== archive.date)]
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeRolloverEvent(events: DailyRolloverEvent[], event: DailyRolloverEvent): DailyRolloverEvent[] {
  return [event, ...events.filter((item) => item.toDate !== event.toDate)]
    .sort((a, b) => b.toDate.localeCompare(a.toDate))
    .slice(0, 90);
}

export function markRolloverDone(storage: Storage | undefined, date: string) {
  try {
    storage?.setItem(ROLLOVER_DONE_KEY, date);
  } catch {
    // Storage may be unavailable in private/offline modes; state idempotence still protects data.
  }
}

export function lastRolloverDone(storage: Storage | undefined): string {
  try {
    return storage?.getItem(ROLLOVER_DONE_KEY) ?? "";
  } catch {
    return "";
  }
}

function taskDueOnOrBefore(task: Task, date: string): boolean {
  return Boolean(task.due && task.due.slice(0, 10) <= date);
}

function journalEntryIdsForDay(journal: JournalEntry[], date: string): string[] {
  return journal
    .filter((entry) => {
      const parsed = new Date(entry.date);
      return Number.isNaN(parsed.getTime()) ? entry.date.slice(0, 10) === date : localDateKey(parsed) === date;
    })
    .map((entry) => entry.id);
}

function productiveMinutesForDay(logs: StudyLog[], date: string): number {
  return logs.reduce((sum, log) => {
    if (log.dayKey !== date) return sum;
    if (log.productive === false) return sum;
    return sum + Math.max(0, log.minutes);
  }, 0);
}
