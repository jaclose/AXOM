// Build tooling injects the exact build identity and critical shell assets.
// Optional games and document engines remain lazy and cache when first opened.
const BUILD_ID = "__AXOM_BUILD_ID__";
const CACHE_PREFIX = "axom-shell-";
const CACHE = CACHE_PREFIX + BUILD_ID;
const PRECACHE = []; // __AXOM_PRECACHE__
const CORE = [...new Set(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", ...PRECACHE])];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  // No skipWaiting: a ready update must not interrupt an open workspace.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "AXOM_ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Retain older assets while other tabs may still be using them. Only this
    // application's caches are eligible; IndexedDB is never touched.
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients.length > 1) return;
    const keys = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX));
    const previous = keys.filter((key) => key !== CACHE).at(-1);
    await Promise.all(keys.filter((key) => key !== CACHE && key !== previous).map((key) => caches.delete(key)));
    // Do not claim/reload other tabs. The user-selected page reloads itself.
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (/\/version\.json$/.test(url.pathname) || /\/api\//.test(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
          const cache = await caches.open(CACHE);
          await cache.put("./index.html", response.clone());
          return response;
        }
        return (await (await caches.open(CACHE)).match("./index.html")) || response;
      } catch {
        return (await (await caches.open(CACHE)).match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  const staticAsset = /\.(?:js|mjs|css|png|jpe?g|svg|webp|ico|woff2?|webmanifest)$/.test(url.pathname);
  if (!staticAsset) return;
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    // Hosts can rewrite missing JS to index.html: never cache HTML as an asset.
    if (response.ok && !response.headers.get("content-type")?.includes("text/html")) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

// Local notifications only. No push subscription or background timer promise:
// suspended/closed browser tabs cannot schedule reliable alarms by themselves.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const routes = new Set(["productivity", "questions", "step", "soundscapes", "dashboard"]);
  const route = routes.has(data.route) ? data.route : "productivity";
  const action = data.action === "rest" ? "rest" : undefined;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: "AXOM_NOTIFICATION_OPEN", route, action });
      return;
    }
    const url = new URL("./", self.registration.scope);
    url.hash = route;
    if (action === "rest") url.searchParams.set("axomRest", "1");
    await self.clients.openWindow(url.href);
  })());
});
