import type { Page } from "@playwright/test";
import type { DayPlan, JournalEntry, StudyLog } from "../src/lib/types";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

test.use({ timezoneId: "America/Grenada" });

type ReflectionData = { dayPlans: DayPlan[]; journal: JournalEntry[]; logs: StudyLog[] };
type Dev = {
  useStore: {
    getState: () => ReflectionData;
    setState: (patch: object) => void;
  };
  flushVault: () => Promise<void>;
};

async function reflectionData(page: Page): Promise<ReflectionData> {
  return page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const { dayPlans, journal, logs } = dev.useStore.getState();
    return { dayPlans, journal, logs };
  });
}

function captureErrors(page: Page, errors: string[]) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
}

for (const width of [1440, 390]) {
  test(`dismissed reflection days stay quiet without changing Journal data (${width}px)`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    captureErrors(page, errors);
    const theme = width === 390 ? "light" : "dark";
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.clock.setFixedTime("2026-10-20T16:00:00.000Z");
    await page.addInitScript(value => localStorage.setItem("axom.theme", value), theme);
    await page.goto("/#dashboard", { waitUntil: "networkidle" });
    await seedOnboarded(page, {
      dailyLoopReminders: { checkInEnabled: false, checkInTime: "08:00", closeoutEnabled: false, closeoutTime: "20:30" },
    });
    await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.setState({
        activeDayKey: "2026-10-20",
        lastActiveLocalDate: "2026-10-20",
        dayPlans: [
          { dayKey: "2026-10-19", intention: "Review a practice block", wins: [], createdAt: "2026-10-19T12:00:00.000Z" },
          { dayKey: "2026-10-16", intention: "Read the next lecture", wins: [], createdAt: "2026-10-16T12:00:00.000Z" },
          { dayKey: "2026-10-20", intention: "Finish today's practice", wins: [], createdAt: "2026-10-20T12:00:00.000Z" },
        ],
        logs: [
          { id: "reflection-recent", dayKey: "2026-10-19", ts: "2026-10-19T16:00:00.000Z", type: "Questions", minutes: 30, cards: 0 },
          { id: "reflection-older", dayKey: "2026-10-16", ts: "2026-10-16T16:00:00.000Z", type: "Study", minutes: 45, cards: 0 },
          { id: "reflection-today", dayKey: "2026-10-20", ts: "2026-10-20T15:00:00.000Z", type: "Study", minutes: 20, cards: 0 },
        ],
        journal: [{
          id: "preserved-reflection", date: "2026-10-15T12:00:00.000Z", today: "This existing reflection stays unchanged.",
          tomorrow: "Continue at a steady pace.", blockers: "", energy: "Medium", rating: "Useful",
        }],
      });
      await dev.flushVault();
    });
    await reloadAfterSave(page);
    const original = await reflectionData(page);
    const inbox = page.getByRole("region", { name: "Reflection inbox" });
    await expect(inbox).toContainText("2 days are ready when you are");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await inbox.getByRole("button", { name: "View all 2" }).click();
    await expect(inbox.getByText("Read the next lecture", { exact: true })).toBeVisible();
    const dismiss = inbox.getByRole("button", { name: "Dismiss these days" });
    await dismiss.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`reflection-before-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // A real second tab shares preferences, without rewriting workspace data.
    const other = width === 1440 ? await page.context().newPage() : null;
    if (other) {
      captureErrors(other, errors);
      await other.clock.setFixedTime("2026-10-20T16:00:00.000Z");
      await other.goto("/#dashboard", { waitUntil: "networkidle" });
      await expect(other.getByRole("region", { name: "Reflection inbox" })).toBeVisible();
    }

    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(inbox).toBeHidden();
    if (other) await expect(other.getByRole("region", { name: "Reflection inbox" })).toBeHidden();
    expect(await reflectionData(page)).toEqual(original);

    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(inbox).toBeVisible();
    if (other) await expect(other.getByRole("region", { name: "Reflection inbox" })).toBeVisible();
    await dismiss.focus();
    await page.keyboard.press("Space");
    await expect(inbox).toBeHidden();
    if (other) {
      await expect(other.getByRole("region", { name: "Reflection inbox" })).toBeHidden();
      expect(await reflectionData(other)).toEqual(original);
      await other.close();
    }
    await reloadAfterSave(page);
    await expect(inbox).toBeHidden();
    expect(await reflectionData(page)).toEqual(original);

    // Start on another route after a reload: the shell must also honor the dates.
    await page.goto("/#tracker", { waitUntil: "networkidle" });
    await expect(page.locator(".toast:not(.is-leaving)").filter({ hasText: "Journal catch-up for" })).toHaveCount(0);
    await page.goto("/#dashboard", { waitUntil: "networkidle" });
    await page.clock.setFixedTime("2026-10-21T16:00:00.000Z");
    await page.evaluate(async () => {
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      dev.useStore.setState({ activeDayKey: "2026-10-21", lastActiveLocalDate: "2026-10-21" });
      await dev.flushVault();
    });
    await expect(inbox).toContainText("One day is ready when you are");
    await expect(inbox.getByRole("button", { name: /Continue Oct 20, 2026/ })).toBeVisible();
    await expect(inbox).not.toContainText("Review a practice block");
    await expect(inbox).not.toContainText("Read the next lecture");
    expect(await reflectionData(page)).toEqual(original);
    await reloadAfterSave(page);
    await expect(inbox).toContainText("One day is ready when you are");
    expect(await reflectionData(page)).toEqual(original);
    await inbox.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`reflection-new-day-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
