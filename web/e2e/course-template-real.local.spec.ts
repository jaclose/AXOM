import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

// Opt-in private-source acceptance. Paths and file contents never enter Git.
const roots: string[] = JSON.parse(process.env.AXOM_TEMPLATE_ROOTS ?? "[]");
test.skip(!roots.length, "Set AXOM_TEMPLATE_ROOTS to a JSON array of local template directories.");
test("every supplied text template persists with its stated module and term", async ({ page }) => {
  test.setTimeout(120_000);
  const files = (await Promise.all(roots.map(async (root) => (await readdir(root)).filter((name) => name.endsWith(".txt")).map((name) => join(root, name))))).flat();
  expect(files.length).toBeGreaterThan(0);
  await seedOnboarded(page);
  await page.goto("/#tracker");
  await page.getByRole("button", { name: "Load course template" }).click();
  await page.getByRole("button", { name: /Saved templates \(/ }).click();
  const dialog = page.getByRole("dialog", { name: "Load a course template" });
  await dialog.getByLabel("Choose course template files").setInputFiles(files);
  await expect(dialog.getByLabel("Choose course template files")).toBeEnabled();
  await expect(dialog.getByRole("region", { name: /^Template for / }).first()).toBeVisible();
  expect(await dialog.getByRole("alert").count()).toBe(0);
  const expected = await page.evaluate(async () => {
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<{ useStore: { getState: () => { documents: unknown[] } } }> }).__AXOM_DEV__;
    const library = await import("/src/lib/course-engine/templateLibrary.ts");
    const saved = library.savedCourseTemplates(dev.useStore.getState().documents);
    return { count: saved.length, modules: new Set(saved.map((item) => item.section.module)).size,
      activities: saved.reduce((total, item) => total + item.section.items.length, 0),
      badTermModules: saved.filter((item) => /^(T|Term)\s*\d+$/i.test(item.section.module)).length };
  });
  expect(expected.count).toBe(files.length);
  expect(expected.badTermModules).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await reloadAfterSave(page);
  await page.getByRole("button", { name: "Load course template" }).click();
  await page.getByRole("button", { name: `Saved templates (${files.length})` }).click();
  await expect(dialog.getByRole("button", { name: /^Use saved / })).toHaveCount(files.length);
  console.log(JSON.stringify({ privateTemplateAcceptance: expected }));
});
