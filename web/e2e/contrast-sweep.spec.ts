import type { Page } from "@playwright/test";
import { probeContrast, type ContrastFinding } from "./contrastProbe";
import { expect, seedOnboarded, test } from "./fixtures";

/**
 * Text below this ratio is effectively unreadable, not just short of AA. The
 * sweep fails on it; everything under 4.5:1 is attached as a report so the AA
 * gap can be worked down without blocking.
 */
const UNREADABLE = 2;
const AA = 4.5;

const ROUTES = [
  "dashboard", "tracker", "questions", "productivity", "reports", "journal", "soundscapes",
  "daily-games", "daily-word", "doctordle", "appchecker", "integrations", "leaderboards", "help", "about",
];

async function sweep(page: Page, label: string, findings: Array<ContrastFinding & { where: string }>) {
  for (const finding of await page.evaluate(probeContrast, { minRatio: AA })) findings.push({ ...finding, where: label });
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.locator(".route-loading").waitFor({ state: "detached" }).catch(() => undefined);
  // The Soundscapes taste picker opens on a first visit; it has its own pass below.
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(350);
}

for (const theme of ["dark", "light"] as const) {
  test(`no unreadable text on any main screen or first-run layer (${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript((value) => localStorage.setItem("axom.theme", value), theme);
    await page.goto("/", { waitUntil: "networkidle" });

    // First-run layers, before the workspace is marked done with them.
    await seedOnboarded(page, { promisePromptStatus: undefined });
    const findings: Array<ContrastFinding & { where: string }> = [];
    await expect(page.getByRole("dialog", { name: "A promise to yourself" })).toBeVisible();
    await sweep(page, "promise prompt", findings);

    await seedOnboarded(page);
    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      await settle(page);
      await sweep(page, route, findings);
    }

    await page.goto("/#dashboard");
    await settle(page);
    await page.getByTitle("Settings", { exact: true }).click();
    for (const tab of ["Profile", "Account", "Appearance", "Data", "Emergency recovery", "Advanced"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.waitForTimeout(200);
      await sweep(page, `settings: ${tab}`, findings);
    }

    const unreadable = findings.filter((finding) => finding.ratio < UNREADABLE);
    await testInfo.attach(`contrast-${theme}.json`, {
      body: JSON.stringify(findings.sort((a, b) => a.ratio - b.ratio), null, 2),
      contentType: "application/json",
    });
    expect(unreadable.map(({ where, text, ratio, selector }) => `${where} · "${text}" ${ratio}:1 · ${selector}`), `Unreadable text (< ${UNREADABLE}:1) in ${theme}`).toEqual([]);
  });
}

/** Accent palettes recolour pills, chips and kickers; each gets a lighter pass in both themes. */
const PALETTE_IDS = ["ivory", "amethyst", "sapphire", "midnight", "emerald", "rose", "platinum"];
const PALETTE_ROUTES = ["dashboard", "tracker", "reports", "daily-word"];

test("no unreadable text under any accent palette", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  const findings: Array<ContrastFinding & { where: string }> = [];
  for (const theme of ["dark", "light"] as const) {
    for (const id of PALETTE_IDS) {
      await page.evaluate(async ({ theme: value, id: palette }) => {
        localStorage.setItem("axom.theme", value);
        const module = await import("/src/lib/palette.ts");
        module.setPalettePreference({ id: palette });
      }, { theme, id });
      for (const route of PALETTE_ROUTES) {
        await page.goto(`/#${route}`);
        await page.reload({ waitUntil: "networkidle" });
        await settle(page);
        await sweep(page, `${theme}/${id}: ${route}`, findings);
      }
    }
  }
  await page.evaluate(() => localStorage.removeItem("axom.palette.v1"));
  await testInfo.attach("contrast-palettes.json", { body: JSON.stringify(findings.sort((a, b) => a.ratio - b.ratio), null, 2), contentType: "application/json" });
  const unreadable = findings.filter((finding) => finding.ratio < UNREADABLE);
  expect(unreadable.map(({ where, text, ratio, selector }) => `${where} · "${text}" ${ratio}:1 · ${selector}`), "Unreadable text under a palette").toEqual([]);
});
