import type { StudyLog } from "./types";
import { isoDate } from "./scoring";

export type PersonalBoardMetric = "activeDays" | "cards" | "minutes";
export interface ActivityWeek { start: string; end: string; activeDays: number; cards: number; minutes: number; current: boolean; }

/** Local Monday–Sunday weeks. Do not rank partial weeks against full ones. */
export function personalActivityWeeks(logs: StudyLog[], now = new Date()): ActivityWeek[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const today = isoDate(now);
  const weeks: ActivityWeek[] = [];
  const days = new Map<string, { minutes: number; cards: number }>();
  const ids = new Set<string>();
  for (const log of logs) {
    if (ids.has(log.id) || log.academic === false || log.dayKey > today) continue;
    ids.add(log.id);
    const day = days.get(log.dayKey) ?? { minutes: 0, cards: 0 };
    day.minutes += Number.isFinite(log.minutes) ? Math.max(0, log.minutes) : 0;
    day.cards += Number.isFinite(log.cards) ? Math.max(0, log.cards) : 0;
    days.set(log.dayKey, day);
  }
  for (let offset = 0; offset < 9; offset++) {
    const start = new Date(monday); start.setDate(start.getDate() - offset * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const week: ActivityWeek = { start: isoDate(start), end: isoDate(end), activeDays: 0, cards: 0, minutes: 0, current: offset === 0 };
    for (let index = 0; index < 7; index++) {
      const date = new Date(start); date.setDate(date.getDate() + index);
      const day = days.get(isoDate(date));
      if (!day) continue;
      if (day.minutes > 0 || day.cards > 0) week.activeDays++;
      week.cards += day.cards; week.minutes += day.minutes;
    }
    weeks.push(week);
  }
  return weeks;
}

export function rankPersonalWeeks(weeks: ActivityWeek[], metric: PersonalBoardMetric) {
  const ranked = weeks.filter(week => !week.current && week[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || b.start.localeCompare(a.start));
  let rank = 0;
  return ranked.map((week, index) => {
    if (index === 0 || week[metric] !== ranked[index - 1][metric]) rank = index + 1;
    return { ...week, rank };
  });
}

// ---------------------------------------------------------------------------
// Race your past self — pace against your own history (no invented people)
// ---------------------------------------------------------------------------

export type PaceStatus = "ahead" | "on-track" | "behind" | "no-history";

export interface WeekPace {
  metric: PersonalBoardMetric;
  /** Days of the current Monday–Sunday week that have started (1–7). */
  elapsedDays: number;
  current: number;
  /** Average of completed weeks over the same number of days. */
  typicalSoFar: number;
  /** Average full completed week. */
  typicalWeek: number;
  best?: ActivityWeek;
  /** Current + typical remaining days. */
  projected: number;
  projectedRank: number | null;
  status: PaceStatus;
  /** What is still needed, per remaining day (including today), to beat the best week. */
  neededPerDayToBeatBest: number | null;
  /** Cumulative per-day series for the race chart. */
  series: { you: number[]; typical: number[]; best: number[] };
}

function dayValues(logs: StudyLog[], today: string) {
  const days = new Map<string, { minutes: number; cards: number }>();
  const ids = new Set<string>();
  for (const log of logs) {
    if (ids.has(log.id) || log.academic === false || log.dayKey > today) continue;
    ids.add(log.id);
    const day = days.get(log.dayKey) ?? { minutes: 0, cards: 0 };
    day.minutes += Number.isFinite(log.minutes) ? Math.max(0, log.minutes) : 0;
    day.cards += Number.isFinite(log.cards) ? Math.max(0, log.cards) : 0;
    days.set(log.dayKey, day);
  }
  return days;
}

function metricForDay(day: { minutes: number; cards: number } | undefined, metric: PersonalBoardMetric): number {
  if (!day) return 0;
  if (metric === "activeDays") return day.minutes > 0 || day.cards > 0 ? 1 : 0;
  return day[metric];
}

function cumulative(values: number[]): number[] {
  let running = 0;
  return values.map((value) => (running += value));
}

export function weekPace(logs: StudyLog[], metric: PersonalBoardMetric, now = new Date()): WeekPace {
  const today = isoDate(now);
  const days = dayValues(logs, today);
  const weeks = personalActivityWeeks(logs, now);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const elapsedDays = ((now.getDay() + 6) % 7) + 1;
  const perDay = (start: Date) => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(date.getDate() + index);
    return metricForDay(days.get(isoDate(date)), metric);
  });
  const currentDays = perDay(monday);
  const completed = weeks.filter((week) => !week.current && (week.minutes > 0 || week.cards > 0));
  const completedDays = completed.map((week) => perDay(new Date(`${week.start}T12:00:00`)));
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const typicalDaily = Array.from({ length: 7 }, (_, index) => average(completedDays.map((week) => week[index])));
  const current = currentDays.slice(0, elapsedDays).reduce((sum, value) => sum + value, 0);
  const typicalSoFar = typicalDaily.slice(0, elapsedDays).reduce((sum, value) => sum + value, 0);
  const typicalWeek = typicalDaily.reduce((sum, value) => sum + value, 0);
  const ranked = rankPersonalWeeks(weeks, metric);
  const best = ranked[0];
  const bestIndex = best ? completed.findIndex((week) => week.start === best.start) : -1;
  const bestDays = bestIndex >= 0 ? completedDays[bestIndex] : Array(7).fill(0);
  const projected = current + typicalDaily.slice(elapsedDays).reduce((sum, value) => sum + value, 0);
  const projectedRank = ranked.length ? ranked.filter((week) => week[metric] > projected).length + 1 : null;
  const status: PaceStatus = !completed.length
    ? "no-history"
    : current >= typicalSoFar * 1.1 ? "ahead" : current >= typicalSoFar * 0.9 ? "on-track" : "behind";
  const remainingDays = 7 - elapsedDays + 1;
  const bestTotal = best ? best[metric] : 0;
  const neededPerDayToBeatBest = best && current <= bestTotal
    ? Math.max(0, (bestTotal + 1 - current) / remainingDays)
    : best ? 0 : null;
  return {
    metric,
    elapsedDays,
    current,
    typicalSoFar,
    typicalWeek,
    best,
    projected,
    projectedRank,
    status,
    neededPerDayToBeatBest,
    series: {
      you: cumulative(currentDays).slice(0, elapsedDays),
      typical: cumulative(typicalDaily),
      best: cumulative(bestDays),
    },
  };
}

/** Longest run of consecutive active days in the log history. */
export function longestActiveStreak(logs: StudyLog[], now = new Date()): number {
  const days = [...dayValues(logs, isoDate(now)).entries()]
    .filter(([, day]) => day.minutes > 0 || day.cards > 0)
    .map(([key]) => key)
    .sort();
  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of days) {
    const date = new Date(`${key}T12:00:00`);
    run = previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

export function bestDay(logs: StudyLog[], metric: Exclude<PersonalBoardMetric, "activeDays">, now = new Date()): { dayKey: string; value: number } | null {
  let winner: { dayKey: string; value: number } | null = null;
  for (const [dayKey, day] of dayValues(logs, isoDate(now))) {
    const value = day[metric];
    if (value > 0 && (!winner || value > winner.value || (value === winner.value && dayKey > winner.dayKey))) winner = { dayKey, value };
  }
  return winner;
}
