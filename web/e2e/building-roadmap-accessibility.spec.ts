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
    const openNext = nextHorizon.getByRole("button", { name: /^See \d+ systems in Next roadmap$/i });
    await expect(page.getByRole("button", { name: /^See \d+ systems in Later roadmap$/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^See \d+ systems in Next roadmap$/i })).toHaveCount(1);
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

test("Building system emphasis honors real pointer and keyboard focus precedence across viewports", async ({ page }) => {
  test.setTimeout(120_000);
  await openBuilding(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.getByRole("tab", { name: "Systems" }).click();
    const all = page.getByRole("button", { name: /^All \d+/ });
    await all.click();

    const accountCard = page.locator(".system-card").filter({
      has: page.getByRole("heading", { name: "Accounts & Sync", exact: true }),
    });
    const unrelatedCard = page.locator(".system-card").filter({
      has: page.getByRole("heading", { name: "Knowledge Graph", exact: true }),
    });
    const highlighted = page.locator(".system-card.is-focus, .system-card.is-related, .system-card.is-dim");
    await expect(page.getByRole("group", { name: "Accounts & Sync", exact: true })).toHaveCount(1);
    await expect(accountCard).toHaveAttribute("aria-labelledby", "building-system-accounts-sync");
    await expect(accountCard).toHaveAccessibleDescription("IN DEVELOPMENT");
    const accountConnections = accountCard.getByRole("list", { name: "Accounts & Sync connections" });
    await expect(accountConnections.getByRole("listitem")).toHaveText(["All learner data", "Backups", "Native AXOM"]);


    // Losing pointer hover must not clear keyboard focus.
    await accountCard.focus();
    await accountCard.hover();
    await expect(accountCard).toHaveClass(/\bis-focus\b/);
    await page.mouse.move(0, 0);
    await expect(accountCard).toHaveClass(/\bis-focus\b/);
    await expect(unrelatedCard).toHaveClass(/\bis-dim\b/);
    await all.focus();
    await expect(highlighted).toHaveCount(0);

    // Losing keyboard focus must not clear the pointer's hover highlight.
    await accountCard.hover();
    await accountCard.focus();
    await all.focus();
    await expect(accountCard).toHaveClass(/\bis-focus\b/);
    await page.mouse.move(0, 0);
    await expect(highlighted).toHaveCount(0);

    // Keyboard focus takes precedence when the pointer hovers another system.
    await accountCard.focus();
    await unrelatedCard.hover();
    await expect(accountCard).toHaveClass(/\bis-focus\b/);
    await expect(unrelatedCard).toHaveClass(/\bis-dim\b/);
    await all.focus();
    await expect(unrelatedCard).toHaveClass(/\bis-focus\b/);
    await page.mouse.move(0, 0);
    await expect(highlighted).toHaveCount(0);

    // Filtering must clear interaction state and not dim unrelated new cards.
    await accountCard.hover();
    await page.getByRole("button", { name: /^Foundation \d+/ }).click();
    await expect(highlighted).toHaveCount(0);
    await all.click();
    await expect(highlighted).toHaveCount(0);
  }
});

test("Building is reachable by keyboard through its real desktop sidebar and mobile drawer", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "networkidle" });
  await completeSetup(page, "AXOM Building Navigation E2E", { ifVisible: true });
  const reviewLater = page.getByRole("button", { name: "Review later" });
  if (await reviewLater.count()) await reviewLater.click();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const sidebar = page.locator("#app-sidebar");
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  const building = sidebar.locator('[data-tour="nav-building"]');
  const dashboard = sidebar.locator('[data-tour="nav-dashboard"]');

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    const mobile = width < 881;
    if (mobile) {
      await expect(sidebar).toHaveAttribute("aria-hidden", "true");
      await expect(sidebar).toHaveAttribute("inert", "");
      await menu.focus();
      await menu.press("Enter");
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(sidebar).toBeFocused();
      await expect(sidebar).not.toHaveAttribute("inert", "");
    } else {
      await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
    }

    await building.focus();
    await expect(building).toBeFocused();
    await building.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Building AXOM" })).toBeVisible();
    await expect(page).toHaveURL(/#building$/);
    await expect(building).toHaveAttribute("aria-current", "page");

    if (mobile) {
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar).toHaveAttribute("aria-hidden", "true");
      await expect(sidebar).toHaveAttribute("inert", "");
      await expect(menu).toBeFocused();
      await menu.press("Enter");
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(sidebar).toBeFocused();
    }

    await dashboard.focus();
    await dashboard.press("Enter");
    await expect(page).toHaveURL(/#dashboard$/);
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    if (mobile) {
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar).toHaveAttribute("inert", "");
      await expect(menu).toBeFocused();
    }
  }

  expect(errors).toEqual([]);
});


test("Building filter results are announced after keyboard activation without focus loss", async ({ page }) => {
  test.setTimeout(120_000);
  await openBuilding(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.getByRole("tab", { name: "Systems" }).click();

    const status = page.getByRole("tabpanel").getByRole("status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveAttribute("aria-atomic", "true");
    await expect(status).toHaveText("Showing 11 systems (all statuses).");

    for (const [label, count, description] of [
      ["Next", 5, "Next roadmap"],
      ["Foundation", 1, "foundation"],
      ["Research", 5, "research"],
      ["All", 11, "all statuses"],
    ] as const) {
      const filterButton = page.getByRole("button", { name: new RegExp(`^${label} \\d+`) });
      await filterButton.focus();
      await filterButton.press("Enter");
      await expect(filterButton).toBeFocused();
      await expect(filterButton).toHaveAttribute("aria-pressed", "true");
      await expect(status).toHaveText(`Showing ${count} ${count === 1 ? "system" : "systems"} (${description}).`);
      await expect(page.locator(".system-card")).toHaveCount(count);
    }

    const fitsViewport = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fitsViewport, `Building status live region overflow at ${width}px`).toBe(true);
  }
});
