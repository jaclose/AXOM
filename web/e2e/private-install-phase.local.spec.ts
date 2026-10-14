// Opt-in local performance diagnostic. Uses the user's explicitly selected
// private fixture; never copies bank text, images, credentials or screenshots.
import { test, expect, seedOnboarded } from "./fixtures";

test.skip(!process.env.AXOM_PRIVATE_LIBRARY_DIR, "Set AXOM_PRIVATE_LIBRARY_DIR.");
test.use({ trace: "off", screenshot: "off", video: "off" });
test("private bank installer resolves its final phase and surfaces actionable failures", async ({ page }) => {
  test.setTimeout(75_000);
  const events: { elapsed: number; phase: string }[] = [];
  const started = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#questions");
  const panel = page.getByRole("region", { name: "Prepared library", exact: true });
  if (!await panel.isVisible()) await page.getByText("Local collection transfer and source review", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Install prepared folder", exact: true }).click();
  await (await chooser).setFiles(process.env.AXOM_PRIVATE_LIBRARY_DIR!);
  let last = "";
  for (let i = 0; i < 100; i++) {
    const phase = (await panel.getByRole("status").allTextContents()).join(" | ");
    if (phase !== last) { events.push({ elapsed: Date.now() - started, phase }); last = phase; }
    if (/Library installed\.|Package installation|reinstall|failed/i.test(phase)) break;
    const alert = await panel.getByRole("alert").allTextContents();
    if (alert.length) { events.push({ elapsed: Date.now() - started, phase: "ALERT: " + alert.join(" | ") }); break; }
    await page.waitForTimeout(250);
  }
  // Reveal only phase names/timings. No source/answer content or account IDs.
  console.log("Installer phase transition timings (milliseconds):", JSON.stringify(events));
  console.log("Browser errors:", JSON.stringify(errors.slice(0, 8)));
  expect(events.some(item => /Library installed\./i.test(item.phase))).toBe(true);
  expect(errors).toEqual([]);
});
