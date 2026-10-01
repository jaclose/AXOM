import type { Page } from "@playwright/test";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

/**
 * JD's two reports from Ideas 5, checked the way he met them (I5-01, I5-27):
 * renaming one of your sounds did not stick, and assigning it to a preset did
 * not change what the preset plays. Both must also survive a reload.
 */
type DevWindow = Window & {
  __AXOM_DEV__: Promise<{
    useSoundscape: { getState: () => { status: string; presetId: string | null; versions: Record<string, string> } };
  }>;
};

/** One second of a 220 Hz tone as a 16-bit mono WAV. */
function toneWav(): Buffer {
  const rate = 8000;
  const samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin((index / rate) * 2 * Math.PI * 220) * 9000), 44 + index * 2);
  return buffer;
}

async function openSoundscapes(page: Page) {
  await page.goto("/#soundscapes", { waitUntil: "networkidle" });
  await page.locator(".soundscapes-page").waitFor();
  const skip = page.getByRole("button", { name: "Skip for now" });
  if (await skip.count()) await skip.click();
  await expect(page.locator(".soundscape-opener")).toHaveCount(0);
}

const player = (page: Page) => page.evaluate(async () => {
  const { useSoundscape } = await (window as unknown as DevWindow).__AXOM_DEV__;
  const { status, presetId, versions } = useSoundscape.getState();
  return { status, presetId, pick: versions["gamma-40"] };
});

test("a renamed and reassigned sound of your own keeps both across a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await openSoundscapes(page);

  // The learner has played 40 Hz Gamma before, so a pick is already saved for it.
  await page.locator(".frequency-card").getByRole("button", { name: "Play 40 Hz Gamma" }).click();
  await expect.poll(async () => (await player(page)).pick).toBe("clean");

  await page.locator(".your-sounds-add input[type=file]").setInputFiles({ name: "recording 0142.wav", mimeType: "audio/wav", buffer: toneWav() });
  const row = page.locator(".your-sound").first();
  await expect(row.locator(".your-sound-copy b")).toHaveText("recording 0142");

  // Rename: Enter saves, clicking away saves, Escape cancels.
  await row.getByRole("button", { name: /^Rename/ }).click();
  await row.getByLabel("Sound name").fill("Alpha waves");
  await row.getByLabel("Sound name").press("Enter");
  await expect(row.locator(".your-sound-copy b")).toHaveText("Alpha waves");
  await row.getByRole("button", { name: /^Rename/ }).click();
  await row.getByLabel("Sound name").fill("Alpha focus");
  await page.locator("#yours-title").click();
  await expect(row.locator(".your-sound-copy b")).toHaveText("Alpha focus");
  await row.getByRole("button", { name: /^Rename/ }).click();
  await row.getByLabel("Sound name").fill("Not this");
  await row.getByLabel("Sound name").press("Escape");
  await expect(row.locator(".your-sound-copy b")).toHaveText("Alpha focus");

  // Assign it to the preset that already had a pick.
  await row.locator("select").selectOption({ label: "40 Hz Gamma" });
  await expect(row.locator(".your-sound-copy small")).toContainText("Plays for 40 Hz Gamma");
  const assigned = (await player(page)).pick;
  expect(assigned).toMatch(/^user-/);

  await reloadAfterSave(page);
  await openSoundscapes(page);
  const after = page.locator(".your-sound").first();
  await expect(after.locator(".your-sound-copy b")).toHaveText("Alpha focus");
  await expect(after.locator(".your-sound-copy small")).toContainText("Plays for 40 Hz Gamma");
  await expect(after.locator("select")).toHaveValue("gamma-40");
  expect((await player(page)).pick).toBe(assigned);

  // Pressing play on the preset plays the learner's file, by its new name.
  await page.locator(".frequency-card").getByRole("button", { name: "Play 40 Hz Gamma" }).click();
  await expect.poll(async () => (await player(page)).status).toBe("playing");
  expect(await player(page)).toMatchObject({ presetId: "gamma-40", pick: assigned });
  await expect(page.locator(".dock-sound-name").first()).toContainText("Alpha focus");
  expect(errors).toEqual([]);
});
