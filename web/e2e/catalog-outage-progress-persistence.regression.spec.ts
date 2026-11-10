import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import { academicCatalogFixture, collection } from "./academicCatalogFixture";
import { expect, reloadAfterSave, test } from "./fixtures";

// A catalog 503 is not permission to replace a learner's already downloaded
// course, question attempts, source bindings or tracker activity identities.
// All account/service traffic below is synthetic and intercepted in-process.
async function savedCourse(page: Page) {
  return page.evaluate(async () => {
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
      questions: state.questions.filter(question => question.content?.id === "shared-q1").map(question => ({
        id: question.id,
        sourceId: question.content?.id,
        attempts: question.attempts,
        attachments: question.attachments?.length ?? 0,
      })),
    };
  });
}

// After a completed quiz/reload, the Questions page intentionally collapses
// the remote catalog section; reopen it before exercising a refresh control.
async function openCatalog(page: Page) {
  const region = page.getByRole("region", { name: "Available question banks" });
  if (!await region.isVisible()) {
    await page.getByText("Browse the course catalog", { exact: true }).click();
  }
  await expect(region).toBeVisible();
  return region;
}

for (const width of [320, 390, 1440]) {
  test(`a catalog outage after a quiz preserves course, attempts and tracker IDs at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    const backend = await academicCatalogFixture(page);
    const catalog = await openCatalog(page);
    const card = catalog.locator(`[data-course-id="${collection}"]`);
    await expect(card).toBeVisible();
    await card.click();
    const plan = page.getByRole("region", { name: "GOER course plan" });
    await expect(plan).toBeVisible();
    await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
    await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    await plan.getByRole("button", { name: "Load Course", exact: true }).click();
    await expect(page.getByText("Course downloaded and enrollment saved to your account.", { exact: true })).toBeVisible();

    await plan.getByRole("button", { name: "Quiz week 2", exact: true }).click();
    await expect(page.getByLabel("Question stem", { exact: true })).toBeVisible();
    await page.getByLabel("Question stem", { exact: true }).focus();
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Finish block", exact: true }).click();

    const before = await savedCourse(page);
    expect(before.tracker).toHaveLength(2);
    expect(before.questions).toHaveLength(1);
    expect(before.questions[0].attempts).toHaveLength(1);
    expect(before.questions[0].attachments).toBeGreaterThan(0);
    await reloadAfterSave(page);
    expect(await savedCourse(page)).toEqual(before);
    await openCatalog(page);

    // A remote catalog refresh failure must not destroy the already persisted
    // private course state; repeat across a full boot while still offline.
    backend.fail();
    await catalog.getByRole("button", { name: "Refresh banks" }).click();
    await expect(catalog.getByRole("alert")).toContainText("could not be loaded");
    expect(await savedCourse(page)).toEqual(before);
    await reloadAfterSave(page);
    expect(await savedCourse(page)).toEqual(before);
    await openCatalog(page);

    backend.recover();
    await catalog.getByRole("button", { name: "Refresh banks" }).click();
    await expect(catalog.getByRole("alert")).toHaveCount(0);
    await expect(card).toBeVisible();
    await card.click();
    await expect(plan).toBeVisible();
    await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
    await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    await plan.getByRole("button", { name: "Load Course", exact: true }).click();
    await expect(plan.getByRole("status")).toContainText("already in My Courses");
    expect(await savedCourse(page)).toEqual(before);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
