import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

test("Question Bank first use stays focused, themed, responsive, and route-scroll safe", async ({ page }) => {
  await page.goto("/#questions", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "questions"; });

  const primary = page.getByRole("button", { name: "Import Questions" });
  await expect(page.getByRole("heading", { level: 1, name: "Question Bank" })).toBeVisible();
  await expect(primary).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByText("Current mastery", { exact: true })).toHaveCount(0);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: STORAGE_KEYS.themePreference,
      value: theme,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(primary).toBeVisible();
  }

  for (const viewport of [
    { width: 1360, height: 900 },
    { width: 1024, height: 820 },
    { width: 768, height: 820 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator(".surface-scroll").evaluate((element) => { element.scrollTop = 0; });
    await expect(primary).toBeVisible();
    const layout = await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(".surface-scroll");
      const content = document.querySelector<HTMLElement>(".page");
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent?.trim() === "Import Questions");
      const rect = button?.getBoundingClientRect();
      return {
        surfaceFits: Boolean(surface && surface.scrollWidth <= surface.clientWidth + 1),
        contentFits: Boolean(content && content.scrollWidth <= content.clientWidth + 1),
        buttonHeight: rect?.height ?? 0,
        buttonFullyVisible: Boolean(rect
          && rect.left >= 0
          && rect.right <= window.innerWidth
          && rect.top >= 0
          && rect.bottom <= window.innerHeight),
      };
    });
    expect(layout).toEqual({
      surfaceFits: true,
      contentFits: true,
      buttonHeight: expect.any(Number),
      buttonFullyVisible: true,
    });
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
  }

  await primary.click();
  await expect(page.getByLabel("Choose a question file to import")).toBeAttached();
  const previousScroll = await page.locator(".surface-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(previousScroll).toBeGreaterThan(0);

  await page.evaluate(() => { window.location.hash = "dashboard"; });
  await expect(page.getByRole("heading", { level: 1, name: "Question Bank" })).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "questions"; });
  await expect(primary).toBeVisible();
  await expect.poll(() => page.locator(".surface-scroll").evaluate((element) => element.scrollTop)).toBe(0);
});

async function completeOnboarding(page: Page): Promise<void> {
  await completeSetup(page, "AXOM Landing E2E");
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
}
