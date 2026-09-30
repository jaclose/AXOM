import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { STORAGE_KEYS } from "../src/lib/brand";

test("persistent Daily Games, Daily Word history, and shared clock preferences persist locally", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  await completeOnboarding(page);
  await page.evaluate(() => { window.location.hash = "daily-word"; });

  await expect(page.getByRole("heading", { level: 1, name: "AXOM Daily Word" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daily Games", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daily Word", exact: true })).toBeVisible();

  // FOXES is a known allowed guess but not an answer in general-2, so this
  // always leaves a durable, unfinished puzzle without coupling to today's key.
  await page.keyboard.type("FOXES");
  await page.keyboard.press("Enter");
  await expect(page.locator(".daily-word-status")).toContainText(/correct position|positions/);
  await expect.poll(async () => (await readPersistedWorkspace(page)).dailyWordPuzzles?.[0]?.guesses?.[0]).toBe("FOXES");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("gridcell", { name: /Row 1, column 1, letter F/ })).toBeVisible();

  // The TopBar action opens the exact Personalization surface rather than a
  // nested settings dialog.
  await page.getByRole("button", { name: /Open clock/ }).click();
  await page.getByRole("button", { name: "Clock preferences" }).click();
  const settings = page.getByRole("dialog", { name: "Your AXOM Setup" });
  await expect(settings.getByRole("heading", { name: "Daily rhythm reminders" })).toBeVisible();

  await settings.getByRole("combobox", { name: "Hour cycle" }).selectOption("24");
  await settings.getByRole("checkbox", { name: "Digital seconds" }).check();
  await settings.getByRole("checkbox", { name: "Timezone label" }).check();
  await settings.getByRole("radio", { name: "Custom IANA timezone" }).check();
  await settings.getByLabel("Custom timezone").fill("America/Grenada");
  await settings.getByRole("button", { name: "Apply timezone" }).click();

  await settings.getByRole("button", { name: "Done" }).click();
  expect((await readPersistedWorkspace(page)).dailyWordPuzzles[0].guesses).toEqual(["FOXES"]);
  await expect(page.getByRole("gridcell", { name: /Row 1, column 1, letter F/ })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  const persisted = await readPersistedWorkspace(page);
  expect(persisted.schemaVersion).toBe(34);
  expect(persisted.profile.timeZonePreference).toEqual({ mode: "custom", customTimezone: "America/Grenada" });
  expect(persisted.profile.clockPreferences).toMatchObject({
    enabled: true,
    hourCycle: "24",
    showDigitalSeconds: true,
    showTimezoneLabel: true,
  });
  expect(persisted.dailyWordPuzzles[0]).toMatchObject({ guesses: ["FOXES"], timezone: expect.any(String) });
  await expect(page.getByRole("button", { name: /Open clock, .*America\/Grenada/ })).toBeVisible();

  await page.evaluate((themeKey) => localStorage.setItem(themeKey, "light"), STORAGE_KEYS.themePreference);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { level: 1, name: "AXOM Daily Word" })).toBeVisible();
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    surfaceFits: (() => {
      const surface = document.querySelector<HTMLElement>(".surface-scroll");
      return Boolean(surface && surface.scrollWidth <= surface.clientWidth + 1);
    })(),
    topbarFits: (() => {
      const topbar = document.querySelector<HTMLElement>(".topbar");
      return Boolean(topbar && topbar.scrollWidth <= topbar.clientWidth + 1);
    })(),
  }));
  expect(mobileLayout).toEqual({ viewport: 390, documentWidth: 390, surfaceFits: true, topbarFits: true });

  const localStorageEvidence = await page.evaluate((stateKey) => ({
    workspace: localStorage.getItem(stateKey),
    scopedWorkspace: Object.keys(localStorage).some((key) => key.startsWith(`${stateKey}:user:`)),
  }), STORAGE_KEYS.persistedState);
  expect(localStorageEvidence).toEqual({ workspace: null, scopedWorkspace: false });
  expect(browserErrors).toEqual([]);
});

async function completeOnboarding(page: Page): Promise<void> {
  await page.getByLabel("Display name (optional)").fill("AXOM Daily Games E2E");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
}

async function readPersistedWorkspace(page: Page) {
  return page.evaluate(async ({ dbName, stateKey }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const raw = await new Promise<string>((resolve, reject) => {
      const request = db.transaction("state", "readonly").objectStore("state").get(stateKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.parse(raw).state;
  }, { dbName: STORAGE_KEYS.vaultDb, stateKey: STORAGE_KEYS.persistedState });
}
