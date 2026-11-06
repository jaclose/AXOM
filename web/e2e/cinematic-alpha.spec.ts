import { test, expect, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const media = "/landing/alpha-v1/";

async function seekFrame(video: Locator, seconds: number) {
  await video.evaluate((el: HTMLVideoElement, time) => new Promise<void>((resolve) => {
    el.addEventListener("seeked", () => resolve(), { once: true });
    el.currentTime = time;
  }), seconds);
  await expect(video).toHaveCSS("opacity", "1");
}

test("approved alpha files retain the owner's exact bytes", async () => {
  const root = new URL("../public/landing/alpha-v1/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8")) as { files: { name: string; bytes: number; sha256: string }[] };
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.name, root));
    expect(bytes.byteLength).toBe(file.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
});

test("approved film occupies the full homepage without a marketing overlay", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".landing-page--cinematic")).toBeVisible();
  await expect(page.locator(".landing-copy")).toHaveCount(0);
  for (const [width, height] of [[1440, 900], [390, 844], [2560, 1080], [844, 390], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("link", { name: "Open AXOM", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign In", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download for Desktop" })).toBeVisible();
    const bounds = await page.locator(".landing-film").boundingBox();
    expect(bounds?.width).toBe(width);
    expect(bounds?.height).toBe(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".landing-film img").evaluate(el => getComputedStyle(el).objectFit)).toBe("contain");
    await page.screenshot({ path: testInfo.outputPath(`cinematic-alpha-${width}.png`), fullPage: true });
  }
});

test("desktop plays the approved local film muted with working pause and sound", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const video = page.locator(".landing-film video");
  await expect(video).toHaveAttribute("src", `${media}axom-launch-web.mp4`);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(video).toHaveJSProperty("playsInline", true);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Enable film sound" }).click();
  await expect(video).toHaveJSProperty("muted", false);
  await page.getByRole("button", { name: "Pause background film" }).click();
  await expect(video).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Mute film sound" }).click();
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("paused", true);
  await seekFrame(video, 12);
  await page.screenshot({ path: testInfo.outputPath("cinematic-alpha-playing.png") });
  await seekFrame(video, 35.5);
  await page.getByRole("button", { name: "Play background film" }).click();
  await expect(video).toHaveJSProperty("paused", false);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test("portrait uses only the mobile film and rotation retains user pause and position", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requests: string[] = [];
  page.on("request", request => { if (/\.mp4(?:\?|$)/.test(request.url())) requests.push(request.url()); });
  await page.goto("/");
  const video = page.locator(".landing-film video");
  await expect(video).toHaveAttribute("src", `${media}axom-launch-mobile.mp4`);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.1);
  expect(requests.every(url => url.includes("axom-launch-mobile.mp4"))).toBe(true);
  await page.getByRole("button", { name: "Pause background film" }).click();
  await seekFrame(video, 12);
  await page.screenshot({ path: testInfo.outputPath("cinematic-alpha-mobile-playing.png") });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(video).toHaveAttribute("src", `${media}axom-launch-web.mp4`);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(1);
  await expect(video).toHaveJSProperty("paused", true);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(11);
});

for (const mode of ["reduce", "save-data", "slow-connection"] as const) {
  test(`${mode} loads a poster without downloading either film`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: mode === "reduce" ? "reduce" : "no-preference" });
    await page.addInitScript(value => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: value === "save-data", effectiveType: value === "slow-connection" ? "slow-2g" : "4g" } }), mode);
    const requests: string[] = [];
    page.on("request", request => { if (/\.mp4(?:\?|$)/.test(request.url())) requests.push(request.url()); });
    await page.goto("/");
    await expect(page.locator(".landing-film img")).not.toHaveJSProperty("naturalWidth", 0);
    await expect(page.locator(".landing-film video")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open AXOM", exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole("button", { name: "Play background film" }).click();
    await expect(page.locator(".landing-film video")).toHaveCount(1);
  });
}

test("autoplay refusal leaves a usable play control instead of a blank page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    Reflect.set(window, "allowFilm", false);
    HTMLMediaElement.prototype.play = function () {
      return Reflect.get(window, "allowFilm") ? play.call(this) : Promise.reject(new DOMException("User gesture required", "NotAllowedError"));
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play background film" })).toBeVisible();
  await expect(page.locator(".landing-film img")).toBeVisible();
  await page.evaluate(() => Reflect.set(window, "allowFilm", true));
  await page.getByRole("button", { name: "Play background film" }).click();
  await expect(page.locator("video")).toHaveJSProperty("paused", false);
});

test("failed media keeps the poster, retry and app entry usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.locator("video").evaluate(el => el.dispatchEvent(new Event("error")));
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator(".landing-film img")).not.toHaveJSProperty("naturalWidth", 0);
  await expect(page.getByRole("link", { name: "Open AXOM", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry film" }).click();
  await expect(page.locator("video")).toHaveCount(1);
});

test("changing the device motion preference stops media without touching workspace data", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("video")).toHaveCount(1);
  await page.evaluate(() => { document.documentElement.dataset.motion = "reduce"; });
  await expect(page.locator("video")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("noctyrium-state"))).toBeNull();
});
