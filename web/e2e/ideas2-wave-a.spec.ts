import { expect, test, type Page } from "@playwright/test";

type DevWindow = Window & { __AXOM_DEV__?: Promise<{ useStore: typeof import("../src/lib/store").useStore }> };

async function openWorkspace(page: Page, route: string) {
  await page.goto(`/#${route}`);
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await page.evaluate((hash) => { location.hash = hash; }, route);
  await expect(page.locator(".route-loading")).toHaveCount(0);
}

test("384 minutes reach Study once through both timer entry points and survive reload", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorkspace(page, "productivity");
  await page.evaluate(async () => {
    const { useStore } = await (window as DevWindow).__AXOM_DEV__!;
    const state = useStore.getState();
    const endedAt = new Date(`${state.activeDayKey}T18:00:00`).toISOString();
    state.logStudy({ type: "Study", minutes: 32 });
    const activity = { eventId: "regression-352", source: "axom" as const, kind: "pomodoro" as const, endedAt, durationSeconds: 352 * 60, completed: true };
    state.recordStudyActivity(activity);
    state.logStudy({ type: "Pomodoro", activity });
  });
  const verify = () => page.evaluate(async () => {
    const { useStore } = await (window as DevWindow).__AXOM_DEV__!;
    const state = useStore.getState();
    const today = state.logs.filter((log) => log.dayKey === state.activeDayKey);
    return { minutes: today.reduce((sum, log) => sum + log.minutes, 0), study: today.filter((log) => log.trackerId === "tracker-study").reduce((sum, log) => sum + log.minutes, 0), events: today.filter((log) => log.activity?.eventId === "regression-352").length };
  });
  await expect.poll(verify).toEqual({ minutes: 384, study: 384, events: 1 });
  const categories = page.getByText("Activity categories", { exact: false });
  if (await categories.count()) await categories.click();
  await expect(page.locator(".tracker-card").filter({ hasText: "Study" }).first()).toContainText("6h 24m");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: info.outputPath(`productivity-${viewport.width}.png`) });
  }
  await page.reload();
  await expect.poll(verify).toEqual({ minutes: 384, study: 384, events: 1 });
  expect(errors).toEqual([]);
});
