import { test, expect, seedOnboarded, reloadAfterSave } from "./fixtures";

for (const width of [1440, 390]) test(`the product bookshelf loads activities and starts persistent practice at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Load course template", exact: true }).click();
  await page.getByRole("region", { name: "Course library", exact: true }).getByRole("button", { name: /^FTM 1,/ }).click();
  const book = page.getByRole("dialog", { name: /FTM 1/ });
  await expect(book.getByText("Weeks", { exact: true }).first()).toBeVisible();
  await book.getByRole("button", { name: "Choose a template file" }).click();
  const loader = page.getByRole("dialog", { name: "Load a course template" });
  const files = process.env.AXOM_TEMPLATE_FILES?.split("|") ?? [{ name: "FTM1.txt", mimeType: "text/plain",
    buffer: Buffer.from("FTM 1 - Activities:\nWeek 2:\nSample lecture [Lecture]\nSample small group [Small Group]\nSample IMCQ [IMCQ]\n") }];
  await loader.getByLabel("Choose course template files").setInputFiles(files);
  await expect(loader.getByRole("region", { name: "Template for FTM 1" })).toContainText("new");
  await loader.getByRole("button", { name: /^Add \d+ items/ }).click();
  await expect(loader).toHaveCount(0);
  await reloadAfterSave(page);
  await expect(page.getByRole("region", { name: "FTM 1 by week" })).toBeVisible();

  // Use canonical import actions: no parallel bank or attempt store.
  await page.goto("/#questions");
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByLabel("Import source type", { exact: true }).getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Structured question text").fill("Question 1: Which sample label is Beta?\nA. Alpha\nB. Beta\nC. Gamma\nAnswer: B\nExplanation: Beta is the requested label.");
  await page.getByRole("button", { name: "Parse and review", exact: true }).click();
  await page.getByLabel("Module", { exact: true }).selectOption({ label: "FTM 1" });
  await page.getByLabel("Week", { exact: true }).fill("2");
  await page.getByLabel("Set title").fill("Week 2 IMCQ sample");
  const review = page.getByLabel("I reviewed this question", { exact: true });
  if (await review.isVisible()) await review.check();
  await page.getByRole("button", { name: "Finalize import" }).click();
  await page.getByRole("tab", { name: /Question Sets/ }).click();
  await page.getByRole("button", { name: "Bookshelf", exact: true }).click();
  const shelf = page.getByRole("region", { name: "Question bank library", exact: true });
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    await shelf.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/axom-product-bookshelf-${width}-${theme}.png` });
  }
  await shelf.getByRole("button", { name: /^FTM 1,/ }).focus();
  await page.keyboard.press("Enter");
  const bank = page.getByRole("dialog", { name: /FTM 1/ });
  await expect(bank.getByRole("button", { name: "Week 2 · 1", exact: true })).toBeVisible();
  await bank.getByRole("button", { name: "Start practice", exact: true }).click();
  await page.getByRole("button", { name: "Start tutor block", exact: true }).click();
  await page.getByLabel("Question stem").focus();
  await page.keyboard.press("B");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Finish block", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await reloadAfterSave(page);
  await page.getByRole("button", { name: "Bookshelf", exact: true }).click();
  await shelf.getByRole("button", { name: /^FTM 1,/ }).click();
  await expect(bank.locator(".book-fact").filter({ hasText: "Answered" })).toContainText("1");
  await page.keyboard.press("Escape");
  await expect(shelf.getByRole("button", { name: /^FTM 1,/ })).toBeFocused();
  await shelf.getByRole("button", { name: /^GOER,/ }).click();
  const pending = page.getByRole("dialog", { name: /GOER/ });
  await expect(pending.getByRole("button", { name: "Start practice", exact: true })).toBeDisabled();
  await expect(pending.getByText("Source file missing", { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
