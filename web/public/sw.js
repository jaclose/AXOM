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
// Browser-fetched responses carry a final URL. A manifest-listed request must
// never authorize a redirected response or bytes from another asset/origin.
// Ignore the query: asset fetches add __axom_revalidate for stale-host recovery.
function matchesRequestedResource(request, response) {
  if (response.redirected || response.status !== 200 || !response.url) return false;
  try {
    const requested = new URL(request.url);
    const resolved = new URL(response.url);
    return requested.origin === resolved.origin && requested.pathname === resolved.pathname;
  } catch {
    return false;
  }
}

function pinnedPublicBuildAsset(request, response) {
  // Earlier precache entries are preserved across upgrades. A synthetic cache
  // fixture may have no response URL, but known redirects are never trusted.
  if (response.redirected || response.status !== 200 || (response.url && !matchesRequestedResource(request, response))) return false;
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
  if (!matchesRequestedResource(request, response)) return false;
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

// HTML MIME types are ASCII case-insensitive. An HTML deployment rewrite
// must never be treated as JavaScript/CSS/media, even with mixed-case headers.
function isHtmlResponse(response) {
  return /^text\/html(?:\s*;|$)/i.test((response.headers.get("content-type") || "").trim());
}

// Offline navigation must not replay account-specific, malformed or foreign
// HTML from a legacy/current shell cache. Cached browser fetches retain URL.
function safeOfflineShell(response) {
  if (!response?.ok || response.status !== 200 || response.redirected
    || !isHtmlResponse(response) || !cacheablePublicResponse(response)) return false;
  try {
    const scope = new URL(self.registration.scope);
    const finalUrl = new URL(response.url);
    return finalUrl.origin === scope.origin && finalUrl.pathname.startsWith(scope.pathname);
  } catch {
    return false;
  }
}

async function offlineShell() {
  const cache = await caches.open(CACHE);
  const response = await cache.match("./index.html");
  if (!response) return undefined;
  if (safeOfflineShell(response)) return response;
  // Delete only the invalid shell entry; never clear older build or learner data.
  await cache.delete("./index.html");
  return undefined;
}

async function installPublicShell() {
  const routes = ["./", "./index.html"];
  // Validate both navigation entrypoints before writing either response.
  const validated = await Promise.all(routes.map(async (path) => {
    const response = await fetch(new URL(path, self.registration.scope).href, { cache: "no-store" });
    if (!safeOfflineShell(response)) throw new Error(`Unsafe offline shell: ${path}`);
    return { path, response };
  }));
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE.filter((path) => !routes.includes(path)));
  for (const { path, response } of validated) await cache.put(path, response);
}

function cacheResponse(event, key, response) {
  if (!matchesRequestedResource(event.request, response)) return;
  if (!cacheablePublicResponse(response) && !shippedPublicBuildAsset(event.request, response)) return;
  const copy = response.clone();
  // A failed cache write must not turn a successful network response into a failed request.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {}));
}

async function cachedAppAsset(request) {
  // Inspect retained generations in creation order, then the current build.
  // The last valid matching asset wins, while stale HTML rewrites in older
  // caches are still evicted even when the current cache has a valid copy.
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  const ordered = [...names.filter((name) => name !== CACHE), CACHE];
  let preferred;
  for (const name of ordered) {
    const cache = await caches.open(name);
    const response = await cache.match(request);
    if (!response) continue;
    // Legacy synthetic cache fixtures can omit URL; browser-fetched entries
    // have it and must match their original origin/path before replay.
    if (response.redirected || response.status !== 200 || (response.url && !matchesRequestedResource(request, response))) continue;
    if (!cacheablePublicResponse(response) && !pinnedPublicBuildAsset(request, response)
      && !shippedPublicBuildAsset(request, response)) continue;
    if (isHtmlResponse(response)) {
      // A host rewrite may have cached HTML at a hashed asset URL in an older shell.
      await cache.delete(request);
      continue;
    }
    preferred = response;
  }
  return preferred;
}

self.addEventListener("install", (event) => {
  event.waitUntil(installPublicShell());
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
        if (response.ok && isHtmlResponse(response)) {
          cacheResponse(event, "./index.html", response);
          return response;
        }
        return (await offlineShell().catch(() => undefined)) || response;
      } catch {
        return (await offlineShell().catch(() => undefined)) || Response.error();
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
    const isHtml = isHtmlResponse(response);
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
