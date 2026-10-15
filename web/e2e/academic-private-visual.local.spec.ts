// Opt-in, private source-backed UI screenshots. Never store proprietary exam
// pages in tracked fixtures, Vite public assets, or public share packages.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, seedOnboarded } from "./fixtures";

const sources = process.env.AXOM_QBANK_SOURCES;
const out = process.env.AXOM_PRIVATE_VISUAL_DIR;
test.skip(!sources || !out, "Set private source+image destinations explicitly; no school content goes into Git.");
test.use({ trace: "off", screenshot: "off", video: "off" });
const originalName = "Biostats+and+Epidemiology+PQ.pdf";
const expectedSha = "f899b4ac414130cf48307486db2ee7b6039aee6e25aae2304bdfe8d43834c7a0";

for (const width of [1440, 390]) test(`private original PDF renders real QBank review at ${width}px`, async ({ page }) => {
  test.setTimeout(90_000);
  const filepath = join(sources!, originalName);
  expect(createHash("sha256").update(readFileSync(filepath)).digest("hex")).toBe(expectedSha);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await seedOnboarded(page);
  await page.goto("/#questions");
  await page.getByRole("button", { name: "Add your own material", exact: true }).click();
  await page.getByLabel("Choose question files or a ZIP to import").setInputFiles(filepath);
  const preview = page.getByRole("region", { name: "Source question bank preview" });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(preview).toContainText("15 questions");
  await expect(preview.getByLabel("Bank module")).toHaveValue("GOER");
  await mkdir(out!, { recursive: true });
  await page.screenshot({ path: join(out!, `private-goer-biostats-${width}.png`), fullPage: true });
  await preview.getByText("Question 1 of 15").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out!, `private-goer-question-${width}.png`), fullPage: false });
  // A screenshot and parser preview are NOT a reviewed answer or cloud import.
});
