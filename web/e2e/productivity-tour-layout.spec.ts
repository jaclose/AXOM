import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";

interface LayoutSnapshot {
  bodyClass: string;
  bodyStyle: string;
  documentClass: string;
  documentStyle: string;
  bodyHeight: number;
  bodyWidth: number;
  documentHeight: number;
  documentWidth: number;
  surfaceClientHeight: number;
  surfaceClientWidth: number;
  surfaceScrollHeight: number;
  surfaceScrollLeft: number;
  surfaceScrollTop: number;
  surfaceScrollWidth: number;
}

test("Productivity module tour restores layout after completion and skip at every supported viewport", async ({ page }) => {
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "productivity"; });
  await expect(page.getByRole("heading", { level: 2, name: "Log an activity" })).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 820 },
    { width: 768, height: 820 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);

    // Exercise a non-reduced, already-scrolled completion. DOM activation
    // intentionally avoids Playwright scrolling the Help button first.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const scrolledBaseline = await prepareTour(page, "scrolled");
    await advanceAndFinish(page);
    await assertRestoredLayout(page, scrolledBaseline);

    // Exercise the reduced-motion, unscrolled skip path independently.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const topBaseline = await prepareTour(page, "top");
    await page.getByRole("button", { name: "Skip Productivity tour" }).click();
    await assertRestoredLayout(page, topBaseline);
  }
});

async function prepareTour(page: Page, position: "scrolled" | "top"): Promise<LayoutSnapshot> {
  const surface = page.locator(".surface-scroll");
  await surface.evaluate((element, requestedPosition) => {
    element.scrollTop = requestedPosition === "scrolled"
      ? Math.max(1, Math.round((element.scrollHeight - element.clientHeight) * 0.42))
      : 0;
    element.scrollLeft = 0;
  }, position);
  const baseline = await layoutSnapshot(page);
  if (position === "scrolled") expect(baseline.surfaceScrollTop).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Open Productivity help tour" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("dialog", { name: "Log activity" })).toBeVisible();
  await expect(page.locator("body > .tour-overlay")).toHaveCount(1);
  return baseline;
}

async function advanceAndFinish(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Choose targets" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Use the focus timer" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  const finalDialog = page.getByRole("dialog", { name: "Read trends" });
  await expect(finalDialog).toBeVisible();
  await expect(finalDialog).toHaveClass(/centered/);
  await page.getByRole("button", { name: "Finish" }).click();
}

async function assertRestoredLayout(page: Page, baseline: LayoutSnapshot): Promise<void> {
  await expect(page.locator(".tour-overlay")).toHaveCount(0);
  await expect.poll(() => layoutSnapshot(page)).toEqual(baseline);
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "visible");
  await expect(page.getByRole("dialog", { name: "A promise to yourself" })).toHaveCount(0);
}

function layoutSnapshot(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".surface-scroll");
    if (!surface) throw new Error("Productivity scroll surface is missing");
    return {
      bodyClass: document.body.className,
      bodyStyle: document.body.getAttribute("style") ?? "",
      documentClass: document.documentElement.className,
      documentStyle: document.documentElement.getAttribute("style") ?? "",
      bodyHeight: document.body.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      surfaceClientHeight: surface.clientHeight,
      surfaceClientWidth: surface.clientWidth,
      surfaceScrollHeight: surface.scrollHeight,
      surfaceScrollLeft: surface.scrollLeft,
      surfaceScrollTop: surface.scrollTop,
      surfaceScrollWidth: surface.scrollWidth,
    };
  });
}

async function completeOnboarding(page: Page): Promise<void> {
  await completeSetup(page, "AXOM Tour E2E", { ifVisible: true });
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
}

test("Productivity primary panels stay usable across themes and narrow screens", async ({ page }, testInfo) => {
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "productivity"; });
  for (const theme of ["dark", "light"]) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await expect(page.getByRole("heading", { name: "Log an activity" })).toBeVisible();
      const bounds = await page.locator(".productivity-primary-grid").evaluate((grid) => {
        const [log, focus] = Array.from(grid.children).map((element) => element.getBoundingClientRect());
        return { logHeight: log.height, focusHeight: focus.height, logTop: log.top, focusTop: focus.top, scroll: grid.scrollWidth, width: grid.clientWidth };
      });
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      if (width === 1440) {
        expect(Math.abs(bounds.logTop - bounds.focusTop)).toBeLessThan(2);
        expect(Math.abs(bounds.logHeight - bounds.focusHeight)).toBeLessThan(2);
      } else expect(bounds.focusTop).toBeGreaterThan(bounds.logTop);
      await page.locator(".surface-scroll").evaluate((surface) => { surface.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`productivity-${theme}-${width}.png`) });
    }
  }
});
