import { expect, seedOnboarded, test } from "./fixtures";

test.use({ quietNudges: false });

test("first scroll introduces lock-in at one minute, then Overwhelmed after dismissal", async ({ page }) => {
  const browserIssues: string[] = [];
  page.on("console", (entry) => { if (entry.type() === "warning" || entry.type() === "error") browserIssues.push(entry.text()); });
  page.on("pageerror", (error) => browserIssues.push(error.message));
  await page.addInitScript(() => localStorage.setItem("axom.guideOffer.v1", "declined"));
  await seedOnboarded(page);
  const scroller = page.locator(".surface-scroll");
  await expect(scroller).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.clock.install();
  await expect(page.getByRole("dialog", { name: "Are you locked in?" })).toHaveCount(0);

  await scroller.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop += 1;
    if (element.scrollTop === before) throw new Error("The first-visit test page did not scroll.");
    element.dispatchEvent(new Event("scroll"));
  });
  await page.clock.fastForward(59_000);
  await expect(page.getByRole("dialog", { name: "Are you locked in?" })).toHaveCount(0);
  await page.clock.runFor(1_000);
  const sample = page.getByRole("dialog", { name: "Are you locked in?" });
  await expect(sample).toBeVisible();
  await expect(page.getByText("Overwhelmed?", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/axom-first-visit-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sample).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "/tmp/axom-first-visit-mobile.png" });

  await sample.getByRole("button", { name: "Dismiss check-in" }).click();
  await page.clock.runFor(240);
  await expect(sample).toHaveCount(0);
  await page.clock.fastForward(9_000);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axom.coach.v1") ?? "{}").seen ?? [])).not.toContain("overwhelmed");
  await page.clock.runFor(4_000);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axom.coach.v1") ?? "{}").seen ?? [])).toContain("overwhelmed");
  await expect(page.getByRole("dialog", { name: "Make AXOM yours" })).toBeVisible();
  expect(browserIssues).toEqual([]);
});
