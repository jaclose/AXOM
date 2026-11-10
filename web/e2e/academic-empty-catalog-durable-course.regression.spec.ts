import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
import { academicCatalogFixture, collection } from "./academicCatalogFixture";
import { expect, reloadAfterSave, test } from "./fixtures";

// An HTTP 200 with zero rows is not an instruction to erase the learner's
// previously downloaded course. A transient empty/RLS-filtered catalog differs
// from a 503 response and must preserve local source IDs and attempts.
async function persistedCourse(page: Page) {
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
      tracker: state.tracker.filter(item => item.templateKey).map(item => ({
        id: item.id, path: item.path, templateKey: item.templateKey, passes: item.passes,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      questions: state.questions.filter(q => q.content?.id === "shared-q1").map(q => ({
        id: q.id, sourceId: q.content?.id,
        attempts: q.attempts, attachments: q.attachments?.length ?? 0,
      })),
    };
  });
}

async function catalogRegion(page: Page) {
  const region = page.getByRole("region", { name: "Available question banks" });
  if (!await region.isVisible()) {
    await page.getByText("Browse the course catalog", { exact: true }).click();
  }
  await expect(region).toBeVisible();
  return region;
}

for (const width of [320, 390, 1440]) {
  test(`a 200-empty catalog never deletes downloaded question progress at ${width}px`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));

    await academicCatalogFixture(page);
    const catalog = await catalogRegion(page);
    const card = catalog.locator(`[data-course-id="${collection}"]`);
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

    const before = await persistedCourse(page);
    expect(before.tracker).toHaveLength(2);
    expect(before.questions).toHaveLength(1);
    expect(before.questions[0].attempts).toHaveLength(1);
    expect(before.questions[0].attachments).toBeGreaterThan(0);
    await reloadAfterSave(page);
    expect(await persistedCourse(page)).toEqual(before);
    await catalogRegion(page);

    // The later route runs ahead of the broad synthetic backend handler.
    // Do not alter the academic fixture or any authenticated service.
    let serveEmpty = true;
    let emptyReplies = 0;
    await page.route("**/rpc/academic_catalog*", async route => {
      if (!serveEmpty) return route.fallback();
      emptyReplies++;
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: "[]",
      });
    });
    await catalog.getByRole("button", { name: "Refresh banks" }).click();
    await expect.poll(() => emptyReplies).toBeGreaterThan(0);
    await expect(card).toHaveCount(0);
    expect(await persistedCourse(page)).toEqual(before);

    await reloadAfterSave(page);
    expect(await persistedCourse(page)).toEqual(before);
    await catalogRegion(page);
    // Once the same reviewed catalog is reachable, revisiting an installed
    // source cannot duplicate records or transfer week ownership.
    serveEmpty = false;
    await catalog.getByRole("button", { name: "Refresh banks" }).click();
    await expect(card).toBeVisible();
    await card.click();
    await expect(plan).toBeVisible();
    await plan.getByRole("button", { name: "Clear selection", exact: true }).click();
    await plan.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    await plan.getByRole("button", { name: "Load Course", exact: true }).click();
    await expect(plan.getByRole("status")).toContainText("already in My Courses");
    expect(await persistedCourse(page)).toEqual(before);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
