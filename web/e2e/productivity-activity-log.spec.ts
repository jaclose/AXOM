import type { Page } from "@playwright/test";
import type { StudyLog } from "../src/lib/types";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

type Dev = {
  useStore: {
    getState: () => { logs: StudyLog[] };
    setState: (patch: object) => void;
  };
  flushVault: () => Promise<void>;
};

async function savedLogs(page: Page): Promise<StudyLog[]> {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().logs;
  });
}

for (const width of [1440, 390]) {
  test(`Activity Log stays compact below the timer without changing history (${width}px)`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    const theme = width === 390 ? "light" : "dark";
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.clock.setFixedTime("2026-10-20T16:00:00.000Z");
    await page.addInitScript(value => localStorage.setItem("axom.theme", value), theme);
    await page.goto("/#productivity", { waitUntil: "networkidle" });
    await seedOnboarded(page, {
      dailyLoopReminders: { checkInEnabled: false, checkInTime: "08:00", closeoutEnabled: false, closeoutTime: "20:30" },
    });
    await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.setState({
        activeDayKey: "2026-10-20",
        lastActiveLocalDate: "2026-10-20",
        logs: Array.from({ length: 8 }, (_, index) => ({
          id: `compact-activity-${index}`, dayKey: "2026-10-20", ts: `2026-10-20T15:0${7 - index}:00.000Z`,
          type: `Review block ${index + 1}`, minutes: 10, cards: 0,
          note: "Reviewed the mechanism, checked the original explanation, and recorded the distinction to revisit.\nThe full note remains available when this activity history is expanded.",
        })),
      });
      await dev.flushVault();
    });
    await reloadAfterSave(page);
    const original = await savedLogs(page);
    const log = page.getByRole("region", { name: "Activity Log" });
    const feed = log.locator(".activity-feed");
    const firstNote = log.locator(".activity-note").first();
    const expand = log.getByRole("button", { name: "Show all 8 events" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(log.locator(".activity-row")).toHaveCount(5);
    await expect(log).toContainText("Showing 5 of 8 events.");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(firstNote).toHaveCSS("white-space", "nowrap");
    expect(await page.locator('[data-module-tour="productivity-focus"]').evaluate(element => element.nextElementSibling?.classList.contains("activity-log-card"))).toBe(true);
    expect(await expand.getAttribute("aria-controls")).toBe(await feed.getAttribute("id"));
    await log.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`activity-preview-${width}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await expand.focus();
    await expect(expand).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(log.locator(".activity-row")).toHaveCount(8);
    await expect(firstNote).toHaveCSS("white-space", "pre-wrap");
    await expect(log.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(await savedLogs(page)).toEqual(original);
    await log.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`activity-expanded-${width}.png`), fullPage: false });

    const collapse = log.getByRole("button", { name: "Show less" });
    await collapse.focus();
    await page.keyboard.press("Space");
    await expect(log.locator(".activity-row")).toHaveCount(5);
    await expect(firstNote).toHaveCSS("white-space", "nowrap");
    expect(await savedLogs(page)).toEqual(original);
    await reloadAfterSave(page);
    await expect(log.locator(".activity-row")).toHaveCount(5);
    expect(await savedLogs(page)).toEqual(original);
    await log.getByRole("link", { name: "View full activity" }).click();
    await expect(page).toHaveURL(/#activity$/);
    expect(await savedLogs(page)).toEqual(original);
    expect(errors).toEqual([]);
  });
}
