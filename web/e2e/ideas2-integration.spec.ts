import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

type DevAPI = {
  useStore: typeof import("../src/lib/store").useStore;
  usePomodoro: typeof import("../src/lib/pomodoro").usePomodoro;
  useSoundscape: typeof import("../src/lib/soundscapes/store").useSoundscape;
};
declare global { interface Window { __AXOM_DEV__?: Promise<DevAPI> } }

async function openWorkspace(page: Page) {
  await page.goto("/#dashboard");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await page.evaluate(async () => {
    const { useStore } = await window.__AXOM_DEV__!;
    const state = useStore.getState();
    state.updateProfile({ dashboardLayout: { version: 1, preset: "custom", order: ["winDay", "todayScore", "examCountdown", "pomodoro", "weekly"], hiddenWidgetIds: [], widgets: { examCountdown: { size: "large", enabledFields: [], preferences: {} } } } });
  });
  await expect(page.getByText("Exam horizon", { exact: true })).toBeVisible();
}
async function navigate(page: Page, route: string) {
  await page.evaluate((value) => { location.hash = value; }, route);
}

test("exam edits, completion, removal and Step 1 dates persist through reload", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Set Step 1 date" }).click();
  await page.getByLabel("Step 1 date", { exact: true }).fill("2027-03-31");
  await page.getByLabel("Date status").selectOption("booked");
  await page.getByRole("button", { name: "Save date" }).click();
  await page.getByRole("button", { name: "Add exam", exact: true }).click();
  await page.getByLabel("Exam name").fill("Renal module exam");
  await page.getByLabel("Exam date").fill("2026-10-07");
  await page.getByRole("button", { name: "Save date" }).click();
  await page.reload();
  await expect(page.getByLabel("Step 1 countdown")).toContainText("Booked");
  await expect(page.getByLabel("Step 1 countdown")).toContainText("Mar 31, 2027");
  await page.getByRole("button", { name: "Edit Renal module exam" }).click();
  await page.getByLabel("Exam name").fill("Renal final");
  await page.getByRole("button", { name: "Save date" }).click();
  await page.getByRole("button", { name: "Complete Renal final" }).click();
  await page.getByRole("button", { name: "Show 1 completed exam" }).click();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("button", { name: "Remove Renal final" }).click();
  await expect(page.getByLabel("Module exam countdowns")).not.toContainText("Renal final");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Module exam countdowns")).toContainText("Renal final");
});

test("Locked In survives route changes and reload, with explicit goal and timer language", async ({ page }, info) => {
  await openWorkspace(page);
  await page.evaluate(async () => {
    const { useStore } = await window.__AXOM_DEV__!;
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
    const { useStore } = await window.__AXOM_DEV__!;
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
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`checkin-${theme}-${width}.png`) });
  }
  await page.getByRole("button", { name: /locked in/i }).click();
  await navigate(page, "soundscapes");
  await expect(page.locator(".focus-checkin")).toHaveCount(0);
  await page.evaluate(async () => { const dev = await window.__AXOM_DEV__!; dev.usePomodoro.getState().start(); window.dispatchEvent(new Event("axom:focus-checkin-preview")); });
  await expect(page.locator(".focus-checkin")).toContainText(/left in this focus session/);
});

test("Spotify API contract keeps one player across navigation and drives the media dock", async ({ page }) => {
  await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.onSpotifyIframeApiReady({ createController(element, options, callback) {
      const iframe = document.createElement('iframe'); iframe.title = 'Spotify contract fixture'; iframe.dataset.instance = crypto.randomUUID(); element.replaceWith(iframe);
      document.documentElement.dataset.spotifyCreates = String(Number(document.documentElement.dataset.spotifyCreates || 0) + 1);
      const listeners = {}; let state = { isPaused: true, isBuffering: false, position: 0, duration: 180000, playingURI: options.uri };
      const emit = () => listeners.playback_update?.({data:state});
      const controller = { addListener(name, fn) { listeners[name] = fn; if(name === 'ready') queueMicrotask(fn); }, loadEntity(uri) { state = {...state, playingURI:uri, position:0}; emit(); }, resume() { state.isPaused = false; emit(); }, play() { this.resume(); }, pause() { state.isPaused = true; emit(); }, destroy() { iframe.remove(); } };
      window.addEventListener('qa:spotify', e => { state = {...state, ...e.detail}; emit(); }); callback(controller);
    }});` }));
  await openWorkspace(page);
  await navigate(page, "soundscapes");
  await page.getByRole("button", { name: "Open player", exact: true }).first().click();
  const frame = page.locator(".persistent-spotify iframe");
  await expect(frame).toHaveCount(1);
  const instance = await frame.getAttribute("data-instance");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("qa:spotify", { detail: { isPaused: false, position: 1000 } })));
  const dock = page.getByRole("region", { name: "Focus dock" });
  await expect(dock.getByRole("button", { name: "Pause Spotify" })).toBeVisible();
  await page.getByRole("button", { name: "Hide Spotify player" }).click();
  await navigate(page, "productivity");
  await expect(page.getByText("Log an activity", { exact: true })).toBeVisible();
  await expect(frame).toHaveAttribute("data-instance", instance!);
  await expect(page.locator("html")).toHaveAttribute("data-spotify-creates", "1");
  await dock.getByRole("button", { name: "Pause Spotify" }).click();
  await expect(dock.getByRole("button", { name: "Resume Spotify" })).toBeVisible();
  await dock.getByRole("button", { name: "Resume Spotify" }).click();
  await dock.getByRole("button", { name: "Show spotify player" }).click();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await navigate(page, "soundscapes");
  await expect(frame).toHaveAttribute("data-instance", instance!);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(frame).toHaveCount(0);
});

test("focus spaces retain the timer, support local video and recover the saved selection", async ({ page }) => {
  await openWorkspace(page);
  await page.evaluate(async () => { const dev = await window.__AXOM_DEV__!; dev.usePomodoro.getState().start(); });
  await navigate(page, "soundscapes");
  await page.getByRole("button", { name: "Open space", exact: true }).click();
  await expect(page.getByRole("region", { name: "Active focus space" })).toBeVisible();
  await page.getByRole("button", { name: "Enter immersive view" }).click();
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume timer" })).toBeVisible();
  await page.getByRole("button", { name: "Close focus space" }).click();
  await page.getByLabel("Import focus video").setInputFiles(path.resolve("public/scenes/kelp-forest.mp4"));
  const localVideo = page.getByRole("region", { name: "Active focus space" }).locator("video");
  await expect(localVideo).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => localVideo.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close focus space" }).click();
  await page.reload();
  await expect(page.getByLabel("Environment", { exact: true })).toHaveValue("local");
  await page.getByRole("button", { name: "Open space", exact: true }).click();
  await expect(localVideo).toHaveAttribute("src", /^blob:/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Active focus space" })).toHaveCount(0);
});

test("desktop/mobile themes, reduced motion and new library controls have no overflow or console errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  await openWorkspace(page);
  for (const theme of ["dark", "light"]) for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: size.width === 390 ? "reduce" : "no-preference" });
    await page.evaluate((value) => { localStorage.setItem("axom.theme", value); window.dispatchEvent(new Event("axom:theme-change")); document.documentElement.dataset.theme = value; }, theme);
    for (const route of ["dashboard", "productivity", "soundscapes", "folders"]) {
      await navigate(page, route);
      await expect(page.locator(".route-loading")).toHaveCount(0);
      await page.locator(".surface-scroll").evaluate(async (element) => {
        for (let y = 0; y < element.scrollHeight; y += element.clientHeight) { element.scrollTop = y; await new Promise(requestAnimationFrame); }
        element.scrollTop = 0;
      });
      expect(await page.locator(".surface-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${route} ${theme} ${size.width}`).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${route}-${theme}-${size.width}.png`) });
    }
  }
  await navigate(page, "soundscapes");
  await page.getByLabel("Search sound library").fill("zz-not-a-sound");
  await expect(page.getByText("No sounds match this search.", { exact: false })).toBeVisible();
  await page.getByLabel("Search sound library").fill("");
  await page.getByRole("button", { name: "Favorite Exquisite chess — piano" }).click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exquisite chess — piano" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfavorite Exquisite chess — piano" })).toBeVisible();
  expect(errors).toEqual([]);
});
