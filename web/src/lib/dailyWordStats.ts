import type { DailyWordPuzzleState } from "./types";
import { isNextCalendarDate } from "./dailyWordCalendar";

export const DAILY_WORD_MAX_GUESSES = 6;

export interface DailyWordStats {
  gamesPlayed: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: Record<number, number>;
  lastCompletedPuzzleId?: string;
}

/**
 * Aggregate already-normalized puzzle records without importing gameplay,
 * answer selection, or word-list code. The workspace normalizer owns trust;
 * this selector exists so small shell summaries remain bundle-light.
 */
export function deriveDailyWordStatsFromNormalizedHistory(
  history: readonly DailyWordPuzzleState[],
): DailyWordStats {
  const completed = uniqueCompletedHistory(history);
  const distribution: Record<number, number> = Object.fromEntries(
    Array.from({ length: DAILY_WORD_MAX_GUESSES }, (_, index) => [index + 1, 0]),
  );
  let wins = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  let streakDate = "";

  for (const puzzle of completed) {
    if (puzzle.won) {
      wins += 1;
      const bucket = Math.min(DAILY_WORD_MAX_GUESSES, Math.max(1, puzzle.guesses.length));
      distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    }

    // Older/same-day completions can be imported or arise after a list-version
    // change. They count as games but never inflate or reset the live streak.
    if (streakDate && puzzle.puzzleDate <= streakDate) continue;
    // Streaks reward completing the daily puzzle, including losses and reveals.
    // Wins and their guess distribution stay separate from participation.
    currentStreak = isNextCalendarDate(streakDate, puzzle.puzzleDate) ? currentStreak + 1 : 1;
    streakDate = puzzle.puzzleDate;
    maxStreak = Math.max(maxStreak, currentStreak);
  }

  return {
    gamesPlayed: completed.length,
    wins,
    currentStreak,
    maxStreak,
    guessDistribution: distribution,
    lastCompletedPuzzleId: completed.at(-1)?.puzzleId,
  };
}

function uniqueCompletedHistory(history: readonly DailyWordPuzzleState[]): DailyWordPuzzleState[] {
  const byId = new Map<string, DailyWordPuzzleState>();
  for (const puzzle of history) {
    if (!puzzle.completed) continue;
    const existing = byId.get(puzzle.puzzleId);
    if (!existing || compareCompleteness(existing, puzzle) < 0) byId.set(puzzle.puzzleId, puzzle);
  }
  return [...byId.values()].sort((left, right) => (
    completionTimestamp(left).localeCompare(completionTimestamp(right))
    || left.puzzleId.localeCompare(right.puzzleId)
  ));
}

function completionTimestamp(puzzle: DailyWordPuzzleState): string {
  return puzzle.completedAt ?? puzzle.updatedAt ?? puzzle.startedAt;
}

function compareCompleteness(left: DailyWordPuzzleState, right: DailyWordPuzzleState): number {
  const progress = left.guesses.length - right.guesses.length;
  if (progress) return progress;
  const updated = left.updatedAt.localeCompare(right.updatedAt);
  if (updated) return updated;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
