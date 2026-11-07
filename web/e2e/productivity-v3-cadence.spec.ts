import { completeSetup, expect, test } from "./fixtures";

/** Source-backed gym and named-occurrence flow, never a fabricated second log. */
test("Recurring gym and private named goals stay connected across Productivity and Reports", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeSetup(page, "AXOM Cadence E2E", { ifVisible: true });
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
  await page.evaluate(() => { window.location.hash = "productivity"; });
  await expect(page.getByRole("heading", { name: "Log an activity" })).toBeVisible();

  await page.getByRole("button", { name: "Gym: 4 minimum, 5 preferred" }).click();
  await page.getByRole("button", { name: "Five named daily prayers" }).click();
  const gym = page.locator(".goal-cadence-card").filter({ has: page.locator(".goal-cadence-card-head b", { hasText: "Gym" }) });
  const prayer = page.locator(".goal-cadence-card").filter({ has: page.locator(".goal-cadence-card-head b", { hasText: "Daily prayers" }) });
  await expect(gym).toBeVisible();
  await expect(prayer).toBeVisible();
  await expect(prayer.getByRole("button", { name: "Complete Fajr" })).toBeVisible();

  await prayer.getByRole("button", { name: "Complete Fajr" }).click();
  await expect(prayer.getByText("1 of 5 confirmed")).toBeVisible();
  await prayer.getByRole("button", { name: "Complete Dhuhr" }).click();
  await expect(prayer.getByText("2 of 5 confirmed")).toBeVisible();
  await expect(prayer.getByRole("button", { name: "Undo Fajr" })).toBeVisible();
  await prayer.getByRole("button", { name: "Undo Fajr" }).click();
  await expect(prayer.getByText("1 of 5 confirmed")).toBeVisible();

  await gym.getByRole("button", { name: "Log today" }).click();
  await expect(gym.getByText(/1 \/ 4/)).toBeVisible();
  // Both forms project from Habit entries, not an invented academic study log.
  await expect(page.locator(".activity-log-card .activity-log-row")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".goal-cadence-panel").screenshot({ path: testInfo.outputPath("goal-cadence-v3-desktop-1440.png") });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = await page.locator(".goal-cadence-panel").evaluate((panel) => {
      const container = panel.getBoundingClientRect();
      return [...panel.querySelectorAll<HTMLElement>("button, input, select")].filter((element) => element.getClientRects().length > 0)
        .map((element) => ({ left: element.getBoundingClientRect().left - container.left,
          right: element.getBoundingClientRect().right - container.right }));
    });
    for (const control of controls) {
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(1);
    }
    await page.locator(".goal-cadence-panel").screenshot({ path: testInfo.outputPath(`goal-cadence-v3-mobile-${width}.png`) });
  }

  await page.evaluate(() => { window.location.hash = "reports"; });
  await expect(page.getByRole("heading", { name: "See your work clearly." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal rhythms" })).toBeVisible();
  await expect(page.locator(".goal-cadence-reports")).toContainText("Gym");
  await expect(page.locator(".goal-cadence-reports")).not.toContainText("Daily prayers");

  await page.evaluate(() => { window.location.hash = "productivity"; });
  await expect(prayer).toBeVisible();
  await prayer.getByRole("checkbox", { name: /Include in my private Reports/ }).check();
  await page.evaluate(() => { window.location.hash = "reports"; });
  await expect(page.locator(".goal-cadence-reports")).toContainText("Daily prayers");
});
