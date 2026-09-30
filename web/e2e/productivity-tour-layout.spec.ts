import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

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
  const identityInput = page.getByLabel("Display name (optional)");
  if (await identityInput.count()) {
    await identityInput.fill("AXOM Tour E2E");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  }
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
}
