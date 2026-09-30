import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test("review-first schedule intake accepts files, corrections, deferral, and mobile reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#tracker", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "tracker"; });

  await page.getByRole("button", { name: "Import schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Import course schedule" });
  await dialog.getByLabel("Tracker destination").fill("Term 1/BPM 500");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "BPM-calendar.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260901T080000\r\nSUMMARY:Renal Physiology Lecture\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20260908T080000\r\nSUMMARY:IMCQ 1\r\nDESCRIPTION:Quiz assessment\r\nEND:VEVENT\r\nEND:VCALENDAR"),
  });
  await expect(dialog.getByText("2 ready", { exact: true })).toBeVisible();
  await dialog.getByLabel("Title").first().fill("Renal Clearance Lecture");
  await dialog.getByLabel("Type").first().selectOption("Lecture");
  await dialog.getByRole("button", { name: "Import selected (2)" }).click();
  await expect(page.getByText("Renal Clearance Lecture")).toBeVisible();

  const defer = page.getByRole("button", { name: /^Defer / }).first();
  // I3-27: one tap, no "when should this return?" question; the notice explains and offers Undo.
  await defer.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast:not(.is-leaving)").filter({ hasText: "Back tomorrow" })).toContainText("stays in your Tracker");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Renal Clearance Lecture")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

async function completeOnboarding(page: Page) {
  const name = page.getByLabel("Display name (optional)");
  if (!(await name.isVisible().catch(() => false))) return;
  await name.fill("Schedule Intake Test");
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  const later = page.getByRole("button", { name: "Review later" });
  if (await later.count()) await later.click();
}
