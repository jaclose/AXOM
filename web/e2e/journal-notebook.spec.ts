import { expect, reloadAfterSave, seedOnboarded, test } from "./fixtures";

for (const width of [1440, 768, 390]) test(`Journal saves and reloads a page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((theme) => localStorage.setItem("axom.theme", theme), width === 390 ? "light" : "dark");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await seedOnboarded(page);
  await page.goto("/#journal");
  await page.getByRole("button", { name: "Open today’s page", exact: true }).click();

  const notebook = page.getByRole("region", { name: "Journal notebook" });
  await expect(notebook).toBeVisible();
  await expect(notebook).toHaveAttribute("data-motion", "reduced");
  const entry = `A durable synthetic journal page at ${width}px.`;
  await page.getByLabel("Free writing").fill(entry);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to this workspace", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByText("Recent pages", { exact: true })).toBeVisible();
  await expect(page.getByText(entry, { exact: true })).toBeVisible();
  await reloadAfterSave(page);
  await page.getByText(entry, { exact: true }).click();
  await expect(page.getByLabel("Free writing")).toHaveValue(entry);

  await page.screenshot({ path: `/tmp/axom-journal-notebook-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
