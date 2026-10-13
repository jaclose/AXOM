import { expect, test } from "./fixtures";
import { academicCatalogFixture, collection } from "./academicCatalogFixture";

test("QBank discovers the course catalog without downloading content and retains it on retry", async ({ page }) => {
  const backend = await academicCatalogFixture(page);
  const region = page.getByRole("region", { name: "Available question banks" });
  const course = region.locator(`[data-course-id="${collection}"]`);
  await expect(course).toContainText("1 ready question");
  expect(backend.paths).toEqual([]);
  backend.fail(); await region.getByRole("button", { name: "Refresh banks" }).click();
  await expect(region.getByRole("alert")).toContainText("could not be loaded");
  await expect(course).toBeVisible();
  backend.recover(); await region.getByRole("button", { name: "Refresh banks" }).click();
  await expect(region.getByRole("alert")).toHaveCount(0);
  await course.click();
  await expect(page.getByRole("region", { name: "GOER course plan" })).toBeVisible();
  expect(backend.paths).toEqual([]);
  expect(backend.requests.some(path => path.includes("academic_catalog_releases"))).toBe(false);
});
