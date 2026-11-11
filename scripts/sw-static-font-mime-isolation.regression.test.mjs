import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Browser Response.url survives a CacheStorage round trip. The Node Response
// constructor does not set it; preserve final-URL provenance in this fixture.
function atUrl(response, url) {
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => atUrl(clone(), url);
  return response;
}

function response(body, mime, url = 'https://app.test/fonts/axom-ui.woff2') {
  return atUrl(new Response(body, {
    headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
  }), url);
}

function worker({ network = async () => { throw new Error('offline'); } } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const absolute = (entry) => new URL(
    typeof entry === 'string' ? entry : entry.url, 'https://app.test/').href;
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const items = stores.get(name);
      return {
        match: async (key) => items.get(absolute(key))?.clone(),
        put: async (key, value) => { items.set(absolute(key), value.clone()); },
        delete: async (key) => items.delete(absolute(key)),
        addAll: async () => {},
      };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    registration: { scope: 'https://app.test/' },
    clients: { matchAll: async () => [] },
    addEventListener: (type, callback) => handlers.set(type, callback),
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'r47');
  vm.runInNewContext(source, {
    self, caches, URL, Response,
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      return atUrl(await network(url), url);
    },
  });

  const read = async (path = '/fonts/axom-ui.woff2') => {
    let pending;
    const lifetime = [];
    handlers.get('fetch')({
      request: {
        url: absolute(path), method: 'GET', mode: 'same-origin',
        cache: 'default', headers: new Headers(),
      },
      respondWith: (value) => { pending = value; },
      waitUntil: (value) => { lifetime.push(value); },
    });
    assert.ok(pending, 'service worker must intercept shipped public font URL');
    const result = await pending;
    await Promise.all(lifetime);
    return result;
  };
  return { caches, read };
}

test('cached public WOFF2 URL cannot replay synthetic JSON and is evicted', async () => {
  const app = worker();
  const current = await app.caches.open('axom-shell-r47');
  const unrelated = await app.caches.open('another-app');
  await unrelated.put('/keep', new Response('unrelated'));
  await current.put('/fonts/axom-ui.woff2',
    response('SYNTHETIC_OTHER_ACCOUNT_JSON', 'application/json'));

  const result = await app.read();
  assert.equal(result.status, 0, 'offline font fallback must reject JSON, not return HTTP 200');
  assert.equal(await current.match('/fonts/axom-ui.woff2'), undefined,
    'remove only poisoned font entry');
  assert.equal(await (await unrelated.match('/keep')).text(), 'unrelated',
    'other products caches must remain intact');
});

test('online JSON response from public WOFF2 URL is not persisted', async () => {
  const app = worker({
    network: async () => new Response('SYNTHETIC_OTHER_ACCOUNT_JSON', {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
    }),
  });

  const online = await app.read();
  assert.equal(online.status, 200, 'browser owns the direct network response');
  assert.equal(await (await app.caches.open('axom-shell-r47'))
    .match('/fonts/axom-ui.woff2'), undefined,
    'never persist JSON bytes in the origin-wide application shell cache');
});

test('obsolete generation JSON font is evicted even when current font is valid', async () => {
  const app = worker();
  const old = await app.caches.open('axom-shell-older');
  const current = await app.caches.open('axom-shell-r47');
  await old.put('/fonts/axom-ui.woff2',
    response('SYNTHETIC_OTHER_ACCOUNT_JSON', 'application/json'));
  await current.put('/fonts/axom-ui.woff2',
    response('SYNTHETIC_VALID_FONT', 'font/woff2'));

  const result = await app.read();
  assert.equal(await result.text(), 'SYNTHETIC_VALID_FONT',
    'current genuine public asset takes precedence');
  assert.equal(await old.match('/fonts/axom-ui.woff2'), undefined,
    'retired font cache cannot retain mismatched JSON indefinitely');
});

test('genuine public WOFF2 remains available offline across reads', async () => {
  let online = true;
  const app = worker({
    network: async () => {
      if (!online) throw new Error('offline');
      return new Response('SYNTHETIC_VALID_FONT', {
        headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=600' },
      });
    },
  });

  assert.equal(await (await app.read()).text(), 'SYNTHETIC_VALID_FONT');
  online = false;
  assert.equal(await (await app.read()).text(), 'SYNTHETIC_VALID_FONT',
    'offline font loading must survive the privacy guard');
});
