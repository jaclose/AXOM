import { expect, test, type Page } from "@playwright/test";
type DevWindow = Window & { __AXOM_DEV__?: Promise<{ useStore: typeof import("../src/lib/store").useStore; usePomodoro: typeof import("../src/lib/pomodoro").usePomodoro }> };
async function openWorkspace(page: Page) {
  await page.goto("/#dashboard");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
}
async function navigate(page: Page, route: string) { await page.evaluate((value) => { location.hash = value; }, route); }

test("Locked In survives route changes and reload, with explicit goal and timer language", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorkspace(page);
  await page.evaluate(async () => {
    const { useStore } = await (window as DevWindow).__AXOM_DEV__!;
    useStore.getState().updateProfile({ focusCheckIn: { enabled: true, intervalMinutes: 5, scope: "anytime", respectQuietHours: false } });
  });
  await page.evaluate(() => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    localStorage.setItem("axom.focus-checkins.v1", JSON.stringify({ day, armedAt: new Date(Date.now() - 6 * 60_000).toISOString(), prompts: 0, lockedIn: 0, drifted: 0, breaks: 0, streak: 0 }));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByText("Are you locked in?", { exact: true })).toBeVisible();
  await navigate(page, "productivity");
  await expect(page.getByText("Are you locked in?", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Are you locked in?", { exact: true })).toBeVisible();
  await expect(page.locator(".focus-checkin")).toContainText("Remember to log work done outside AXOM");
  await page.evaluate(async () => {
    const { useStore } = await (window as DevWindow).__AXOM_DEV__!;
    const day = useStore.getState().activeDayKey;
    const at = new Date().toISOString();
    useStore.getState().updateProfile({ dailySuccess: { version: 1, configuredAt: day, requirements: [{ id: "study", label: "Study", enabled: true, source: { kind: "study-minutes" }, target: 42, unit: "minutes", schedule: { kind: "daily" }, trackingStartsAt: day, createdAt: at, updatedAt: at }] } });
  });
  await expect(page.locator(".focus-checkin")).toContainText("42 min remaining toward today's Study goal");
  for (const theme of ["dark", "light"]) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: width === 390 ? "reduce" : "no-preference" });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const bounds = await page.locator(".focus-checkin").boundingBox();
    expect(bounds!.y).toBeLessThan(40);
    expect(bounds!.height).toBeLessThan(240);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`checkin-${theme}-${width}.png`) });
  }
  await page.getByRole("button", { name: /locked in/i }).click();
  await navigate(page, "soundscapes");
  await expect(page.locator(".focus-checkin")).toHaveCount(0);
  await page.evaluate(async () => { const dev = await (window as DevWindow).__AXOM_DEV__!; dev.usePomodoro.getState().start(); window.dispatchEvent(new Event("axom:focus-checkin-preview")); });
  await expect(page.locator(".focus-checkin")).toContainText(/left in this focus session/);
  expect(errors).toEqual([]);
});
