import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Synthetic public assets only. This exercises the actual worker, not real auth.
const ORIGIN = 'https://app.test/';
const IMAGE = '/landing/hero.png';
const BUILD = 'encoded-public-version-r55';

function withFinalUrl(response, url) {
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => withFinalUrl(clone(), url);
  return response;
}

function publicPng(url) {
  return withFinalUrl(new Response('SYNTHETIC_PUBLIC_PNG_BYTES', {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=600',
    },
  }), url);
}

function worker() {
  const listeners = new Map();
  const stores = new Map();
  let offline = false;
  let networkCalls = 0;
  const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (request) => entries.get(keyOf(request))?.clone(),
        put: async (request, response) => { entries.set(keyOf(request), response.clone()); },
        delete: async (request) => entries.delete(keyOf(request)),
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
    .replaceAll('__AXOM_BUILD_ID__', BUILD);
  vm.runInNewContext(source, {
    URL, Response, self, caches,
    fetch: async (input) => {
      networkCalls++;
      if (offline) throw new Error('synthetic offline');
      // The real worker sets __axom_revalidate using URLSearchParams.set,
      // which canonicalizes permitted percent-encoded values in the final URL.
      return publicPng(keyOf(input));
    },
  });

  async function read(path) {
    let responsePromise;
    const pending = [];
    listeners.get('fetch')({
      request: {
        url: keyOf(path), method: 'GET', mode: 'same-origin',
        headers: new Headers(), cache: 'default',
      },
      respondWith: (promise) => { responsePromise = promise; },
      waitUntil: (promise) => { pending.push(promise); },
    });
    if (!responsePromise) return { intercepted: false };
    try {
      return { intercepted: true, response: await responsePromise };
    } finally {
      await Promise.allSettled(pending);
    }
  }

  return {
    read,
    cache: (name) => caches.open(name),
    goOffline: () => { offline = true; },
    networkCalls: () => networkCalls,
  };
}

async function requireOfflineRoundTrip(path) {
  const app = worker();
  const online = await app.read(path);
  assert.equal(online.intercepted, true, 'allowlisted public version must use worker');
  assert.equal(await online.response.text(), 'SYNTHETIC_PUBLIC_PNG_BYTES');
  const current = await app.cache(`axom-shell-${BUILD}`);
  assert.ok(await current.match(path), 'allowed public variant must be stored after online fetch');

  app.goOffline();
  const offline = await app.read(path);
  assert.equal(offline.intercepted, true);
  assert.equal(await offline.response.text(), 'SYNTHETIC_PUBLIC_PNG_BYTES',
    'same public build version must replay offline without a network round-trip');
  assert.equal(app.networkCalls(), 1, 'offline replay must not fetch');
}

test('percent-encoded build date is cached and replayed offline', async () => {
  await requireOfflineRoundTrip(IMAGE + '?v=build%2D20261111');
});

test('percent-encoded dotted semantic version is cached and replayed offline', async () => {
  await requireOfflineRoundTrip(IMAGE + '?v=1%2E2%2E3');
});

test('ordinary unencoded public build version remains cacheable', async () => {
  await requireOfflineRoundTrip(IMAGE + '?v=build-20261111');
});

test('credential and unknown query fields bypass the shared service-worker cache', async () => {
  const app = worker();
  for (const path of [
    IMAGE + '?access_token=SYNTHETIC_A_ONLY',
    IMAGE + '?v=build-20261111&signature=SYNTHETIC_A_ONLY',
    IMAGE + '?v=build-20261111&__axom_revalidate=123',
  ]) {
    assert.equal((await app.read(path)).intercepted, false, path);
  }
  assert.equal(app.networkCalls(), 0);
});

test('wrong public build version in legacy final URL is evicted instead of replayed', async () => {
  const app = worker();
  const older = await app.cache('axom-shell-legacy');
  const request = IMAGE + '?v=build-20261111';
  await older.put(request, publicPng(new URL(IMAGE + '?v=build-20261109&__axom_revalidate=123', ORIGIN).href));
  app.goOffline();
  await assert.rejects(app.read(request), /synthetic offline/);
  assert.equal(await older.match(request), undefined, 'reject the foreign version entry');
});

test('malformed legacy revalidation query does not make cached image bytes public', async () => {
  const app = worker();
  const older = await app.cache('axom-shell-legacy');
  const request = IMAGE + '?v=build-20261111';
  await older.put(request, publicPng(new URL(IMAGE + '?v=build-20261111&__axom_revalidate=bad', ORIGIN).href));
  app.goOffline();
  await assert.rejects(app.read(request), /synthetic offline/);
  assert.equal(await older.match(request), undefined);
});

test('encoded version replay prefers current public bytes over poisoned legacy A final URL after A→B', async () => {
  const app = worker();
  const key = IMAGE + '?v=build%2D20261111';
  const old = await app.cache('axom-shell-legacy');
  const current = await app.cache(`axom-shell-${BUILD}`);
  const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' };
  // An old shared cache can contain a clean key with a signed final URL.
  // Account B must never inherit these synthetic account-A bytes.
  await old.put(key, withFinalUrl(
    new Response('SYNTHETIC_A_PRIVATE_IMAGE', { headers }),
    new URL(IMAGE + '?v=build-20261111&access_token=SYNTHETIC_A_ONLY', ORIGIN).href,
  ));
  await current.put(key, withFinalUrl(
    new Response('SYNTHETIC_CURRENT_PUBLIC_IMAGE', { headers }),
    new URL(IMAGE + '?v=build-20261111&__axom_revalidate=123', ORIGIN).href,
  ));
  app.goOffline();
  const result = await app.read(key);
  assert.equal(result.intercepted, true);
  assert.equal(await result.response.text(), 'SYNTHETIC_CURRENT_PUBLIC_IMAGE');
  assert.equal(await old.match(key), undefined, 'evict only the tainted legacy entry');
  assert.ok(await current.match(key), 'preserve the valid current build entry');
  assert.equal(app.networkCalls(), 0);
});
