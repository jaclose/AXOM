import type { Page } from "@playwright/test";
import type { AxomState } from "../src/lib/types";
import { STORAGE_KEYS } from "../src/lib/brand";
import { academicPublishFixture } from "./academicPublishFixture";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

async function courseState(page: Page) {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{
      flushVault: () => Promise<void>;
      useStore: { getState: () => AxomState };
    }> }).__AXOM_DEV__;
    await dev.flushVault();
    const state = dev.useStore.getState();
    return {
      questions: state.questions.map(question => ({ id: question.id, sourceId: question.content?.id, week: question.week,
        needsReview: question.needsReview })),
      activities: state.tracker.filter(item => item.templateKey).map(item => ({ id: item.id, path: item.path })),
    };
  });
}

async function activePool(page: Page) {
  return page.evaluate(key => {
    const active = JSON.parse(localStorage.getItem(key) ?? "null") as { poolIds?: string[] } | null;
    return active?.poolIds ?? [];
  }, STORAGE_KEYS.quizActiveSession);
}

function localIds(state: Awaited<ReturnType<typeof courseState>>, sourceIds: readonly string[]) {
  return sourceIds.map(sourceId => {
    const match = state.questions.find(question => question.sourceId === sourceId);
    expect(match, `Downloaded source question ${sourceId} must retain its identity`).toBeDefined();
    return match!.id;
  });
}

async function openCatalog(page: Page) {
  const details = page.locator(".qb-course-catalog").first();
  if (await details.count() && !(await details.evaluate(element => (element as HTMLDetailsElement).open)))
    await details.locator("summary").click();
  const catalog = page.getByRole("region", { name: "Available question banks" });
  await expect(catalog).toBeVisible();
  return catalog;
}

async function finishReadyBlock(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await page.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: index === count - 1 ? "Finish block" : "Next question", exact: true }).click();
  }
}

for (const width of [1440, 390]) {
  test(`five reviewed terms keep a planned Week 2 quiz exact after reload at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const backend = await academicPublishFixture(page);
    const courses = [
      backend.seedCourse({ title: "FTM 1 reviewed set", module: "FTM 1", term: 1 }),
      backend.seedCourse({ title: "NB1 reviewed set", module: "NB1", term: 2 }),
      backend.seedCourse({ title: "BPM502 reviewed set", module: "BPM502", term: 3 }),
      backend.seedCourse({ title: "FTCM reviewed set", module: "FTCM", term: 4 }),
      backend.seedCourse({ title: "GOER weekly plan", module: "GOER", term: 5, withPlan: true,
        weeks: [{ week: 1, readyQuestions: 1 }, { week: 2, readyQuestions: 2, reviewQuestions: 1 }] }),
    ];
    const planned = courses[4];
    await seedOnboarded(page);
    await page.goto("/?app=1#questions");
    const catalog = await openCatalog(page);
    await expect(catalog.locator(".course-term-section h3")).toHaveText(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"]);
    for (const course of courses) await expect(catalog.locator(`[data-course-id="${course.id}"]`)).toContainText(course.module);
    expect(await catalog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-five-term-catalog-${width}.png`, fullPage: true });

    await catalog.locator(`[data-course-id="${courses[3].id}"]`).click();
    const unrelated = page.getByRole("region", { name: "FTCM question collection" });
    await unrelated.getByRole("button", { name: "Download questions", exact: true }).click();
    await expect(unrelated).toContainText("1 reviewed question is on this device.");
    await unrelated.getByRole("button", { name: "All courses", exact: true }).click();

    await catalog.locator(`[data-course-id="${planned.id}"]`).click();
    const plan = page.getByRole("region", { name: "GOER course plan" });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole("checkbox", { name: "Week 1", exact: true })).toBeVisible();
    await expect(plan.getByRole("checkbox", { name: "Week 2", exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/axom-five-term-plan-${width}.png`, fullPage: true });
    await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(plan.getByRole("button", { name: "Load Course", exact: true })).toBeDisabled();
    await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    await plan.getByRole("button", { name: "Load Course", exact: true }).click();
    await expect(page.getByText("Course downloaded and enrollment saved to your account.", { exact: true })).toBeVisible();
    const loaded = await courseState(page);
    expect(loaded.activities).toHaveLength(1);
    expect(loaded.activities[0].path).toContain("Week 2");
    expect(loaded.questions).toHaveLength(4);
    const week2Ids = localIds(loaded, planned.readyQuestionIdsByWeek[2]);
    const excludedIds = localIds(loaded, [...planned.readyQuestionIdsByWeek[1], ...courses[3].readyQuestionIds]);
    expect(loaded.questions.every(question => !question.needsReview)).toBe(true);
    expect(loaded.questions.filter(question => week2Ids.includes(question.id)).map(question => question.week)).toEqual([2, 2]);

    await reloadAfterSave(page);
    const reloaded = await courseState(page);
    expect(reloaded).toEqual(loaded);
    const reloadedCatalog = await openCatalog(page);
    await reloadedCatalog.locator(`[data-course-id="${planned.id}"]`).click();
    await expect(plan.getByRole("button", { name: "Quiz week 2", exact: true })).toBeVisible();
    expect(await plan.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await plan.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Question 1 of 2", exact: true })).toBeVisible();
    expect((await activePool(page)).sort()).toEqual([...week2Ids].sort());
    expect((await activePool(page)).some(id => excludedIds.includes(id))).toBe(false);
    await finishReadyBlock(page, 2);
    await reloadAfterSave(page);
    const repeatCatalog = await openCatalog(page);
    await repeatCatalog.locator(`[data-course-id="${planned.id}"]`).click();
    await plan.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Question 1 of 2", exact: true })).toBeVisible();
    expect((await activePool(page)).sort()).toEqual([...week2Ids].sort());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`reviewed source-only weeks keep held rows out of Week 2 at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const backend = await academicPublishFixture(page);
    const other = backend.seedCourse({ title: "Other reviewed course", module: "FTM 1", term: 1 });
    const sourceOnly = backend.seedCourse({ title: "NMI reviewed sources", module: "NMI", term: 5,
      weeks: [{ week: 1, readyQuestions: 2 }, { week: 2, readyQuestions: 1, reviewQuestions: 1 },
        { week: 3, readyQuestions: 0, reviewQuestions: 1 }] });
    await seedOnboarded(page);
    await page.goto("/?app=1#questions");
    const catalog = await openCatalog(page);
    await catalog.locator(`[data-course-id="${other.id}"]`).click();
    const unrelated = page.getByRole("region", { name: "FTM 1 question collection" });
    await unrelated.getByRole("button", { name: "Download questions", exact: true }).click();
    await expect(unrelated).toContainText("1 reviewed question is on this device.");
    await unrelated.getByRole("button", { name: "All courses", exact: true }).click();
    await catalog.locator(`[data-course-id="${sourceOnly.id}"]`).click();
    const collection = page.getByRole("region", { name: "NMI question collection" });
    await expect(collection).toBeVisible();
    await collection.getByRole("button", { name: "Download questions", exact: true }).click();
    await expect(collection).toContainText("3 reviewed questions are on this device.");
    const downloaded = await courseState(page);
    expect(downloaded.questions).toHaveLength(4);
    expect(downloaded.questions.every(question => !question.needsReview)).toBe(true);
    const week2Ids = localIds(downloaded, sourceOnly.readyQuestionIdsByWeek[2]);
    const excludedIds = localIds(downloaded, [...sourceOnly.readyQuestionIdsByWeek[1], ...other.readyQuestionIds]);
    await expect(collection.getByText("Week 1", { exact: true })).toBeVisible();
    await expect(collection.getByText("Week 2", { exact: true })).toBeVisible();
    await expect(collection.getByText("Week 3", { exact: true })).toHaveCount(0);
    await expect(collection).toContainText("2 awaiting review");
    await expect(collection.getByRole("button", { name: "Quiz week 3", exact: true })).toHaveCount(0);
    await expect(collection.getByRole("button", { name: "Create Quiz", exact: true })).toBeVisible();
    expect(await collection.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-source-weeks-${width}.png`, fullPage: true });
    await collection.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
    expect(await activePool(page)).toEqual(week2Ids);
    expect((await activePool(page)).some(id => excludedIds.includes(id))).toBe(false);
    await finishReadyBlock(page, 1);
    await reloadAfterSave(page);
    const repeatCatalog = await openCatalog(page);
    await repeatCatalog.locator(`[data-course-id="${sourceOnly.id}"]`).click();
    await collection.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
    expect(await activePool(page)).toEqual(week2Ids);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
