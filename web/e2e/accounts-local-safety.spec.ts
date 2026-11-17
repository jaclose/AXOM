import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { completeSetup, deferPromisePrompt, expect, test } from "./fixtures";

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

    if (viewport.width <= 560) await expect(page.getByRole("combobox", { name: "Settings section" })).toHaveValue("account");
    else await expect(page.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute("aria-selected", "true");
    // Builds without cloud credentials say so; a dev server with .env.local shows sign-in instead.
    const localOnly = await page.getByText(/Accounts aren’t available in this version/).isVisible();
    if (!localOnly) await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    // Plain language first (I1-22); the technical note sits behind a disclosure.
    await expect(page.getByText(/export, restore, or merge a portable copy/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    if (viewport.width <= 560) await page.getByRole("combobox", { name: "Settings section" }).selectOption("backup");
    else await page.getByRole("tab", { name: "Emergency recovery" }).click();
    await expect(page.getByRole("button", { name: "Export complete backup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose backup to restore" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  }

  expect(errors).toEqual([]);
});

async function onboard(page: Page) {
  if (!(await completeSetup(page, "Account Safety Test", { ifVisible: true }))) return;
  // Defer the Promise and wait until the deferral is saved, or the reload below brings it back.
  await deferPromisePrompt(page);
}

/** The dashboard must never silently export metadata-only JSON under the word
 * "backup"; it delegates to the consentful, omission-reporting Settings path. */
test("dashboard backup options open the verified recovery flow on desktop and mobile", async ({ page }) => {
  test.setTimeout(120_000);
  const origin = new URL(process.env.AXOM_E2E_BASE_URL ?? "http://127.0.0.1:5187").origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    throw new Error("This backup entry test must run against an isolated loopback AXOM.");
  }
  const failedDownloads: string[] = [];
  page.on("download", (download) => failedDownloads.push(download.suggestedFilename()));
  await page.goto("/?app=1#dashboard", { waitUntil: "networkidle" });
  await onboard(page);
  await page.evaluate(async () => {
    type Dev = {
      useStore: {
        getState: () => {
          profile: { dashboardWidgetOrder?: string[]; hiddenDashboardWidgets?: string[]; dashboardLayout?: { order: string[]; hiddenWidgetIds: string[] } };
          updateProfile: (value: Record<string, unknown>) => void;
        };
      };
      flushVault: () => Promise<void>;
    };
    const { useStore, flushVault } =
      await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    const state = useStore.getState();
    state.updateProfile({
      dashboardWidgetOrder: [...new Set([...(state.profile.dashboardWidgetOrder ?? []), "localData"])],
      hiddenDashboardWidgets: (state.profile.hiddenDashboardWidgets ?? []).filter(id => id !== "localData"),
      ...(state.profile.dashboardLayout ? {
        dashboardLayout: {
          ...state.profile.dashboardLayout,
          preset: "custom",
          order: [...new Set([...(state.profile.dashboardLayout.order ?? []), "localData"])],
          hiddenWidgetIds: (state.profile.dashboardLayout.hiddenWidgetIds ?? []).filter(id => id !== "localData"),
          updatedAt: new Date().toISOString(),
        },
      } : {}),
    });
    await flushVault();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const trigger = page.getByRole("button", { name: "Backup options", exact: true });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const modal = page.getByRole("dialog", { name: "Settings" });
    await expect(modal).toBeVisible();
    if (viewport.width <= 560) {
      await expect(modal.getByRole("combobox", { name: "Settings section" })).toHaveValue("backup");
    } else {
      await expect(modal.getByRole("tab", { name: "Emergency recovery" })).toHaveAttribute("aria-selected", "true");
    }
    expect(failedDownloads).toHaveLength(0); // merely opening options never downloads lossy metadata
    const downloaded = page.waitForEvent("download");
    await modal.getByRole("button", { name: "Export complete backup" }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/^axom-backup-\d{4}-\d{2}-\d{2}\.(json|zip)$/);
    const path = await file.path();
    if (!path) throw new Error("Chromium did not save the synthetic backup.");
    const bytes = await readFile(path);
    expect(bytes.byteLength).toBeGreaterThan(0);
    await modal.getByRole("button", { name: "Done" }).click();
    failedDownloads.length = 0;
  }
});
