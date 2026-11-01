import { addLocalDays, localDateKey, previousLocalDateKey } from "./dailyRollover";
import { isCalendarDateKey } from "./dailyWordCalendar";
import { JOURNAL_STYLE_COST, journalInkEarned } from "./journalNotebook";
import type { DailyWordPuzzleState, NoctyriumState } from "./types";

export const STUDY_CURRENCY_NAME = "AXOM Credits";
export const STUDY_CURRENCY_SHORT = "AC";
export const PRODUCTIVITY_STREAK_THRESHOLD = 80;
export const STARTER_STREAK_FREEZES = 2;

export interface ProductivityStreakLedger {
  startedOn: string;
  creditedDays: string[];
  bonusDays: string[];
  frozenDays: string[];
  freezesLeft: number;
}

export interface DailyWordStreakLedger {
  startedOn: string;
  frozenDays: string[];
  freezesLeft: number;
}

export interface StudyStreaks {
  productivity: ProductivityStreakLedger;
  dailyWord: DailyWordStreakLedger;
}

type BarResult = { eligibleCount: number; progress: number };

export function reachedProductivityGoal(result: BarResult): boolean {
  return result.eligibleCount > 0 && result.progress >= PRODUCTIVITY_STREAK_THRESHOLD;
}

export function normalizeStudyStreaks(value: unknown, today = localDateKey()): StudyStreaks {
  const raw = asRecord(value);
  const productivity = asRecord(raw.productivity);
  const dailyWord = asRecord(raw.dailyWord);
  const productivityStart = isCalendarDateKey(productivity.startedOn) ? productivity.startedOn : today;
  const wordStart = isCalendarDateKey(dailyWord.startedOn) ? dailyWord.startedOn : today;
  const creditedDays = dateList(productivity.creditedDays).filter((day) => day >= productivityStart);
  const frozenDays = dateList(productivity.frozenDays).filter((day) => day >= productivityStart && !creditedDays.includes(day));
  return {
    productivity: {
      startedOn: productivityStart,
      creditedDays,
      bonusDays: dateList(productivity.bonusDays).filter((day) => creditedDays.includes(day)),
      frozenDays,
      freezesLeft: safeFreezeCount(productivity.freezesLeft),
    },
    dailyWord: {
      startedOn: wordStart,
      frozenDays: dateList(dailyWord.frozenDays).filter((day) => day >= wordStart),
      freezesLeft: safeFreezeCount(dailyWord.freezesLeft),
    },
  };
}

/** Existing completed-session value and saved purchases remain valid. */
export function studyCreditsBalance(state: Pick<NoctyriumState, "profile" | "sessions">): number {
  const earnedFromSessions = journalInkEarned(state.sessions);
  const ledger = state.profile.studyStreaks;
  const earnedFromGoals = ledger?.productivity.creditedDays.length ?? 0;
  const earnedFromStreaks = ledger?.productivity.bonusDays.length ?? 0;
  const spent = (state.profile.journalNotebook?.unlockedStyles?.length ?? 0) * JOURNAL_STYLE_COST;
  return Math.max(0, earnedFromSessions + earnedFromGoals + earnedFromStreaks - spent);
}

/** Freeze exactly one missed calendar day, once. A longer gap cannot be bridged. */
export function reconcileProductivityStreak(
  input: StudyStreaks | undefined,
  today: string,
  todayBar: BarResult,
  yesterdayBar: BarResult,
): { ledger: StudyStreaks; creditedToday: boolean; frozenDay?: string } {
  const ledger = normalizeStudyStreaks(input, today);
  const lane = ledger.productivity;
  const yesterday = previousLocalDateKey(today);
  const beforeYesterday = previousLocalDateKey(yesterday);
  let creditedToday = false;
  let frozenDay: string | undefined;

  if (yesterday >= lane.startedOn && reachedProductivityGoal(yesterdayBar) && !lane.creditedDays.includes(yesterday)) {
    lane.creditedDays.push(yesterday);
    lane.creditedDays.sort();
    recordMilestone(lane, yesterday);
  }
  if (yesterday >= lane.startedOn && !lane.creditedDays.includes(yesterday)
    && !lane.frozenDays.includes(yesterday) && lane.creditedDays.includes(beforeYesterday)
    && lane.freezesLeft > 0) {
    lane.frozenDays.push(yesterday);
    lane.freezesLeft -= 1;
    frozenDay = yesterday;
  }
  if (reachedProductivityGoal(todayBar) && !lane.creditedDays.includes(today)) {
    lane.creditedDays.push(today);
    lane.creditedDays.sort();
    recordMilestone(lane, today);
    creditedToday = true;
  }
  return { ledger, creditedToday, frozenDay };
}

export function reconcileDailyWordStreak(
  input: StudyStreaks | undefined,
  today: string,
  completedDates: readonly string[],
): { ledger: StudyStreaks; frozenDay?: string } {
  const ledger = normalizeStudyStreaks(input, today);
  const lane = ledger.dailyWord;
  const completed = new Set(completedDates);
  const yesterday = previousLocalDateKey(today);
  const beforeYesterday = previousLocalDateKey(yesterday);
  let frozenDay: string | undefined;
  if (yesterday >= lane.startedOn && !completed.has(yesterday)
    && !lane.frozenDays.includes(yesterday) && completed.has(beforeYesterday)
    && lane.freezesLeft > 0) {
    lane.frozenDays.push(yesterday);
    lane.freezesLeft -= 1;
    frozenDay = yesterday;
  }
  return { ledger, frozenDay };
}

export function protectedCalendarStreak(
  completedDates: readonly string[],
  frozenDates: readonly string[],
  today: string,
): number {
  const completed = new Set(completedDates);
  const frozen = new Set(frozenDates);
  let cursor = completed.has(today) ? today : previousLocalDateKey(today);
  let count = 0;
  let previousWasFrozen = false;
  for (let depth = 0; depth < 730; depth += 1) {
    if (completed.has(cursor)) {
      count += 1;
      previousWasFrozen = false;
    } else if (frozen.has(cursor) && !previousWasFrozen) {
      previousWasFrozen = true;
    }
    else break;
    cursor = addLocalDays(cursor, -1);
  }
  return count;
}

/** One selector for the page, dashboard, and navigation rail. */
export function dailyWordProtectedStreak(
  history: readonly Pick<DailyWordPuzzleState, "completed" | "puzzleDate">[],
  frozenDates: readonly string[],
  today: string,
): number {
  return protectedCalendarStreak(
    history.filter((puzzle) => puzzle.completed).map((puzzle) => puzzle.puzzleDate),
    frozenDates,
    today,
  );
}

/** Daily Word uses its selected calendar zone, which may differ from device time. */
export function dateKeyInTimeZone(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const key = `${part("year")}-${part("month")}-${part("day")}`;
  if (!isCalendarDateKey(key)) throw new RangeError("The Daily Word date could not be resolved.");
  return key;
}

function recordMilestone(lane: ProductivityStreakLedger, day: string) {
  const streak = protectedCalendarStreak(lane.creditedDays, lane.frozenDays, day);
  if (streak > 0 && streak % 3 === 0 && !lane.bonusDays.includes(day)) lane.bonusDays.push(day);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isCalendarDateKey))].sort().slice(-730) : [];
}

function safeFreezeCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(0, Math.min(STARTER_STREAK_FREEZES, value))
    : STARTER_STREAK_FREEZES;
}
