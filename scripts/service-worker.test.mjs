import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic node:Response objects have no network URL. Mirror the browser's
// fetch/clone URL provenance so the worker can fail closed in production.
function withNetworkUrl(response, url) {
  if (response.url) return response;
  Object.defineProperty(response, 'url', { value: String(url), configurable: true });
  const clone = response.clone.bind(response);
  response.clone = () => withNetworkUrl(clone(), url);
  return response;
}

function worker({ failCacheMatch = false, failCachePut = false, scope = 'https://app.test/', precache = [], shippedChunks = [], fetchResponse = async () => { throw new Error('offline'); } } = {}) {
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
        delete: async (key) => values.delete(absolute(key)),
        put: async (key, value) => {
          if (failCachePut) throw new Error('cache quota exceeded');
          values.set(absolute(key), value.clone());
        },
      };
    },
    match: async (key) => {
      if (failCacheMatch) throw new Error('cache read failed');
      for (const store of stores.values()) if (store.has(absolute(key))) return store.get(absolute(key)).clone();
    },
  };
  const context = {
    self: { location: { origin: 'https://app.test' }, registration: { scope }, clients: { matchAll: async () => [] }, addEventListener: (name, fn) => events.set(name, fn), skipWaiting: async () => { activations++; } },
    caches, URL, Response, fetch: async (request, ...args) => withNetworkUrl(await fetchResponse(request, ...args), typeof request === 'string' ? request : request.url),
  };
  const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__AXOM_BUILD_ID__', 'current')
    .replace('const PRECACHE = []; // __AXOM_PRECACHE__', `const PRECACHE = ${JSON.stringify(precache)}; // __AXOM_PRECACHE__`)
    .replace('const SHIPPED_CHUNKS = []; // __AXOM_SHIPPED_CHUNKS__', `const SHIPPED_CHUNKS = ${JSON.stringify(shippedChunks)}; // __AXOM_SHIPPED_CHUNKS__`);
  vm.runInNewContext(source, context);
  return { events, caches, context, activations: () => activations };
}

test('worker stages an update without forcing activation; only consent activates', async () => {
  const app = worker({ fetchResponse: async () =>
    new Response('<!doctype html>public', { headers: { 'content-type': 'text/html' } }) });
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
  const shell = (text) => withNetworkUrl(new Response(text, {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
  }), 'https://app.test/index.html');
  await (await app.caches.open('axom-shell-old')).put('./index.html', shell('old'));
  await (await app.caches.open('axom-shell-current')).put('./index.html', shell('current'));
  let response;
  app.events.get('fetch')({ request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' }, respondWith: (value) => { response = value; } });
  assert.equal(await (await response).text(), 'current');
});

test('offline navigation rejects and evicts protected, malformed or foreign cached shells', async () => {
  const cases = [
    ['private no-store', { 'content-type': 'text/html', 'cache-control': 'private, no-store' }, 'https://app.test/index.html'],
    ['auth-vary', { 'content-type': 'text/html', vary: 'Accept-Encoding, Cookie' }, 'https://app.test/index.html'],
    ['non-html', { 'content-type': 'text/plain' }, 'https://app.test/index.html'],
    ['foreign origin', { 'content-type': 'text/html' }, 'https://elsewhere.test/index.html'],
  ];
  for (const [name, headers, url] of cases) {
    const app = worker();
    const cache = await app.caches.open('axom-shell-current');
    await cache.put('./index.html', withNetworkUrl(new Response('must-not-replay', { headers }), url));
    await app.caches.open('other-app');
    let pending;
    app.events.get('fetch')({
      request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' },
      respondWith: (value) => { pending = value; },
    });
    assert.equal((await pending).status, 0, name);
    assert.equal(await cache.match('./index.html'), undefined, `${name}: remove unsafe shell only`);
    assert.ok((await app.caches.keys()).includes('other-app'), 'preserve unrelated caches');
  }
});

test('offline navigation evicts public-marked shells fetched from noncanonical routes', async () => {
  for (const path of ['/private/owner-account', '/api/account', '/questions']) {
    const app = worker();
    const cache = await app.caches.open('axom-shell-current');
    await cache.put('./index.html', withNetworkUrl(new Response('misfiled-route-shell', {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
    }), 'https://app.test' + path));
    let pending;
    app.events.get('fetch')({
      request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' },
      respondWith: (value) => { pending = value; },
    });
    assert.equal((await pending).status, 0, path + ': never replay a noncanonical shell');
    assert.equal(await cache.match('./index.html'), undefined, path + ': evict only misfiled shell');
  }
});

test('online deep-route navigation cannot replace the canonical offline shell', async () => {
  const original = withNetworkUrl(new Response('canonical-shell', {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
  }), 'https://app.test/index.html');
  const app = worker({ fetchResponse: async () => new Response('route-html', {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
  }) });
  const cache = await app.caches.open('axom-shell-current');
  await cache.put('./index.html', original);
  for (const path of ['/private/owner-account', '/questions']) {
    let pending;
    const tasks = [];
    app.events.get('fetch')({
      request: { url: 'https://app.test' + path, method: 'GET', mode: 'navigate' },
      respondWith: (value) => { pending = value; },
      waitUntil: (value) => tasks.push(value),
    });
    assert.equal(await (await pending).text(), 'route-html', path + ': online route must render');
    await Promise.all(tasks);
    assert.equal(await (await cache.match('./index.html')).text(), 'canonical-shell',
      path + ': noncanonical navigation must not replace offline shell');
  }
});

test('install never stores protected shell and retains public HTML for offline use', async () => {
  for (const headers of [
    { 'content-type': 'text/html', 'cache-control': 'private, no-store' },
    { 'content-type': 'text/html', vary: 'Cookie' },
    { 'content-type': 'text/plain' },
  ]) {
    const app = worker({ fetchResponse: async () => new Response('unsafe-shell', { headers }) });
    let task;
    app.events.get('install')({ waitUntil: (value) => { task = value; } });
    await assert.rejects(task, /unsafe offline shell/i);
    const cache = await app.caches.open('axom-shell-current');
    assert.equal(await cache.match('./index.html'), undefined, 'install must not write the protected shell');
    assert.equal(await cache.match('./'), undefined, 'install must not write the protected navigation root');
  }
  const app = worker({ fetchResponse: async () =>
    new Response('<!doctype html>public-shell', { headers: { 'content-type': 'TEXT/HTML; charset=UTF-8', 'cache-control': 'public, max-age=0' } }) });
  let task;
  app.events.get('install')({ waitUntil: (value) => { task = value; } });
  await task;
  const cache = await app.caches.open('axom-shell-current');
  assert.equal(await (await cache.match('./index.html')).text(), '<!doctype html>public-shell');
  assert.equal(await (await cache.match('./')).text(), '<!doctype html>public-shell');
});

test('canonical production no-cache shell installs and reloads fully offline', async () => {
  // vercel.json and the build _headers both declare no-cache for /index.html.
  let online = true;
  const app = worker({ fetchResponse: async () => {
    if (!online) throw new Error('offline');
    return new Response('<!doctype html>production-shell', {
      headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-cache' },
    });
  } });
  let task;
  app.events.get('install')({ waitUntil: (value) => { task = value; } });
  await task;
  const cache = await app.caches.open('axom-shell-current');
  assert.equal(await (await cache.match('./index.html')).text(), '<!doctype html>production-shell');
  assert.equal(await (await cache.match('./')).text(), '<!doctype html>production-shell');
  online = false;
  let result;
  app.events.get('fetch')({
    request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' },
    respondWith: (value) => { result = value; },
  });
  assert.equal(await (await result).text(), '<!doctype html>production-shell');
});

test('no-cache canonical navigation refreshes offline shell, protected variants remain excluded', async () => {
  const app = worker({ fetchResponse: async () => new Response('updated-shell', {
    headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
  }) });
  const cache = await app.caches.open('axom-shell-current');
  await cache.put('./index.html', withNetworkUrl(new Response('old-shell', {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
  }), 'https://app.test/index.html'));
  let pending;
  const tasks = [];
  app.events.get('fetch')({
    request: { url: 'https://app.test/index.html', method: 'GET', mode: 'navigate' },
    respondWith: (value) => { pending = value; },
    waitUntil: (value) => tasks.push(value),
  });
  assert.equal(await (await pending).text(), 'updated-shell');
  await Promise.all(tasks);
  assert.equal(await (await cache.match('./index.html')).text(), 'updated-shell');

  for (const forbidden of [
    { 'cache-control': 'private, no-cache' },
    { 'cache-control': 'no-store, no-cache' },
    { 'cache-control': 'no-cache', vary: 'Cookie' },
    { 'cache-control': 'no-cache', vary: 'Authorization' },
    { 'cache-control': 'no-cache', 'set-cookie': 'sid=secret' },
  ]) {
    const protectedApp = worker({ fetchResponse: async () =>
      new Response('private', { headers: { 'content-type': 'text/html', ...forbidden } }) });
    let install;
    protectedApp.events.get('install')({ waitUntil: (value) => { install = value; } });
    await assert.rejects(install, /unsafe offline shell/i, JSON.stringify(forbidden));
    assert.equal(await (await protectedApp.caches.open('axom-shell-current')).match('./index.html'),
      undefined, JSON.stringify(forbidden));
  }
});

test('current public assets win over retained generations; newest safe fallback survives offline', async () => {
  const app = worker();
  const oldest = await app.caches.open('axom-shell-oldest');
  const previous = await app.caches.open('axom-shell-previous');
  const current = await app.caches.open('axom-shell-current');
  const image = (text) => new Response(text, { headers: { 'content-type': 'image/png' } });
  await oldest.put('/icon-192.png', image('oldest-icon'));
  await previous.put('/icon-192.png', image('previous-icon'));
  await current.put('/icon-192.png', image('current-icon'));
  await oldest.put('/landing/splash.webp', image('oldest-splash'));
  await previous.put('/landing/splash.webp', image('previous-splash'));
  await oldest.put('/assets/retained-12345678.js',
    new Response('previous-only-chunk', { headers: { 'content-type': 'text/javascript' } }));
  await oldest.put('/assets/shared-12345678.js',
    new Response('<!doctype html>stale rewrite', { headers: { 'content-type': 'text/html' } }));
  await current.put('/assets/shared-12345678.js',
    new Response('current-chunk', { headers: { 'content-type': 'text/javascript' } }));

  const offlineRead = async (path) => {
    let response;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { response = value; },
      waitUntil: () => {},
    });
    assert.ok(response, `public path ${path} must be intercepted`);
    return (await response).text();
  };
  assert.equal(await offlineRead('/icon-192.png'), 'current-icon', 'same-path older icon must not mask the current one');
  assert.equal(await offlineRead('/landing/splash.webp'), 'previous-splash', 'newest retained fallback should win');
  assert.equal(await offlineRead('/assets/retained-12345678.js'), 'previous-only-chunk', 'old-only code must survive offline');
  assert.equal(await offlineRead('/assets/shared-12345678.js'), 'current-chunk', 'stale HTML rewrite must be ignored');
  assert.equal(await oldest.match('/assets/shared-12345678.js'), undefined, 'stale cached HTML must still be evicted');
});

test('mixed-case HTML asset rewrites are rejected online and evicted from retained cache', async () => {
  const path = '/assets/poison-12345678.js';
  let online = true;
  const app = worker({ fetchResponse: async () => {
    if (!online) throw new Error('offline');
    return new Response('<!doctype html>online rewrite', { headers: { 'content-type': 'TeXt/HtMl; charset=UTF-8' } });
  } });
  const previous = await app.caches.open('axom-shell-previous');
  const current = await app.caches.open('axom-shell-current');
  await previous.put(path, new Response('<!doctype html>retained rewrite', {
    headers: { 'content-type': 'TEXT/HTML; charset=UTF-8' },
  }));
  const request = async () => {
    let result;
    const tasks = [];
    app.events.get('fetch')({
      request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
      respondWith: (promise) => { result = promise; },
      waitUntil: (promise) => { tasks.push(promise); },
    });
    const response = await result;
    await Promise.all(tasks);
    return response;
  };
  assert.equal((await request()).status, 0, 'HTML asset rewrite must be rejected');
  assert.equal(await previous.match(path), undefined, 'older HTML rewrite must be evicted');
  assert.equal(await current.match(path), undefined, 'HTML rewrite must not enter current cache');
  online = false;
  await assert.rejects(request(), /offline/, 'offline must not replay bad HTML');
});

test('navigation with mixed-case HTML content type refreshes offline shell', async () => {
  const html = '<!doctype html><title>new shell</title>';
  const app = worker({ fetchResponse: async () =>
    new Response(html, { headers: { 'content-type': 'TEXT/HTML; charset=UTF-8' } }) });
  let pending;
  let task;
  app.events.get('fetch')({
    request: { url: 'https://app.test/', method: 'GET', mode: 'navigate' },
    respondWith: (value) => { pending = value; },
    waitUntil: (value) => { task = value; },
  });
  assert.equal(await (await pending).text(), html);
  assert.ok(task, 'valid HTML navigation must be cached');
  await task;
  const current = await app.caches.open('axom-shell-current');
  assert.equal(await (await current.match('./index.html')).text(), html);
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

test('failed cache writes do not block online navigation or stylesheet loading', async () => {
  const app = worker({
    failCachePut: true,
    fetchResponse: async (request) => new Response(
      request.mode === 'navigate' ? '<main>AXOM</main>' : 'body { color: white; }',
      { headers: { 'content-type': request.mode === 'navigate' ? 'text/html' : 'text/css' } },
    ),
  });
  for (const [path, mode, expected] of [
    ['/', 'navigate', '<main>AXOM</main>'],
    ['/assets/main.css', 'same-origin', 'body { color: white; }'],
  ]) {
    let response;
    let lifetime;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode },
      respondWith: (value) => { response = value; },
      waitUntil: (value) => { lifetime = value; },
    });
    assert.equal(await (await response).text(), expected);
    await lifetime;
  }
});

test('failed cache reads fall back to the network for application assets', async () => {
  const app = worker({
    failCacheMatch: true,
    fetchResponse: async () => new Response('export const ready = true;', { headers: { 'content-type': 'text/javascript' } }),
  });
  let response;
  let lifetime;
  app.events.get('fetch')({
    request: { url: 'https://app.test/assets/main.js', method: 'GET', mode: 'same-origin' },
    respondWith: (value) => { response = value; },
    waitUntil: (value) => { lifetime = value; },
  });
  assert.equal(await (await response).text(), 'export const ready = true;');
  await lifetime;
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

test('worker does not intercept account-specific same-origin image-shaped URLs', async () => {
  const app = worker({ fetchResponse: async () => new Response('account-A image', { headers: { 'content-type': 'image/png' } }) });
  for (const path of [
    '/private/avatar.png',
    '/storage/v1/object/private/learner.webp',
    '/user-files/learner.svg',
    '/profile-image.png',
  ]) {
    let response;
    let lifetime;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { response = value; },
      waitUntil: (value) => { lifetime = value; },
    });
    if (response) await response;
    if (lifetime) await lifetime;
    assert.equal(Boolean(response), false, `private-looking image URL ${path} was intercepted by the public shell cache`);
  }
});

test('known shipped public icon URLs still cache for offline reuse', async () => {
  let online = true;
  const app = worker({
    fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('shipped-icon', { headers: { 'content-type': 'image/png' } });
    },
  });
  for (const path of ['/icon-192.png', '/assets/app.png', '/landing/splash.webp']) {
    const visit = async () => {
      let response;
      let lifetime;
      app.events.get('fetch')({
        request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { response = value; },
        waitUntil: (value) => { lifetime = value; },
      });
      assert.ok(response, `expected public asset interception for ${path}`);
      const resolved = await response;
      if (lifetime) await lifetime;
      return resolved.text();
    };
    online = true;
    assert.equal(await visit(), 'shipped-icon');
    online = false;
    assert.equal(await visit(), 'shipped-icon');
  }
});

test('public asset scope follows a subdirectory installation without admitting private paths', async () => {
  const app = worker({ scope: 'https://app.test/axom/', fetchResponse: async () =>
    new Response('css', { headers: { 'content-type': 'text/css' } }) });
  for (const [path, expectedInterception] of [
    ['/axom/assets/main.css', true],
    ['/axom/landing/logo.svg', true],
    ['/axom/private/avatar.png', false],
    ['/private/avatar.png', false],
    ['/axom/nonpublic.png', false],
  ]) {
    let response;
    let lifetime;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { response = value; },
      waitUntil: (value) => { lifetime = value; },
    });
    if (response) await response;
    if (lifetime) await lifetime;
    assert.equal(Boolean(response), expectedInterception, `incorrect service-worker scope for ${path}`);
  }
});

test('cache policy refuses protected responses even under an allowed public-looking asset path', async () => {
  for (const headers of [
    { 'cache-control': 'private, no-store' },
    { 'cache-control': 'no-cache' },
    { vary: 'Accept-Encoding, Cookie' },
    { vary: 'Authorization' },
    { vary: '*' },
    { 'set-cookie': 'session=accountA' },
  ]) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('account-A-only', { headers: { 'content-type': 'image/png', ...headers } });
    } });
    const visit = async () => {
      let response;
      let lifetime;
      app.events.get('fetch')({
        request: { url: 'https://app.test/landing/user-avatar.png', method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { response = value; },
        waitUntil: (value) => { lifetime = value; },
      });
      const result = await response;
      if (lifetime) await lifetime;
      return result.text();
    };
    assert.equal(await visit(), 'account-A-only');
    online = false;
    await assert.rejects(visit(), /offline/, 'private or authentication-varying response was replayed offline: ' + JSON.stringify(headers));
  }
});

test('cache lookup ignores protected responses retained by an older worker', async () => {
  const app = worker({ fetchResponse: async () =>
    new Response('account-B-fresh', { headers: { 'content-type': 'image/png', 'cache-control': 'private' } }) });
  await (await app.caches.open('axom-shell-older')).put(
    'https://app.test/landing/user-avatar.png',
    new Response('account-A-cached', { headers: { 'content-type': 'image/png', 'cache-control': 'private' } }),
  );
  let response;
  let lifetime;
  app.events.get('fetch')({
    request: { url: 'https://app.test/landing/user-avatar.png', method: 'GET', mode: 'same-origin' },
    respondWith: (value) => { response = value; },
    waitUntil: (value) => { lifetime = value; },
  });
  assert.equal(await (await response).text(), 'account-B-fresh');
  if (lifetime) await lifetime;
});

test('authenticated requests to a public-looking path bypass the shell cache entirely', () => {
  const app = worker();
  app.events.get('fetch')({
    request: {
      url: 'https://app.test/assets/private-preview.png', method: 'GET', mode: 'same-origin',
      headers: new Headers({ Authorization: 'Bearer account-A' }),
    },
    respondWith: () => assert.fail('authorized request should not be intercepted or cached'),
  });
});


test('request cache=no-store bypasses shell cache even for a shipped asset', () => {
  const app = worker();
  app.events.get('fetch')({
    request: {
      url: 'https://app.test/assets/app.png', method: 'GET', mode: 'same-origin',
      cache: 'no-store',
    },
    respondWith: () => assert.fail('no-store request should not be intercepted'),
  });
});

test('manifest-pinned checkpoint chunk survives no-store host headers after deployment swap', async () => {
  const asset = '/assets/updateCheckpoint-7UZDKYto.js';
  const app = worker({
    precache: [`.${asset}`],
    fetchResponse: async () => new Response('old chunk removed', { status: 404, headers: { 'content-type': 'text/javascript' } }),
  });
  await (await app.caches.open('axom-shell-current')).put(
    `https://app.test${asset}`,
    new Response('export const safe = true;', { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } }),
  );
  let pending;
  app.events.get('fetch')({
    request: { url: `https://app.test${asset}`, method: 'GET', mode: 'same-origin' },
    respondWith: (promise) => { pending = promise; },
    waitUntil: () => {},
  });
  const result = await pending;
  assert.equal(result.status, 200, 'old update checkpoint chunk was not served from pinned shell cache');
  assert.equal(await result.text(), 'export const safe = true;');
});

test('pinned chunk cannot replay private, auth-varying or unpinned cached responses', async () => {
  const pinned = '/assets/updateCheckpoint-7UZDKYto.js';
  for (const [asset, headers] of [
    [pinned, { 'cache-control': 'private, no-store' }],
    [pinned, { 'cache-control': 'no-cache' }],
    [pinned, { 'cache-control': 'no-store', vary: 'Cookie' }],
    [pinned, { 'cache-control': 'no-store', 'set-cookie': 'session=A' }],
    ['/assets/accountImage-7UZDKYto.js', { 'cache-control': 'no-store' }],
  ]) {
    const app = worker({
      precache: [`.${pinned}`],
      fetchResponse: async () => new Response('network-B', { headers: { 'content-type': 'text/javascript', ...headers } }),
    });
    await (await app.caches.open('axom-shell-current')).put(
      `https://app.test${asset}`,
      new Response('cached-A', { headers: { 'content-type': 'text/javascript', ...headers } }),
    );
    let pending;
    app.events.get('fetch')({
      request: { url: `https://app.test${asset}`, method: 'GET', mode: 'same-origin' },
      respondWith: (promise) => { pending = promise; },
      waitUntil: () => {},
    });
    assert.equal(await (await pending).text(), 'network-B', `replayed protected or unpinned asset: ${asset}`);
  }
});

test('manifest-declared lazy JS/CSS with no-cache or no-store headers caches on first use and reopens offline', async () => {
  const assets = [
    ['/assets/DailyWordPage-abcdefgh.js', 'text/javascript'],
    ['/assets/DailyWordPage-abcdefgh.css', 'text/css'],
    ['/assets/dailyWordWords-12345678.js', 'application/javascript'],
  ];
  for (const control of ['no-cache', 'no-store']) {
    let online = true;
    const app = worker({
      shippedChunks: assets.map(([path]) => `.${path}`),
      fetchResponse: async (url) => {
        if (!online) throw new Error('offline');
        const asset = assets.find(([path]) => new URL(url).pathname === path);
        return new Response('verified-public-build-asset', {
          headers: { 'cache-control': control, 'content-type': asset?.[1] || 'text/plain' },
        });
      },
    });
    for (const [path] of assets) {
      const visit = async () => {
        let pending;
        let lifetime;
        app.events.get('fetch')({
          request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
          respondWith: (result) => { pending = result; },
          waitUntil: (result) => { lifetime = result; },
        });
        const result = await pending;
        if (lifetime) await lifetime;
        return result.text();
      };
      assert.equal(await visit(), 'verified-public-build-asset', `first-use ${control}: ${path}`);
      online = false;
      assert.equal(await visit(), 'verified-public-build-asset', `offline reload ${control}: ${path}`);
      online = true;
    }
  }
});

test('manifest chunk exception rejects private, auth-varying, unlisted and wrong-MIME content', async () => {
  const known = '/assets/DailyWordPage-abcdefgh.js';
  for (const [path, headers] of [
    [known, { 'cache-control': 'private, no-store', 'content-type': 'text/javascript' }],
    [known, { 'cache-control': 'no-store', 'content-type': 'text/javascript', vary: 'Cookie' }],
    [known, { 'cache-control': 'no-cache', 'content-type': 'text/javascript', vary: '*' }],
    [known, { 'cache-control': 'no-store', 'content-type': 'text/javascript', 'set-cookie': 'session=A' }],
    [known, { 'cache-control': 'no-store', 'content-type': 'image/png' }],
    ['/assets/accountCustom-12345678.js', { 'cache-control': 'no-store', 'content-type': 'text/javascript' }],
    ['/assets/DailyWordPage-unhashed.js', { 'cache-control': 'no-store', 'content-type': 'text/javascript' }],
  ]) {
    let online = true;
    const app = worker({
      shippedChunks: [`.${known}`],
      fetchResponse: async () => {
        if (!online) throw new Error('offline');
        return new Response('private-or-unverified', { headers });
      },
    });
    const visit = async () => {
      let pending;
      let lifetime;
      app.events.get('fetch')({
        request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
        respondWith: (result) => { pending = result; },
        waitUntil: (result) => { lifetime = result; },
      });
      const result = await pending;
      if (lifetime) await lifetime;
      return result.text();
    };
    assert.equal(await visit(), 'private-or-unverified');
    online = false;
    await assert.rejects(visit(), /offline/, `unsafe cache replay: ${path}, ${JSON.stringify(headers)}`);
  }
});

test('redirects and mismatched final URLs cannot persist manifest-listed lazy scripts', async () => {
  const path = '/assets/DailyWordPage-12345678.js';
  const cases = [
    { name: 'cross-origin redirect', finalUrl: 'https://other.example/api/private.js', redirected: true, control: 'no-store', status: 200 },
    { name: 'same-origin private redirect', finalUrl: 'https://app.test/api/private.js', redirected: true, control: 'no-cache', status: 200 },
    { name: 'mismatched final path without redirect flag', finalUrl: 'https://app.test/api/private.js', redirected: false, control: 'no-store', status: 200 },
    { name: 'partial content', finalUrl: `https://app.test${path}`, redirected: false, control: 'no-cache', status: 206 },
    { name: 'ordinary cacheable redirected asset', finalUrl: 'https://app.test/api/other.js', redirected: true, control: '', status: 200 },
  ];
  for (const scenario of cases) {
    let online = true;
    const app = worker({
      shippedChunks: [`.${path}`],
      fetchResponse: async () => {
        if (!online) throw new Error('offline');
        const response = new Response('synthetic-account-bytes', {
          status: scenario.status,
          headers: {
            'content-type': 'text/javascript',
            ...(scenario.control ? { 'cache-control': scenario.control } : {}),
          },
        });
        Object.defineProperty(response, 'url', { value: scenario.finalUrl });
        Object.defineProperty(response, 'redirected', { value: scenario.redirected });
        return response;
      },
    });
    const visit = async () => {
      let output;
      const pending = [];
      app.events.get('fetch')({
        request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
        respondWith: (promise) => { output = promise; },
        waitUntil: (promise) => { pending.push(promise); },
      });
      const response = await output;
      await Promise.all(pending);
      return response;
    };
    assert.equal(await (await visit()).text(), 'synthetic-account-bytes', scenario.name + ': online response unchanged');
    online = false;
    await assert.rejects(visit(), /offline/, scenario.name + ': unsafe bytes replayed offline');
  }
});

test('installed worker persists immutable chunk inventory for future upgrades', async () => {
  const app = worker({
    precache: ['./assets/checkpoint-12345678.js', './assets/nohash.js'],
    shippedChunks: ['./assets/oldLazy-abcdefgh.css', './private/secret-12345678.js'],
    fetchResponse: async () => new Response('<!doctype html>shell', { headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' } }),
  });
  let task;
  app.events.get('install')({ waitUntil: (p) => { task = p; } });
  await task;
  const record = await (await app.caches.open('axom-shell-current')).match('./__axom-retained-public-chunks.json');
  assert.ok(record);
  assert.deepEqual(await record.json(), { version: 1, chunks: ['./assets/checkpoint-12345678.js', './assets/oldLazy-abcdefgh.css'] });
});

test('new generation replays prior manifest-listed immutable JS/CSS with restrictive host headers', async () => {
  const app = worker();
  const prior = await app.caches.open('axom-shell-previous');
  const paths = [
    ['/assets/checkpoint-12345678.js', 'text/javascript', 'no-store'],
    ['/assets/oldLazy-abcdefgh.css', 'text/css', 'no-cache'],
  ];
  await prior.put('./__axom-retained-public-chunks.json', new Response(
    JSON.stringify({ version: 1, chunks: paths.map(([url]) => `.${url}`) }),
    { headers: { 'content-type': 'application/json' } },
  ));
  for (const [path, mime, directive] of paths) {
    await prior.put(path, withNetworkUrl(new Response('older-public-code', {
      headers: { 'content-type': mime, 'cache-control': directive },
    }), `https://app.test${path}`));
    let pending;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.equal(await (await pending).text(), 'older-public-code', `retained ${path}`);
  }
});

test('retained snapshot never authorizes private, substituted or unlisted offline code', async () => {
  const asset = '/assets/checkpoint-12345678.js';
  const snapshot = { version: 1, chunks: [`.${asset}`] };
  const cases = [
    ['absent snapshot', null, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript' }, null],
    ['wrong asset', { version: 1, chunks: ['./assets/other-12345678.js'] }, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript' }, null],
    ['invalid version', { version: 2, chunks: [`.${asset}`] }, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript' }, null],
    ['private', snapshot, asset, { 'cache-control': 'private, no-store', 'content-type': 'text/javascript' }, null],
    ['authorization vary', snapshot, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript', vary: 'Authorization' }, null],
    ['cookie', snapshot, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript', 'set-cookie': 'sid=A' }, null],
    ['HTML rewrite', snapshot, asset, { 'cache-control': 'no-store', 'content-type': 'text/html' }, null],
    ['substituted final URL', snapshot, asset, { 'cache-control': 'no-store', 'content-type': 'text/javascript' }, 'https://app.test/api/account'],
  ];
  for (const [label, manifest, path, headers, finalUrl] of cases) {
    const app = worker({ fetchResponse: async () => { throw new Error('offline'); } });
    const prior = await app.caches.open('axom-shell-previous');
    if (manifest) await prior.put('./__axom-retained-public-chunks.json',
      new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
    await prior.put(path, withNetworkUrl(new Response('must-not-replay', { headers }), finalUrl || `https://app.test${path}`));
    let pending;
    app.events.get('fetch')({
      request: { url: `https://app.test${path}`, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    await assert.rejects(pending, /offline/, label);
  }
});

test('wrong-MIME script/style responses are returned online but never cached', async () => {
  for (const [path, mime] of [
    ['/assets/app-12345678.js', 'application/json'],
    ['/assets/app-12345678.mjs', 'text/plain'],
    ['/assets/app-12345678.css', 'application/json'],
  ]) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('wrong-code-mime', {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
      });
    } });
    const visit = async () => {
      let pending;
      const lifetime = [];
      app.events.get('fetch')({
        request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { pending = value; },
        waitUntil: (value) => lifetime.push(value),
      });
      const response = await pending;
      await Promise.all(lifetime);
      return response.text();
    };
    assert.equal(await visit(), 'wrong-code-mime', path + ': preserve online response');
    online = false;
    await assert.rejects(visit(), /offline/, path + ': wrong MIME persisted');
  }
});

test('wrong-MIME legacy script/style cache entries are evicted before replay', async () => {
  for (const cacheName of ['axom-shell-previous', 'axom-shell-current']) {
    for (const [path, mime] of [
      ['/assets/app-12345678.js', 'application/json'],
      ['/assets/app-12345678.css', 'text/plain'],
    ]) {
      const app = worker();
      const url = 'https://app.test' + path;
      const cache = await app.caches.open(cacheName);
      await cache.put(url, withNetworkUrl(new Response('invalid-legacy-code', {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
      }), url));
      let pending;
      app.events.get('fetch')({
        request: { url, method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { pending = value; },
        waitUntil: () => {},
      });
      await assert.rejects(pending, /offline/, cacheName + ' ' + path + ': bad code replayed');
      assert.equal(await cache.match(url), undefined, cacheName + ' ' + path + ': invalid entry retained');
    }
  }
});

test('valid code MIME with charset remains available offline', async () => {
  for (const [path, mime] of [
    ['/assets/app-12345678.js', 'TEXT/JAVASCRIPT; charset=utf-8'],
    ['/assets/app-12345678.mjs', 'application/javascript; charset=utf-8'],
    ['/assets/app-12345678.css', 'TEXT/CSS; charset=utf-8'],
  ]) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('valid-code', {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
      });
    } });
    const visit = async () => {
      let pending;
      const lifetime = [];
      app.events.get('fetch')({
        request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { pending = value; },
        waitUntil: (value) => lifetime.push(value),
      });
      const response = await pending;
      await Promise.all(lifetime);
      return response.text();
    };
    assert.equal(await visit(), 'valid-code');
    online = false;
    assert.equal(await visit(), 'valid-code', path + ': correct MIME rejected');
  }
});
