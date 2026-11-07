import type { BrowserContext } from "@playwright/test";
import { permitsLiveAccountRequest } from "../src/lib/liveAccountSafety";

/**
 * Destructive-test-only network boundary. Playwright route.continue() does NOT
 * re-enter route handlers for redirects, so it cannot enforce an origin guard.
 * Fetch one approved hop without following redirects, and never fulfill 3xx.
 * This also blocks custom backends and disallowed origins in either browser.
 */
/**
 * Playwright's HTTP routes do not intercept WebSocket upgrades. Convert only
 * ws/wss to the HTTP-equivalent origin for the same exact-origin allowlist.
 * Never fall back to a custom host, another project, or cleartext project WS.
 */
export function permitsLiveAccountWebSocket(
  socketUrl: string,
  dedicatedOrigin: string,
  appOrigin: string,
): boolean {
  try {
    const target = new URL(socketUrl);
    if (target.hash || (target.protocol !== "ws:" && target.protocol !== "wss:")) return false;
    target.protocol = target.protocol === "ws:" ? "http:" : "https:";
    return permitsLiveAccountRequest(target.href, dedicatedOrigin, appOrigin);
  } catch {
    return false;
  }
}

export async function isolateLiveAccountNetwork(
  context: BrowserContext,
  dedicatedOrigin: string,
  appOrigin: string,
): Promise<void> {
  // Register before opening any app pages. HTTP route("**/*") alone cannot
  // stop ws/wss egress. A blocked route never connects to the remote server.
  await context.routeWebSocket(/.*/, async (socket) => {
    if (!permitsLiveAccountWebSocket(socket.url(), dedicatedOrigin, appOrigin)) {
      await socket.close({ code: 1008, reason: "Blocked by AXOM test isolation" });
      return;
    }
    // Only the explicitly named test project, its storage host, or local app
    // may connect. Default WebSocket message forwarding remains intact.
    socket.connectToServer();
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
