// Build tooling injects the exact build identity and critical shell assets.
// Optional games and document engines remain lazy and cache when first opened.
const BUILD_ID = "__AXOM_BUILD_ID__";
const CACHE_PREFIX = "axom-shell-";
const CACHE = CACHE_PREFIX + BUILD_ID;
const PRECACHE = []; // __AXOM_PRECACHE__
// Exact hashed JS/CSS artifacts emitted by this build, including lazy routes.
// Injection does not add optional games to install-time PRECACHE.
const SHIPPED_CHUNKS = []; // __AXOM_SHIPPED_CHUNKS__
const CORE = [...new Set(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", ...PRECACHE])];

// Cache Storage does not enforce HTTP Cache-Control on explicit cache.put.
// A public-looking path may still return account-bound bytes; never persist or
// replay a response that instructs caches not to store or share it.
function cacheablePublicResponse(response) {
  const control = response.headers.get("cache-control") || "";
  const vary = response.headers.get("vary") || "";
  return !/\b(?:private|no-store|no-cache)\b/i.test(control)
    && !/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary)
    && !response.headers.has("set-cookie");
}

// The updater pre-caches exact build-manifest files with cache.addAll, even
// where the host's generic header is no-store. An old build must still load
// its own hash-named checkpoint chunk after the deployment switches over.
// This narrow read exception applies ONLY to manifest-pinned JS/CSS with
// no-store as its sole cache directive, never private/auth-varying responses.
function pinnedPublicBuildAsset(request, response) {
  if (response.headers.get("cache-control")?.trim().toLowerCase() !== "no-store") return false;
  if (response.headers.has("set-cookie")) return false;
  if (/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(response.headers.get("vary") || "")) return false;
  if (!response.ok || !/(?:javascript|text\/css)/i.test(response.headers.get("content-type") || "")) return false;
  const pathname = new URL(request.url).pathname;
  return PRECACHE.some((path) => /^\.\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(path)
    && new URL(path, self.registration.scope).pathname === pathname);
}

// Some hosts and controlled update tests send no-store or no-cache even for
// immutable build code. Only exact Vite-manifest-listed hashed JS/CSS can use
// an explicit Cache Storage offline fallback; media and user URLs never qualify.
function shippedPublicBuildAsset(request, response) {
  const control = (response.headers.get("cache-control") || "").trim().toLowerCase();
  if (control !== "no-store" && control !== "no-cache") return false;
  if (!response.ok || response.headers.has("set-cookie")) return false;
  if (/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(response.headers.get("vary") || "")) return false;
  const contentType = response.headers.get("content-type") || "";
  const pathname = new URL(request.url).pathname;
  return SHIPPED_CHUNKS.some((path) => {
    if (!/^\.\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(path)) return false;
    if (new URL(path, self.registration.scope).pathname !== pathname) return false;
    return path.endsWith(".css") ? /^text\/css(?:;|$)/i.test(contentType)
      : /^(?:text|application)\/javascript(?:;|$)/i.test(contentType);
  });
}

function cacheResponse(event, key, response) {
  if (!cacheablePublicResponse(response) && !shippedPublicBuildAsset(event.request, response)) return;
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
    if (!cacheablePublicResponse(response) && !pinnedPublicBuildAsset(request, response)
      && !shippedPublicBuildAsset(request, response)) continue;
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
  // Authorization-bearing requests must never share the origin-wide shell cache.
  if (request.headers?.has?.("authorization") || request.cache === "no-store") return;
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
