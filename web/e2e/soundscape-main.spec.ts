import type { Page } from "@playwright/test";
import { completeSetup, expect, reloadAfterSave, test } from "./fixtures";

type AudioWindow = Window & { __AXOM_TEST_AUDIO__: HTMLAudioElement[] };
type PlayerWindow = Window & {
  __AXOM_DEV__: Promise<{
    useSoundscape: { getState: () => { status: string; presetId: string | null; loadedVersionId: string | null; mainSound: { presetId: string; versionId: string }; pinned: string[] } };
    soundscapeAnalyser: () => AnalyserNode | null;
  }>;
};

async function openSounds(page: Page) {
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await completeSetup(page, "Soundscape acceptance", { ifVisible: true });
  const later = page.getByRole("button", { name: "Review later", exact: true });
  if (await later.count()) await later.click();
  await page.evaluate(() => { location.hash = "soundscapes"; });
  await page.locator(".soundscapes-page").waitFor();
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  if (await skip.count()) await skip.click();
  await expect(page.locator(".soundscape-opener")).toHaveCount(0);
}

async function player(page: Page) {
  return page.evaluate(async () => {
    const { useSoundscape } = await (window as unknown as PlayerWindow).__AXOM_DEV__;
    const { status, presetId, loadedVersionId, mainSound, pinned } = useSoundscape.getState();
    return { status, presetId, loadedVersionId, mainSound, pinned };
  });
}

function toneWave() {
  const samples = 16_000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24); buffer.writeUInt32LE(32_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 16_000) * 4_000), 44 + i * 2);
  return buffer;
}

test("AXOM Soundscape 1 plays the bundled loop, pauses its clock, resumes, and drives the Orb", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Observe real media elements without replacing their playback implementation.
  await page.addInitScript(() => {
    const observed = window as unknown as AudioWindow;
    observed.__AXOM_TEST_AUDIO__ = [];
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(src?: string) { super(src); observed.__AXOM_TEST_AUDIO__.push(this); }
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSounds(page);
  const main = page.getByRole("region", { name: "Main sound", exact: true });
  await expect(main.getByRole("heading", { name: "AXOM Soundscape 1" })).toBeVisible();
  expect(await player(page)).toMatchObject({ status: "idle", mainSound: { presetId: "axom-1", versionId: "axom-soundscape-1" } });
  expect((await player(page)).pinned[0]).toBe("axom-1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await main.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await player(page)).status).toBe("playing");
  const mediaState = () => page.evaluate(() => {
    const audio = (window as unknown as AudioWindow).__AXOM_TEST_AUDIO__.find((item) => item.src.endsWith("/soundscapes/axom-soundscape-1.m4a"));
    return audio ? { duration: audio.duration, currentTime: audio.currentTime, loop: audio.loop, paused: audio.paused } : null;
  });
  await expect.poll(async () => (await mediaState())?.currentTime ?? 0).toBeGreaterThan(0.2);
  expect((await mediaState())?.duration).toBeCloseTo(566.92, 1);
  expect(await mediaState()).toMatchObject({ loop: true, paused: false });
  const orb = page.locator(".soundscape-hero .sound-orb");
  await expect(orb).toHaveAttribute("data-response", "audio");
  await page.screenshot({ path: testInfo.outputPath("soundscapes-playing-desktop.png") });
  await expect.poll(() => page.evaluate(async () => {
    const { soundscapeAnalyser } = await (window as unknown as PlayerWindow).__AXOM_DEV__;
    const analyser = soundscapeAnalyser();
    if (!analyser) return 0;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    return Math.max(...samples.map((sample) => Math.abs(sample - 128)));
  })).toBeGreaterThan(0);
  await main.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await mediaState())?.paused).toBe(true);
  const pausedAt = (await mediaState())!.currentTime;
  await page.waitForTimeout(300); // A suspended context alone must not leave the recording clock running.
  expect((await mediaState())!.currentTime).toBeCloseTo(pausedAt, 2);
  await expect(orb).toHaveAttribute("data-response", "idle");
  await main.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await mediaState())!.currentTime).toBeGreaterThan(pausedAt);
  expect(await page.evaluate(() => (window as unknown as AudioWindow).__AXOM_TEST_AUDIO__.filter((item) => item.src.endsWith("/soundscapes/axom-soundscape-1.m4a")).length)).toBe(1);
  await page.evaluate(() => {
    const audio = (window as unknown as AudioWindow).__AXOM_TEST_AUDIO__.find((item) => item.src.endsWith("/soundscapes/axom-soundscape-1.m4a"))!;
    audio.currentTime = audio.duration - 0.15;
  });
  await expect.poll(async () => (await mediaState())!.currentTime).toBeLessThan(2);
  expect((await player(page)).status).toBe("playing");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(orb).toHaveAttribute("data-response", "still");
  await reloadAfterSave(page);
  await expect(main.getByRole("heading", { name: "AXOM Soundscape 1" })).toBeVisible();
  expect((await player(page)).status).toBe("idle");
  expect((await player(page)).pinned[0]).toBe("axom-1");
  expect(errors).toEqual([]);
});

test("a personal main sound survives reload and deleting it preserves another playing track", async ({ page }) => {
  await openSounds(page);
  const main = page.getByRole("region", { name: "Main sound", exact: true });
  const makeNextMain = page.getByRole("checkbox", { name: "Make the next added sound my main sound" });
  await makeNextMain.check();
  await page.locator('.your-sounds-add input[type="file"]').setInputFiles([
    { name: "Study tone.wav", mimeType: "audio/wav", buffer: toneWave() },
    { name: "Second tone.wav", mimeType: "audio/wav", buffer: toneWave() },
  ]);
  await expect(main.getByRole("heading", { name: "Study tone", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play Second tone", exact: true })).toBeVisible();
  await expect(makeNextMain).not.toBeChecked();
  await reloadAfterSave(page);
  await expect(main.getByRole("heading", { name: "Study tone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play Second tone", exact: true }).click();
  await expect.poll(async () => (await player(page)).status).toBe("playing");
  const loaded = (await player(page)).loadedVersionId;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove Study tone", exact: true }).click();
  await expect(main.getByRole("heading", { name: "AXOM Soundscape 1" })).toBeVisible();
  expect(await player(page)).toMatchObject({ status: "playing", loadedVersionId: loaded });
  await expect(page.getByRole("button", { name: "Pause Second tone", exact: true })).toBeVisible();
});
