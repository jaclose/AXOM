import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Invented data only. The real school templates remain private and are covered
// separately via AXOM_TEMPLATE_ROOT. This verifies the UI's identity resolution.
const original = "FTM 1 - Lectures:\nWeek 1:\nCell anatomy sample [Lecture]";
const renamed = "FTM 1 - Lectures:\nWeek 1:\nUpdated cell anatomy sample [Lecture]";
const repeated = "FTM 1 - Lectures:\nWeek 1:\nLecture 01 Same sample [Lecture]\nLecture 01 Same sample [Lecture]";
const input = (content: string) => ({ name: "Sample-course.txt", mimeType: "text/plain", buffer: Buffer.from(content) });

async function openLoader(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Course Library / Load Course" }).click();
  await page.getByText("Manage sources and custom courses", { exact: true }).click();
  await page.getByRole("button", { name: "Saved templates and imports", exact: true }).click();
  const loader = page.getByRole("region", { name: "Load a course template", exact: true });
  await expect(loader).toBeVisible();
  return loader;
}

test("renamed source activities require explicit matching and retain original study progress", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await seedOnboarded(page);
  await page.goto("/#tracker");
  let dialog = await openLoader(page);
  await dialog.getByLabel("Choose course template files").setInputFiles(input(original));
  await dialog.getByRole("button", { name: "Add 1 item" }).click();
  await reloadAfterSave(page);

  const before = await page.evaluate(async () => {
    type Row = { id: string; label: string; passes: number; templateKey?: string };
    type Dev = { useStore: { getState: () => { tracker: Row[]; updateTrackerItem: (id: string, patch: { passes: number }) => void } }; flushVault: () => Promise<void> };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const state = dev.useStore.getState();
    const source = state.tracker.find((row) => row.templateKey)!;
    state.updateTrackerItem(source.id, { passes: 3 });
    await dev.flushVault();
    return { id: source.id, oldKey: source.templateKey };
  });
  dialog = await openLoader(page);
  await dialog.getByLabel("Choose course template files").setInputFiles(input(renamed));
  const preview = dialog.getByRole("region", { name: "Template for FTM 1" });
  const conflicts = preview.getByLabel("Identity conflicts for FTM 1");
  await expect(conflicts).toContainText("ambiguous template activities need identity review");
  await expect(dialog.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
  await preview.getByLabel("Resolve activity 1 for FTM 1").selectOption(`existing:${before.id}`);
  await expect(dialog.getByRole("button", { name: "Add 0 items and update 1" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add 0 items and update 1" }).click();
  await reloadAfterSave(page);
  const after = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { tracker: { id: string; label: string; passes: number; templateKey?: string }[] } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter((row) => row.templateKey);
  });
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: before.id, passes: 3, label: "Updated cell anatomy sample" });
  expect(after[0].templateKey).not.toEqual(before.oldKey);
  expect(pageErrors).toEqual([]);
});

test("repeated template identity is held for review and cannot silently create two rows", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  const dialog = await openLoader(page);
  await dialog.getByLabel("Choose course template files").setInputFiles(input(repeated));
  const preview = dialog.getByRole("region", { name: "Template for FTM 1" });
  await expect(preview.getByLabel("Identity conflicts for FTM 1")).toContainText("Repeated identities cannot safely be matched");
  await expect(dialog.getByRole("button", { name: "Nothing to add" })).toBeDisabled();
  expect(await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { tracker: { templateKey?: string }[] } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter(row => row.templateKey).length;
  })).toBe(0);
});

test("official NB Block 2 template resolves the pre-existing NB2 course without creating another module", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/#tracker");
  const dialog = await openLoader(page);
  await dialog.getByLabel("Choose course template files").setInputFiles(input(
    "NB Block 2 - Lectures:\nWeek 1:\nNB Lecture 01 Sample cortex [Lecture]"
  ));
  const preview = dialog.getByRole("region", { name: "Template for NB Block 2" });
  await expect(preview.getByLabel("Term for NB Block 2")).toHaveValue("term-2");
  await expect(preview).toContainText("1 of 1 activities selected");
  await dialog.getByRole("button", { name: "Add 1 item" }).click();
  await reloadAfterSave(page);
  const saved = await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { tracker: { path: string; templateKey?: string }[] } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().tracker.filter((row) => row.templateKey);
  });
  expect(saved).toHaveLength(1);
  expect(saved[0].path).toMatch(/^Term 2\/BPM 501\/NB2\/Week 1$/);
});
