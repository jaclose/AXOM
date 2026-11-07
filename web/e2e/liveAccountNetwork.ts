import type { BrowserContext } from "@playwright/test";
import { permitsLiveAccountRequest } from "../src/lib/liveAccountSafety";

/**
 * Destructive-test-only network boundary. Playwright route.continue() does NOT
 * re-enter route handlers for redirects, so it cannot enforce an origin guard.
 * Fetch one approved hop without following redirects, and never fulfill 3xx.
 * This also blocks custom backends and disallowed origins in either browser.
 */
export async function isolateLiveAccountNetwork(
  context: BrowserContext,
  dedicatedOrigin: string,
  appOrigin: string,
): Promise<void> {
  await context.route("**/*", async (route) => {
    if (!permitsLiveAccountRequest(route.request().url(), dedicatedOrigin, appOrigin)) {
      await route.abort("blockedbyclient");
      return;
    }
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      await route.abort("failed");
      return;
    }
    // A fulfilled redirect can escape the intercept in Chromium and Firefox.
    // Even a same-origin redirect is unsafe without a fresh origin check.
    if (response.status() >= 300 && response.status() < 400) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ response });
  });
}
