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

for (const width of [1440, 390]) {
  test(`developer preview retains in-progress input across tab round-trips at ${width}px`, async ({ page }) => {
    let previewRequests = 0;
    await page.route("https://www.jafardabbagh.com/**", route => {
      previewRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><title>Preview fixture</title><label>Unsent draft<input id="draft" value="initial"></label>',
      });
    });
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    await seedOnboarded(page);
    await page.evaluate(() => { window.location.hash = "about"; });

    const about = page.getByRole("tab", { name: "About AXOM" });
    const developer = page.getByRole("tab", { name: "The developer" });
    const frame = page.locator('iframe[title="Live site preview"]');
    const draft = page.frameLocator('iframe[title="Live site preview"]').locator("#draft");

    // Before first explicit visit, no third-party request or iframe is created.
    await expect(frame).toHaveCount(0);
    expect(previewRequests).toBe(0);

    await developer.click();
    await frame.scrollIntoViewIfNeeded();
    await draft.fill("draft never submitted");
    await expect(draft).toHaveValue("draft never submitted");

    await about.click();
    await expect(about).toBeFocused();
    await expect(frame).toHaveCount(1);
    await expect(frame).toBeHidden();
    await expect(page.locator('[inert] iframe[title="Live site preview"]')).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "about-tab-axom");

    await developer.click();
    await expect(developer).toBeFocused();
    await expect(frame).toBeVisible();
    await expect(draft).toHaveValue("draft never submitted");
    expect(previewRequests).toBe(1);

    // Closing explicitly unloads third-party scripts; tab changes cannot reopen it.
    const close = page.getByRole("button", { name: "Close preview" });
    await close.focus();
    await close.click();
    await expect(frame).toHaveCount(0);
    const reopen = page.getByRole("button", { name: "Open preview" });
    await expect(reopen).toBeFocused();
    await about.click();
    await developer.click();
    await expect(frame).toHaveCount(0);
    expect(previewRequests).toBe(1);

    await reopen.click();
    await frame.scrollIntoViewIfNeeded();
    await expect(draft).toHaveValue("initial");
    expect(previewRequests).toBe(2);
  });
}

test("external developer preview omits AXOM query referrer", async ({ page }) => {
  const controlReferrers: string[] = [];
  const previewReferrers: Array<string | undefined> = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("https://www.jafardabbagh.com/**", async route => {
    // allHeaders includes browser-controlled headers that headers() may omit.
    const referer = (await route.request().allHeaders())["referer"];
    if (new URL(route.request().url()).pathname === "/axom-referrer-visibility-control") {
      controlReferrers.push(referer ?? "");
    } else {
      previewReferrers.push(referer);
    }
    await route.fulfill({
      status: 200, contentType: "text/html", body: "<!doctype html><title>Preview fixture</title>",
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await page.evaluate(() => {
    window.location.hash = "about";
    const url = new URL(window.location.href);
    url.searchParams.set("axom-referrer-canary", "synthetic-test-only");
    window.history.replaceState(window.history.state, "", url.toString());

    // Positive control: prove this intercepted request path can observe Referer
    // when permitted, so an absent header on the real preview is meaningful.
    const probe = document.createElement("iframe");
    probe.title = "Synthetic referrer visibility control";
    probe.referrerPolicy = "unsafe-url";
    probe.src = "https://www.jafardabbagh.com/axom-referrer-visibility-control";
    document.body.appendChild(probe);
  });
  await expect.poll(
    () => controlReferrers.some(value => value.includes("axom-referrer-canary=synthetic-test-only")),
    { timeout: 15_000 },
  ).toBe(true);
  await page.evaluate(() => {
    document.querySelector('iframe[title="Synthetic referrer visibility control"]')?.remove();
  });

  await page.getByRole("tab", { name: "The developer" }).click();
  await page.getByTitle("Live site preview").scrollIntoViewIfNeeded();
  await expect.poll(() => previewReferrers.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(previewReferrers.every(value => value === undefined)).toBe(true);
});

test("developer preview blocks a user-triggered popup while an unsandboxed cross-origin control permits it", async ({ page }) => {
  // Intercept the real external iframe URL: no remote site, account or data access.
  // A working unsandboxed positive control prevents a vacuous blocked-popup test.
  const fixture = [
    "<!doctype html><title>Popup containment fixture</title>",
    '<button type="button" id="open-popup">Attempt popup</button>',
    '<output id="popup-result">idle</output>',
    "<script>",
    'document.getElementById("open-popup").addEventListener("click", () => {',
    "  let popup = null;",
    '  try { popup = window.open("about:blank", "_blank"); } catch {}',
    '  document.getElementById("popup-result").textContent = popup ? "allowed" : "blocked";',
    "  if (popup) popup.close();",
    "});",
    "</script>",
  ].join("\n");
  await page.route("https://www.jafardabbagh.com/**", route => route.fulfill({
    status: 200, contentType: "text/html", body: fixture,
  }));

  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await page.evaluate(() => { window.location.hash = "about"; });
  await page.getByRole("tab", { name: "The developer" }).click();

  await page.evaluate(() => {
    const control = document.createElement("iframe");
    control.title = "Unsandboxed external popup control";
    // Keep the synthetic control in the viewport above the app shell and
    // sidebar/backdrop so Playwright can deliver a genuine pointer gesture.
    // Do not force-click: the positive control must prove normal hit-testing.
    control.style.cssText = "position:fixed;top:12px;left:12px;width:340px;height:140px;z-index:2147483647;border:0;background:white";
    control.src = "https://www.jafardabbagh.com/axom-popup-positive-control";
    document.body.appendChild(control);
  });
  const control = page.frameLocator('iframe[title="Unsandboxed external popup control"]');
  await control.getByRole("button", { name: "Attempt popup" }).click();
  await expect(control.locator("#popup-result")).toHaveText("allowed");
  // Positive control retains its real origin; the sandboxed preview must not.
  expect(await control.locator("body").evaluate(() => window.origin)).toBe("https://www.jafardabbagh.com");
  await page.evaluate(() => {
    document.querySelector('iframe[title="Unsandboxed external popup control"]')?.remove();
  });

  // Exercise the actual AboutPage iframe, not a standalone browser mock.
  const preview = page.frameLocator('iframe[title="Live site preview"]');
  await preview.getByRole("button", { name: "Attempt popup" }).click();
  await expect(preview.locator("#popup-result")).toHaveText("blocked");
  expect(await preview.locator("body").evaluate(() => window.origin)).toBe("null");
});

test("explicitly closing the developer iframe stops embedded background activity", async ({ page }) => {
  // Deterministic synthetic cross-origin page. No third-party site or private account is contacted.
  await page.route("https://www.jafardabbagh.com/**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: '<!doctype html><title>Activity fixture</title><script>setInterval(() => parent.postMessage("axom-preview-tick", "*"), 40)</script>',
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  await seedOnboarded(page);
  await page.evaluate(() => { window.location.hash = "about"; });
  await page.evaluate(() => {
    const state = window as Window & { __axomPreviewTicks?: number };
    state.__axomPreviewTicks = 0;
    window.addEventListener("message", event => {
      if (event.data === "axom-preview-tick") {
        state.__axomPreviewTicks = (state.__axomPreviewTicks ?? 0) + 1;
      }
    });
  });
  const pings = () => page.evaluate(() =>
    (window as Window & { __axomPreviewTicks?: number }).__axomPreviewTicks ?? 0);
  const about = page.getByRole("tab", { name: "About AXOM" });
  const developer = page.getByRole("tab", { name: "The developer" });
  const iframe = page.locator('iframe[title="Live site preview"]');

  await expect(iframe).toHaveCount(0);
  await developer.click();
  await iframe.scrollIntoViewIfNeeded();
  await expect.poll(pings, { timeout: 10_000 }).toBeGreaterThan(2);
  await about.click();
  await expect(iframe).toBeHidden();
  const beforeHidden = await pings();
  // Hidden + inert removes interaction but does not suspend third-party scripts.
  await expect.poll(pings, { timeout: 10_000 }).toBeGreaterThan(beforeHidden);
  await developer.click();
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(iframe).toHaveCount(0);
  // Drain already queued messages before checking that execution has stopped.
  await page.waitForTimeout(250);
  const stopped = await pings();
  await page.waitForTimeout(550);
  expect(await pings()).toBe(stopped);
  await about.click();
  await developer.click();
  await expect(iframe).toHaveCount(0);
  await page.getByRole("button", { name: "Open preview" }).click();
  await iframe.scrollIntoViewIfNeeded();
  const beforeRestart = await pings();
  await expect.poll(pings, { timeout: 10_000 }).toBeGreaterThan(beforeRestart);
});
