import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker() {
  const events = new Map();
  const stores = new Map();
  let activations = 0;
  const absolute = (key) => new URL(typeof key === 'string' ? key : key.url, 'https://app.test/').href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        addAll: async (keys) => { assert.equal(new Set(keys).size, keys.length); },
        match: async (key) => values.get(absolute(key))?.clone(),
        put: async (key, value) => values.set(absolute(key), value.clone()),
      };
    },
    match: async (key) => { for (const store of stores.values()) if (store.has(absolute(key))) return store.get(absolute(key)).clone(); },
  };
  const context = {
    self: { location: { origin: 'https://app.test' }, clients: { matchAll: async () => [] }, addEventListener: (name, fn) => events.set(name, fn), skipWaiting: async () => { activations++; } },
    caches, URL, Response, fetch: async () => { throw new Error('offline'); },
  };
  vm.runInNewContext(readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8').replaceAll('__AXOM_BUILD_ID__', 'current'), context);
  return { events, caches, context, activations: () => activations };
}

test('worker stages an update without forcing activation; only consent activates', async () => {
  const app = worker();
  let task;
  app.events.get('install')({ waitUntil: (value) => { task = value; } });
  await task;
  assert.equal(app.activations(), 0);
  app.events.get('message')({ data: { type: 'AXOM_ACTIVATE_UPDATE' }, waitUntil: (value) => { task = value; } });
  await task;
  assert.equal(app.activations(), 1);
});

test('offline navigation uses current shell rather than older retained shell', async () => {
  const app = worker();
  await (await app.caches.open('axom-shell-old')).put('./index.html', new Response('old'));
  await (await app.caches.open('axom-shell-current')).put('./index.html', new Response('current'));
  let response;
  app.events.get('fetch')({ request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' }, respondWith: (value) => { response = value; } });
  assert.equal(await (await response).text(), 'current');
});

test('version and API requests bypass caches; missing JS never returns HTML', async () => {
  const app = worker();
  for (const path of ['/version.json?t=1', '/api/data/me']) {
    app.events.get('fetch')({ request: { url: `https://app.test${path}`, method: 'GET' }, respondWith: () => assert.fail('private or update response was intercepted') });
  }
  let response;
  app.events.get('fetch')({ request: { url: 'https://app.test/assets/missing.js', method: 'GET' }, respondWith: (value) => { response = value; } });
  await assert.rejects(response, /offline/);
});

test('activation preserves other application caches and old clients', async () => {
  const app = worker();
  for (const name of ['other-app', 'axom-shell-oldest', 'axom-shell-previous', 'axom-shell-current']) await app.caches.open(name);
  let task;
  app.context.self.clients.matchAll = async () => [{}, {}];
  app.events.get('activate')({ waitUntil: (value) => { task = value; } });
  await task;
  assert.equal((await app.caches.keys()).length, 4);
  app.context.self.clients.matchAll = async () => [{}];
  app.events.get('activate')({ waitUntil: (value) => { task = value; } });
  await task;
  assert.deepEqual(await app.caches.keys(), ['other-app', 'axom-shell-previous', 'axom-shell-current']);
});
