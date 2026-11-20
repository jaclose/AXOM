import { completeSetup, expect, test } from "./fixtures";

async function openBuilding(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await completeSetup(page, "AXOM Building E2E", { ifVisible: true });
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
  await page.evaluate(() => { window.location.hash = "building"; });
  await expect(page.getByRole("heading", { level: 1, name: "Building AXOM" })).toBeVisible();
}

test("Building tabs and Next horizon retain keyboard focus and semantics on desktop and narrow screens", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBuilding(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });

    const overview = page.getByRole("tab", { name: "Overview" });
    const systems = page.getByRole("tab", { name: "Systems" });
    const panel = page.getByRole("tabpanel");
    await overview.click();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect(overview).toHaveAttribute("tabindex", "0");
    await expect(systems).toHaveAttribute("tabindex", "-1");
    await expect(panel).toHaveAttribute("aria-labelledby", "building-tab-overview");
    await expect(overview).toHaveAttribute("aria-controls", "building-active-panel");

    await overview.focus();
    await overview.press("ArrowRight");
    await expect(systems).toBeFocused();
    await expect(systems).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", "building-tab-systems");
    await expect(overview).toHaveAttribute("tabindex", "-1");
    await expect(systems).toHaveAttribute("tabindex", "0");

    await systems.press("ArrowRight");
    await expect(overview).toBeFocused();
    await overview.press("End");
    await expect(systems).toBeFocused();
    await systems.press("Home");
    await expect(overview).toBeFocused();
    await overview.press("ArrowLeft");
    await expect(systems).toBeFocused();

    await overview.click();
    const nextHorizon = page.locator(".building-horizon").filter({
      has: page.getByRole("heading", { name: "Next", exact: true }),
    });
    const openNext = nextHorizon.getByRole("button", { name: /^See \d+ next roadmap systems$/i });
    await expect(page.getByRole("button", { name: /^See \d+ later roadmap systems$/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^See \d+ next roadmap systems$/i })).toHaveCount(1);
    await openNext.focus();
    await expect(openNext).toBeFocused();
    await openNext.press("Enter");

    await expect(systems).toBeFocused();
    await expect(systems).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", "building-tab-systems");
    await expect(page.getByRole("button", { name: /^Next \d+/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".system-card")).toHaveCount(5);
    await page.getByRole("button", { name: /^All \d+/ }).click();
    await expect(page.locator(".system-card")).toHaveCount(11);

    const fitsViewport = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fitsViewport, `Building page horizontal overflow at ${width}px`).toBe(true);
  }
  expect(errors).toEqual([]);
});
