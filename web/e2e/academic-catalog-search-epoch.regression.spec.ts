import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import { academicPublishFixture } from "./academicPublishFixture";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Search is a permissioned view, not a write path. A slow response to an old
// search must not replace the latest query's catalog or alter downloaded work.
// The RPC and all courses are synthetic; this is not hosted RLS acceptance.
async function savedCourse(page: Page, sourceIds: readonly string[]) {
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
      tracker: state.tracker.filter(row => row.templateKey).map(row => ({
        id: row.id, path: row.path, templateKey: row.templateKey, passes: row.passes,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      questions: state.questions.filter(q => ids.includes(q.content?.id ?? "")).map(q => ({
        id: q.id, sourceId: q.content?.id, attempts: q.attempts, week: q.week,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }, [...sourceIds]);
}

async function openCatalog(page: Page) {
  const region = page.getByRole("region", { name: "Available question banks" });
  if (!await region.isVisible())
    await page.getByText("Browse the course catalog", { exact: true }).click();
  await expect(region).toBeVisible();
  return region;
}

for (const width of [320, 390, 1440]) {
  test(`an older academic search response cannot replace the current course or progress at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    const backend = await academicPublishFixture(page);
    const alpha = backend.seedCourse({
      title: "Alpha synthetic term one", module: "FTM 1", term: 1,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const beta = backend.seedCourse({
      title: "Beta synthetic term five", module: "GOER", term: 5,
      withPlan: true, weeks: [{ week: 2, readyQuestions: 1 }],
    });
    const sourceIds = [...alpha.readyQuestionIdsByWeek[2], ...beta.readyQuestionIdsByWeek[2]];
    await seedOnboarded(page);
    await page.goto("/?app=1#questions");

    const catalog = await openCatalog(page);
    await catalog.locator(`[data-course-id="${beta.id}"]`).click();
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

    const before = await savedCourse(page, sourceIds);
    expect(before.tracker).toHaveLength(1);
    expect(before.tracker[0].path).toMatch(/^Term 5\//);
    expect(before.questions).toHaveLength(1);
    expect(before.questions[0].sourceId).toBe(beta.readyQuestionIdsByWeek[2][0]);
    expect(before.questions[0].attempts).toHaveLength(1);
    await reloadAfterSave(page);
    expect(await savedCourse(page, sourceIds)).toEqual(before);

    const searchCatalog = await openCatalog(page);
    const search = searchCatalog.getByRole("searchbox", { name: "Search available banks" });
    await expect(search).toBeVisible();
    let releaseOld!: () => void;
    const held = new Promise<void>(resolve => { releaseOld = resolve; });
    let oldStarted = 0;
    let oldCompleted = 0;

    // Playwright's most recently installed route precedes the fixture RPC.
    // Hold only the Alpha POST, allow Beta to finish, then return stale Alpha.
    await page.route("**/rpc/academic_catalog", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { search?: string };
      if (body.search !== "Alpha") return route.fallback();
      oldStarted++;
      await held;
      try { await route.fallback(); } finally { oldCompleted++; }
    });
    try {
      await search.fill("Alpha");
      await expect.poll(() => oldStarted).toBe(1);
      await search.fill("Beta");
      const betaCard = searchCatalog.locator(`[data-course-id="${beta.id}"]`);
      const alphaCard = searchCatalog.locator(`[data-course-id="${alpha.id}"]`);
      await expect(betaCard).toBeVisible();
      await expect(alphaCard).toHaveCount(0);

      // Returning an older valid response must not replace the new query,
      // show the wrong term or mutate the installed question's attempts.
      releaseOld();
      await expect.poll(() => oldCompleted).toBe(1);
      await expect(betaCard).toBeVisible();
      await expect(alphaCard).toHaveCount(0);
      await expect(search).toHaveValue("Beta");
      expect(await savedCourse(page, sourceIds)).toEqual(before);
      expect(backend.catalogRequests.some(request => request.search === "Alpha")).toBe(true);
      expect(backend.catalogRequests.some(request => request.search === "Beta")).toBe(true);
    } finally {
      releaseOld();
      await page.unroute("**/rpc/academic_catalog");
    }

    await reloadAfterSave(page);
    expect(await savedCourse(page, sourceIds)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
