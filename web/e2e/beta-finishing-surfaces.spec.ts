import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";

// Sourced cards and the 271-row filtering behavior remain covered directly in
// ApplicationCheckerPage.test.tsx while this page is intentionally unreleased.
for (const width of [390, 1440]) test(`unreleased Application Checker stays gated at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  let datasetRequests = 0;
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/application-schools.json", route => {
    datasetRequests += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 2, schools: [] }) });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await onboard(page);
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/#appchecker");
  const assertReleasedFallback = async () => {
    await expect(page.locator(".topbar-heading .tb-title")).toHaveText("Dashboard");
    await expect(page.getByRole("region", { name: "Dashboard widgets" })).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("button", { name: /^Application Checker(?:,|$)/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Medical school/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  };
  await assertReleasedFallback();
  await page.reload({ waitUntil: "networkidle" });
  await assertReleasedFallback();
  expect(datasetRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("install affordance appears only after browser support and is single use", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await onboard(page);
  await page.evaluate(() => { window.location.hash = "about"; });
  await expect(page.getByRole("button", { name: "Install AXOM" })).toHaveCount(0);
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
    };
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install AXOM" }).click();
  await expect(page.getByRole("button", { name: "Install AXOM" })).toHaveCount(0);
});

async function onboard(page: Page) {
  if (!(await completeSetup(page, "Beta Finishing Test", { ifVisible: true }))) return;
  const later = page.getByRole("button", { name: "Review later" });
  if (await later.count()) await later.click();
}
