import type { DailyWordPuzzleState, TimeZonePreference } from "./types";
import { normalizeHintFields } from "./dailyWordHints";
import { isCalendarDateKey } from "./dailyWordCalendar";
import {
  DAILY_WORD_MAX_GUESSES,
  deriveDailyWordStatsFromNormalizedHistory,
  type DailyWordStats,
} from "./dailyWordStats";

export type { DailyWordPuzzleState, TimeZonePreference } from "./types";
export { isCalendarDateKey, isNextCalendarDate } from "./dailyWordCalendar";
export { DAILY_WORD_MAX_GUESSES, type DailyWordStats } from "./dailyWordStats";

export type LetterEvaluation = "correct" | "present" | "absent";

export type DailyWordSelectionStatus = "current" | "locked" | "clock-behind";

export interface DailyWordSelection {
  puzzle: DailyWordPuzzleState;
  history: DailyWordPuzzleState[];
  created: boolean;
  status: DailyWordSelectionStatus;
}

interface SelectDailyWordPuzzleOptions {
  history: readonly DailyWordPuzzleState[];
  now?: Date;
  timeZone: string;
  wordListVersion: string;
}

const VERSION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FIVE_LETTERS = /^[A-Z]{5}$/;

/** Validate an IANA timezone without doing any manual offset arithmetic. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Return the runtime's canonical IANA spelling, or undefined when invalid. */
export function canonicalTimeZone(value: unknown): string | undefined {
  if (!isValidTimeZone(value)) return undefined;
  return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

/**
 * Resolve the shared application timezone. Invalid custom input falls back to
 * the valid system timezone, then UTC, so rendering can never crash.
 */
export function resolveTimeZone(
  preference: TimeZonePreference | undefined,
  systemTimeZone: string | undefined = new Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const system = canonicalTimeZone(systemTimeZone) ?? "UTC";
  if (preference?.mode !== "custom") return system;
  return canonicalTimeZone(preference.customTimezone) ?? system;
}

/** Calendar date in an explicit IANA timezone. Never truncates a UTC date. */
export function getCalendarDateKey(date: Date, timeZone: string): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError("A valid date is required.");
  const zone = canonicalTimeZone(timeZone);
  if (!zone) throw new RangeError("A valid IANA timezone is required.");
  const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone: zone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const key = `${year}-${month}-${day}`;
  if (!isCalendarDateKey(key)) throw new RangeError("The calendar date could not be resolved.");
  return key;
}

/**
 * Milliseconds until the next calendar date in an explicit IANA timezone.
 * A bounded binary search delegates DST and offset rules to Intl rather than
 * duplicating timezone arithmetic in the game.
 */
export function millisecondsUntilNextCalendarDate(date: Date, timeZone: string): number {
  if (!Number.isFinite(date.getTime())) throw new RangeError("A valid date is required.");
  const zone = canonicalTimeZone(timeZone);
  if (!zone) throw new RangeError("A valid IANA timezone is required.");
  const currentDate = getCalendarDateKey(date, zone);
  const start = date.getTime();
  let low = start;
  let high = start + 36 * 60 * 60 * 1000;
  const limit = start + 72 * 60 * 60 * 1000;

  while (high < limit && getCalendarDateKey(new Date(high), zone) === currentDate) {
    high += 6 * 60 * 60 * 1000;
  }
  if (getCalendarDateKey(new Date(high), zone) === currentDate) {
    throw new RangeError("The next calendar date could not be resolved.");
  }

  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (getCalendarDateKey(new Date(middle), zone) === currentDate) low = middle;
    else high = middle;
  }
  return Math.max(0, high - start);
}

export function buildDailyWordPuzzleId(wordListVersion: string, puzzleDate: string): string {
  if (!VERSION_KEY.test(wordListVersion)) throw new RangeError("A valid word-list version is required.");
  if (!isCalendarDateKey(puzzleDate)) throw new RangeError("A valid puzzle date is required.");
  return `daily-word:${wordListVersion}:${puzzleDate}`;
}

/** Stable FNV-1a 32-bit hash. Puzzle identifiers are deliberately ASCII. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Bundled answers are inspectable in client code; AXOM intentionally does not
 * pretend that client-side obfuscation can make a local puzzle answer secret.
 */
export function selectDailyWordAnswer(puzzleId: string, answers: readonly string[]): string {
  if (!answers.length) throw new RangeError("The answer list cannot be empty.");
  const index = fnv1a32(puzzleId) % answers.length;
  return normalizeFiveLetterWord(answers[index], "answer");
}

/** Two-pass duplicate-safe scoring using semantic states, never color names. */
export function scoreGuess(guess: string, answer: string): LetterEvaluation[] {
  const normalizedGuess = normalizeFiveLetterWord(guess, "guess");
  const normalizedAnswer = normalizeFiveLetterWord(answer, "answer");
  const evaluations: Array<LetterEvaluation | undefined> = Array(5).fill(undefined);
  const remaining = new Map<string, number>();

  for (let index = 0; index < 5; index += 1) {
    if (normalizedGuess[index] === normalizedAnswer[index]) {
      evaluations[index] = "correct";
    } else {
      const letter = normalizedAnswer[index];
      remaining.set(letter, (remaining.get(letter) ?? 0) + 1);
    }
  }

  for (let index = 0; index < 5; index += 1) {
    if (evaluations[index] === "correct") continue;
    const letter = normalizedGuess[index];
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      evaluations[index] = "present";
      remaining.set(letter, count - 1);
    } else {
      evaluations[index] = "absent";
    }
  }

  return evaluations as LetterEvaluation[];
}

export function createDailyWordPuzzle(
  puzzleDate: string,
  timeZone: string,
  wordListVersion: string,
  startedAt: Date = new Date(),
): DailyWordPuzzleState {
  if (!Number.isFinite(startedAt.getTime())) throw new RangeError("A valid start time is required.");
  const zone = canonicalTimeZone(timeZone);
  if (!zone) throw new RangeError("A valid IANA timezone is required.");
  const timestamp = startedAt.toISOString();
  return {
    puzzleId: buildDailyWordPuzzleId(wordListVersion, puzzleDate),
    puzzleDate,
    timezone: zone,
    wordListVersion,
    guesses: [],
    completed: false,
    won: false,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Resolve today's playable record while preserving an unfinished puzzle's
 * locked timezone. A backward clock never creates an older playable puzzle,
 * and skipped dates never receive synthetic records.
 */
export function selectDailyWordPuzzle(options: SelectDailyWordPuzzleOptions): DailyWordSelection {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError("A valid current time is required.");
  const currentZone = canonicalTimeZone(options.timeZone);
  if (!currentZone) throw new RangeError("A valid IANA timezone is required.");
  buildDailyWordPuzzleId(options.wordListVersion, getCalendarDateKey(now, currentZone));

  const history = normalizeDailyWordHistory(options.history);
  const newestDate = history.reduce((latest, puzzle) => puzzle.puzzleDate > latest ? puzzle.puzzleDate : latest, "");
  const locked = history
    .filter((puzzle) => !puzzle.completed && puzzle.puzzleDate === newestDate)
    .sort(comparePuzzleRecency)
    .at(-1);

  if (locked && getCalendarDateKey(now, locked.timezone) <= locked.puzzleDate) {
    return { puzzle: locked, history, created: false, status: "locked" };
  }

  const candidateDate = getCalendarDateKey(now, currentZone);
  if (newestDate && candidateDate < newestDate) {
    const newest = history.filter((puzzle) => puzzle.puzzleDate === newestDate).sort(comparePuzzleRecency).at(-1);
    if (newest) return { puzzle: newest, history, created: false, status: "clock-behind" };
  }

  const puzzleId = buildDailyWordPuzzleId(options.wordListVersion, candidateDate);
  const existing = history.find((puzzle) => puzzle.puzzleId === puzzleId);
  if (existing) return { puzzle: existing, history, created: false, status: "current" };

  // One playable puzzle per local calendar date. If the dictionary changed
  // while that date's legacy puzzle was active, keep the same record through
  // completion instead of silently switching to a second answer that day.
  const historicalVersionForDate = history
    .filter((puzzle) => puzzle.puzzleDate === candidateDate)
    .sort(comparePuzzleCompleteness)
    .at(-1);
  if (historicalVersionForDate) {
    return { puzzle: historicalVersionForDate, history, created: false, status: "current" };
  }

  const puzzle = createDailyWordPuzzle(candidateDate, currentZone, options.wordListVersion, now);
  return {
    puzzle,
    history: mergeDailyWordHistories(history, [puzzle]),
    created: true,
    status: "current",
  };
}

export function normalizeDailyWordPuzzle(value: unknown): DailyWordPuzzleState | undefined {
  if (!isRecord(value)) return undefined;
  const puzzleDate = typeof value.puzzleDate === "string" ? value.puzzleDate : "";
  const wordListVersion = typeof value.wordListVersion === "string" ? value.wordListVersion : "";
  if (!isCalendarDateKey(puzzleDate) || !VERSION_KEY.test(wordListVersion)) return undefined;
  const expectedId = buildDailyWordPuzzleId(wordListVersion, puzzleDate);
  if (value.puzzleId !== expectedId) return undefined;
  const timezone = canonicalTimeZone(value.timezone);
  if (!timezone) return undefined;
  const guesses = Array.isArray(value.guesses)
    ? value.guesses
      .filter((guess): guess is string => typeof guess === "string" && FIVE_LETTERS.test(guess.toUpperCase()))
      .map((guess) => guess.toUpperCase())
      .slice(0, DAILY_WORD_MAX_GUESSES)
    : [];
  const fallbackTimestamp = `${puzzleDate}T00:00:00.000Z`;
  const startedAt = validIsoTimestamp(value.startedAt) ?? fallbackTimestamp;
  const updatedAt = validIsoTimestamp(value.updatedAt) ?? validIsoTimestamp(value.completedAt) ?? startedAt;
  const completed = value.completed === true;
  const completedAt = completed ? validIsoTimestamp(value.completedAt) ?? updatedAt : undefined;
  const won = completed && value.won === true;
  return {
    puzzleId: expectedId,
    puzzleDate,
    timezone,
    wordListVersion,
    guesses,
    completed,
    won,
    startedAt,
    updatedAt,
    completedAt,
    ...normalizeHintFields(value, completed, won),
  };
}



export function normalizeDailyWordHistory(value: unknown): DailyWordPuzzleState[] {
  if (!Array.isArray(value)) return [];
  return mergeDailyWordHistories([], value.map(normalizeDailyWordPuzzle).filter(isDefined));
}

/** Merge by puzzleId, preferring completed, more-progressed, then newer data. */
export function mergeDailyWordHistories(
  current: readonly DailyWordPuzzleState[],
  imported: readonly DailyWordPuzzleState[],
): DailyWordPuzzleState[] {
  const records = [...current, ...imported].map(normalizeDailyWordPuzzle).filter(isDefined);
  const byId = new Map<string, DailyWordPuzzleState>();
  for (const record of records) {
    const existing = byId.get(record.puzzleId);
    if (!existing || comparePuzzleCompleteness(existing, record) < 0) byId.set(record.puzzleId, record);
  }
  return [...byId.values()].sort((left, right) =>
    left.puzzleDate.localeCompare(right.puzzleDate) || left.puzzleId.localeCompare(right.puzzleId));
}

/** Aggregate statistics are derived from unique history, so reload is idempotent. */
export function deriveDailyWordStats(history: readonly DailyWordPuzzleState[]): DailyWordStats {
  return deriveDailyWordStatsFromNormalizedHistory(normalizeDailyWordHistory(history));
}

/** Daily Word launched on this date (commit ba9c4a8): puzzle #1. */
export const DAILY_WORD_FIRST_DATE = "2026-07-12";
export const AXOM_PUBLIC_URL = "https://axom.info";

/** A stable, shared puzzle number for a calendar date (#1 = launch day). */
export function dailyWordNumber(puzzleDate: string): number {
  const start = Date.UTC(2026, 6, 12);
  const [y, m, d] = puzzleDate.split("-").map(Number);
  return Math.max(1, Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000) + 1);
}

/**
 * Share text in the convention players already know (NYT Wordle, Doctordle):
 * number and score, colour squares, a link. Never the answer or the guesses.
 */
export function buildDailyWordShare(
  puzzle: DailyWordPuzzleState,
  rows: readonly (readonly LetterEvaluation[])[],
): string {
  if (!puzzle.completed) throw new Error("Complete the puzzle before sharing.");
  if (rows.length !== puzzle.guesses.length || rows.some((row) => row.length !== 5)) {
    throw new Error("A complete evaluation row is required for every submitted guess.");
  }
  const result = puzzle.revealed
    ? "revealed"
    : puzzle.won ? `${puzzle.guesses.length}/${DAILY_WORD_MAX_GUESSES}` : `X/${DAILY_WORD_MAX_GUESSES}`;
  const hints = puzzle.hintsUsed && !puzzle.revealed ? ` 💡${puzzle.hintsUsed}` : "";
  const symbol: Record<LetterEvaluation, string> = { correct: "🟩", present: "🟨", absent: "⬛" };
  const grid = rows.map((row) => row.map((evaluation) => symbol[evaluation]).join("")).join("\n");
  return `AXOM Daily Word #${dailyWordNumber(puzzle.puzzleDate)} ${result}${hints}${grid ? `\n${grid}` : ""}\n${AXOM_PUBLIC_URL.replace("https://", "")}`;
}

function normalizeFiveLetterWord(value: string, label: string): string {
  if (typeof value !== "string") throw new TypeError(`The ${label} must be text.`);
  const normalized = value.toUpperCase();
  if (normalized.length !== 5) throw new RangeError(`The ${label} must contain exactly five letters.`);
  if (!FIVE_LETTERS.test(normalized)) throw new RangeError(`The ${label} must contain A-Z letters only.`);
  return normalized;
}

function validIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return Number.isFinite(new Date(value).getTime()) ? value : undefined;
}

function comparePuzzleRecency(left: DailyWordPuzzleState, right: DailyWordPuzzleState): number {
  return left.puzzleDate.localeCompare(right.puzzleDate)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.puzzleId.localeCompare(right.puzzleId);
}

function comparePuzzleCompleteness(left: DailyWordPuzzleState, right: DailyWordPuzzleState): number {
  const completed = Number(left.completed) - Number(right.completed);
  if (completed) return completed;
  const progress = left.guesses.length - right.guesses.length;
  if (progress) return progress;
  const updated = left.updatedAt.localeCompare(right.updatedAt);
  if (updated) return updated;
  return stablePuzzleFingerprint(left).localeCompare(stablePuzzleFingerprint(right));
}

function stablePuzzleFingerprint(puzzle: DailyWordPuzzleState): string {
  return JSON.stringify([
    puzzle.puzzleId, puzzle.timezone, puzzle.guesses, puzzle.completed,
    puzzle.won, puzzle.startedAt, puzzle.updatedAt, puzzle.completedAt ?? "",
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
