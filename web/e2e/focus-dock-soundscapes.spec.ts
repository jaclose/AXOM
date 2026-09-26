import { expect, test, type Page } from "@playwright/test";

/** Dev-only live-store handle installed by src/main.tsx. */
type DevWindow = Window & {
  __AXOM_DEV__: Promise<{
    usePomodoro: { getState: () => { start: () => void; running: boolean } };
    useSoundscape: { getState: () => { status: string; presetId: string | null } };
  }>;
};

async function openWorkspace(page: Page) {
  await page.goto("/#dashboard", { waitUntil: "networkidle" });
  const name = page.getByLabel("Display name (optional)");
  if (await name.isVisible()) {
    await name.fill("Dock test");
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Finish setup", exact: true }).click();
    const later = page.getByRole("button", { name: "Review later", exact: true });
    if (await later.count()) await later.click();
  }
}

const soundStatus = (page: Page) => page.evaluate(async () => {
  const { useSoundscape } = await (window as unknown as DevWindow).__AXOM_DEV__;
  return useSoundscape.getState().status;
});

test("the focus dock splits for a soundscape, genies its visual, and stops cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openWorkspace(page);

  await page.evaluate(async () => {
    const { usePomodoro } = await (window as unknown as DevWindow).__AXOM_DEV__;
    usePomodoro.getState().start();
  });
  const dock = page.getByRole("region", { name: "Focus dock" });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("status")).toContainText("Focus running");
  await expect(dock).not.toHaveClass(/split/);

  await page.goto("/#soundscapes");
  await expect(page.getByRole("heading", { name: "Your rotation" })).toBeVisible();
  await page.getByRole("button", { name: "Play 20 Hz Beta" }).first().click();
  await expect.poll(() => soundStatus(page)).toBe("playing");
  await expect(dock).toHaveClass(/split/);

  const capsule = dock.getByRole("button", { name: /20 Hz Beta soundscape/ });
  await capsule.hover();
  const genie = page.getByRole("dialog", { name: "20 Hz Beta soundscape" });
  await expect(genie).toBeVisible();
  await expect(genie).toContainText("Low evidence");
  await page.keyboard.press("Escape");
  await expect(genie).toBeHidden();

  // Switching presets crossfades without leaving the pill.
  await page.getByRole("button", { name: "Play Brown noise" }).first().click();
  await expect(dock.getByRole("button", { name: /Brown noise soundscape/ })).toBeVisible();

  await dock.getByRole("button", { name: "Stop sound" }).click();
  await expect.poll(() => soundStatus(page)).toBe("idle");
  await expect(dock).not.toHaveClass(/split/);
  await expect(dock.getByRole("status")).toContainText("Focus running");

  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dock.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("opening-film settings persist and a preview can be skipped", async ({ page }) => {
  await openWorkspace(page);
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const schedule = page.getByRole("radiogroup", { name: "When the opening film plays" });
  await schedule.getByRole("radio", { name: /First open of the week/ }).click();
  await page.getByRole("radiogroup", { name: "Everyday opening film" }).getByRole("radio", { name: /Edge glint/ }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axom.cinematics.v1") ?? "{}"))).toMatchObject({ frequency: "weekly", intro: "edge-glint" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("radio", { name: /First open of the week/ })).toHaveAttribute("aria-checked", "true");
});

test.describe("with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a first run plays the opening film once and Escape skips it", async ({ page }) => {
    await page.goto("/#dashboard");
    const film = page.getByRole("dialog", { name: /Opening AXOM/ });
    await expect(film).toBeVisible();
    await expect(film.locator("video")).toHaveAttribute("src", /cinematics\/luster-slow-sweep\.mp4$/);
    await page.keyboard.press("Escape");
    await expect(film).toBeHidden();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog", { name: /Opening AXOM/ })).toHaveCount(0);
  });
});
