import { expect, test } from "@playwright/test";

test("Hub folders validate, copy, clear and preserve local paths with an honest web fallback", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#folders");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  const skipReminder = page.getByRole("button", { name: "Skip today", exact: true });
  if (await skipReminder.isVisible()) await skipReminder.click();
  await page.evaluate(() => { location.hash = "folders"; });
  await page.getByRole("button", { name: "Add folder", exact: true }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Study QA");
  await page.getByLabel("Local path (optional)").fill("relative/path");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByLabel("Local path (optional)").fill("/tmp/axom-ideas2-folder-qa");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const card = page.locator(".folder-card").filter({ hasText: "Study QA" });
  await expect(card).toContainText("Local folder · desktop required");
  await expect(card.getByRole("button", { name: /in file manager/ })).toHaveCount(0);
  await card.getByRole("button", { name: "Copy path for Study QA" }).click();
  await expect(card).toContainText("Copied");
  await card.getByRole("button", { name: "Favorite Study QA", exact: true }).click();
  await expect(page.getByRole("region", { name: "Pinned folders" })).toContainText("Study QA");
  await page.getByRole("button", { name: "List view" }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await card.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await card.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`hub-${width}.png`) });
  }
  await page.reload();
  await expect(card).toContainText("/tmp/axom-ideas2-folder-qa");
  await card.getByRole("button", { name: "Edit Study QA" }).click();
  await page.getByLabel("Local path (optional)").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(card).not.toContainText("/tmp/axom-ideas2-folder-qa");
  await card.getByRole("button", { name: "Archive Study QA" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});
