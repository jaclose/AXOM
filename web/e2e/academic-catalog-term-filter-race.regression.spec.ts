import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import { academicPublishFixture } from "./academicPublishFixture";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// A term filter is a permissioned catalog view, not a learner-data write path.
// This synthetic browser test does not establish hosted RLS or publication rights.
async function installedState(page: Page, sourceIds: readonly string[]) {
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
      tracker: state.tracker.filter(item => item.templateKey).map(item => ({
        id: item.id, path: item.path, templateKey: item.templateKey, passes: item.passes,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      questions: state.questions.filter(item => ids.includes(item.content?.id ?? "")).map(item => ({
        id: item.id, sourceId: item.content?.id, week: item.week, attempts: item.attempts,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }, [...sourceIds]);
}

async function questionBankCatalog(page: Page) {
  const details = page.locator("details.qb-course-catalog").first();
  await expect(details).toBeVisible();
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open)))
    await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  const region = details.getByRole("region", { name: "Available question banks" });
  await expect(region).toBeVisible();
  return region;
}

for (const width of [320, 390, 1440]) {
  test(`a delayed Term 1 response cannot replace Term 5 or change saved course work at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    const backend = await academicPublishFixture(page);
    const oldTerm = backend.seedCourse({
      title: "Synthetic alpha term one", module: "FTM 1", term: 1,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const activeTerm = backend.seedCourse({
      title: "Synthetic beta term five", module: "GOER", term: 5,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const sourceIds = [...oldTerm.readyQuestionIdsByWeek[2], ...activeTerm.readyQuestionIdsByWeek[2]];
    await seedOnboarded(page);
    await page.goto("/?app=1#questions");

    // Install a real synthetic reviewed source and record an actual quiz attempt.
    const bankCatalog = await questionBankCatalog(page);
    await bankCatalog.locator(`[data-course-id="${activeTerm.id}"]`).click();
    const plan = page.getByRole("region", { name: "GOER course plan" });
    await expect(plan).toBeVisible();
    await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
    await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    await plan.getByRole("button", { name: "Load Course", exact: true }).click();
    await expect(page.getByText("Course downloaded and enrollment saved to your account.", { exact: true })).toBeVisible();
    await plan.getByRole("button", { name: "Quiz week 2", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Question stem", { exact: true })).toBeVisible();
    await page.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Finish block", exact: true }).click();

    const saved = await installedState(page, sourceIds);
    expect(saved.tracker).toHaveLength(1);
    expect(saved.tracker[0].path).toMatch(/^Term 5\\//);
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions[0].sourceId).toBe(activeTerm.readyQuestionIdsByWeek[2][0]);
    expect(saved.questions[0].attempts).toHaveLength(1);
    await reloadAfterSave(page);
    expect(await installedState(page, sourceIds)).toEqual(saved);

    // Switch surfaces: the Course Library term picker has a distinct catalog
    // query input from the Question Bank's text search.
    await page.goto("/?app=1&course-library=1#tracker");
    await expect(page.getByRole("heading", { name: "Course Library", level: 1 })).toBeVisible();
    const filter = page.getByRole("combobox", { name: "Filter by term" });
    await expect(filter).toBeVisible();
    const alphaCard = page.locator(`[data-course-id="${oldTerm.id}"]`);
    const betaCard = page.locator(`[data-course-id="${activeTerm.id}"]`);
    await expect(betaCard).toBeVisible();
    await expect(alphaCard).toBeVisible();

    let releaseOld!: () => void;
    const held = new Promise<void>(resolve => { releaseOld = resolve; });
    let oldStarted = 0;
    let oldCompleted = 0;
    await page.route("**/rpc/academic_catalog", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { term_filter?: string };
      if (body.term_filter !== "Term 1") return route.fallback();
      oldStarted++;
      await held;
      try { await route.fallback(); } finally { oldCompleted++; }
    });
    try {
      await filter.selectOption("Term 1");
      await expect.poll(() => oldStarted).toBe(1);
      await filter.selectOption("Term 5");
      await expect(betaCard).toBeVisible();
      await expect(alphaCard).toHaveCount(0);

      const oldResponse = page.waitForResponse(response =>
        response.url().endsWith("/rpc/academic_catalog")
        && response.request().method() === "POST"
        && (response.request().postDataJSON() as { term_filter?: string }).term_filter === "Term 1",
      );
      releaseOld();
      expect((await oldResponse).status()).toBe(200);
      await expect.poll(() => oldCompleted).toBe(1);
      await expect(filter).toHaveValue("Term 5");
      await expect(betaCard).toBeVisible();
      await expect(alphaCard).toHaveCount(0);
      expect(backend.catalogRequests.some(request => request.term === "Term 1")).toBe(true);
      expect(backend.catalogRequests.some(request => request.term === "Term 5")).toBe(true);
      expect(await installedState(page, sourceIds)).toEqual(saved);
    } finally {
      releaseOld();
      await page.unroute("**/rpc/academic_catalog");
    }

    await reloadAfterSave(page);
    expect(await installedState(page, sourceIds)).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
