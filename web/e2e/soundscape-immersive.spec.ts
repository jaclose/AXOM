import { completeSetup, expect, test } from "./fixtures";

type DevWindow = Window & {
  __AXOM_DEV__: Promise<{
    useSoundscape: { getState: () => { setStopAfter: (minutes: number | null) => void; status: string } };
    usePomodoro: { getState: () => {
      setPreset: (id: string) => void; start: () => void; reset: () => void;
      pause: () => void; secondsLeft: number; running: boolean;
    } };
  }>;
};

test("soundscape fullscreen shows the existing focus timer until it is reset", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await completeSetup(page, "Immersive timer", { ifVisible: true });
  const later = page.getByRole("button", { name: "Review later", exact: true });
  if (await later.count()) await later.click();
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await expect(page.locator(".soundscapes-page")).toBeVisible();
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (await skip.count()) await skip.click();

  await expect(page.getByRole("group", { name: "Focus timer" })).toHaveCount(0);
  await page.evaluate(async () => {
    const { usePomodoro } = await (window as unknown as DevWindow).__AXOM_DEV__;
    usePomodoro.getState().setPreset("25-5");
    usePomodoro.getState().start();
  });
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("soundscape-hero") ?? false)).toBe(true);
  const timer = page.getByRole("group", { name: "Focus timer" });
  await expect(timer).toBeVisible();
  await expect(timer.getByRole("timer")).toContainText(/\d+:\d+/);
  await expect(timer).toContainText(/Focus/i);
  const bounds = await timer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1441);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(timer).toBeVisible();
    const mobile = await timer.boundingBox();
    expect(mobile).not.toBeNull();
    expect(mobile!.x).toBeGreaterThanOrEqual(0);
    expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(width + 1);
    expect(mobile!.y + mobile!.height).toBeLessThanOrEqual(845);
  }

  await timer.getByRole("button", { name: "Pause timer" }).click();
  await expect(timer).toContainText("Paused");
  await page.evaluate(async () => {
    const { usePomodoro } = await (window as unknown as DevWindow).__AXOM_DEV__;
    usePomodoro.getState().reset();
  });
  await expect(timer).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("immersive Orb uses actual pixel density within the 8K budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await completeSetup(page, "Immersive Orb", { ifVisible: true });
  const later = page.getByRole("button", { name: "Review later", exact: true });
  if (await later.count()) await later.click();
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await expect(page.locator(".soundscapes-page")).toBeVisible();
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (await skip.count()) await skip.click();
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  const orb = page.locator(".soundscape-hero.is-fullscreen .sound-orb");
  await expect(orb).toBeVisible();
  const values = await orb.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return { pixels: canvas.width * canvas.height, width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, density: devicePixelRatio };
  });
  expect(values.width).toBeGreaterThanOrEqual(Math.floor(values.cssWidth * Math.min(values.density, 1.25)));
  expect(values.pixels).toBeLessThanOrEqual(7680 * 4320);
  expect(values.width).toBeGreaterThan(0);
});

test("soundscape stop timer is shown in fullscreen even without a Pomodoro", async ({ page }) => {
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await completeSetup(page, "Immersive sound stop", { ifVisible: true });
  const later = page.getByRole("button", { name: "Review later", exact: true });
  if (await later.count()) await later.click();
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (await skip.count()) await skip.click();
  await page.getByRole("region", { name: "Main sound", exact: true }).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { useSoundscape } = await (window as unknown as DevWindow).__AXOM_DEV__;
    return useSoundscape.getState().status;
  })).toBe("playing");
  await page.evaluate(async () => {
    const { useSoundscape } = await (window as unknown as DevWindow).__AXOM_DEV__;
    useSoundscape.getState().setStopAfter(5);
  });
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  const timer = page.getByRole("group", { name: "Audio stop timer" });
  await expect(timer).toBeVisible();
  await expect(timer).toContainText("AUDIO STOP");
  await expect(timer).toContainText("Soundscape playback will stop");
  await timer.getByRole("button", { name: "Cancel sound stop timer" }).click();
  await expect(timer).toHaveCount(0);
});
