import { expect, test } from "@playwright/test";

// Tests the actual browser worker + CacheStorage, rather than reimplementing
// its cache ordering. All bytes are synthetic. No workspace or account writes.
const PREDECESSOR = "axom-shell-r37-retained-predecessor";
const UNRELATED = "r37-unrelated-browser-cache";
const SHARED_ASSET = "/assets/r37-shared-chunk.js";
const OLD_ONLY_ASSET = "/assets/r37-previous-chunk.js";
const CURRENT_SOURCE = "export const r37Current = true;";
const PREVIOUS_SOURCE = "export const r37Retained = true;";

for (const width of [320, 390, 1440]) {
  test(`retained HTML cannot poison current JS and missing current chunks remain available offline at ${width}px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?app=1", { waitUntil: "domcontentloaded" });

    // Create the old cache BEFORE installing the current worker: CacheStorage
    // preserves insertion order, so the poisoned entry is encountered first.
    await page.evaluate(async ({ predecessor, unrelated, shared, previous, source }) => {
      const old = await caches.open(predecessor);
      await old.put(shared, new Response("<!doctype html><title>stale rewrite</title>", {
        headers: { "content-type": "text/html" },
      }));
      await old.put(previous, new Response(source, {
        headers: { "content-type": "text/javascript" },
      }));
      const other = await caches.open(unrelated);
      await other.put("/r37-unrelated.txt", new Response("untouched"));
    }, {
      predecessor: PREDECESSOR, unrelated: UNRELATED, shared: SHARED_ASSET,
      previous: OLD_ONLY_ASSET, source: PREVIOUS_SOURCE,
    });

    // Vite serves the repository's public/sw.js in development. Its build ID
    // stays a placeholder in this test but it executes the real worker source.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });

    const prepared = await page.evaluate(async ({ predecessor, shared, source }) => {
      const keys = await caches.keys();
      const current = keys.find(key => key.startsWith("axom-shell-") && key !== predecessor);
      if (!current) throw new Error("current service-worker cache did not install");
      const cache = await caches.open(current);
      await cache.put(shared, new Response(source, { headers: { "content-type": "text/javascript" } }));
      return { keys, current };
    }, { predecessor: PREDECESSOR, shared: SHARED_ASSET, source: CURRENT_SOURCE });
    expect(prepared.keys).toContain(PREDECESSOR);
    expect(prepared.keys).toContain(UNRELATED);
    expect(prepared.current).not.toBe(PREDECESSOR);

    // Both assets must resolve from caches with the origin offline. The older
    // HTML rewrite must be evicted rather than ever returned as application JS.
    await context.setOffline(true);
    try {
      const result = await page.evaluate(async ({ predecessor, unrelated, shared, previous }) => {
        const fresh = await fetch(shared);
        const retained = await fetch(previous);
        const old = await caches.open(predecessor);
        const other = await caches.open(unrelated);
        return {
          controlled: Boolean(navigator.serviceWorker.controller),
          fresh: { ok: fresh.ok, type: fresh.headers.get("content-type"), body: await fresh.text() },
          retained: { ok: retained.ok, type: retained.headers.get("content-type"), body: await retained.text() },
          poisonedEntryEvicted: !(await old.match(shared)),
          unrelatedStillPresent: (await (await other.match("/r37-unrelated.txt"))?.text()) === "untouched",
        };
      }, {
        predecessor: PREDECESSOR, unrelated: UNRELATED,
        shared: SHARED_ASSET, previous: OLD_ONLY_ASSET,
      });
      expect(result.controlled).toBe(true);
      expect(result.fresh).toMatchObject({ ok: true, body: CURRENT_SOURCE });
      expect(result.fresh.type).toContain("text/javascript");
      expect(result.retained).toMatchObject({ ok: true, body: PREVIOUS_SOURCE });
      expect(result.retained.type).toContain("text/javascript");
      expect(result.poisonedEntryEvicted).toBe(true);
      expect(result.unrelatedStillPresent).toBe(true);
    } finally {
      await context.setOffline(false);
    }
  });
}
