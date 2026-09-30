import { expect, test, type Page } from "@playwright/test";

const piano = "0KAHoInyGB8kJ0NplpAP3h";
const jazz = "37i9dQZF1DX3SiCzCxMDOH";

async function openSoundscapes(page: Page) {
  await page.goto("/#dashboard");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await page.evaluate(() => { location.hash = "soundscapes"; });
  await expect(page.getByRole("heading", { name: "Find your sound" })).toBeVisible();
}

async function spotifyFixture(page: Page, delayReady = false) {
  // Exercise only the documented controller contract; live Spotify is checked separately.
  await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.onSpotifyIframeApiReady({ createController(element, options, callback) {
      const frame = document.createElement('iframe'); frame.title = 'Spotify persistence fixture';
      frame.dataset.instance = crypto.randomUUID(); frame.dataset.uri = options.uri; element.replaceWith(frame);
      const listeners = {}; let state = { isPaused: true, isBuffering: false, position: 0, duration: 180000, playingURI: options.uri };
      const emit = () => listeners.playback_update?.({ data: state });
      const ready = () => listeners.ready?.({});
      const controller = {
        addListener(name, fn) { listeners[name] = fn; if (name === 'ready' && !${delayReady}) queueMicrotask(ready); },
        loadEntity(uri) { frame.dataset.uri = uri; state = { ...state, playingURI: uri, position: 0 }; emit(); },
        resume() { state.isPaused = false; emit(); }, play() { this.resume(); },
        pause() { state.isPaused = true; emit(); },
        destroy() { frame.remove(); window.removeEventListener('qa:spotify-play', play); window.removeEventListener('qa:spotify-ready', ready); }
      };
      const play = () => controller.resume();
      window.addEventListener('qa:spotify-play', play); window.addEventListener('qa:spotify-ready', ready);
      callback(controller);
    }});
  ` }));
}

test("personalization and sound settings survive reload; audio and its dock survive navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await openSoundscapes(page);
  await page.getByRole("button", { name: "Personalize", exact: true }).click();
  await page.getByRole("checkbox", { name: /Rain & waves/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: /Waves/ }).click();
  await page.getByRole("button", { name: "Start listening", exact: true }).click();
  await page.reload();
  const hero = page.locator(".soundscape-hero");
  await expect(hero.getByRole("heading")).toHaveText("Soft rain");
  await hero.getByRole("radio", { name: "Speakers", exact: true }).click();
  await hero.getByRole("slider", { name: "Volume" }).fill("17");
  await hero.getByRole("radio", { name: "Generative", exact: true }).click();
  await hero.getByRole("radio", { name: "Rain & fireplace", exact: true }).click();
  await hero.getByRole("checkbox", { name: /Follow my Pomodoro/ }).uncheck();
  await hero.getByRole("button", { name: "Play Soft rain", exact: true }).click();
  const dock = page.getByRole("region", { name: "Focus dock" });
  await expect(dock.getByRole("button", { name: "Pause sound", exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = "dashboard"; });
  await expect(page.locator(".soundscapes-page")).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Pause sound", exact: true })).toBeVisible();
  await dock.getByRole("button", { name: "Pause sound", exact: true }).click();
  await expect(dock.getByRole("button", { name: "Play sound", exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = "soundscapes"; });
  await page.reload();
  await expect(hero.getByRole("heading")).toHaveText("Soft rain");
  await expect(hero.getByRole("slider", { name: "Volume" })).toHaveValue("17");
  await expect(hero.getByRole("radio", { name: "Speakers", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(hero.getByRole("radio", { name: "Generative", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(hero.getByRole("radio", { name: "Rain & fireplace", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(hero.getByRole("checkbox", { name: /Follow my Pomodoro/ })).not.toBeChecked();
  await expect(dock).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Spotify keeps one player across routes and restores the saved selection without autoplay", async ({ page }) => {
  await spotifyFixture(page);
  await openSoundscapes(page);
  await page.getByRole("button", { name: "Open player", exact: true }).first().click();
  const frame = page.getByTitle("Spotify persistence fixture", { exact: true });
  await expect(frame).toHaveAttribute("data-uri", `spotify:playlist:${piano}`);
  const instance = await frame.getAttribute("data-instance");
  await page.evaluate(() => window.dispatchEvent(new Event("qa:spotify-play")));
  await page.getByRole("button", { name: "Hide Spotify player" }).click();
  await page.evaluate(() => { location.hash = "dashboard"; });
  await expect(page.locator(".soundscapes-page")).toHaveCount(0);
  await expect(frame).toHaveAttribute("data-instance", instance!);
  const dock = page.getByRole("region", { name: "Focus dock" });
  await dock.getByRole("button", { name: "Pause Spotify" }).click();
  await expect(dock.getByRole("button", { name: "Resume Spotify" })).toBeVisible();
  await dock.getByRole("button", { name: "Resume Spotify" }).click();
  await expect(dock.getByRole("button", { name: "Pause Spotify" })).toBeVisible();
  await page.evaluate(() => { location.hash = "soundscapes"; });
  const jazzCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Jazz for Study", exact: true }) });
  await jazzCard.getByRole("button", { name: "Favorite Jazz for Study", exact: true }).click();
  await jazzCard.getByRole("button", { name: "Open player", exact: true }).click();
  await expect(frame).toHaveAttribute("data-instance", instance!);
  await expect(frame).toHaveAttribute("data-uri", `spotify:playlist:${jazz}`);
  await page.reload();
  await expect(frame).toHaveAttribute("data-uri", `spotify:playlist:${jazz}`);
  await expect(dock).toHaveCount(0);
  await expect(jazzCard.getByRole("button", { name: "Unfavorite Jazz for Study" })).toHaveAttribute("aria-pressed", "true");
  await jazzCard.getByRole("button", { name: "Show Spotify player" }).click();
  await page.getByRole("button", { name: "Hide Spotify player" }).focus();
  await page.keyboard.press("Escape");
  await expect(frame).toBeHidden();
  await jazzCard.getByRole("button", { name: "Show Spotify player" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(frame).toHaveCount(0);
  await page.reload();
  await expect(frame).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axom.spotify.v1")!))).toEqual({ enabled: false, playlistId: jazz });
});

test("playlist changes during Spotify initialization reach the persistent controller", async ({ page }) => {
  await spotifyFixture(page, true);
  await openSoundscapes(page);
  await page.getByRole("button", { name: "Open player", exact: true }).first().click();
  const frame = page.getByTitle("Spotify persistence fixture", { exact: true });
  await expect(frame).toHaveCount(1);
  await page.getByRole("button", { name: "Hide Spotify player" }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "Jazz for Study", exact: true }) }).getByRole("button", { name: "Open player", exact: true }).click();
  await expect(frame).toHaveAttribute("data-uri", `spotify:playlist:${piano}`);
  await page.evaluate(() => window.dispatchEvent(new Event("qa:spotify-ready")));
  await expect(frame).toHaveAttribute("data-uri", `spotify:playlist:${jazz}`);
  await expect(page.getByText("Connecting to Spotify…", { exact: true })).toHaveCount(0);
});
