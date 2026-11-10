import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import { STORAGE_KEYS } from "../src/lib/brand";
import { academicPublishFixture } from "./academicPublishFixture";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Course ownership must be keyed by exact collection, academic term and source
// identity, not by a repeated display title, module label or Week 2 number.
// Synthetic approved material only: no real accounts, source documents or RLS.
async function savedScope(page: Page, sourceIds: string[]) {
  return page.evaluate(async ids => {
    const dev = await (window as unknown as {
      __AXOM_DEV__: Promise<{
        useStore: { getState: () => NoctyriumState };
        flushVault: () => Promise<void>;
      }>;
    }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    return {
      tracker: state.tracker.filter(row => row.templateKey && row.path.includes("FTM 1")).map(row => ({
        id: row.id, path: row.path, templateKey: row.templateKey, passes: row.passes,
      })).sort((a, b) => a.path.localeCompare(b.path)),
      questions: state.questions.filter(q => ids.includes(q.content?.id ?? "")).map(q => ({
        id: q.id, sourceId: q.content?.id ?? "", attempts: q.attempts, week: q.week,
      })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    };
  }, sourceIds);
}

async function catalogRegion(page: Page) {
  const details = page.locator(".qb-course-catalog").first();
  if (await details.count() && !(await details.evaluate(el => (el as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  const catalog = page.getByRole("region", { name: "Available question banks" });
  await expect(catalog).toBeVisible();
  return catalog;
}

async function loadWeekTwo(page: Page, collectionId: string) {
  const catalog = await catalogRegion(page);
  await catalog.locator(`[data-course-id="${collectionId}"]`).click();
  const plan = page.getByRole("region", { name: "FTM 1 course plan" });
  await expect(plan).toBeVisible();
  await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
  await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
  await plan.getByRole("button", { name: "Load Course", exact: true }).click();
  await expect(page.getByText("Course downloaded and enrollment saved to your account.", { exact: true })).toBeVisible();
  return plan;
}

async function finishOneWeekQuestion(page: Page, expectedId: string) {
  await expect(page.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
  const pool = await page.evaluate(key => {
    const active = JSON.parse(localStorage.getItem(key) ?? "null") as { poolIds?: string[] } | null;
    return active?.poolIds ?? [];
  }, STORAGE_KEYS.quizActiveSession);
  expect(pool).toEqual([expectedId]);
  await page.getByLabel("Question stem", { exact: true }).focus();
  await page.keyboard.press("A");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
}

for (const width of [320, 390, 1440]) {
  test(`identical module, course title and week in two terms never share progress at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    const backend = await academicPublishFixture(page);
    const first = backend.seedCourse({
      title: "Repeated synthetic module", module: "FTM 1", term: 1,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const second = backend.seedCourse({
      title: "Repeated synthetic module", module: "FTM 1", term: 2,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const sourceIds = [...first.readyQuestionIdsByWeek[2], ...second.readyQuestionIdsByWeek[2]];
    expect(new Set(sourceIds).size).toBe(2);
    await seedOnboarded(page);
    await page.goto("/?app=1#questions");

    const firstPlan = await loadWeekTwo(page, first.id);
    const firstOnly = await savedScope(page, sourceIds);
    expect(firstOnly.tracker).toHaveLength(1);
    expect(firstOnly.tracker[0].path).toMatch(/^Term 1\//);
    expect(firstOnly.questions.map(q => q.sourceId)).toEqual(first.readyQuestionIdsByWeek[2]);
    await firstPlan.getByRole("button", { name: "Quiz week 2", exact: true }).focus();
    await page.keyboard.press("Enter");
    await finishOneWeekQuestion(page, firstOnly.questions[0].id);

    const firstCompleted = await savedScope(page, sourceIds);
    expect(firstCompleted.questions[0].attempts).toHaveLength(1);
    await reloadAfterSave(page);
    expect(await savedScope(page, sourceIds)).toEqual(firstCompleted);

    const secondPlan = await loadWeekTwo(page, second.id);
    const both = await savedScope(page, sourceIds);
    expect(both.tracker).toHaveLength(2);
    expect(both.tracker.map(row => row.path)).toEqual([
      expect.stringMatching(/^Term 1\//),
      expect.stringMatching(/^Term 2\//),
    ]);
    expect(new Set(both.tracker.map(row => row.id)).size).toBe(2);
    // A lecture key may repeat across terms; the owner-scoped path must not.
    expect(new Set(both.tracker.map(row => `${row.path}|${row.templateKey}`)).size).toBe(2);
    expect(both.questions.map(q => q.sourceId).sort()).toEqual([...sourceIds].sort());
    const firstQuestion = both.questions.find(q => q.sourceId === first.readyQuestionIdsByWeek[2][0])!;
    const secondQuestion = both.questions.find(q => q.sourceId === second.readyQuestionIdsByWeek[2][0])!;
    expect(firstQuestion.attempts).toHaveLength(1);
    expect(secondQuestion.attempts).toHaveLength(0);

    await secondPlan.getByRole("button", { name: "Quiz week 2", exact: true }).focus();
    await page.keyboard.press("Enter");
    await finishOneWeekQuestion(page, secondQuestion.id);
    const completed = await savedScope(page, sourceIds);
    expect(completed.questions.every(q => q.attempts.length === 1)).toBe(true);
    expect(completed.tracker).toEqual(both.tracker);

    await reloadAfterSave(page);
    expect(await savedScope(page, sourceIds)).toEqual(completed);

    // Once both identically titled modules exist, reopening Term 1 must still
    // produce ONLY Term 1's source-bound question, not the most recent term.
    const repeatCatalog = await catalogRegion(page);
    await repeatCatalog.locator(`[data-course-id="${first.id}"]`).click();
    const repeatPlan = page.getByRole("region", { name: "FTM 1 course plan" });
    await repeatPlan.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
    const repeatPool = await page.evaluate(key => {
      const active = JSON.parse(localStorage.getItem(key) ?? "null") as { poolIds?: string[] } | null;
      return active?.poolIds ?? [];
    }, STORAGE_KEYS.quizActiveSession);
    expect(repeatPool).toEqual([firstQuestion.id]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
