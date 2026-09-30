// Doctordle check-ins (JD, Ideas 3: "after clicking Doctordle, when they come
// back ask did you get it? ... if they didn't click it but it refreshed and
// they have played before, remind them on the dashboard"). AXOM cannot see
// doctordle.org, so everything here is what the learner tells us, kept on
// this device next to the other game courtesies (never synced, never shared).
import { create } from "zustand";

const KEY = "axom.doctordle.v1";
export const DOCTORDLE_URL = "https://doctordle.org/";
const DAY_MS = 86_400_000;
/**
 * doctordle.org numbers its cases in whole days since 2025-07-16T00:00-05:00
 * (its getTodaysDiseaseNumber), so a case turns over at 05:00 UTC. Checked
 * against JD's "Doctordle #440" screenshot from 2026-09-29.
 */
const CASE_ZERO_MS = Date.UTC(2025, 6, 16, 5);
/** Wait this long after "Open doctordle.org" before asking how it went. */
export const DOCTORDLE_ASK_AFTER_MS = 15_000;
/** Opens or results on this many of the last 14 cases make a regular. */
const REGULAR_MIN_CASES = 2;
const HISTORY_CASES = 14;

export type DoctordleResult = "solved" | "missed";

export interface DoctordleLog {
  /** Case numbers opened from AXOM, newest last. */
  opened: number[];
  /** What the learner reported, by case number. */
  results: Record<string, DoctordleResult>;
  /** Cases the learner said they'd sit out. */
  skipped: number[];
  lastOpenedAt?: number;
  /** "Later" on either prompt. */
  snoozedUntil?: number;
  /** "Don't show again" on the dashboard reminder. */
  remindersOff?: boolean;
}

export const EMPTY_DOCTORDLE_LOG: DoctordleLog = { opened: [], results: {}, skipped: [] };

export function doctordleCaseNumber(now: number = Date.now()): number {
  return Math.floor((now - CASE_ZERO_MS) / DAY_MS);
}

const finiteInts = (value: unknown) => (Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : []);

export function normalizeDoctordleLog(value: unknown): DoctordleLog {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const results: Record<string, DoctordleResult> = {};
  if (raw.results && typeof raw.results === "object") {
    for (const [key, result] of Object.entries(raw.results as Record<string, unknown>)) {
      if (/^\d+$/.test(key) && (result === "solved" || result === "missed")) results[key] = result;
    }
  }
  const time = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
  return {
    opened: [...new Set(finiteInts(raw.opened))].slice(-60),
    results,
    skipped: [...new Set(finiteInts(raw.skipped))].slice(-60),
    lastOpenedAt: time(raw.lastOpenedAt),
    snoozedUntil: time(raw.snoozedUntil),
    remindersOff: raw.remindersOff === true || undefined,
  };
}

/** Consecutive solved cases ending today (or yesterday, before today is logged). Matches doctordle.org's own streak. */
export function doctordleStreak(log: DoctordleLog, today: number): number {
  let day = log.results[today] ? today : today - 1;
  let streak = 0;
  while (log.results[day] === "solved") { streak += 1; day -= 1; }
  return streak;
}

/** After "Open doctordle.org": ask once the learner is back, unless they already answered. */
export function shouldAskResult(log: DoctordleLog, today: number, now: number): boolean {
  return log.opened.includes(today)
    && !log.results[today]
    && !log.skipped.includes(today)
    && log.lastOpenedAt !== undefined && now - log.lastOpenedAt >= DOCTORDLE_ASK_AFTER_MS
    && !(log.snoozedUntil && log.snoozedUntil > now);
}

/** Dashboard nudge: a regular who hasn't touched today's case yet. */
export function shouldRemind(log: DoctordleLog, today: number, now: number): boolean {
  if (log.remindersOff || (log.snoozedUntil && log.snoozedUntil > now)) return false;
  if (log.opened.includes(today) || log.results[today] || log.skipped.includes(today)) return false;
  const recent = new Set([...log.opened, ...Object.keys(log.results).map(Number)].filter((n) => n < today && n >= today - HISTORY_CASES));
  return recent.size >= REGULAR_MIN_CASES;
}

function read(): DoctordleLog {
  try { return normalizeDoctordleLog(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return { ...EMPTY_DOCTORDLE_LOG }; }
}

interface DoctordleState {
  log: DoctordleLog;
  recordOpen: (now?: number) => void;
  recordResult: (result: DoctordleResult, now?: number) => void;
  skipToday: (now?: number) => void;
  snooze: (ms: number, now?: number) => void;
  setRemindersOff: (off: boolean) => void;
}

export const useDoctordle = create<DoctordleState>((set, get) => {
  const save = (log: DoctordleLog) => {
    set({ log });
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* storage blocked */ }
  };
  return {
    log: typeof window === "undefined" ? { ...EMPTY_DOCTORDLE_LOG } : read(),
    recordOpen(now = Date.now()) {
      const { log } = get();
      save({ ...log, opened: [...log.opened.filter((n) => n !== doctordleCaseNumber(now)), doctordleCaseNumber(now)].slice(-60), lastOpenedAt: now, snoozedUntil: undefined });
    },
    recordResult(result, now = Date.now()) {
      const { log } = get();
      const today = doctordleCaseNumber(now);
      save({ ...log, results: { ...log.results, [today]: result }, skipped: log.skipped.filter((n) => n !== today), snoozedUntil: undefined });
    },
    skipToday(now = Date.now()) {
      const { log } = get();
      save({ ...log, skipped: [...log.skipped, doctordleCaseNumber(now)].slice(-60) });
    },
    snooze(ms, now = Date.now()) {
      save({ ...get().log, snoozedUntil: now + ms });
    },
    setRemindersOff(off) {
      save({ ...get().log, remindersOff: off || undefined });
    },
  };
});
