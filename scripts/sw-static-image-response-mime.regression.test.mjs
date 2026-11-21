import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Browser-fetched responses have a final URL. Node's synthetic Response does
// not; preserve it through clones to exercise the real worker's provenance gate.
function atNetworkUrl(response, url) {
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => atNetworkUrl(clone(), url);
  return response;
}

function responseWithMime(body, mime, url = 'https://app.test/landing/hero.png') {
  return atNetworkUrl(new Response(body, {
    headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
  }), url);
}

function harness({ network = async () => { throw new Error('offline'); } } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const absolute = (input) => new URL(typeof input === 'string' ? input : input.url, 'https://app.test/').href;
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (key) => entries.get(absolute(key))?.clone(),
        put: async (key, value) => { entries.set(absolute(key), value.clone()); },
        delete: async (key) => entries.delete(absolute(key)),
        addAll: async () => {},
      };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    registration: { scope: 'https://app.test/' },
    clients: { matchAll: async () => [] },
    addEventListener: (type, fn) => { handlers.set(type, fn); },
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'r46');
  vm.runInNewContext(source, {
    self, caches, URL, Response,
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      const response = await network(url);
      return atNetworkUrl(response, url);
    },
  });

  const read = async (path = '/landing/hero.png') => {
    let response;
    const lifetime = [];
    handlers.get('fetch')({
      request: {
        url: absolute(path), method: 'GET', mode: 'same-origin',
        cache: 'default', headers: new Headers(),
      },
      respondWith: (value) => { response = value; },
      waitUntil: (value) => { lifetime.push(value); },
    });
    assert.ok(response, 'worker must handle shipped public image path');
    const result = await response;
    await Promise.all(lifetime);
    return result;
  };
  return { caches, read };
}

test('cached JSON at public PNG path is rejected and evicted offline', async () => {
  const app = harness();
  const current = await app.caches.open('axom-shell-r46');
  const unrelated = await app.caches.open('unrelated-app');
  await unrelated.put('/keep', new Response('untouched'));
  await current.put('/landing/hero.png', responseWithMime(
    'SYNTHETIC_ACCOUNT_DATA_JSON', 'application/json'));

  const result = await app.read();
  assert.equal(result.status, 0, 'a cached JSON response must not masquerade as offline PNG');
  assert.equal(await current.match('/landing/hero.png'), undefined,
    'evict invalid image MIME from the shell cache');
  assert.equal(await (await unrelated.match('/keep')).text(), 'untouched',
    'never alter unrelated app caches');
});

test('public-marked JSON returned at shipped PNG URL is not stored in shared cache', async () => {
  const app = harness({
    network: async () => new Response('SYNTHETIC_ACCOUNT_DATA_JSON', {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
    }),
  });
  const online = await app.read();
  assert.equal(online.status, 200, 'network result remains owned by the browser');
  assert.equal(await (await app.caches.open('axom-shell-r46')).match('/landing/hero.png'),
    undefined, 'never retain mismatched JSON bytes across sessions');
});

test('genuine public PNG remains cached for offline use; unrelated caches survive', async () => {
  let online = true;
  const app = harness({
    network: async () => {
      if (!online) throw new Error('offline');
      return new Response('SYNTHETIC_VALID_PNG_BYTES', {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
      });
    },
  });
  const unrelated = await app.caches.open('other-product');
  await unrelated.put('/keep', new Response('do-not-touch'));
  assert.equal(await (await app.read()).text(), 'SYNTHETIC_VALID_PNG_BYTES');
  online = false;
  assert.equal(await (await app.read()).text(), 'SYNTHETIC_VALID_PNG_BYTES');
  assert.equal(await (await unrelated.match('/keep')).text(), 'do-not-touch');
});
