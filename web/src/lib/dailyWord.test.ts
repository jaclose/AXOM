import { describe, expect, it } from "vitest";
import type { DailyWordPuzzleState } from "./types";
import {
  buildDailyWordPuzzleId,
  buildDailyWordShare,
  normalizeDailyWordPuzzle,
  dailyWordNumber,
  canonicalTimeZone,
  createDailyWordPuzzle,
  deriveDailyWordStats,
  fnv1a32,
  getCalendarDateKey,
  isCalendarDateKey,
  isNextCalendarDate,
  isValidTimeZone,
  millisecondsUntilNextCalendarDate,
  mergeDailyWordHistories,
  normalizeDailyWordHistory,
  resolveTimeZone,
  scoreGuess,
  selectDailyWordAnswer,
  selectDailyWordPuzzle,
  type LetterEvaluation,
} from "./dailyWord";
import { deriveDailyWordStatsFromNormalizedHistory } from "./dailyWordStats";

describe("hints and reveal", () => {
  it("keeps the streak through a revealed day without counting it as a win", () => {
    const revealed = { ...completedPuzzle("2026-07-13", false, 2, "2026-07-13T20:00:00Z"), revealed: true, hintsUsed: 3 };
    const stats = deriveDailyWordStats([
      completedPuzzle("2026-07-12", true, 3, "2026-07-12T20:00:00Z"),
      revealed,
      completedPuzzle("2026-07-14", true, 4, "2026-07-14T20:00:00Z"),
    ]);
    expect(stats).toMatchObject({ gamesPlayed: 3, wins: 2, currentStreak: 3, maxStreak: 3 });
    expect(Object.values(stats.guessDistribution).reduce((sum, n) => sum + n, 0)).toBe(2);
  });

  it("normalizes hint fields and never lets a won puzzle also be revealed", () => {
    const won = normalizeDailyWordPuzzle({ ...completedPuzzle("2026-07-12", true, 3, "2026-07-12T20:00:00Z"), revealed: true, hintsUsed: 9 });
    expect(won).toMatchObject({ won: true, hintsUsed: 3 });
    expect(won?.revealed).toBeUndefined();
    const plain = normalizeDailyWordPuzzle(completedPuzzle("2026-07-12", true, 3, "2026-07-12T20:00:00Z"));
    expect(plain && "hintsUsed" in plain).toBe(false);
  });

  it("marks hints and reveals in the share text", () => {
    const withHints = { ...completedPuzzle("2026-07-12", true, 1, "2026-07-12T20:00:00Z"), hintsUsed: 2 };
    expect(buildDailyWordShare(withHints, [scoreGuess("APPLE", "APPLE")]).split("\n")[0]).toBe("AXOM Daily Word #1 1/6 💡2");
    const revealed = { ...completedPuzzle("2026-07-12", false, 1, "2026-07-12T20:00:00Z"), revealed: true, hintsUsed: 3 };
    expect(buildDailyWordShare(revealed, [scoreGuess("CRANE", "APPLE")]).split("\n")[0]).toBe("AXOM Daily Word #1 revealed");
  });
});

describe("daily word number", () => {
  it("counts from launch day and stays stable across time zones", () => {
    expect(dailyWordNumber("2026-07-12")).toBe(1);
    expect(dailyWordNumber("2026-07-13")).toBe(2);
    expect(dailyWordNumber("2026-09-29")).toBe(80);
  });
});

describe("Daily Word calendar and deterministic answer selection", () => {
  it("formats calendar parts in the explicit IANA timezone", () => {
    const instant = new Date("2026-07-12T02:30:00.000Z");
    expect(getCalendarDateKey(instant, "America/Grenada")).toBe("2026-07-11");
    expect(getCalendarDateKey(instant, "Asia/Tokyo")).toBe("2026-07-12");
  });

  it("uses calendar boundaries across DST start and end", () => {
    expect(getCalendarDateKey(new Date("2025-03-09T04:59:00.000Z"), "America/New_York")).toBe("2025-03-08");
    expect(getCalendarDateKey(new Date("2025-03-09T05:00:00.000Z"), "America/New_York")).toBe("2025-03-09");
    expect(getCalendarDateKey(new Date("2025-11-02T03:59:00.000Z"), "America/New_York")).toBe("2025-11-01");
    expect(getCalendarDateKey(new Date("2025-11-02T04:00:00.000Z"), "America/New_York")).toBe("2025-11-02");
  });

  it("calculates the next puzzle boundary through fixed-offset and DST days", () => {
    expect(millisecondsUntilNextCalendarDate(
      new Date("2026-07-12T14:00:00.000Z"),
      "America/Grenada",
    )).toBe(14 * 60 * 60 * 1000);
    expect(millisecondsUntilNextCalendarDate(
      new Date("2025-03-09T05:00:00.000Z"),
      "America/New_York",
    )).toBe(23 * 60 * 60 * 1000);
    expect(millisecondsUntilNextCalendarDate(
      new Date("2025-11-02T04:00:00.000Z"),
      "America/New_York",
    )).toBe(25 * 60 * 60 * 1000);
    expect(() => millisecondsUntilNextCalendarDate(new Date(), "invalid")).toThrow(/IANA timezone/);
  });

  it("validates, canonicalizes, and safely resolves timezone preferences", () => {
    expect(isValidTimeZone("America/Grenada")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(canonicalTimeZone("America/Grenada")).toBe("America/Grenada");
    expect(resolveTimeZone({ mode: "custom", customTimezone: "Asia/Tokyo" }, "America/Grenada")).toBe("Asia/Tokyo");
    expect(resolveTimeZone({ mode: "custom", customTimezone: "invalid" }, "America/Grenada")).toBe("America/Grenada");
    expect(() => getCalendarDateKey(new Date(), "invalid")).toThrow(/IANA timezone/);
  });

  it("validates Gregorian date keys without elapsed-hour arithmetic", () => {
    expect(isCalendarDateKey("2024-02-29")).toBe(true);
    expect(isCalendarDateKey("2025-02-29")).toBe(false);
    expect(isNextCalendarDate("2024-02-29", "2024-03-01")).toBe(true);
    expect(isNextCalendarDate("2025-12-31", "2026-01-01")).toBe(true);
    expect(isNextCalendarDate("2025-03-08", "2025-03-10")).toBe(false);
  });

  it("selects the same answer for the same date/version namespace", () => {
    const answers = ["APPLE", "BRAIN", "CRANE", "DELTA"];
    const id = buildDailyWordPuzzleId("general-1", "2026-07-12");
    expect(id).toBe("daily-word:general-1:2026-07-12");
    expect(fnv1a32(id)).toBe(4019199481);
    expect(selectDailyWordAnswer(id, answers)).toBe("BRAIN");
    expect(buildDailyWordPuzzleId("general-2", "2026-07-12")).not.toBe(id);
  });

  it("rejects malformed identifiers, dates, and answer lists", () => {
    expect(() => buildDailyWordPuzzleId("bad version", "2026-07-12")).toThrow();
    expect(() => buildDailyWordPuzzleId("general-1", "2026-02-30")).toThrow();
    expect(() => selectDailyWordAnswer("daily-word:general-1:2026-07-12", [])).toThrow();
    expect(() => selectDailyWordAnswer("daily-word:general-1:2026-07-12", ["SIX"])).toThrow();
  });
});

describe("Daily Word duplicate-letter scoring", () => {
  const fixtures: Array<[answer: string, guess: string, expected: LetterEvaluation[]]> = [
    ["APPLE", "ALLEY", ["correct", "present", "absent", "present", "absent"]],
    ["LEVEL", "EERIE", ["present", "correct", "absent", "absent", "absent"]],
    ["SHEEP", "PEEPS", ["present", "present", "correct", "absent", "present"]],
    ["ARRAY", "AAAAA", ["correct", "absent", "absent", "correct", "absent"]],
    ["BANAL", "LLAMA", ["present", "absent", "present", "absent", "present"]],
    ["SASSY", "ASSES", ["present", "present", "correct", "absent", "present"]],
  ];

  it.each(fixtures)("scores %s against %s with duplicate counts", (answer, guess, expected) => {
    expect(scoreGuess(guess, answer)).toEqual(expected);
  });

  it("handles all-correct, all-absent, lowercase, and both duplicate directions", () => {
    expect(scoreGuess("crane", "CRANE")).toEqual(Array(5).fill("correct"));
    expect(scoreGuess("BULKY", "CRANE")).toEqual(Array(5).fill("absent"));
    expect(scoreGuess("ABBEY", "CABBY")).toEqual(["present", "present", "correct", "absent", "correct"]);
    expect(scoreGuess("CABBY", "ABBEY")).toEqual(["absent", "present", "correct", "present", "correct"]);
  });

  it("rejects invalid length and nonalphabetic input", () => {
    expect(() => scoreGuess("FOUR", "CRANE")).toThrow(/five/);
    expect(() => scoreGuess("SIX123", "CRANE")).toThrow(/five/);
    expect(() => scoreGuess("AB1DE", "CRANE")).toThrow(/A-Z/);
    expect(() => scoreGuess("CRANE", "A-B-C")).toThrow(/A-Z/);
  });
});

describe("Daily Word durable puzzle selection", () => {
  it("creates only the selected date and does not synthesize missed days", () => {
    const old = createDailyWordPuzzle("2026-07-09", "America/Grenada", "general-1", new Date("2026-07-09T14:00:00Z"));
    const selected = selectDailyWordPuzzle({
      history: [old],
      now: new Date("2026-07-12T14:00:00Z"),
      timeZone: "America/Grenada",
      wordListVersion: "general-1",
    });
    expect(selected.created).toBe(true);
    expect(selected.puzzle.puzzleDate).toBe("2026-07-12");
    expect(selected.history.map((puzzle) => puzzle.puzzleDate)).toEqual(["2026-07-09", "2026-07-12"]);
  });

  it("keeps an active puzzle locked to its recorded timezone and version", () => {
    const active = createDailyWordPuzzle("2026-07-11", "America/Grenada", "general-1", new Date("2026-07-11T15:00:00Z"));
    const selected = selectDailyWordPuzzle({
      history: [active],
      now: new Date("2026-07-12T02:30:00Z"), // July 11 in Grenada, July 12 in Tokyo
      timeZone: "Asia/Tokyo",
      wordListVersion: "general-2",
    });
    expect(selected).toMatchObject({ created: false, status: "locked" });
    expect(selected.puzzle.puzzleId).toBe(active.puzzleId);
    expect(selected.puzzle.timezone).toBe("America/Grenada");
  });

  it("advances after the locked timezone reaches a later calendar date", () => {
    const active = createDailyWordPuzzle("2026-07-11", "America/Grenada", "general-1", new Date("2026-07-11T15:00:00Z"));
    const selected = selectDailyWordPuzzle({
      history: [active],
      now: new Date("2026-07-12T05:00:00Z"),
      timeZone: "America/Grenada",
      wordListVersion: "general-1",
    });
    expect(selected).toMatchObject({ created: true, status: "current" });
    expect(selected.puzzle.puzzleDate).toBe("2026-07-12");
  });

  it("does not create an older puzzle when the clock moves backward", () => {
    const future = completedPuzzle("2026-07-12", true, 3, "2026-07-12T18:00:00Z");
    const selected = selectDailyWordPuzzle({
      history: [future],
      now: new Date("2026-07-10T18:00:00Z"),
      timeZone: "America/Grenada",
      wordListVersion: "general-1",
    });
    expect(selected).toMatchObject({ created: false, status: "clock-behind" });
    expect(selected.puzzle.puzzleId).toBe(future.puzzleId);
    expect(selected.history).toHaveLength(1);
  });

  it("keeps one legacy puzzle for its date, then uses the new namespace on the next date", () => {
    const completed = completedPuzzle("2026-07-12", true, 2, "2026-07-12T15:00:00Z");
    const sameDate = selectDailyWordPuzzle({
      history: [completed],
      now: new Date("2026-07-12T18:00:00Z"),
      timeZone: "America/Grenada",
      wordListVersion: "general-2",
    });
    expect(sameDate.created).toBe(false);
    expect(sameDate.puzzle.puzzleId).toBe(completed.puzzleId);
    expect(sameDate.history).toHaveLength(1);

    const nextVersion = selectDailyWordPuzzle({
      history: [completed],
      now: new Date("2026-07-13T18:00:00Z"),
      timeZone: "America/Grenada",
      wordListVersion: "general-2",
    });
    expect(nextVersion.created).toBe(true);
    expect(nextVersion.puzzle.puzzleId).toBe("daily-word:general-2:2026-07-13");
    expect(nextVersion.history).toHaveLength(2);
  });
});

describe("Daily Word history, statistics, and sharing", () => {
  it("normalizes and deterministically merges duplicate records by completeness", () => {
    const base = createDailyWordPuzzle("2026-07-12", "America/Grenada", "general-1", new Date("2026-07-12T12:00:00Z"));
    const progressed = { ...base, guesses: ["CRANE"], updatedAt: "2026-07-12T12:05:00.000Z" };
    const complete = completedPuzzle("2026-07-12", true, 2, "2026-07-12T12:10:00Z");
    const merged = mergeDailyWordHistories([base, progressed], [complete]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ completed: true, won: true, guesses: ["CRANE", "APPLE"] });
    expect(normalizeDailyWordHistory([{ nope: true }, complete, complete])).toHaveLength(1);
  });

  it("derives idempotent games, wins, distribution, consecutive streaks, and loss reset", () => {
    const history = [
      completedPuzzle("2026-07-08", true, 2, "2026-07-08T18:00:00Z"),
      completedPuzzle("2026-07-09", true, 3, "2026-07-09T18:00:00Z"),
      completedPuzzle("2026-07-10", false, 6, "2026-07-10T18:00:00Z"),
      completedPuzzle("2026-07-12", true, 4, "2026-07-12T18:00:00Z"),
    ];
    const stats = deriveDailyWordStats([...history, history[3]]);
    expect(stats).toMatchObject({ gamesPlayed: 4, wins: 3, currentStreak: 1, maxStreak: 2 });
    expect(stats.guessDistribution).toMatchObject({ 2: 1, 3: 1, 4: 1, 6: 0 });
    expect(deriveDailyWordStatsFromNormalizedHistory(normalizeDailyWordHistory([...history, history[3]])))
      .toEqual(stats);
  });

  it("does not inflate the live streak when an older completion arrives later", () => {
    const history = [
      completedPuzzle("2026-07-10", true, 2, "2026-07-10T18:00:00Z"),
      completedPuzzle("2026-07-11", true, 2, "2026-07-11T18:00:00Z"),
      completedPuzzle("2026-07-09", true, 2, "2026-07-12T18:00:00Z"),
    ];
    expect(deriveDailyWordStats(history)).toMatchObject({ gamesPlayed: 3, wins: 3, currentStreak: 2, maxStreak: 2 });
  });

  it("creates an answer- and guess-free result grid", () => {
    const puzzle = completedPuzzle("2026-07-12", true, 2, "2026-07-12T18:00:00Z");
    const rows = puzzle.guesses.map((guess) => scoreGuess(guess, "APPLE"));
    const shared = buildDailyWordShare(puzzle, rows);
    expect(shared.split("\n")[0]).toBe("AXOM Daily Word #1 2/6");
    expect(shared).toContain("🟩🟩🟩🟩🟩");
    expect(shared.trim().endsWith("axom.info")).toBe(true);
    expect(shared).not.toContain("APPLE");
    expect(shared).not.toContain("CRANE");
    expect(shared).not.toContain("answer");
  });

  it("rejects sharing an unfinished puzzle or incomplete evaluation rows", () => {
    const active = createDailyWordPuzzle("2026-07-12", "America/Grenada", "general-1");
    expect(() => buildDailyWordShare(active, [])).toThrow(/Complete/);
    const completed = completedPuzzle("2026-07-12", false, 6, "2026-07-12T18:00:00Z");
    expect(() => buildDailyWordShare(completed, [])).toThrow(/every submitted guess/);
  });
});

function completedPuzzle(
  date: string,
  won: boolean,
  guesses: number,
  completedAt: string,
): DailyWordPuzzleState {
  const words = ["CRANE", "BLUSH", "POINT", "SHELF", "MIGHT", "APPLE"].slice(0, guesses);
  if (won) words[words.length - 1] = "APPLE";
  return {
    ...createDailyWordPuzzle(date, "America/Grenada", "general-1", new Date(`${date}T12:00:00Z`)),
    guesses: words,
    completed: true,
    won,
    updatedAt: completedAt,
    completedAt,
  };
}
