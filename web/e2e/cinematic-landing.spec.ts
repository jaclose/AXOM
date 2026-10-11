import { test, expect } from "@playwright/test";
import { RELEASES_API } from "../src/lib/landing/releases";

test("public page is responsive, static for reduced motion, and isolated from learner data", async ({ page }, testInfo) => {
  const issues: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) issues.push(message.text()); });
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A mind at work.A world in order.");
  await expect(page.locator(".landing-film img")).toHaveJSProperty("complete", true);
  await expect(page.locator(".landing-film img")).not.toHaveJSProperty("naturalWidth", 0);
  for (const [width, height] of [[1440, 900], [390, 844], [2560, 1080]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "Download for Desktop" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await expect(page.getByText("Built for the way you learn.")).toBeVisible();
  }
  expect(requests.some((url) => /\.(webm|mp4)(\?|$)/.test(url))).toBe(false);
  expect(requests.some((url) => /lib\/store|workspaceBootstrap|src\/main.tsx/.test(url))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("noctyrium-state"))).toBeNull();
  expect(issues).toEqual([]);
});

test("download panel handles empty releases, closes by keyboard, and restores focus", async ({ page }) => {
  await page.route(RELEASES_API, (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Download for Desktop" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("next desktop release");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Close downloads" }).click();
  await expect(trigger).toBeFocused();
});

test("download retries failures and downloads a validated release fixture", async ({ page }) => {
  let count = 0;
  const asset = "https://github.com/jaclose/AXOM/releases/download/v1/AXOM-arm64.dmg";
  await page.route(RELEASES_API, (route) => route.fulfill(count++ ? { json: [{ tag_name: "v1", prerelease: true, assets: [{ name: "AXOM-arm64.dmg", browser_download_url: asset, size: 40_000_000 }] }] } : { status: 503, body: "Unavailable" }));
  await page.route(asset, (route) => route.fulfill({ contentType: "application/octet-stream", headers: { "content-disposition": "attachment; filename=AXOM-arm64.dmg" }, body: "test-only installer bytes" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Download for Desktop" }).click();
  await expect(page.getByRole("alert")).toContainText("couldn’t check");
  await page.getByRole("button", { name: "Try again" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /macOS/ }).click();
  expect((await download).suggestedFilename()).toBe("AXOM-arm64.dmg");
});

test("browser launch retains first-run setup and sign-in reuses the existing account panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Launch in Browser" }).click();
  await expect(page).toHaveURL(/app=1/);
  await expect(page.locator(".setup-root")).toBeVisible();
  await page.goto("/");
  await page.getByRole("link", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/app=1&account=1/);
  await expect(page.getByRole("heading", { name: "Your AXOM account" })).toBeVisible();
  await expect(page.locator(".account-center")).toBeVisible();
  await expect(page.getByText("Accounts aren’t available in this version")).toBeVisible();
  await page.getByRole("link", { name: "Continue to AXOM" }).click();
  await expect(page.locator(".setup-root")).toBeVisible();
});

test("film plays, pauses, and switches to static when reduced motion changes", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: false, effectiveType: "4g" }, configurable: true }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const video = page.locator(".landing-film video");
  await expect(video).toHaveClass("is-ready");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause background film" }).click();
  await expect(video).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Play background film" }).click();
  await expect(video).toHaveJSProperty("paused", false);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(video).toHaveJSProperty("paused", true);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(video).toHaveJSProperty("paused", false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(0);
  await expect(page.locator(".landing-film img")).toBeVisible();
});

test("data saver uses the poster without requesting a film", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true }));
  const films: string[] = [];
  page.on("request", (request) => { if (/\.(webm|mp4)$/.test(request.url())) films.push(request.url()); });
  await page.goto("/");
  await expect(page.locator(".landing-film img")).not.toHaveJSProperty("naturalWidth", 0);
  await expect(page.locator("video")).toHaveCount(0);
  expect(films).toEqual([]);
});

test("failed playback leaves the poster and working actions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: false, effectiveType: "4g" }, configurable: true }));
  await page.goto("/");
  await page.locator("video").evaluate((element) => element.dispatchEvent(new Event("error")));
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator(".landing-film img")).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch in Browser" })).toBeVisible();
});

test("account entry preserves system light and dark appearance", async ({ page }, testInfo) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/?app=1&account=1");
    await expect(page.getByRole("heading", { name: "Your AXOM account" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`account-${colorScheme}.png`), fullPage: true });
  }
});
