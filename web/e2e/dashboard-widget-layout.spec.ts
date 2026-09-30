import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test("Dashboard widgets stay configurable, keyboard-reorderable, and responsive", async ({ page }) => {
  await page.goto("/#dashboard", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "dashboard"; });

  const widgetGrid = page.getByRole("region", { name: "Dashboard widgets" });
  const trackerWidget = page.locator('[data-widget-id="courseTracker"]');
  await expect(widgetGrid).toBeVisible();
  await expect(trackerWidget).toBeVisible();
  // I1-21 (JD): the check-in first, then the focus timer with soundscapes beside it.
  await expect.poll(() => widgetGrid.locator("[data-widget-id]").evaluateAll((frames) => frames.slice(0, 3).map((frame) => frame.getAttribute("data-widget-id"))))
    .toEqual(["winDay", "pomodoro", "soundscapes"]);

  // Widget settings behave like a contained editing surface: opening moves
  // focus inside, Cancel discards the draft, and focus returns to the trigger.
  const customizeTasks = page.getByRole("button", { name: "Customize Course Tracker" });
  await customizeTasks.focus();
  await page.keyboard.press("Enter");
  const settings = page.getByRole("region", { name: "Customize Course Tracker" });
  await expect(settings).toBeVisible();
  await expect(settings.locator('input[type="radio"]').first()).toBeFocused();

  const originalSize = await settings.locator('input[type="radio"]:checked').getAttribute("value");
  expect(originalSize).toBeTruthy();
  const draftSize = originalSize === "small" ? "medium" : "small";
  await settings.locator(`input[type="radio"][value="${draftSize}"]`).check();
  await settings.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await expect(settings).toBeHidden();
  await expect(customizeTasks).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(settings.locator(`input[type="radio"][value="${originalSize}"]`)).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(customizeTasks).toBeFocused();

  // The editor exposes the current catalog without reviving storage-only AI
  // recommendation widgets. Reorder controls must work without a pointer and
  // announce the result to assistive technology.
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await expect(page.getByText("On your dashboard", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggested", { exact: true })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await expect(page.getByText("Experimental", { exact: true })).toBeVisible();
  await expect(page.getByText("Hidden", { exact: true })).toBeVisible();
  await expect(page.getByText("AI Suggested Actions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Suggested moves", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Legacy AI actions", { exact: true })).toHaveCount(0);

  const visibleZone = page.locator(".widget-editor-zone").first();
  const labelsBefore = await editorWidgetLabels(visibleZone);
  const tasksIndexBefore = labelsBefore.indexOf("Course Tracker");
  expect(tasksIndexBefore).toBeGreaterThan(0);

  const moveTasksUp = page.getByRole("button", { name: "Move Course Tracker up" });
  await moveTasksUp.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('.dashboard-widget-editor .sr-only[aria-live="polite"]'))
    .toContainText("Course Tracker moved earlier.");
  await expect.poll(async () => (await editorWidgetLabels(visibleZone)).indexOf("Course Tracker"))
    .toBe(tasksIndexBefore - 1);

  await page.getByRole("button", { name: "Done editing" }).click();

  for (const viewport of [
    { width: 1440, height: 900, columns: 2 },
    { width: 1024, height: 820, columns: 2 },
    { width: 768, height: 820, columns: 2 },
    { width: 390, height: 844, columns: 1 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator(".surface-scroll").evaluate((element) => { element.scrollTop = 0; });

    const layout = await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(".surface-scroll");
      const pageContent = document.querySelector<HTMLElement>(".page");
      const grid = document.querySelector<HTMLElement>(".dashboard-widget-grid");
      if (!surface || !pageContent || !grid) throw new Error("Dashboard layout surface is missing");
      const widgetRects = [...grid.querySelectorAll<HTMLElement>(".dashboard-widget-frame")]
        .filter((widget) => widget.offsetParent !== null)
        .map((widget) => widget.getBoundingClientRect());
      const distinctWidgetColumns = new Set(widgetRects.map((rect) => Math.round(rect.left)));
      const gridRect = grid.getBoundingClientRect();
      return {
        documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        bodyFits: document.body.scrollWidth <= document.body.clientWidth + 1,
        surfaceFits: surface.scrollWidth <= surface.clientWidth + 1,
        pageFits: pageContent.scrollWidth <= pageContent.clientWidth + 1,
        gridFits: grid.scrollWidth <= grid.clientWidth + 1,
        widgetsStayInsideGrid: widgetRects.every((rect) => (
          rect.left >= gridRect.left - 1 && rect.right <= gridRect.right + 1
        )),
        templateColumnCount: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
        mobileWidgetsSingleColumn: window.innerWidth > 640 || distinctWidgetColumns.size === 1,
      };
    });

    expect(layout).toEqual({
      documentFits: true,
      bodyFits: true,
      surfaceFits: true,
      pageFits: true,
      gridFits: true,
      widgetsStayInsideGrid: true,
      templateColumnCount: viewport.columns,
      mobileWidgetsSingleColumn: true,
    });
  }
});

async function editorWidgetLabels(zone: ReturnType<Page["locator"]>): Promise<string[]> {
  return zone.locator("article.widget-library-row.draggable .grow > b").allTextContents();
}

async function completeOnboarding(page: Page): Promise<void> {
  const identityInput = page.getByLabel("Display name (optional)");
  if (await identityInput.count()) {
    await identityInput.fill("AXOM Widget E2E");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  }
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
}
