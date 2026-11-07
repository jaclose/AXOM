import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";

async function navigate(page: Page, route: string) {
  await page.evaluate((value) => { window.location.hash = value; }, route);
}

async function onboard(page: Page) {
  if (!await completeSetup(page, "AXOM Workspace Review", { ifVisible: true })) return;
  const later = page.getByRole("button", { name: "Review later" });
  if (await later.count()) await later.click();
}

test("consolidated workspaces retain legacy routes and fit narrow displays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await onboard(page);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);

    await navigate(page, "productivity");
    await expect(page.getByRole("heading", { name: "Give the day a direction." })).toBeVisible();
    await page.getByRole("button", { name: /Tasks.*Decide what is next/ }).click();
    await expect(page.getByText("Add a task")).toBeVisible();

    await navigate(page, "tasks");
    await expect(page.getByText("Add a task")).toBeVisible();

    await navigate(page, "studio");
    await expect(page.getByRole("heading", { name: "From method to execution." })).toBeVisible();
    await page.getByRole("button", { name: /Prompts.*Reuse your instructions/ }).click();
    await expect(page.getByText("Reusable AI prompts for study workflows")).toBeVisible();

    await navigate(page, "prompts");
    await expect(page.getByText("Reusable AI prompts for study workflows")).toBeVisible();

    await navigate(page, "library");
    await expect(page.getByRole("heading", { name: "Everything, within reach." })).toBeVisible();
    await page.getByRole("button", { name: /Folders.*Project and drive shortcuts/ }).click();
    await expect(page.getByText("Hub Folders", { exact: true })).toBeVisible();

    await navigate(page, "folders");
    await expect(page.getByText("Hub Folders", { exact: true })).toBeVisible();

    await navigate(page, "patch-notes");
    await expect(page.getByRole("heading", { name: "What changed." })).toBeVisible();

    await navigate(page, "building");
    await expect(page.getByRole("heading", { name: "Building AXOM" })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});
