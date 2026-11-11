import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Synthetic fixtures only. A credentials-looking URL is not itself proof of
// unauthorized production content, but must not enter a shared shell cache.
const ORIGIN = 'https://app.test/';
const IMAGE = '/landing/hero.png';
const SENSITIVE = IMAGE + '?access_token=SYNTHETIC_A_ONLY_CANARY';
const VERSIONED = IMAGE + '?v=build-20261111';

function atUrl(response, url) {
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => atUrl(clone(), url);
  return response;
}

function harness() {
  const handlers = new Map();
  const stores = new Map();
  let online = true;
  let networkReads = 0;
  const absolute = (input) => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
  const caches = {
    keys: async () => Array.from(stores.keys()),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (key) => entries.get(absolute(key))?.clone(),
        put: async (key, value) => { entries.set(absolute(key), value.clone()); },
        delete: async (key) => entries.delete(absolute(key)),
      };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    registration: { scope: ORIGIN },
    clients: { matchAll: async () => [] },
    addEventListener: (type, fn) => handlers.set(type, fn),
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'r49');
  vm.runInNewContext(source, {
    URL, Response, self, caches,
    fetch: async (input) => {
      networkReads++;
      if (!online) throw new Error('simulated offline');
      const url = absolute(input);
      const body = url.includes('SYNTHETIC_A_ONLY_CANARY')
        ? 'SYNTHETIC_A_ONLY_IMAGE_BYTES'
        : 'SAFE_PUBLIC_IMAGE_BYTES';
      return atUrl(new Response(body, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
      }), url);
    },
  });
  const read = async (path, headers = new Headers()) => {
    let promised;
    const lifetime = [];
    handlers.get('fetch')({
      request: { url: absolute(path), method: 'GET', mode: 'same-origin', headers, cache: 'default' },
      respondWith: (p) => { promised = p; },
      waitUntil: (p) => { lifetime.push(p); },
    });
    if (!promised) return { intercepted: false };
    try {
      const response = await promised;
      await Promise.all(lifetime);
      return { intercepted: true, response };
    } catch (error) {
      await Promise.allSettled(lifetime);
      return { intercepted: true, error };
    }
  };
  return {
    read,
    offline: () => { online = false; },
    networkReads: () => networkReads,
    cache: async () => caches.open('axom-shell-r49'),
  };
}

test('credential-bearing public image URL never persists synthetic account-A bytes', async () => {
  const app = harness();
  const first = await app.read(SENSITIVE);
  assert.ok(!first.intercepted || first.response?.status === 200,
    'the first network fetch may be browser-owned or worker-owned');
  assert.equal(await (await app.cache()).match(SENSITIVE), undefined,
    'query-borne access_token must not remain in origin-wide CacheStorage');
});

test('after account switch, offline public image lookup cannot replay A-only signed URL', async () => {
  const app = harness();
  await app.read(SENSITIVE); // Simulated session A's initial request.
  app.offline(); // Simulated session B's attempt with the same stale URL.
  const second = await app.read(SENSITIVE);
  assert.ok(!second.intercepted || !second.response || second.response.status !== 200,
    'a signed URL associated with A must never replay stored A bytes to B');
});

test('ordinary cache-busting version query still serves same build asset offline', async () => {
  const app = harness();
  const first = await app.read(VERSIONED);
  assert.equal(first.intercepted, true, 'normal public version query remains handled');
  assert.equal(await first.response.text(), 'SAFE_PUBLIC_IMAGE_BYTES');
  app.offline();
  const second = await app.read(VERSIONED);
  assert.equal(second.intercepted, true, 'versioned public asset retains offline support');
  assert.equal(await second.response.text(), 'SAFE_PUBLIC_IMAGE_BYTES');
  assert.equal(app.networkReads(), 1, 'offline read uses validated existing cache');
});

test('explicit authorization header continues bypassing shared asset handling', async () => {
  const app = harness();
  const result = await app.read(IMAGE, new Headers({ authorization: 'Bearer SYNTHETIC_ONLY' }));
  assert.equal(result.intercepted, false);
  assert.equal(await (await app.cache()).match(IMAGE), undefined);
});
