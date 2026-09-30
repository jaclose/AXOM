import type { Page } from "@playwright/test";
import { deferPromisePrompt, expect, test } from "./fixtures";

test("account foundation preserves local-only use and manual recovery at every launch viewport", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  await onboard(page);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 900 },
    { width: 430, height: 880 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "networkidle" });
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    if (await menu.isVisible()) await menu.click();
    await page.getByTitle("Account and protection").click();

    await expect(page.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute("aria-selected", "true");
    // Builds without cloud credentials say so; a dev server with .env.local shows sign-in instead.
    const localOnly = await page.getByText(/Accounts aren’t available in this version/).isVisible();
    if (!localOnly) await expect(page.getByRole("tab", { name: "Sign in", exact: true })).toBeVisible();
    // Plain language first (I1-22); the technical note sits behind a disclosure.
    await expect(page.getByText(/export, restore, or merge a portable copy/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await page.getByRole("tab", { name: "Emergency recovery" }).click();
    await expect(page.getByRole("button", { name: /Export backup/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Import \/ restore/ })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  }

  expect(errors).toEqual([]);
});

async function onboard(page: Page) {
  const name = page.getByLabel("Display name (optional)");
  if (!(await name.isVisible().catch(() => false))) return;

  await name.fill("Account Safety Test");
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  // Defer the Promise and wait until the deferral is saved, or the reload below brings it back.
  await deferPromisePrompt(page);
}
