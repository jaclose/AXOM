import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";

/** First visits open the "What are you into?" opener; tests that aren't about it skip it. */
async function skipSoundscapeOpener(page: Page) {
  // The opener mounts in the same render as the page, so wait for the page first.
  await page.locator(".soundscapes-page").waitFor();
  const skip = page.getByRole("button", { name: "Skip for now" });
  if (await skip.count()) await skip.click();
  await expect(page.locator(".soundscape-opener")).toHaveCount(0);
}

async function openWorkspace(page: Page) {
  await page.goto("/#dashboard", { waitUntil: "networkidle" });
  if (await completeSetup(page, "Scenes test", { ifVisible: true })) {
    const later = page.getByRole("button", { name: "Review later", exact: true });
    if (await later.count()) await later.click();
  }
}

test("frequency cards, ambient sounds, scenes and Spotify load cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openWorkspace(page);
  await page.goto("/#soundscapes");
  await skipSoundscapeOpener(page);

  await expect(page.getByRole("heading", { name: "What each frequency is for" })).toBeVisible();
  for (const headline of ["The binding rhythm", "The working brain", "The resting rhythm", "The slow waves of sleep"]) {
    await expect(page.getByRole("heading", { name: headline })).toBeVisible();
  }
  const ambient = page.locator(".ambient-card");
  await expect(ambient).toHaveCount(8);

  // Scenes are real, loadable video files.
  const gamma = page.getByRole("article", { name: /40 Hz Gamma/ });
  const video = gamma.locator("video.scene-player");
  await expect(video).toHaveAttribute("src", /scenes\/cockpit\.mp4$/);
  const status = await page.evaluate(async (src) => (await fetch(src, { method: "HEAD" })).status, await video.getAttribute("src"));
  expect(status).toBe(200);

  // The hero's scene picker swaps between scenes and the generative visual.
  // Backgrounds live behind one "Background" button that opens over the stage.
  const hero = page.locator(".soundscape-hero");
  await hero.getByRole("button", { name: /^Background/ }).click();
  await hero.getByRole("radio", { name: "Earth turning scene" }).click();
  await expect(hero.locator("video.scene-player")).toHaveAttribute("src", /scenes\/earth\.mp4$/);
  await hero.getByRole("radio", { name: "Generative" }).click();
  await expect(hero.locator("video.scene-player")).toHaveCount(0);
  await expect(hero.locator("canvas.soundscape-visual")).toHaveCount(1);
  await hero.getByRole("radio", { name: "Auto" }).click();

  // Spotify only loads when asked.
  await expect(page.locator("iframe.spotify-embed")).toHaveCount(0);
  await page.getByRole("button", { name: /Load the Spotify player/ }).first().click();
  await expect(page.locator("iframe.spotify-embed").first()).toHaveAttribute("src", /open\.spotify\.com\/embed\/playlist\/0KAHoInyGB8kJ0NplpAP3h/);

  expect(errors.filter((message) => !/spotify|favicon|Failed to load resource/i.test(message))).toEqual([]);
});
