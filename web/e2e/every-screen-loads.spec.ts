import type { Page } from "@playwright/test";
import { completeSetup, expect, test } from "./fixtures";

/**
 * Every screen a learner can reach opens without an error screen, a page
 * error, a console error or a missing file. Run it against the dev server, a
 * production build (`AXOM_E2E_BASE_URL` pointed at `vite preview`) or the live
 * site: lazy screens and their stylesheets are only split in production.
 */
const ROUTES = [
  "dashboard", "courses", "tracker", "questions", "simulations", "communities", "methods",
  "soundscapes", "productivity", "journal", "reports", "daily-games", "daily-word", "doctordle",
  "resources", "step", "step2", "dedicated", "shelf", "step3", "premed", "mcat", "dat", "casper",
  "premed-log", "appchecker", "tasks", "habits", "anki", "prompts", "patch-notes", "integrations",
  "community", "leaderboards", "activity", "about", "folders", "building", "help", "host",
  "communications", "privacy", "shared-set",
];

const FAILURE_TEXT = /This screen hit a snag|This screen needs the latest AXOM|AXOM could not load|Something went wrong/i;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    // Email previews are deliberately sandboxed without scripts. Chromium under
    // automation logs this for such frames at random, even for a frame holding
    // only "<p>x</p>"; the page itself runs no script there.
    if (/^Blocked script execution in 'about:srcdoc'/.test(message.text())) return;
    if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(page.url() || "http://invalid").origin) return;
    // Account endpoints answer 4xx without an account; that is not a broken screen.
    if (url.pathname.startsWith("/api/")) return;
    if (response.status() >= 400) problems.push(`${response.status()} ${url.pathname}`);
  });
  page.on("requestfailed", (request) => {
    // Leaving a screen cancels its background video, audio and images; that is not a failure.
    if (request.failure()?.errorText === "net::ERR_ABORTED" && ["media", "image"].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (url.origin === new URL(page.url() || "http://invalid").origin && !url.pathname.startsWith("/api/")) {
      problems.push(`failed request ${url.pathname}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  return problems;
}

for (const viewport of VIEWPORTS) {
  test(`every screen opens without an error on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(480_000);
    const problems = watchProblems(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/", { waitUntil: "networkidle" });
    await completeSetup(page, "AXOM Screens E2E", { ifVisible: true });
    const later = page.getByRole("button", { name: "Review later" });
    if (await later.count()) await later.first().click();

    const failures: string[] = [];
    for (const route of ROUTES) {
      const before = problems.length;
      await page.evaluate((id) => { window.location.hash = id; }, route);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      // Lazy screens show a short "Opening…" status first.
      await expect.poll(() => page.getByRole("status").filter({ hasText: /^Opening/ }).count(), { timeout: 20_000 }).toBe(0);
      const routeError = await page.locator(".route-error").count();
      const failureText = await page.getByText(FAILURE_TEXT).count();
      if (routeError || failureText) {
        const detail = (await page.locator(".route-error").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
        failures.push(`#${route}: error screen ${detail}`);
      }
      const fresh = problems.slice(before);
      if (fresh.length) failures.push(`#${route}: ${fresh.join(" | ")}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
