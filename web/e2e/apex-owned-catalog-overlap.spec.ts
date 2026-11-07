import { expect, seedOnboarded, test } from "./fixtures";
import { academicPublishFixture } from "./academicPublishFixture";

const collectionId = (index: number) =>
  `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const revisionId = (index: number) =>
  `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

/** Synthetic catalog metadata only. No learner files, grades, or rights claims. */
const course = (index: number) => ({
  id: collectionId(index),
  current_revision_id: revisionId(index),
  title: `Synthetic anatomy module ${index}`,
  module: `Module ${index}`,
  term: "Term 1",
  visibility: "private",
  review_status: "pending",
  owned: true,
  ready_questions: 1,
  review_questions: 0,
});

for (const width of [390, 1440]) {
  test(`owner catalog rejects an overlapping terminal page and recovers on retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await academicPublishFixture(page);
    await seedOnboarded(page);
    await page.goto("/?app=1&course-library=1#tracker");
    await page.getByText("Manage sources and custom courses", { exact: true }).click();

    const first = Array.from({ length: 24 }, (_, index) => course(index));
    let overlap = true;
    const requests: Array<string | null> = [];
    // Register after the normal authenticated fixture so only this catalog RPC
    // is overridden. The rest of the app still executes its real fetch path.
    await page.route("https://academic-publish.invalid/rest/v1/rpc/academic_catalog", async route => {
      const input = route.request().postDataJSON() as { after_id?: string | null };
      const after = input.after_id ?? null;
      requests.push(after);
      const rows = after === null ? first : overlap ? [course(23)] : [course(24)];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
        body: JSON.stringify(rows),
      });
    });

    const manager = page.getByRole("region", { name: "Your published courses" });
    await manager.getByRole("button", { name: "Show my courses" }).press("Enter");
    await expect(manager.getByRole("alert")).toContainText("course catalog changed while loading");
    await expect(manager.locator(".academic-manager-summary")).toHaveCount(0);
    expect(requests).toEqual([null, collectionId(23)]);

    // Retry after the server returns a disjoint short final page. The rejected
    // response must not poison the next attempt or inflate the visible count.
    overlap = false;
    await manager.getByRole("button", { name: "Show my courses" }).press("Enter");
    await expect(manager.getByRole("alert")).toHaveCount(0);
    await expect(manager.locator(".academic-manager-summary")).toHaveText("25 courses: 25 private.");
    expect(requests).toEqual([null, collectionId(23), null, collectionId(23)]);
    expect(await manager.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
