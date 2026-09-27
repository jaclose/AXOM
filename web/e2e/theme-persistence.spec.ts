import { expect, test } from "@playwright/test";
import { STORAGE_KEYS } from "../src/lib/brand";

test("pre-paint theme resolution persists light/dark/system without touching workspace storage", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEYS.themePreference);
  await page.reload({ waitUntil: "domcontentloaded" });

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0d0d0e");

  await page.evaluate((key) => localStorage.setItem(key, "light"), STORAGE_KEYS.themePreference);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f3eee3");

  const storage = await page.evaluate(({ themeKey, workspaceKey }) => ({
    theme: localStorage.getItem(themeKey),
    workspace: localStorage.getItem(workspaceKey),
    scopedWorkspace: Object.keys(localStorage).some((key) => key.startsWith(`${workspaceKey}:user:`)),
  }), { themeKey: STORAGE_KEYS.themePreference, workspaceKey: STORAGE_KEYS.persistedState });
  expect(storage).toEqual({ theme: "light", workspace: null, scopedWorkspace: false });

  await page.evaluate((key) => localStorage.setItem(key, "sepia"), STORAGE_KEYS.themePreference);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("accent palette applies before first paint, survives reload, and ignores tampered storage", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const module = await import("/src/lib/palette.ts");
    module.setPalettePreference({ id: "sapphire" });
  });
  // Block the app bundle: only the inline pre-paint script can set the palette.
  await page.route("**/src/main.tsx*", (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-palette", "sapphire");
  await expect(page.locator("style#axom-palette")).toHaveCount(1);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim());
  expect(accent).toBe("126, 166, 224");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#070a10");

  await page.evaluate(() => localStorage.setItem("axom.palette.v1", JSON.stringify({
    version: 1, id: "sapphire",
    vars: { dark: { "--accent-rgb": "1, 2, 3; } body { display: none" }, light: {} },
  })));
  await page.reload({ waitUntil: "domcontentloaded" });
  const bodyDisplay = await page.evaluate(() => getComputedStyle(document.body).display);
  expect(bodyDisplay).not.toBe("none");
  await page.unroute("**/src/main.tsx*");
  await page.evaluate(() => localStorage.removeItem("axom.palette.v1"));
});
