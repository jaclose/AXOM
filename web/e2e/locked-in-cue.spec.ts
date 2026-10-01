import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test } from "./fixtures";

/**
 * Ideas 5 (I5-11, I5-12, I5-28): the "Are you locked in?" check-in arrives with
 * a quiet rising chime, and "I am locked out" is one of the answers. Checked in
 * a browser by listening to what the page asks the audio engine to play.
 */
type Tone = { frequency: number; at: number };
type Probe = Window & { __axomTones: Tone[]; __axomPeaks: number[] };
type DevWindow = Window & { __AXOM_DEV__: Promise<{ useStore: { getState: () => { updateProfile: (patch: Record<string, unknown>) => void } }; flushVault: () => Promise<void> }> };

const BELLS = [783.99, 1046.5, 1318.51];

async function listen(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as Probe;
    probe.__axomTones = [];
    probe.__axomPeaks = [];
    const Context = window.AudioContext;
    if (!Context) return;
    const createOscillator = Context.prototype.createOscillator;
    Context.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => {
        probe.__axomTones.push({ frequency: oscillator.frequency.value, at: (when ?? this.currentTime) - this.currentTime });
        return start(when);
      };
      return oscillator;
    };
    const ramp = AudioParam.prototype.exponentialRampToValueAtTime;
    AudioParam.prototype.exponentialRampToValueAtTime = function (this: AudioParam, value: number, time: number) {
      probe.__axomPeaks.push(value);
      return ramp.call(this, value, time);
    };
  });
}

const heard = (page: Page) => page.evaluate(() => {
  const probe = window as unknown as Probe;
  return { tones: probe.__axomTones.slice(), peaks: probe.__axomPeaks.slice() };
});
const forget = (page: Page) => page.evaluate(() => {
  const probe = window as unknown as Probe;
  probe.__axomTones.length = 0;
  probe.__axomPeaks.length = 0;
});

test("Locked In arrives with three quiet rising bells and offers \"I am locked out\"", async ({ page }) => {
  await listen(page);
  await seedOnboarded(page);
  await page.evaluate(async () => {
    const { useStore, flushVault } = await (window as unknown as DevWindow).__AXOM_DEV__;
    useStore.getState().updateProfile({ focusCheckIn: { enabled: true, intervalMinutes: 5, scope: "anytime", respectQuietHours: false } });
    await flushVault();
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    localStorage.setItem("axom.focus-checkins.v1", JSON.stringify({ day, armedAt: new Date(Date.now() - 6 * 60_000).toISOString(), prompts: 0, lockedIn: 0, drifted: 0, breaks: 0, streak: 0 }));
  });
  await forget(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  const card = page.locator(".focus-checkin");
  await expect(card.getByText("Are you locked in?", { exact: true })).toBeVisible();

  // The chime: G5, C6, E6 in that order, each with two faint overtones, nothing else.
  const { tones, peaks } = await heard(page);
  const bells = tones.filter((tone) => BELLS.some((bell) => Math.abs(tone.frequency - bell) < 0.5)).sort((a, b) => a.at - b.at);
  expect(bells.map((tone) => Math.round(tone.frequency))).toEqual([784, 1047, 1319]);
  expect(bells[0].at).toBeLessThan(0.02);
  expect(bells[2].at).toBeLessThan(0.5);
  expect(tones).toHaveLength(9);
  // Quiet: the loudest bell peaks under 4% of full scale (the timer's own chime peaks at 6%).
  expect(Math.max(...peaks)).toBeLessThanOrEqual(0.04);

  // The three answers, in JD's words.
  await expect(card.getByRole("button", { name: "Locked in" })).toBeVisible();
  const lockedOut = card.getByRole("button", { name: "I am locked out" });
  await expect(lockedOut).toHaveText(/😩\s*I am locked out/);
  await expect(card.getByRole("button", { name: "On a break" })).toBeVisible();
  // The card stays a small strip at the top: a nudge, not a takeover.
  const box = await card.boundingBox();
  expect(box!.height).toBeLessThan(240);
  expect(box!.y).toBeLessThan(40);

  await lockedOut.click();
  await expect(card.locator(".focus-checkin-title")).toHaveText("Back to the work");
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem("axom.focus-checkins.v1") ?? "{}"));
  expect(ledger).toMatchObject({ prompts: 1, drifted: 1, lockedIn: 0 });
});

test("the Locked In chime follows the timer sound setting", async ({ page }) => {
  await listen(page);
  await seedOnboarded(page);
  await page.evaluate(() => localStorage.setItem("axom.timerCues.v1", JSON.stringify({ sound: false, glow: true })));
  await forget(page);
  await page.evaluate(() => window.dispatchEvent(new Event("axom:focus-checkin-preview")));
  await expect(page.locator(".focus-checkin").getByText("Are you locked in?", { exact: true })).toBeVisible();
  expect((await heard(page)).tones).toEqual([]);
});
