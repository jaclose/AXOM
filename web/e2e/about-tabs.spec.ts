import { expect, seedOnboarded, test } from "./fixtures";

// Real browser coverage for the About tab contract. The component RTL tests
// verify handlers, but cannot prove native keyboard focus or the mobile layout.
for (const width of [1440, 390, 320]) {
  test(`About tabs keep keyboard focus and panel identity at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Isolate the developer\'s separately deployed iframe from AXOM keyboard and error checks.
    // Keep uncaught errors from AXOM itself observable rather than muting pageerror.
    await page.route("https://www.jafardabbagh.com/**", route => route.fulfill({
      status: 200, contentType: "text/html", body: "<!doctype html><title>Preview fixture</title>",
    }));
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await page.evaluate(() => { window.location.hash = "about"; });

    const tablist = page.getByRole("tablist", { name: "About" });
    const about = tablist.getByRole("tab", { name: "About AXOM" });
    const developer = tablist.getByRole("tab", { name: "The developer" });
    const panel = page.getByRole("tabpanel");

    await expect(about).toBeVisible();
    await expect(about).toHaveAttribute("aria-selected", "true");
    await expect(about).toHaveAttribute("tabindex", "0");
    await expect(developer).toHaveAttribute("tabindex", "-1");
    await expect(panel).toHaveAttribute("aria-labelledby", "about-tab-axom");
    await expect(panel).toHaveAttribute("tabindex", "0");
    await expect(about).toHaveAttribute("aria-controls", "about-panel");
    await expect(developer).toHaveAttribute("aria-controls", "about-panel");

    await about.focus();
    await about.press("ArrowRight");
    await expect(developer).toBeFocused();
    await expect(developer).toHaveAttribute("aria-selected", "true");
    await expect(developer).toHaveAttribute("tabindex", "0");
    await expect(about).toHaveAttribute("tabindex", "-1");
    await expect(panel).toHaveAttribute("aria-labelledby", "about-tab-developer");
    await expect(page.getByTitle("Live site preview")).toHaveCount(1);

    // An OS/browser-modified key must not switch the selected tab.
    await developer.press("Shift+ArrowRight");
    await expect(developer).toBeFocused();
    await expect(developer).toHaveAttribute("aria-selected", "true");

    await developer.press("Home");
    await expect(about).toBeFocused();
    await expect(panel).toHaveAttribute("aria-labelledby", "about-tab-axom");
    await about.press("End");
    await expect(developer).toBeFocused();
    await developer.press("ArrowLeft");
    await expect(about).toBeFocused();
    await expect(about).toHaveAttribute("aria-selected", "true");

    await developer.click();
    await expect(developer).toBeFocused();
    await expect(panel).toHaveAttribute("aria-labelledby", "about-tab-developer");

    // Includes mobile viewport regression without requiring remote iframe load.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
