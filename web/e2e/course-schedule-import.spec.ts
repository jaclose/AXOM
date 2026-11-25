import type { Page } from "@playwright/test";
import { completeSetup, expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

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
  await expect(page.locator(".dr-label").getByText("Renal Clearance Lecture", { exact: true })).toBeVisible();

  const defer = page.getByRole("button", { name: /^Defer / }).first();
  // I3-27: one tap, no "when should this return?" question; the notice explains and offers Undo.
  await defer.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast:not(.is-leaving)").filter({ hasText: "Back tomorrow" })).toContainText("stays in your Tracker");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".dr-label").getByText("Renal Clearance Lecture", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("reviewed schedule activities enable explicit attendance without inventing absences", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Import schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Import course schedule" });
  await dialog.getByLabel("Tracker destination").fill("Term 1/BPM 500/FTM 1/Week 3");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "review-calendar.ics", mimeType: "text/calendar",
    buffer: Buffer.from("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260901T080000\r\nSUMMARY:Synthetic group discussion\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20260902T080000\r\nSUMMARY:Personal reading\r\nEND:VEVENT\r\nEND:VCALENDAR"),
  });
  await expect(dialog.getByText("2 ready", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Course activity").first()).toHaveValue("");
  await dialog.getByLabel("Course activity").first().selectOption("small-group");
  await expect(dialog.getByLabel("Type").first()).toHaveValue("Requirement");
  await dialog.getByRole("button", { name: "Import selected (2)" }).click();
  const weeks = page.locator(".week-overview");
  const module = weeks.getByRole("region", { name: "FTM 1 by week" });
  await module.getByRole("button", { name: /Week 3/ }).click();
  const missed = module.getByRole("button", { name: "Missed Synthetic group discussion" });
  await expect(missed).toHaveAttribute("aria-pressed", "false");
  await expect(module.getByRole("button", { name: "Missed Personal reading" })).toHaveCount(0);
  await missed.click();
  await weeks.getByText("Term 1 absences").click();
  await weeks.getByLabel("Small group absences allowed").fill("3");
  await expect(weeks.locator(".week-absences summary")).toContainText("Small group: 1 missed of 3 allowed");
  await reloadAfterSave(page);
  await expect(page.locator(".week-absences summary")).toContainText("Small group: 1 missed of 3 allowed");
});

test("conflicting schedule categories require deliberate distinct-event confirmation", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Import schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Import course schedule" });
  await dialog.getByLabel("Tracker destination").fill("Term 1/BPM 500/FTM 1/Week 3");
  await dialog.getByLabel("Or paste schedule rows").fill("2026-09-01,Synthetic category collision,IMCQ\n2026-09-01,Synthetic category collision,ESoft");
  await dialog.getByRole("button", { name: "Review schedule" }).click();
  await expect(dialog.getByText("Conflicting course activity — review required", { exact: false })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Select importable" }).click();
  await expect(dialog.getByRole("button", { name: "Import selected (0)" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Confirm distinct activity" }).first().click();
  await expect(dialog.getByRole("button", { name: "Import selected (1)" })).toBeEnabled();
  await expect(dialog.getByRole("list", { name: "Conflicting records" }).first()).toContainText("ESoft quiz");
  const secondTitle = dialog.locator(".schedule-review-row").nth(1).getByLabel("Title");
  await secondTitle.fill("Different synthetic event");
  await expect(dialog.getByRole("button", { name: "Import selected (0)" })).toBeDisabled();
  await secondTitle.fill("Synthetic category collision");
  await expect(dialog.getByRole("button", { name: "Confirm distinct activity" })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Confirm distinct activity" }).first().click();
  await dialog.getByRole("button", { name: "Confirm distinct activity" }).click();
  await expect(dialog.getByRole("button", { name: "Import selected (2)" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Import selected (2)" }).click();
  await reloadAfterSave(page);
  const module = page.locator(".week-overview").getByRole("region", { name: "FTM 1 by week" });
  await module.getByRole("button", { name: /Week 3/ }).click();
  await expect(module.getByRole("button", { name: "Missed Synthetic category collision" })).toHaveCount(2);
});

test("malformed structured schedule rows stay held until source correction", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Import schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Import course schedule" });
  await dialog.getByLabel("Tracker destination").fill("Term 1/BPM 500/FTM 1/Week 3");
  const paste = dialog.getByLabel("Or paste schedule rows");
  await paste.fill("2026-11-25\t\tIMCQ\n2026-02-29,Impossible day,IMCQ\n2026-11-25,Valid synthetic session,IMCQ");
  await dialog.getByRole("button", { name: "Review schedule" }).click();
  await expect(dialog.getByText("2 invalid", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Source row 1:", { exact: false })).toBeVisible();
  await dialog.getByLabel("Title").first().fill("Attempted correction");
  await dialog.getByRole("button", { name: "Select importable" }).click();
  await expect(dialog.getByRole("button", { name: "Import selected (1)" })).toBeEnabled();
  await paste.fill("2026-11-25,Corrected synthetic session,IMCQ\n2026-11-25,Valid synthetic session,IMCQ");
  await dialog.getByRole("button", { name: "Replace review with pasted rows" }).click();
  await expect(dialog.getByText("2 ready", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import selected (2)" }).click();
  await reloadAfterSave(page);
  const module = page.locator(".week-overview").getByRole("region", { name: "FTM 1 by week" });
  await module.getByRole("button", { name: /Week 3/ }).click();
  await expect(module.getByRole("button", { name: "Missed Corrected synthetic session" })).toHaveCount(1);
  await expect(module.getByRole("button", { name: "Missed Valid synthetic session" })).toHaveCount(1);
  await expect(module.getByRole("button", { name: "Missed Impossible day" })).toHaveCount(0);
});

async function completeOnboarding(page: Page) {
  if (!(await completeSetup(page, "Schedule Intake Test", { ifVisible: true }))) return;
  const later = page.getByRole("button", { name: "Review later" });
  if (await later.count()) await later.click();
}
