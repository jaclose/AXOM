import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Synthetic HTTP/browser provenance. No live accounts, requests or personal data.
function networkResponse(body, finalUrl) {
  const response = new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0' },
  });
  Object.defineProperty(response, 'url', { value: finalUrl, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => networkClone(clone(), finalUrl);
  return response;
}

function networkClone(response, finalUrl) {
  Object.defineProperty(response, 'url', { value: finalUrl, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => networkClone(clone(), finalUrl);
  return response;
}

function navigationHarness() {
  const registrations = new Map();
  const stores = new Map();
  let online = true;
  const absolute = (path) => new URL(typeof path === 'string' ? path : path.url, 'https://app.test/').href;
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        addAll: async () => {},
        match: async (key) => map.get(absolute(key))?.clone(),
        put: async (key, response) => { map.set(absolute(key), response.clone()); },
        delete: async (key) => map.delete(absolute(key)),
      };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    registration: { scope: 'https://app.test/' },
    clients: { matchAll: async () => [] },
    addEventListener: (type, fn) => { registrations.set(type, fn); },
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'current');
  const fetch = async (request) => {
    if (!online) throw new Error('synthetic-offline');
    const url = typeof request === 'string' ? request : request.url;
    const pathname = new URL(url).pathname;
    const body = pathname === '/private/owner-workspace'
      ? 'SYNTHETIC_ACCOUNT_A_PRIVATE_NAVIGATION'
      : 'PUBLIC_AXOM_SHELL';
    return networkResponse(body, url);
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch });

  const navigate = async (path) => {
    let pending;
    const pendingLifetime = [];
    registrations.get('fetch')({
      request: { url: absolute(path), method: 'GET', mode: 'navigate' },
      respondWith: (value) => { pending = value; },
      waitUntil: (value) => { pendingLifetime.push(value); },
    });
    assert.ok(pending, 'navigator must be controlled by the real service worker');
    const response = await pending;
    await Promise.all(pendingLifetime);
    return response;
  };
  return {
    caches, navigate,
    setOffline: (value) => { online = !value; },
  };
}

test('canonical public HTML remains available after a legitimate navigation and reload offline', async () => {
  const app = navigationHarness();
  const response = await app.navigate('/index.html');
  assert.equal(await response.text(), 'PUBLIC_AXOM_SHELL');
  app.setOffline(true);
  const offline = await app.navigate('/');
  assert.equal(offline.status, 200);
  assert.equal(await offline.text(), 'PUBLIC_AXOM_SHELL');
});

test('a noncanonical private navigation cannot replace or replay the public offline shell even when mislabelled public', async () => {
  const app = navigationHarness();
  await app.navigate('/index.html');
  const otherCache = await app.caches.open('unrelated-application');
  await otherCache.put('/other', new Response('unrelated'));
  const online = await app.navigate('/private/owner-workspace');
  assert.equal(online.status, 200);
  assert.equal(await online.text(), 'SYNTHETIC_ACCOUNT_A_PRIVATE_NAVIGATION');

  const current = await app.caches.open('axom-shell-current');
  const cached = await current.match('./index.html');
  assert.ok(cached, 'the legitimate public shell must remain cached');
  assert.equal(await cached.text(), 'PUBLIC_AXOM_SHELL',
    'a noncanonical path must never overwrite the canonical offline shell');

  app.setOffline(true);
  const offline = await app.navigate('/');
  assert.equal(offline.status, 200);
  assert.equal(await offline.text(), 'PUBLIC_AXOM_SHELL',
    'an offline root navigation must never replay synthetic account A markup');
  assert.equal(await (await otherCache.match('/other')).text(), 'unrelated');
});

test('legacy cache entry from an in-scope private route is rejected on offline fallback even with public headers', async () => {
  const app = navigationHarness();
  const current = await app.caches.open('axom-shell-current');
  await current.put('./index.html', networkResponse('SYNTHETIC_ACCOUNT_A_LEGACY_CACHE',
    'https://app.test/private/owner-workspace'));
  const other = await app.caches.open('unrelated-application');
  await other.put('/other', new Response('safe-unrelated'));
  app.setOffline(true);
  const offline = await app.navigate('/');
  assert.equal(offline.status, 0, 'foreign-path cached HTML must fail closed, not return account-like markup');
  assert.equal(await current.match('./index.html'), undefined, 'evict only the invalid shell entry');
  assert.equal(await (await other.match('/other')).text(), 'safe-unrelated');
});
