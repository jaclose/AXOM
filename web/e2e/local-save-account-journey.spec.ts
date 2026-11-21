import type { Page } from "@playwright/test";
import { expect, seedOnboarded, test, waitForWorkspace } from "./fixtures";

/**
 * Real AXOM account-settings panel, synthetic local-only learner context.
 * No sign-in, production account, private source, or protected cloud revision.
 */
const localSave = (page: Page) => page.getByRole("status", { name: "Local save status" })
  .or(page.getByRole("alert", { name: "Local save status" }));

async function openAccount(page: Page) {
  await page.getByTitle("Account and protection").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function markSimulatedFailure(page: Page) {
  await page.evaluate(async () => {
    const { markVaultWriteFailure } = await import("/src/lib/vaultActivity.ts");
    markVaultWriteFailure(new Date("2026-11-07T12:00:00.000Z"));
  });
}

test("real Account UI retries the current workspace, confirms read-back, and preserves changes on reload", async ({ page }) => {
  await seedOnboarded(page, { tagline: "synthetic verified account retry" });
  await openAccount(page);
  await markSimulatedFailure(page);
  const retry = page.getByRole("button", { name: "Retry local save" });
  await expect(retry).toBeVisible();
  await expect(localSave(page)).toContainText("Save needs attention");
  await retry.click();
  await expect(localSave(page)).toContainText("Last confirmed save");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  await waitForWorkspace(page);
  expect(await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { profile: { tagline: string } } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().profile.tagline;
  })).toBe("synthetic verified account retry");
});

test("real Account UI refuses false success under dual storage failure and recovers after retry", async ({ page }) => {
  await seedOnboarded(page, { tagline: "synthetic protected prior state" });
  await openAccount(page);
  await markSimulatedFailure(page);
  await expect(page.getByRole("button", { name: "Retry local save" })).toBeVisible();

  await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import("/src/lib/brand.ts");
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    const originalSet = Storage.prototype.setItem;
    (window as Window & { __restoreSyntheticQuota?: () => void }).__restoreSyntheticQuota = () => {
      Storage.prototype.setItem = originalSet;
      if (previousDescriptor) Object.defineProperty(window, "indexedDB", previousDescriptor);
      else Reflect.deleteProperty(window, "indexedDB");
    };
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    Storage.prototype.setItem = function(name: string, data: string) {
      if (name === STORAGE_KEYS.persistedState) throw new DOMException("Synthetic full storage", "QuotaExceededError");
      return originalSet.call(this, name, data);
    };
  });
  try {
    await page.getByRole("button", { name: "Retry local save" }).click();
    await expect(page.getByText("Local save still needs attention")).toBeVisible();
    await expect(localSave(page)).toContainText("Save needs attention");
  } finally {
    await page.evaluate(() => {
      (window as Window & { __restoreSyntheticQuota?: () => void }).__restoreSyntheticQuota?.();
    });
  }
  await page.getByRole("button", { name: "Retry local save" }).click();
  await expect(localSave(page)).toContainText("Last confirmed save");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  await waitForWorkspace(page);
  expect(await page.evaluate(async () => {
    type Dev = { useStore: { getState: () => { profile: { tagline: string } } } };
    const dev = await (window as unknown as { __AXOM_DEV__: Promise<Dev> }).__AXOM_DEV__;
    return dev.useStore.getState().profile.tagline;
  })).toBe("synthetic protected prior state");
});
