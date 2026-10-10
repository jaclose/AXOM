import { readFile } from "node:fs/promises";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

const ORIGINAL = "FTM 1 - Lectures:\nWeek 1:\nLecture 01 Sample cells [Lecture]\nDLA 01 Sample reading [DLA]\nWeek 2:\nLecture 02 Sample tissue [Lecture]";
const UPDATED = ORIGINAL.replace("Sample tissue", "Updated sample tissue");
const file = (text: string) => ({ name: "Sample-course.txt", mimeType: "text/plain", buffer: Buffer.from(text) });

for (const width of [1440, 390]) {
  test(`saved template versions support selective loading, export and progress at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await seedOnboarded(page);
    await page.goto("/#tracker");
    const dialog = page.getByRole("dialog", { name: "Load a course template" });
    const preview = dialog.getByRole("region", { name: "Template for FTM 1" });
    const open = async () => {
      await page.getByRole("button", { name: "Load course template" }).click();
      await page.getByRole("button", { name: /Saved templates \(/ }).click();
      await expect(dialog).toBeVisible();
    };
    await open();
    await dialog.getByLabel("Choose course template files").setInputFiles(file(ORIGINAL));
    await expect(preview).toContainText("3 of 3 activities selected");
    // Importing into the library is durable even when no tracker items are loaded.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await reloadAfterSave(page);
    await open();
    await dialog.getByRole("button", { name: "Use saved FTM 1 · Lectures" }).click();
    await preview.getByRole("checkbox", { name: "Week 2 (1)" }).uncheck();
    await preview.getByRole("checkbox", { name: "1 DLA" }).focus();
    await page.keyboard.press("Space");
    await expect(preview).toContainText("1 of 3 activities selected");
    await expect(dialog.getByRole("button", { name: "Add 1 item", exact: true })).toBeInViewport();
    expect(await dialog.locator(".modal-body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/axom-template-selection-${width}.png` });
    await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
    await reloadAfterSave(page);
    await page.evaluate(async () => {
      type Dev = { useStore: { getState: () => { tracker: { id: string; templateKey?: string }[]; updateTrackerItem: (id: string, patch: { passes: number }) => void } }; flushVault: () => Promise<void> };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      const row = state.tracker.find((item) => item.templateKey)!;
      state.updateTrackerItem(row.id, { passes: 2 });
      await dev.flushVault();
    });
    await open();
    await dialog.getByLabel("Choose course template files").setInputFiles(file(ORIGINAL));
    await dialog.getByLabel("Choose course template files").setInputFiles(file(UPDATED));
    await expect(preview).toContainText("3 of 3 activities selected");
    await dialog.getByText("Browse saved templates", { exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Saved course templates" })).toContainText("2 saved versions");
    await dialog.getByLabel("Find a saved template").fill("not present");
    await expect(dialog.getByText("No templates match. Try another module or filename.")).toBeVisible();
    await dialog.getByLabel("Find a saved template").fill("FTM");
    const version = dialog.getByLabel("Version of FTM 1 · Lectures");
    await version.selectOption({ label: "Version 1 · Sample-course.txt" });
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export FTM 1 · Lectures" }).click();
    const exported = await download;
    expect(await readFile((await exported.path())!, "utf8")).toBe(ORIGINAL);
    // Loading the exported file deduplicates; the newer stored version remains available.
    await dialog.getByLabel("Choose course template files").setInputFiles((await exported.path())!);
    await expect(preview).toContainText("2 new, 1 already in your tracker");
    await dialog.getByText("Browse saved templates", { exact: true }).click();
    await version.selectOption({ label: "Version 2 · Latest import · Sample-course.txt" });
    await page.screenshot({ path: `/tmp/axom-template-library-${width}.png` });
    await page.evaluate(async () => {
      const theme = await import("/src/lib/theme.ts");
      theme.setThemePreference("dark");
    });
    // Shared controls cross-fade for 130 ms when the theme changes.
    await page.waitForTimeout(200);
    await page.screenshot({ path: `/tmp/axom-template-library-dark-${width}.png` });
    await dialog.getByRole("button", { name: "Use saved FTM 1 · Lectures" }).click();
    await dialog.getByRole("button", { name: "Add 2 items", exact: true }).click();
    await reloadAfterSave(page);
    const saved = await page.evaluate(async () => {
      type Dev = { useStore: { getState: () => { documents: { fileType: string }[]; tracker: { templateKey?: string; label: string; passes: number }[] } } };
      const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
      const state = dev.useStore.getState();
      return { versions: state.documents.filter((doc) => doc.fileType === "axom-course-template").length, rows: state.tracker.filter((row) => row.templateKey) };
    });
    expect(saved.versions).toBe(2);
    expect(saved.rows).toHaveLength(3);
    expect(saved.rows.find((row) => row.label.includes("Sample cells"))?.passes).toBe(2);
    expect(saved.rows.some((row) => row.label.includes("Updated sample tissue"))).toBe(true);
    expect(errors).toEqual([]);
  });
}
