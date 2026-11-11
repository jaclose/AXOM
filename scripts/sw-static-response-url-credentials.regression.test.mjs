import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Account A/B names and image bytes are synthetic. This tests legacy CacheStorage
// response provenance, not live authentication or unauthorized production data.
const ORIGIN = 'https://app.test/';
const IMAGE = '/landing/hero.png';
const BUILD_VERSION = '?v=build-20261111';

function atUrl(response, finalUrl) {
  // Fetch Response.url survives CacheStorage round-trips in Chromium; Node's
  // constructed Response has an empty URL unless the fixture supplies it.
  Object.defineProperty(response, 'url', { value: finalUrl, configurable: true });
  const originalClone = response.clone.bind(response);
  response.clone = () => atUrl(originalClone(), finalUrl);
  return response;
}

function publicImage(bytes, finalUrl) {
  return atUrl(new Response(bytes, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
  }), new URL(finalUrl, ORIGIN).href);
}

function worker() {
  const listeners = new Map();
  const stores = new Map();
  const keyOf = (value) => new URL(typeof value === 'string' ? value : value.url, ORIGIN).href;
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (key) => entries.get(keyOf(key))?.clone(),
        put: async (key, response) => { entries.set(keyOf(key), response.clone()); },
        delete: async (key) => entries.delete(keyOf(key)),
      };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    registration: { scope: ORIGIN },
    clients: { matchAll: async () => [] },
    addEventListener: (type, handler) => listeners.set(type, handler),
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'response-url-r54');
  vm.runInNewContext(source, {
    URL, Response, self, caches,
    fetch: async () => { throw new Error('synthetic offline'); },
  });

  async function read(path) {
    let result;
    const pending = [];
    listeners.get('fetch')({
      request: {
        url: keyOf(path), method: 'GET', mode: 'same-origin',
        headers: new Headers(), cache: 'default',
      },
      respondWith: (promise) => { result = promise; },
      waitUntil: (promise) => { pending.push(promise); },
    });
    assert.ok(result, 'public image should be handled by the worker');
    try {
      return await result;
    } finally {
      await Promise.allSettled(pending);
    }
  }
  return { cache: (name) => caches.open(name), read };
}

test('legacy cache must not replay account-A final URL with a credential after simulated A→B', async () => {
  const app = worker();
  const legacy = await app.cache('axom-shell-legacy');
  const signedFinalUrl = IMAGE + '?access_token=SYNTHETIC_ACCOUNT_A_ONLY';
  // Earlier workers can have a clean cache key but a response fetched at
  // a different final URL. A current clean request must not authorize it.
  await legacy.put(IMAGE, publicImage('SYNTHETIC_ACCOUNT_A_BYTES', signedFinalUrl));

  await assert.rejects(app.read(IMAGE), /synthetic offline/,
    'account B must not receive account A response through shared legacy cache');
  assert.equal(await legacy.match(IMAGE), undefined,
    'invalidate the poisoned legacy entry without clearing unrelated caches');
});

test('cached response from a different public version cannot replace current build', async () => {
  const app = worker();
  const legacy = await app.cache('axom-shell-legacy');
  await legacy.put(IMAGE + BUILD_VERSION,
    publicImage('SYNTHETIC_OLD_BUILD_BYTES',
      IMAGE + '?v=build-20261109&__axom_revalidate=123'));

  await assert.rejects(app.read(IMAGE + BUILD_VERSION), /synthetic offline/,
    'a current public version cannot accept an older final-version response');
  assert.equal(await legacy.match(IMAGE + BUILD_VERSION), undefined);
});

test('worker-generated revalidation parameter is permitted for matching public version', async () => {
  const app = worker();
  const legacy = await app.cache('axom-shell-legacy');
  await legacy.put(IMAGE + BUILD_VERSION,
    publicImage('SYNTHETIC_VALID_BUILD_BYTES',
      IMAGE + BUILD_VERSION + '&__axom_revalidate=123'));

  const response = await app.read(IMAGE + BUILD_VERSION);
  assert.equal(await response.text(), 'SYNTHETIC_VALID_BUILD_BYTES');
  assert.ok(await legacy.match(IMAGE + BUILD_VERSION),
    'legitimate offline build-version cache remains intact');
});

test('canonical public image response remains available offline', async () => {
  const app = worker();
  const current = await app.cache('axom-shell-response-url-r54');
  await current.put(IMAGE, publicImage('SYNTHETIC_PUBLIC_IMAGE_BYTES', IMAGE));

  const response = await app.read(IMAGE);
  assert.equal(await response.text(), 'SYNTHETIC_PUBLIC_IMAGE_BYTES');
});
