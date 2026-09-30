import { expect, test, type Page } from "@playwright/test";

async function seedAccounting(page: Page) {
  await page.clock.install({ time: new Date(2026, 8, 30, 12) });
  await page.goto("/#productivity");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await page.evaluate(async () => {
    const { useStore } = await window.__AXOM_DEV__!;
    const stamp = "2026-09-28T12:00:00Z";
    const common = { enabled: true, weight: 1, trackingStartsAt: "2026-09-28", createdAt: stamp, updatedAt: stamp };
    const contribution = (id: string, dayKey: string, value: number) => ({ id, requirementId: "pages", dayKey, value, unit: "pages", mode: "override" as const, createdAt: stamp, updatedAt: stamp });
    useStore.setState({
      activeDayKey: "2026-09-30",
      logs: [
        { id: "earlier", dayKey: "2026-09-29", ts: stamp, type: "Study", minutes: 90, cards: 10, trackerId: "tracker-study" },
        { id: "today", dayKey: "2026-09-30", ts: "2026-09-30T12:00:00Z", type: "Study", minutes: 60, cards: 10, trackerId: "tracker-study" },
        { id: "correction", dayKey: "2026-09-30", ts: "2026-09-30T12:01:00Z", type: "Correction", minutes: -10, cards: -4, trackerId: "tracker-study" },
      ],
    });
    useStore.getState().updateProfile({ dailySuccess: { version: 1, configuredAt: "2026-09-28", requirements: [
      { ...common, id: "study", label: "Study", source: { kind: "study-minutes" }, target: 120, unit: "minutes", schedule: { kind: "weekly-total", weekStartsOn: 1 } },
      { ...common, id: "pages", label: "Pages", source: { kind: "manual" }, target: 10, unit: "pages", schedule: { kind: "weekly-total", weekStartsOn: 1 }, manualContributions: [contribution("earlier-pages", "2026-09-29", 5), contribution("today-pages", "2026-09-30", 2)] },
      { ...common, id: "study-days", label: "Study days", source: { kind: "study-minutes" }, target: 45, unit: "minutes", schedule: { kind: "times-per-week", times: 3, weekStartsOn: 1 } },
    ] } });
    location.hash = "productivity";
  });
  await expect(page.getByRole("heading", { name: "Log an activity", exact: true })).toBeVisible();
}

for (const theme of ["dark", "light"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`accounting edits and persistence ${theme} ${viewport.width}`, async ({ page }, testInfo) => {
      const consoleIssues: string[] = [];
      page.on("pageerror", (error) => consoleIssues.push(error.message));
      page.on("console", (message) => { if (["warning", "error"].includes(message.type())) consoleIssues.push(message.text()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: viewport.width === 390 ? "reduce" : "no-preference" });
      await seedAccounting(page);
      await page.evaluate((value) => {
        localStorage.setItem("axom.theme", value);
        window.dispatchEvent(new Event("axom:theme-change"));
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.getByLabel("Today automatically recorded study")).toContainText("6 cards reviewed");
      await expect(page.getByRole("button", { name: "Edit Study days target" })).toContainText("2 / 3 days");
      await page.locator(".surface-scroll").evaluate(async (element) => {
        for (let y = 0; y < element.scrollHeight; y += element.clientHeight) {
          element.scrollTop = y;
          await new Promise(requestAnimationFrame);
        }
        element.scrollTop = 0;
      });
      expect(await page.locator(".surface-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("productivity.png") });

      await page.getByRole("button", { name: "Configure targets" }).click();
      const dialog = page.getByRole("dialog", { name: "Targets", exact: true });
      const study = dialog.locator(".daily-requirement-card").filter({ has: page.locator(".daily-requirement-toggle b", { hasText: /^Study$/ }) });
      await study.getByText("Target settings", { exact: false }).click();
      await study.getByLabel("Study target unit").selectOption("hours");
      await expect(study.locator(".daily-requirement-progress")).toContainText("2.3 of 2 hours this week");
      const pages = dialog.locator(".daily-requirement-card").filter({ has: page.locator(".daily-requirement-toggle b", { hasText: /^Pages$/ }) });
      await expect(pages.getByLabel("Today’s value")).toHaveValue("2");
      await pages.getByLabel("Today’s value").focus();
      await page.keyboard.press("Tab");
      await expect(pages.locator(".daily-requirement-progress")).toContainText("7 of 10 pages this week");
      await pages.getByLabel("Today’s value").fill("3");
      await page.keyboard.press("Tab");
      await expect(pages.locator(".daily-requirement-progress")).toContainText("8 of 10 pages this week");
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("targets.png") });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "Configure targets" }).click();
      await expect(pages.getByLabel("Today’s value")).toHaveValue("3");
      await expect(study.locator(".daily-requirement-progress")).toContainText("2.3 of 2 hours this week");
      await study.getByText("Target settings", { exact: false }).click();
      await study.getByLabel("Study target unit").selectOption("minutes");
      await expect(study.locator(".daily-requirement-progress")).toContainText("140 of 120 minutes this week");
      await page.keyboard.press("Escape");
      expect(consoleIssues).toEqual([]);
    });
  }
}
