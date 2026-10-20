import type { Page } from "@playwright/test";
import type { DailyWordPuzzleState } from "../src/lib/types";
import { createDailyWordPuzzle, selectDailyWordAnswer } from "../src/lib/dailyWord";
import { DAILY_WORD_ALLOWED_GUESSES, dailyWordAnswersForVersion, WORD_LIST_VERSION } from "../src/data/dailyWordWords";
import { doctordleCaseNumber } from "../src/lib/doctordle";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

test.use({ timezoneId: "America/Grenada" });

const NOW = "2026-10-20T16:00:00.000Z";
const TODAY_CASE = doctordleCaseNumber(Date.parse(NOW));
const ANSWERS = dailyWordAnswersForVersion(WORD_LIST_VERSION)!;
type Dev = {
  useStore: { getState: () => { dailyWordPuzzles: DailyWordPuzzleState[] }; setState: (patch: object) => void };
  flushVault: () => Promise<void>;
};

function syntheticPuzzle(date: string, result: "won" | "lost" | "active") {
  const puzzle = createDailyWordPuzzle(date, "America/Grenada", WORD_LIST_VERSION, new Date(`${date}T12:00:00.000Z`));
  const answer = selectDailyWordAnswer(puzzle.puzzleId, ANSWERS);
  const wrongGuesses = DAILY_WORD_ALLOWED_GUESSES.filter(word => word !== answer).slice(0, 6);
  const completed = result !== "active";
  return {
    puzzle: {
      ...puzzle,
      guesses: result === "won" ? [answer] : wrongGuesses.slice(0, completed ? 6 : 5),
      won: result === "won", completed,
      completedAt: completed ? `${date}T14:00:00.000Z` : undefined,
      updatedAt: `${date}T14:00:00.000Z`,
    },
    lastGuess: wrongGuesses[5],
  };
}

async function history(page: Page) {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().dailyWordPuzzles;
  });
}

for (const width of [1440, 390]) {
  test(`completed losses and missed Doctordle attempts keep streaks after reload (${width}px)`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    const theme = width === 390 ? "light" : "dark";
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(value => localStorage.setItem("axom.theme", value), theme);
    await page.goto("/#daily-word", { waitUntil: "networkidle" });
    await seedOnboarded(page, {
      timeZonePreference: { mode: "custom", customTimezone: "America/Grenada" },
      dailyLoopReminders: { checkInEnabled: false, checkInTime: "08:00", closeoutEnabled: false, closeoutTime: "20:30" },
    });
    const current = syntheticPuzzle("2026-10-20", "active");
    const puzzles = [syntheticPuzzle("2026-10-18", "won").puzzle, syntheticPuzzle("2026-10-19", "lost").puzzle, current.puzzle];
    await page.evaluate(async ({ puzzles, caseNumber }) => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.setState({ dailyWordPuzzles: puzzles });
      localStorage.setItem("axom.doctordle.v1", JSON.stringify({
        opened: [], skipped: [], remindersOff: true,
        results: { [caseNumber - 2]: "solved", [caseNumber - 1]: "missed" },
      }));
      await dev.flushVault();
    }, { puzzles, caseNumber: TODAY_CASE });
    await reloadAfterSave(page);
    await expect(page.getByRole("grid", { name: "Six-row Daily Word puzzle for 2026-10-20" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    await page.keyboard.type("QQQQQ");
    await page.keyboard.press("Enter");
    await expect(page.locator(".daily-word-status")).toContainText("Not recognized");
    expect((await history(page)).find(puzzle => puzzle.puzzleDate === "2026-10-20"))
      .toMatchObject({ completed: false, guesses: current.puzzle.guesses });
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Backspace");
    await page.keyboard.type(current.lastGuess);
    await page.keyboard.press("Enter");
    const result = page.getByRole("dialog", { name: "Puzzle complete", exact: true });
    await expect(result).toBeVisible();
    await expect(result).toContainText("six guesses used, streak kept");
    await expect(result.locator(".daily-word-stats > div").filter({ hasText: "Streak" })).toHaveText("3Streak");
    await expect(result.locator(".daily-word-stats > div").filter({ hasText: "Win %" })).toHaveText("33Win %");
    const completed = await history(page);
    expect(completed.filter(puzzle => puzzle.won)).toHaveLength(1);
    expect(completed.find(puzzle => puzzle.puzzleDate === "2026-10-20"))
      .toMatchObject({ completed: true, won: false, guesses: [...current.puzzle.guesses, current.lastGuess] });
    await page.screenshot({ path: testInfo.outputPath(`word-loss-streak-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await reloadAfterSave(page);
    expect(await history(page)).toEqual(completed);
    await expect(page.getByText("Not this time. Streak kept.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "See results", exact: true }).click();
    await expect(result.locator(".daily-word-stats > div").filter({ hasText: "Streak" })).toHaveText("3Streak");

    await page.goto("/#doctordle", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Doctordle", exact: true })).toBeVisible();
    const missed = page.getByRole("button", { name: "Missed it", exact: true });
    await missed.focus();
    await expect(missed).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".doctordle-stats")).toHaveText("3 in a row3 logged1 got it");
    await expect(page.getByRole("button", { name: "Change to got it", exact: true })).toBeVisible();
    const savedLog = await page.evaluate(() => JSON.parse(localStorage.getItem("axom.doctordle.v1")!));
    expect(savedLog.results).toEqual({ [TODAY_CASE - 2]: "solved", [TODAY_CASE - 1]: "missed", [TODAY_CASE]: "missed" });
    await reloadAfterSave(page);
    await expect(page.locator(".doctordle-stats")).toHaveText("3 in a row3 logged1 got it");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axom.doctordle.v1")!))).toEqual(savedLog);
    expect(await history(page)).toEqual(completed);
    await page.locator(".doctordle-log").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`doctordle-missed-streak-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
