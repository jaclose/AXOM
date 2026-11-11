import { expect, test } from "@playwright/test";

// Exact browser/CacheStorage proof for DIRECT's offline navigation shell policy.
// All HTML is synthetic. No authentication, personal workspace, or hosted data.
const APP = "/?app=1";
const SHELL_ENTRY = "./index.html";
const CASES = [
  {
    id: "private",
    marker: "r40-synthetic-account-a-private",
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  },
  {
    id: "cookie",
    marker: "r40-synthetic-account-a-cookie-vary",
    headers: { "content-type": "text/html; charset=utf-8", vary: "Cookie" },
  },
  {
    id: "mime",
    marker: "r40-synthetic-account-a-wrong-mime",
    headers: { "content-type": "text/plain; charset=utf-8" },
  },
] as const;

for (const width of [320, 390, 1440]) {
  test(`safe public offline navigation survives while private, cookie-varying and wrong-MIME cached shells cannot replay at ${width}px`, async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    // This route supplies source-URL-bearing HTTP responses for the cache.
    // new Response() has an empty .url and would test only provenance rejection,
    // rather than the explicit private/Vary/MIME controls.
    await page.route("**/index.html?axomNavFixture=*", async route => {
      const id = new URL(route.request().url()).searchParams.get("axomNavFixture");
      const fixture = CASES.find(item => item.id === id);
      if (!fixture) return route.abort();
      await route.fulfill({
        status: 200,
        headers: { ...fixture.headers },
        body: `<!doctype html><html><head><title>${fixture.marker}</title></head><body>${fixture.marker}</body></html>`,
      });
    });

    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    const originalShell = await page.evaluate(async key => {
      const names = (await caches.keys()).filter(name => name.startsWith("axom-shell-"));
      const name = names.at(-1);
      if (!name) throw new Error("The app service-worker cache did not install");
      const response = await (await caches.open(name)).match(key);
      return { name, status: response?.status, type: response?.headers.get("content-type"), url: response?.url };
    }, SHELL_ENTRY);
    expect(originalShell.status).toBe(200);
    expect(originalShell.type).toMatch(/^text\/html/i);
    expect(originalShell.url).toMatch(/^https?:\/\//);

    // Positive control: a genuine public install-time shell remains navigable
    // offline; rejecting all offline navigation would not satisfy this test.
    await context.setOffline(true);
    try {
      const publicNavigation = await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 20_000 });
      expect(publicNavigation?.status()).toBe(200);
      expect(publicNavigation?.headers()["content-type"]).toMatch(/^text\/html/i);
    } finally {
      await context.setOffline(false);
    }
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    for (const fixture of CASES) {
      // Fetch each synthetic response through the browser to retain its final
      // same-origin index.html URL, then deliberately seed only the shell key.
      const seeded = await page.evaluate(async ({ name, id, key }) => {
        const response = await fetch(`/index.html?axomNavFixture=${id}`, { cache: "no-store" });
        const body = await response.clone().text();
        const cache = await caches.open(name);
        await cache.put(key, response);
        return { url: response.url, status: response.status, body };
      }, { name: originalShell.name, id: fixture.id, key: SHELL_ENTRY });
      expect(seeded.status).toBe(200);
      expect(new URL(seeded.url).pathname).toBe("/index.html");
      expect(seeded.body).toContain(fixture.marker);

      await context.setOffline(true);
      let observedBody = "";
      let navigationError = "";
      try {
        const response = await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 20_000 });
        observedBody = (await response?.text()) || "";
      } catch (error) {
        navigationError = String(error);
      } finally {
        await context.setOffline(false);
      }
      if (navigationError) {
        // Fail-closed offline navigation is allowed for an unsafe cache entry,
        // but timeouts or unrelated test-harness errors are not.
        expect(navigationError).toMatch(/net::ERR_/);
      }
      expect(observedBody, `Unsafe cached shell replayed for ${fixture.id}`).not.toContain(fixture.marker);

      // Recover the normal online application between malicious fixtures.
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    }
  });
}
