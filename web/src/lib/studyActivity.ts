import { localDateKey } from "./dailyRollover";
import type { StudyLog } from "./types";

/** Observed facts stay in the existing activity ledger and travel with its backup/sync. */
export interface StudyActivity {
  eventId: string;
  kind: "questions" | "flashcards" | "pomodoro" | "focus";
  source: "axom" | "anki" | "noji" | "quizlet" | "imported";
  startedAt?: string;
  endedAt: string;
  durationSeconds?: number;
  intervals?: Array<{ startedAt: string; endedAt: string }>;
  quantity?: number;
  correct?: number;
  incorrect?: number;
  skipped?: number;
  deck?: string;
  topic?: string;
  mode?: string;
  completed?: boolean;
  note?: string;
}

const labels = { questions: "Questions", flashcards: "Cards", pomodoro: "Pomodoro", focus: "Focus session" };
const positive = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
type Interval = [number, number];

function mergeIntervals(input: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const [start, end] of input.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
const duration = (intervals: Interval[]) => intervals.reduce((sum, [start, end]) => sum + end - start, 0);

/** Stable event IDs make retries/reloads no-ops. Replacing a source snapshot is explicit. */
export function recordObservedActivity(logs: StudyLog[], input: StudyActivity, replace = false): StudyLog[] {
  if (!input.eventId.trim() || !Number.isFinite(Date.parse(input.endedAt))) return logs;
  if (!replace && logs.some((log) => log.activity?.eventId === input.eventId)) return logs;
  const endedAt = new Date(input.endedAt).toISOString();
  const end = Date.parse(endedAt);
  const observedSeconds = Math.min(86400, positive(input.durationSeconds));
  const rawIntervals = input.intervals ?? (observedSeconds > 0
    ? [{ startedAt: input.startedAt ?? new Date(end - observedSeconds * 1000).toISOString(), endedAt }]
    : []);
  const intervals = mergeIntervals(rawIntervals.map((interval): Interval => [Date.parse(interval.startedAt), Math.min(end, Date.parse(interval.endedAt))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 86400000));
  const byDay = new Map<string, Interval[]>();
  for (const [start, finish] of intervals) {
    let cursor = start;
    while (cursor < finish) {
      const date = new Date(cursor);
      const key = localDateKey(date);
      const boundary = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const stop = Math.min(boundary, finish);
      byDay.set(key, [...(byDay.get(key) ?? []), [cursor, stop]]);
      cursor = stop;
    }
  }
  const completionDay = localDateKey(new Date(end));
  if (!byDay.has(completionDay)) byDay.set(completionDay, []);
  const additions: StudyLog[] = [...byDay].map(([dayKey, segments]) => {
    const final = dayKey === completionDay;
    const quantity = final ? Math.floor(positive(input.quantity)) : 0;
    const activity: StudyActivity = {
      ...input, endedAt, startedAt: intervals.length ? new Date(intervals[0][0]).toISOString() : undefined,
      durationSeconds: duration(segments) / 1000,
      intervals: segments.map(([a, b]) => ({ startedAt: new Date(a).toISOString(), endedAt: new Date(b).toISOString() })),
      quantity, correct: final ? Math.floor(positive(input.correct)) : 0,
      incorrect: final ? Math.floor(positive(input.incorrect)) : 0,
      skipped: final ? Math.floor(positive(input.skipped)) : 0,
      completed: final && input.completed,
    };
    return {
      id: `activity:${input.eventId}:${dayKey}`, dayKey, ts: endedAt,
      type: input.source === "anki" ? "Anki" : labels[input.kind],
      minutes: 0, cards: input.kind === "flashcards" ? quantity : 0,
      quantity, quantityKind: input.kind === "flashcards" ? "cards" : input.kind === "questions" ? "questions" : undefined,
      unitType: input.kind === "flashcards" || input.kind === "questions" ? "count" : "minutes",
      trackerId: "tracker-study",
      academic: true, productive: true, note: input.note, activity,
    };
  });
  const next = [...additions, ...logs.filter((log) => log.activity?.eventId !== input.eventId)];
  // A question/card reviewed inside a timer is still a review, but the same
  // wall-clock minute must never be counted twice. Manual time has no interval
  // evidence, so it is left untouched rather than guessed away.
  const touchedDays = new Set([...additions, ...logs.filter((log) => log.activity?.eventId === input.eventId)].map((log) => log.dayKey));
  for (const day of touchedDays) {
    const automatic = next.filter((log) => log.dayKey === day && log.activity?.intervals?.length)
      .sort((a, b) => priority(a) - priority(b) || a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
    let covered: Interval[] = [];
    let previousMinutes = 0;
    for (const log of automatic) {
      covered = mergeIntervals([...covered, ...log.activity!.intervals!.map((interval): Interval => [Date.parse(interval.startedAt), Date.parse(interval.endedAt)])]);
      const totalMinutes = Math.floor(duration(covered) / 60000);
      const index = next.indexOf(log);
      next[index] = { ...log, minutes: totalMinutes - previousMinutes };
      previousMinutes = totalMinutes;
    }
  }
  return next;
}

function priority(log: StudyLog): number {
  return log.activity?.kind === "pomodoro" || log.activity?.kind === "focus" ? 0 : 1;
}

export function studyActivityTotals(logs: StudyLog[], day: string) {
  const total = logs.filter((log) => log.dayKey === day).reduce((total, log) => ({
    cards: total.cards + (Number.isFinite(log.cards) ? log.cards : 0),
    questions: total.questions + (log.quantityKind === "questions" && Number.isFinite(log.quantity) ? log.quantity! : 0),
    correct: total.correct + (log.activity?.correct ?? 0),
    incorrect: total.incorrect + (log.activity?.incorrect ?? 0),
    skipped: total.skipped + (log.activity?.skipped ?? 0),
    pomodoros: total.pomodoros + (log.activity?.kind === "pomodoro" && log.activity.completed ? 1 : 0),
  }), { cards: 0, questions: 0, correct: 0, incorrect: 0, skipped: 0, pomodoros: 0 });
  return { ...total, cards: Math.max(0, total.cards), questions: Math.max(0, total.questions) };
}
