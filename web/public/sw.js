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
// A later worker cannot infer a predecessor's immutable chunk identities from
// its own manifest. Bind those identities to the cache generation at install.
const RETAINED_MANIFEST_KEY = "./__axom-retained-public-chunks.json";
const immutableChunkPath = (path) => typeof path === "string"
  && /^\.\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(path);
const RETAINED_CHUNKS = [...new Set([...PRECACHE, ...SHIPPED_CHUNKS].filter(immutableChunkPath))];

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

// Retained no-store/no-cache code may be replayed only with its own
// build's recorded identity, strict MIME/header checks and original URL.
// Caches predating the manifest deliberately fail closed.
async function retainedGenerationAsset(cache, request, response) {
  if (!matchesRequestedResource(request, response) || response.headers.has("set-cookie")) return false;
  const control = (response.headers.get("cache-control") || "").trim().toLowerCase();
  if (control !== "no-store" && control !== "no-cache") return false;
  if (/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(response.headers.get("vary") || "")) return false;
  const pathname = new URL(request.url).pathname;
  const mime = (response.headers.get("content-type") || "").trim();
  try {
    const stored = await cache.match(RETAINED_MANIFEST_KEY);
    if (!stored || !stored.ok || !/^application\/json(?:;|$)/i.test(stored.headers.get("content-type") || "")) return false;
    const manifest = await stored.json();
    if (manifest?.version !== 1 || !Array.isArray(manifest.chunks) || manifest.chunks.length > 4096) return false;
    return manifest.chunks.some((path) => immutableChunkPath(path)
      && new URL(path, self.registration.scope).pathname === pathname
      && (path.endsWith(".css") ? /^text\/css(?:;|$)/i.test(mime)
        : /^(?:text|application)\/javascript(?:;|$)/i.test(mime)));
  } catch {
    return false;
  }
}

// HTML MIME types are ASCII case-insensitive. An HTML deployment rewrite
// must never be treated as JavaScript/CSS/media, even with mixed-case headers.
// Do not persist or replay non-HTML rewrites as scripts or styles.
// The browser refuses those MIME types, but an offline cache would pin them.
function matchesPublicCodeMime(request, response) {
  const pathname = new URL(request.url).pathname;
  const mime = (response.headers.get("content-type") || "").trim();
  if (/\.m?js$/i.test(pathname)) return /^(?:text|application)\/javascript(?:\s*;|$)/i.test(mime);
  if (/\.css$/i.test(pathname)) return /^text\/css(?:\s*;|$)/i.test(mime);
  // The origin-wide cache must never retain or replay JSON/HTML (including
  // rewritten SPA responses) at public image URLs. Verify actual image MIME;
  // the path and a public Cache-Control header alone are not sufficient.
  if (/\.png$/i.test(pathname)) return /^image\/png(?:\s*;|$)/i.test(mime);
  if (/\.jpe?g$/i.test(pathname)) return /^image\/jpeg(?:\s*;|$)/i.test(mime);
  if (/\.webp$/i.test(pathname)) return /^image\/webp(?:\s*;|$)/i.test(mime);
  if (/\.svg$/i.test(pathname)) return /^image\/svg\+xml(?:\s*;|$)/i.test(mime);
  if (/\.ico$/i.test(pathname)) return /^image\/(?:x-icon|vnd\.microsoft\.icon)(?:\s*;|$)/i.test(mime);
  return true;
}

function isHtmlResponse(response) {
  return /^text\/html(?:\s*;|$)/i.test((response.headers.get("content-type") || "").trim());
}

// Offline navigation must not replay account-specific, malformed or foreign
// HTML from a legacy/current shell cache. Cached browser fetches retain URL.
function cacheableCanonicalOfflineShell(response) {
  if (cacheablePublicResponse(response)) return true;
  // Production's canonical index.html is marked no-cache: retain this public
  // shell for offline startup without permitting private/no-store/auth data.
  // safeOfflineShell() independently checks exact canonical URL and HTML MIME.
  return (response.headers.get("cache-control") || "").trim().toLowerCase() === "no-cache"
    && !response.headers.has("set-cookie")
    && !/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(response.headers.get("vary") || "");
}

function safeOfflineShell(response) {
  if (!response?.ok || response.status !== 200 || response.redirected
    || !isHtmlResponse(response) || !cacheableCanonicalOfflineShell(response)) return false;
  try {
    const scope = new URL(self.registration.scope);
    const finalUrl = new URL(response.url);
    // Only the shipped SPA entrypoints may provide an offline shell. Deep
    // navigation (including future account-specific routes) renders online,
    // but must never replace the shared offline index.html cache entry.
    return finalUrl.origin === scope.origin && !finalUrl.search
      && (finalUrl.pathname === scope.pathname
        || finalUrl.pathname === new URL("./index.html", scope).pathname);
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
  // A quota-limited metadata write must not prevent a valid update installing.
  await cache.put(RETAINED_MANIFEST_KEY,
    new Response(JSON.stringify({ version: 1, chunks: RETAINED_CHUNKS }), {
      headers: { "content-type": "application/json" },
    })).catch(() => {});
  for (const { path, response } of validated) await cache.put(path, response);
}

function cacheResponse(event, key, response) {
  if (!matchesRequestedResource(event.request, response) || !matchesPublicCodeMime(event.request, response)) return;
  // The no-cache exception applies only to a verified canonical navigation
  // shell, never other routes or public-looking JS/CSS/media responses.
  const canonicalNavigationShell = key === "./index.html"
    && event.request.mode === "navigate" && safeOfflineShell(response);
  if (!cacheablePublicResponse(response) && !shippedPublicBuildAsset(event.request, response)
    && !canonicalNavigationShell) return;
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
    if (!matchesPublicCodeMime(request, response)) {
      // Evict only invalid code bytes retained by an older worker.
      await cache.delete(request);
      continue;
    }
    if (!cacheablePublicResponse(response) && !pinnedPublicBuildAsset(request, response)
      && !shippedPublicBuildAsset(request, response)
      && !(name !== CACHE && await retainedGenerationAsset(cache, request, response))) continue;
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
          // Deep SPA routes may render successfully, but are not canonical
          // public shell resources and must not overwrite offline index.html.
          if (safeOfflineShell(response)) cacheResponse(event, "./index.html", response);
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
