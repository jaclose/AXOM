// Build tooling injects the exact build identity and critical shell assets.
// Optional games and document engines remain lazy and cache when first opened.
const BUILD_ID = "__AXOM_BUILD_ID__";
const CACHE_PREFIX = "axom-shell-";
const CACHE = CACHE_PREFIX + BUILD_ID;
const PRECACHE = []; // __AXOM_PRECACHE__
const CORE = [...new Set(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", ...PRECACHE])];

function cacheResponse(event, key, response) {
  const copy = response.clone();
  // A failed cache write must not turn a successful network response into a failed request.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {}));
}

async function cachedAppAsset(request) {
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  for (const name of names) {
    const cache = await caches.open(name);
    const response = await cache.match(request);
    if (!response) continue;
    if (response.headers.get("content-type")?.includes("text/html")) {
      // A host rewrite may have cached HTML at a hashed asset URL in an older shell.
      await cache.delete(request);
      continue;
    }
    return response;
  }
  return undefined;
}

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
          cacheResponse(event, "./index.html", response);
          return response;
        }
        return (await caches.open(CACHE).then((cache) => cache.match("./index.html")).catch(() => undefined)) || response;
      } catch {
        return (await caches.open(CACHE).then((cache) => cache.match("./index.html")).catch(() => undefined)) || Response.error();
      }
    })());
    return;
  }

  // Cache only shipped public application assets. Extension alone is not a
  // privacy boundary: account-specific same-origin image URLs could otherwise
  // persist in the origin-wide shell cache and outlive an account switch.
  const scopePath = new URL(self.registration?.scope || `${self.location.origin}/`).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  const publicPath = url.pathname.slice(scopePath.length);
  const shippedAsset = /^(?:assets|academic-diagrams|anki-guide|cinematics|fonts|icons|landing|scenes|soundscapes|third-party)\//.test(publicPath)
    || /^(?:apple-touch-icon\.png|favicon-32\.png|favicon\.svg|icon-(?:192|512)\.png|manifest\.webmanifest)$/.test(publicPath);
  const staticAsset = shippedAsset && /\.(?:js|mjs|css|png|jpe?g|svg|webp|ico|woff2?|webmanifest)$/.test(publicPath);
  if (!staticAsset) return;
  event.respondWith((async () => {
    const hit = await cachedAppAsset(request).catch(() => undefined);
    if (hit) return hit;
    // A cache-busted no-store request escapes immutable HTML fallbacks left by a bad deployment.
    const freshUrl = new URL(request.url);
    freshUrl.searchParams.set("__axom_revalidate", String(Date.now()));
    const response = await fetch(freshUrl.href, { cache: "no-store" });
    const isHtml = response.headers.get("content-type")?.includes("text/html");
    if (response.ok && !isHtml) {
      cacheResponse(event, request, response);
    }
    return isHtml ? Response.error() : response;
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
