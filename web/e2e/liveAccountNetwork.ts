import type { BrowserContext } from "@playwright/test";
import { permitsLiveAccountRequest } from "../src/lib/liveAccountSafety";

/**
 * Destructive-test-only network boundary. Playwright route.continue() does NOT
 * re-enter route handlers for redirects, so it cannot enforce an origin guard.
 * Fetch one approved hop without following redirects, and never fulfill 3xx.
 * This also blocks custom backends and disallowed origins in either browser.
 * Browser WebSockets are unconditionally disabled for these destructive tests.
 */
export async function isolateLiveAccountNetwork(
  context: BrowserContext,
  dedicatedOrigin: string,
  appOrigin: string,
): Promise<void> {
  // Destructive auth tests do not require browser Realtime or dev-server HMR.
  // Block every WebSocket before opening any page. Even an initially allowlisted
  // server could redirect an upgraded connection to a foreign origin, which
  // route.fetch({ maxRedirects: 0 }) cannot inspect for WebSocket traffic.
  // Never call connectToServer(): this route must make ZERO network handshakes.
  await context.routeWebSocket(/.*/, async (socket) => {
    await socket.close({ code: 1008, reason: "WebSocket disabled in live-account isolation" });
  });
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
