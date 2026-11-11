import { expect, test } from "@playwright/test";

// Integration proof for the DIRECT service-worker candidate. All cache bytes
// and Authorization header values are synthetic, never real account data.
// Unlike the Node VM SW unit suite, this uses Chromium's actual fetch dispatch,
// service-worker controller, CacheStorage and offline networking.
const PREDECESSOR = "axom-shell-r38-previous";
const ICON = "/icon-192.png";
const PUBLIC = "/icons/r38-public.png";
const PRIVATE = "/private/r38-account.png";
const OLD_ICON = "r38-retained-old-icon";
const CURRENT_ICON = "r38-current-icon";
const PUBLIC_BYTES = "r38-current-public-image";
const ACCOUNT_BYTES = "r38-synthetic-account-A";

for (const width of [320, 390, 1440]) {
  test("current public cache wins while synthetic account-like bytes never replay offline at " + width + "px", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto("/?app=1", { waitUntil: "domcontentloaded" });

    // Seed a previous generation BEFORE the real worker installs. A valid
    // predecessor asset with the same URL must not mask newer build bytes.
    await page.evaluate(async ({ predecessor, icon, privatePath, oldBytes, accountBytes }) => {
      const old = await caches.open(predecessor);
      await old.put(icon, new Response(oldBytes, { headers: { "content-type": "image/png" } }));
      await old.put(privatePath, new Response(accountBytes, { headers: { "content-type": "image/png" } }));
    }, {
      predecessor: PREDECESSOR, icon: ICON, privatePath: PRIVATE,
      oldBytes: OLD_ICON, accountBytes: ACCOUNT_BYTES,
    });

    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });

    const seeded = await page.evaluate(async ({ predecessor, icon, publicPath, privatePath, currentBytes, publicBytes, accountBytes }) => {
      const keys = await caches.keys();
      const currentName = keys.find(name => name.startsWith("axom-shell-") && name !== predecessor);
      if (!currentName) throw new Error("current service-worker cache was not created");
      const current = await caches.open(currentName);
      const image = (body: string) => new Response(body, { headers: { "content-type": "image/png" } });
      await current.put(icon, image(currentBytes));
      await current.put(publicPath, image(publicBytes));
      // A maliciously placed synthetic record must not become a shell asset.
      await current.put(privatePath, image(accountBytes));
      return { currentName, predecessorPresent: keys.includes(predecessor) };
    }, {
      predecessor: PREDECESSOR, icon: ICON, publicPath: PUBLIC,
      privatePath: PRIVATE, currentBytes: CURRENT_ICON,
      publicBytes: PUBLIC_BYTES, accountBytes: ACCOUNT_BYTES,
    });
    expect(seeded.predecessorPresent).toBe(true);

    await context.setOffline(true);
    try {
      const result = await page.evaluate(async ({ icon, publicPath, privatePath, predecessor, accountBytes }) => {
        const blocked = async (path: string, options?: RequestInit) => {
          try {
            const response = await fetch(path, options);
            return { rejected: false, status: response.status, body: await response.text() };
          } catch {
            return { rejected: true };
          }
        };
        const iconResponse = await fetch(icon);
        const publicResponse = await fetch(publicPath);
        const old = await caches.open(predecessor);
        return {
          controlled: Boolean(navigator.serviceWorker.controller),
          icon: await iconResponse.text(),
          publicBytes: await publicResponse.text(),
          // These requests MUST go to the browser/network. Offline means a
          // rejection, even if the same account-like bytes are in CacheStorage.
          privatePath: await blocked(privatePath),
          authorizedPublicPath: await blocked(publicPath, {
            headers: { authorization: "Bearer r38-synthetic-account-B" },
          }),
          noStorePublicPath: await blocked(publicPath, { cache: "no-store" }),
          oldStillRetained: (await (await old.match(icon))?.text()) === "r38-retained-old-icon",
          accountFixtureStillPresent: (await (await old.match(privatePath))?.text()) === accountBytes,
        };
      }, {
        icon: ICON, publicPath: PUBLIC, privatePath: PRIVATE,
        predecessor: PREDECESSOR, accountBytes: ACCOUNT_BYTES,
      });
      expect(result.controlled).toBe(true);
      expect(result.icon).toBe(CURRENT_ICON);
      expect(result.publicBytes).toBe(PUBLIC_BYTES);
      expect(result.privatePath).toMatchObject({ rejected: true });
      expect(result.authorizedPublicPath).toMatchObject({ rejected: true });
      expect(result.noStorePublicPath).toMatchObject({ rejected: true });
      expect(result.oldStillRetained).toBe(true);
      expect(result.accountFixtureStillPresent).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  });
}
