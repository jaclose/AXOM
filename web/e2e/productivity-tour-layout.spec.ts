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
  test.setTimeout(120_000); // Ten rendered layouts, including screenshot/font settling.
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "productivity"; });
  for (const theme of ["dark", "light"]) {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await expect(page.getByRole("heading", { name: "Log an activity" })).toBeVisible();
      const bounds = await page.locator(".productivity-primary-grid").evaluate((grid) => {
        const [log, focus] = Array.from(grid.children).map((element) => element.getBoundingClientRect());
        const focusStack = grid.querySelector<HTMLElement>("#productivity-focus");
        if (!focusStack) throw new Error("Focus stack is missing");
        const previousHeight = focusStack.style.height;
        focusStack.style.height = "auto";
        const naturalFocusHeight = focusStack.getBoundingClientRect().height;
        focusStack.style.height = previousHeight;
        return { logTop: log.top, focusTop: focus.top, focusHeight: focus.height, naturalFocusHeight, scroll: grid.scrollWidth, width: grid.clientWidth };
      });
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      if (width === 1440) {
        expect(Math.abs(bounds.logTop - bounds.focusTop)).toBeLessThan(2);
        expect(Math.abs(bounds.focusHeight - bounds.naturalFocusHeight)).toBeLessThan(3); // The timer card cannot be stretched to the logger's height.
      } else expect(bounds.focusTop).toBeGreaterThan(bounds.logTop);
      const progress = await page.locator("#productivity-log .daily-progress-vessel").evaluate((vessel) => {
        const outer = vessel.getBoundingClientRect();
        const track = vessel.querySelector(".daily-progress-track")!.getBoundingClientRect();
        return { left: track.left - outer.left, right: track.right - outer.right };
      });
      expect(progress.left).toBeGreaterThanOrEqual(0);
      expect(progress.right).toBeLessThanOrEqual(1);
      const logFields = await page.locator("#productivity-log .fast-activity-logger").evaluate((logger) => {
        const outer = logger.getBoundingClientRect();
        return Array.from(logger.querySelectorAll("input, select, button")).map((field) => {
          const rect = field.getBoundingClientRect();
          return { left: rect.left - outer.left, right: rect.right - outer.right, width: rect.width,
            isCheckbox: field instanceof HTMLInputElement && field.type === "checkbox" };
        });
      });
      expect(logFields.length).toBeGreaterThanOrEqual(6);
      for (const field of logFields) {
        expect(field.left).toBeGreaterThanOrEqual(0);
        expect(field.right).toBeLessThanOrEqual(1);
        expect(field.width).toBeGreaterThan(field.isCheckbox ? 15 : 40);
      }
      await expect(page.getByRole("checkbox", { name: "Count as academic study" })).toBeVisible();
      await expect(page.locator("#productivity-focus .study-streak-monitor")).toBeVisible();
      await expect(page.locator("#productivity-log .study-streak-monitor")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add a goal" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Use Questions template" })).toBeVisible();
      const focusMeter = page.getByRole("progressbar", { name: "Focus session progress" });
      await expect(focusMeter).toBeVisible();
      await expect(focusMeter).toHaveAttribute("aria-valuenow", /^(0|[1-9]\d?|100)$/);
      const fields = await page.locator(".productivity-primary-grid .pomo-target-box").evaluate((box) => {
        const outer = box.getBoundingClientRect();
        return Array.from(box.querySelectorAll("input, select")).map((field) => {
          const rect = field.getBoundingClientRect();
          return { width: rect.width, left: rect.left - outer.left, right: rect.right - outer.right };
        });
      });
      expect(fields).toHaveLength(2);
      for (const field of fields) {
        expect(field.width).toBeGreaterThan(160);
        expect(field.left).toBeGreaterThanOrEqual(0);
        expect(field.right).toBeLessThanOrEqual(1);
      }
      if (width <= 560) {
        const next = await page.locator(".productivity-next").evaluate((section) => {
          const copy = section.querySelector("p")!.getBoundingClientRect();
          const action = section.querySelector(".gbtn")!.getBoundingClientRect();
          return { copyWidth: copy.width, copyBottom: copy.bottom, actionTop: action.top };
        });
        expect(next.copyWidth).toBeGreaterThan(160);
        expect(next.actionTop).toBeGreaterThanOrEqual(next.copyBottom);
      }
      await page.locator(".surface-scroll").evaluate((surface) => { surface.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`productivity-${theme}-${width}.png`) });
    }
  }
});

test("expanded Productivity target settings and custom form stay inside the Log panel", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "productivity"; });
  const editor = page.locator("#productivity-log .daily-requirements-editor");
  await editor.locator(":scope > summary").click();
  const custom = editor.locator(".daily-custom-requirement");
  await custom.locator("summary").click();
  await custom.getByPlaceholder("Gym, reading, prayer, steps…").fill("Reading practice");
  await custom.getByLabel("Target", { exact: true }).fill("3");
  await custom.getByRole("button", { name: "Add target" }).click();
  const card = editor.locator(".daily-requirement-card").filter({ hasText: "Reading practice" });
  await card.locator(".daily-requirement-settings > summary").click();
  await card.getByLabel("Schedule", { exact: true }).selectOption("weekdays");
  await expect(card.getByLabel("Sunday", { exact: true })).not.toBeChecked();
  await card.getByLabel("Sunday", { exact: true }).check();
  await expect(card.getByLabel("Sunday", { exact: true })).toBeChecked();
  await custom.getByLabel("Completion source").selectOption("activity");
  await custom.getByRole("combobox", { name: /^Schedule/ }).selectOption("times-per-week");
  await expect(custom.getByLabel("Activity aliases", { exact: true })).toBeVisible();
  await expect(custom.getByLabel("Times", { exact: true })).toBeVisible();

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = await editor.evaluate((element) => {
      const panel = element.closest("#productivity-log")!.getBoundingClientRect();
      return Array.from(element.querySelectorAll<HTMLElement>("input, select, button, .daily-weekdays span")).filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).opacity !== "0").map((control) => {
        const rect = control.getBoundingClientRect();
        return { label: control.getAttribute("aria-label") || control.textContent || control.tagName, width: rect.width, left: rect.left - panel.left, right: rect.right - panel.right };
      });
    });
    expect(controls.length).toBeGreaterThanOrEqual(20);
    for (const control of controls) {
      expect(control.left, control.label).toBeGreaterThanOrEqual(0);
      expect(control.right, control.label).toBeLessThanOrEqual(1);
      expect(control.width, control.label).toBeGreaterThanOrEqual(18);
    }
    await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await card.screenshot({ path: testInfo.outputPath(`target-settings-${width}.png`) });
    await custom.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await custom.screenshot({ path: testInfo.outputPath(`target-custom-${width}.png`) });
  }
});

test("Quick self-report goals remain usable without overflow on desktop and phones", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/#productivity", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "productivity"; });

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const name = `Review anatomy ${width}`;
    await page.getByRole("button", { name: "Add a goal" }).click();
    await page.getByLabel("Goal type").selectOption("custom");
    await page.getByLabel("Goal name").fill(name);
    await page.getByLabel("Goal amount").fill("2");
    await page.getByLabel("How progress is recorded").selectOption("activity");
    await page.locator("#quick-goal-form").screenshot({ path: testInfo.outputPath(`quick-goal-create-${width}.png`) });

    const bounds = await page.locator("#quick-goal-form").evaluate((element) => {
      const panel = element.closest("#productivity-log")!.getBoundingClientRect();
      return Array.from(element.querySelectorAll<HTMLElement>("input, select, button"))
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => {
          const rect = control.getBoundingClientRect();
          return { left: rect.left - panel.left, right: rect.right - panel.right, width: rect.width };
        });
    });
    for (const control of bounds) {
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(1);
      expect(control.width).toBeGreaterThan(40);
    }

    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByRole("button", { name: `Use ${name} in self-report` })).toBeVisible();
    if (width <= 390) {
      const textWidth = await page.locator(".quick-goal-row").filter({ hasText: name })
        .locator(".quick-goal-copy").evaluate((element) => element.getBoundingClientRect().width);
      expect(textWidth).toBeGreaterThan(160); // A full goal name must not wrap character by character.
    }
    await page.getByRole("button", { name: `Use ${name} in self-report` }).click();
    await expect(page.getByLabel("What did you do?")).toHaveValue(name);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await expect(page.getByText("Activity added. Your save status appears above.")).toBeVisible();
    await page.locator("#productivity-log .quick-goals").screenshot({ path: testInfo.outputPath(`quick-goal-progress-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
