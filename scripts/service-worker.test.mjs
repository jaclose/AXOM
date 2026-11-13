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

function worker({ failCacheMatch = false, failCachePut = false, onCachePut = async () => {}, scope = 'https://app.test/', precache = [], shippedChunks = [], fetchResponse = async () => { throw new Error('offline'); } } = {}) {
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
        addAll: async (keys) => {
          assert.equal(new Set(keys).size, keys.length);
          // Model the browser's Cache.addAll, which writes successful
          // responses regardless of HTTP no-store/private directives.
          for (const key of keys) {
            const url = new URL(key, scope).href;
            const response = withNetworkUrl(await fetchResponse(url), url);
            if (!response.ok || response.status !== 200) throw new Error('precache fetch failed');
            values.set(absolute(key), response.clone());
          }
        },
        match: async (key) => values.get(absolute(key))?.clone(),
        delete: async (key) => values.delete(absolute(key)),
        put: async (key, value) => {
          if (failCachePut) throw new Error('cache quota exceeded');
          await onCachePut(key);
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

test('R89 a failed retained-chunk inventory write aborts the new generation without erasing older or private caches', async () => {
  const chunk = './assets/critical-87654321.js';
  for (const sourceKind of ['precache', 'shipped']) {
    let manifestWriteAttempts = 0;
    const app = worker({
      precache: sourceKind === 'precache' ? [chunk] : [],
      shippedChunks: sourceKind === 'shipped' ? [chunk] : [],
      onCachePut: async (key) => {
        if (key === './__axom-retained-public-chunks.json') {
          manifestWriteAttempts++;
          throw new Error('synthetic retained inventory quota rejection');
        }
      },
      fetchResponse: async (request) => {
        const path = new URL(typeof request === 'string' ? request : request.url).pathname;
        const type = path.endsWith('.js') ? 'text/javascript'
          : path.endsWith('.png') ? 'image/png'
            : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
        return new Response('PUBLIC_' + path, {
          headers: { 'content-type': type, 'cache-control': path.endsWith('.js') ? 'no-store' : 'public, max-age=0' },
        });
      },
    });
    const older = await app.caches.open('axom-shell-previous');
    const learner = await app.caches.open('private-learner-files');
    await older.put('./previous.js', new Response('PREVIOUS_BUILD_BYTES'));
    await learner.put('./private.txt', new Response('PRIVATE_LEARNER_BYTES'));

    let task;
    app.events.get('install')({ waitUntil: (value) => { task = value; } });
    await assert.rejects(task, /synthetic retained inventory quota rejection/,
      sourceKind + ': missing required cache metadata must fail the entire install');
    assert.equal(manifestWriteAttempts, 1, sourceKind + ': injected metadata failure must be reached');
    assert.deepEqual(await app.caches.keys(), ['axom-shell-previous', 'private-learner-files'],
      sourceKind + ': cleanup may remove only the failed new generation');
    assert.equal(await (await older.match('./previous.js')).text(), 'PREVIOUS_BUILD_BYTES');
    assert.equal(await (await learner.match('./private.txt')).text(), 'PRIVATE_LEARNER_BYTES');
  }
});

test('R89 a successful pinned inventory survives install while a truly empty inventory remains optional', async () => {
  const chunk = './assets/critical-87654321.js';
  const fetchResponse = async (request) => {
    const path = new URL(typeof request === 'string' ? request : request.url).pathname;
    const type = path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.png') ? 'image/png'
        : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
    return new Response('PUBLIC_' + path, {
      headers: { 'content-type': type, 'cache-control': path.endsWith('.js') ? 'no-store' : 'public, max-age=0' },
    });
  };
  for (const sourceKind of ['precache', 'shipped']) {
    const app = worker({
      precache: sourceKind === 'precache' ? [chunk] : [],
      shippedChunks: sourceKind === 'shipped' ? [chunk] : [],
      fetchResponse,
    });
    let task;
    app.events.get('install')({ waitUntil: (value) => { task = value; } });
    await task;
    const current = await app.caches.open('axom-shell-current');
    const manifest = await (await current.match('./__axom-retained-public-chunks.json')).json();
    assert.equal(manifest.version, 1);
    assert.deepEqual([...manifest.chunks], [chunk], sourceKind + ': exact immutable chunk must be pinned');
    assert.ok(await current.match('./index.html'), 'offline shell must install');
  }
  let rejectedEmptyWrite = 0;
  const empty = worker({
    fetchResponse,
    onCachePut: async (key) => {
      if (key === './__axom-retained-public-chunks.json') {
        rejectedEmptyWrite++;
        throw new Error('synthetic optional empty inventory quota rejection');
      }
    },
  });
  let task;
  empty.events.get('install')({ waitUntil: (value) => { task = value; } });
  await task;
  assert.equal(rejectedEmptyWrite, 1);
  assert.ok(await (await empty.caches.open('axom-shell-current')).match('./index.html'),
    'no retained code to authorize: an empty optional manifest must not block shell installation');
});

test('R83 rejected install removes only its newly created partial shell cache', async () => {
  const chunk = './assets/critical-87654321.js';
  for (const failedPath of [chunk, './index.html']) {
    const app = worker({
      precache: [chunk],
      onCachePut: async (path) => {
        if (path === failedPath) throw new Error('synthetic required write quota rejection');
      },
      fetchResponse: async (request) => {
        const pathname = new URL(typeof request === 'string' ? request : request.url).pathname;
        if (pathname.endsWith('.js')) return new Response('export const ready = true;', {
          headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=600' },
        });
        if (pathname.endsWith('.png')) return new Response('icon', {
          headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
        });
        if (pathname.endsWith('.webmanifest')) return new Response('{"name":"AXOM"}', {
          headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=600' },
        });
        return new Response('<!doctype html>safe-shell', {
          headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
        });
      },
    });
    const older = await app.caches.open('axom-shell-previous');
    const privateCache = await app.caches.open('private-learner-files');
    await older.put('./previous.txt', new Response('previous'));
    await privateCache.put('./private.txt', new Response('learner'));
    let task;
    app.events.get('install')({ waitUntil: (value) => { task = value; } });
    await assert.rejects(task, /synthetic required write quota rejection/);
    assert.deepEqual(await app.caches.keys(), ['axom-shell-previous', 'private-learner-files'],
      failedPath + ': failed install left an abandoned partial cache or deleted older/private data');
    assert.equal(await (await older.match('./previous.txt')).text(), 'previous');
    assert.equal(await (await privateCache.match('./private.txt')).text(), 'learner');
  }
});

test('R83 failed same-build install must never delete an existing usable cache', async () => {
  const app = worker({
    precache: ['./assets/critical-87654321.js'],
    onCachePut: async (path) => {
      if (path === './assets/critical-87654321.js') throw new Error('synthetic quota rejection');
    },
    fetchResponse: async (request) => {
      const path = new URL(typeof request === 'string' ? request : request.url).pathname;
      return path.endsWith('.js')
        ? new Response('export const retry = true;', { headers: { 'content-type': 'text/javascript' } })
        : path.endsWith('.png')
          ? new Response('icon', { headers: { 'content-type': 'image/png' } })
          : path.endsWith('.webmanifest')
            ? new Response('{"name":"AXOM"}', { headers: { 'content-type': 'application/manifest+json' } })
            : new Response('<!doctype html>safe-shell', { headers: { 'content-type': 'text/html' } });
    },
  });
  const existing = await app.caches.open('axom-shell-current');
  await existing.put('./index.html', new Response('original-shell'));
  let task;
  app.events.get('install')({ waitUntil: (value) => { task = value; } });
  await assert.rejects(task, /AXOM install refused: build cache already exists/);
  assert.ok((await app.caches.keys()).includes('axom-shell-current'), 'pre-existing same-build cache was deleted');
  assert.equal(await (await existing.match('./index.html')).text(), 'original-shell');
});

test('R87 reused build identity fails closed without mutating original cache bytes', async () => {
  const required = './assets/critical-87654321.js';
  let lateQuotaEnabled = false;
  let installWrites = 0;
  const app = worker({
    precache: [required],
    onCachePut: async (path) => {
      if (lateQuotaEnabled) installWrites++;
      if (lateQuotaEnabled && path === './index.html') throw new Error('synthetic late quota rejection');
    },
    fetchResponse: async (request) => {
      const pathname = new URL(typeof request === 'string' ? request : request.url).pathname;
      const mime = pathname.endsWith('.js') ? 'text/javascript'
        : pathname.endsWith('.png') ? 'image/png'
          : pathname.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
      return new Response(pathname.endsWith('.js') ? 'NEW_BUILD_CODE' : 'NEW_BUILD_SHELL', {
        headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
      });
    },
  });
  const existing = await app.caches.open('axom-shell-current');
  const older = await app.caches.open('axom-shell-prior');
  const privateCache = await app.caches.open('private-learner-files');
  const old = [
    ['./', 'OLD_BUILD_ROOT'],
    ['./index.html', 'OLD_BUILD_INDEX'],
    [required, 'OLD_BUILD_CODE'],
    ['./__axom-retained-public-chunks.json', 'OLD_BUILD_MANIFEST'],
  ];
  for (const [path, bytes] of old) await existing.put(path, new Response(bytes));
  await older.put('./older.txt', new Response('OLD_GENERATION_BYTES'));
  await privateCache.put('./private.txt', new Response('PRIVATE_LEARNER_BYTES'));
  lateQuotaEnabled = true;

  let install;
  app.events.get('install')({ waitUntil: (task) => { install = task; } });
  await assert.rejects(install, /AXOM install refused: build cache already exists/,
    'a repeated build ID must fail closed before any same-generation write');
  assert.equal(installWrites, 0, 'no existing same-build entry may be overwritten before install aborts');
  for (const [path, bytes] of old) {
    assert.equal(await (await existing.match(path))?.text(), bytes, path + ': original cache bytes must survive');
  }
  assert.equal(await (await older.match('./older.txt')).text(), 'OLD_GENERATION_BYTES');
  assert.equal(await (await privateCache.match('./private.txt')).text(), 'PRIVATE_LEARNER_BYTES');
  assert.deepEqual(await app.caches.keys(), ['axom-shell-current', 'axom-shell-prior', 'private-learner-files']);
});

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
  const image = (text, mime = 'image/png') => new Response(text, { headers: { 'content-type': mime } });
  await oldest.put('/icon-192.png', image('oldest-icon'));
  await previous.put('/icon-192.png', image('previous-icon'));
  await current.put('/icon-192.png', image('current-icon'));
  await oldest.put('/landing/splash.webp', image('oldest-splash', 'image/webp'));
  await previous.put('/landing/splash.webp', image('previous-splash', 'image/webp'));
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

test('a rejected retained-cache read or eviction cannot hide a valid current offline icon', async () => {
  const path = '/icon-192.png';
  for (const operation of ['match', 'delete']) {
    const app = worker();
    const old = await app.caches.open('axom-shell-older');
    const current = await app.caches.open('axom-shell-current');
    await old.put(path, new Response(operation === 'delete' ? '<!doctype html>bad image rewrite' : 'old-icon', {
      headers: { 'content-type': operation === 'delete' ? 'text/html' : 'image/png' },
    }));
    await current.put(path, new Response('current-icon', { headers: { 'content-type': 'image/png' } }));

    // A single retained Cache object is damaged. Other cache generations work.
    const originalOpen = app.caches.open.bind(app.caches);
    app.caches.open = async (name) => {
      const cache = await originalOpen(name);
      if (name !== 'axom-shell-older') return cache;
      return operation === 'match'
        ? { ...cache, match: async () => { throw new Error('legacy read rejected'); } }
        : { ...cache, delete: async () => { throw new Error('legacy eviction rejected'); } };
    };
    let pending;
    app.events.get('fetch')({
      request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending, operation + ': expected shipped public icon interception');
    assert.equal(await (await pending).text(), 'current-icon', operation + ': do not lose safe current bytes');
  }
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
  assert.deepEqual(await app.caches.keys(),
    ['other-app', 'axom-shell-oldest', 'axom-shell-previous', 'axom-shell-current'],
    'a single surviving tab may still depend on the oldest build');
  app.context.self.clients.matchAll = async () => [];
  app.events.get('activate')({ waitUntil: (value) => { task = value; } });
  await task;
  assert.deepEqual(await app.caches.keys(), ['other-app', 'axom-shell-previous', 'axom-shell-current'],
    'only a zero-client activation can safely prune superseded generations');
});

test('R79 one surviving legacy window retains its A-only lazy chunk across B and C caches', async () => {
  const app = worker();
  const path = '/assets/legacy-only-12345678.js';
  const legacy = await app.caches.open('axom-shell-A');
  await legacy.put(path, withNetworkUrl(new Response('legacy-A-code', {
    headers: { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=600' },
  }), 'https://app.test' + path));
  await app.caches.open('axom-shell-B');
  await app.caches.open('axom-shell-current');
  await app.caches.open('unrelated-app');
  app.context.self.clients.matchAll = async () => [{ url: 'https://app.test/dashboard' }];
  let activation;
  app.events.get('activate')({ waitUntil: (value) => { activation = value; } });
  await activation;
  assert.deepEqual(await app.caches.keys(),
    ['axom-shell-A', 'axom-shell-B', 'axom-shell-current', 'unrelated-app'],
    'an old active tab may need A after an unused B has been staged and C activated');
  let response;
  app.events.get('fetch')({
    request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin', headers: new Headers() },
    respondWith: (value) => { response = value; },
    waitUntil: () => {},
  });
  assert.ok(response, 'public build code should have a safe cached path');
  assert.equal(await (await response).text(), 'legacy-A-code',
    'old A tab still loads its lazy code offline after C activation');
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
    fetchResponse: async (request) => {
      if (!online) throw new Error('offline');
      const path = new URL(typeof request === 'string' ? request : request.url).pathname;
      const mime = path.endsWith('.webp') ? 'image/webp' : 'image/png';
      return new Response('shipped-icon', { headers: { 'content-type': mime } });
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

test('signed or unknown asset queries cannot enter shared cache, even from a retained generation', async () => {
  let online = true;
  const app = worker({ fetchResponse: async () => {
    if (!online) throw new Error('offline');
    return new Response('synthetic A-only image', { headers: {
      'content-type': 'image/png', 'cache-control': 'public, max-age=600',
    } });
  } });
  const old = await app.caches.open('axom-shell-older');
  const paths = [
    '/landing/hero.png?access_token=SYNTHETIC_A',
    '/landing/hero.png?token=SYNTHETIC_A',
    '/landing/hero.png?X-Amz-Signature=SYNTHETIC_A',
    '/landing/hero.png?v=build-20261111&access_token=SYNTHETIC_A',
    '/landing/hero.png?sig=SYNTHETIC_A',
    '/landing/hero.png?nonce=synthetic-session',
    '/landing/hero.png?v=build-20261111&v=build-20261112',
    '/landing/hero.png?v=sk_synthetic_account_token',
  ];
  for (const path of paths) {
    // Older workers may already contain this query-keyed entry; never replay it.
    await old.put(path, new Response('legacy account A bytes', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public' },
    }));
    let response;
    app.events.get('fetch')({
      request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { response = value; },
    });
    assert.equal(response, undefined, 'sensitive URL intercepted: ' + path);
    assert.equal(await (await app.caches.open('axom-shell-current')).match(path), undefined,
      'sensitive URL was written to current shared shell cache: ' + path);
  }
  online = false;
  let response;
  app.events.get('fetch')({
    request: { url: 'https://app.test' + paths[0], method: 'GET', mode: 'same-origin' },
    respondWith: (value) => { response = value; },
  });
  assert.equal(response, undefined, 'offline worker must not replay older signed URL');
});

test('opaque version hints cannot replay retained shared-cache entries', async () => {
  const app = worker({ fetchResponse: async () => new Response('synthetic A-only image', {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
  }) });
  const retained = await app.caches.open('axom-shell-previous');
  const current = await app.caches.open('axom-shell-current');
  for (const path of [
    '/landing/hero.png?v=deadbeef',
    '/landing/hero.png?v=01ab23cd45ef',
    '/landing/hero.png?v=1234567890',
    '/landing/hero.png?v=00000001',
  ]) {
    const url = 'https://app.test' + path;
    await retained.put(url, withNetworkUrl(new Response('synthetic account-A-only bytes', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
    }), url));
    let intercepted = false;
    app.events.get('fetch')({
      request: { url, method: 'GET', mode: 'same-origin' },
      respondWith: () => { intercepted = true; },
      waitUntil: () => {},
    });
    assert.equal(intercepted, false, 'opaque session-like version reached shared cache: ' + path);
    assert.equal(await current.match(url), undefined, 'opaque asset copied to current cache: ' + path);
  }
});

test('bounded public version-only image URLs still cache and recover offline', async () => {
  let online = true;
  const app = worker({ fetchResponse: async () => {
    if (!online) throw new Error('offline');
    return new Response('public image', { headers: {
      'content-type': 'image/png', 'cache-control': 'public, max-age=600',
    } });
  } });
  for (const path of ['/landing/hero.png?v=build-20261111', '/landing/hero.png?v=1.2.3']) {
    const read = async () => {
      let task; let lifetime;
      app.events.get('fetch')({
        request: { url: 'https://app.test' + path, method: 'GET', mode: 'same-origin' },
        respondWith: (value) => { task = value; },
        waitUntil: (value) => { lifetime = value; },
      });
      assert.ok(task, 'public version query should be intercepted: ' + path);
      const response = await task;
      if (lifetime) await lifetime;
      return response.text();
    };
    online = true;
    assert.equal(await read(), 'public image');
    online = false;
    assert.equal(await read(), 'public image');
  }
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
    fetchResponse: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('.js')) return new Response('export const ready = true;', {
        headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' },
      });
      if (path.endsWith('.webmanifest')) return new Response('{}', {
        headers: { 'content-type': 'application/manifest+json' },
      });
      if (path.endsWith('.png')) return new Response('icon', { headers: { 'content-type': 'image/png' } });
      return new Response('<!doctype html>shell', {
        headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
      });
    },
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

test('wrong-MIME fonts and webmanifest are returned online but never cached', async () => {
  for (const [path, mime] of [
    ['/fonts/interface.woff2', 'application/json'],
    ['/fonts/interface.woff', 'application/json'],
    ['/manifest.webmanifest', 'text/plain'],
  ]) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('wrong-resource-mime', {
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
    assert.equal(await visit(), 'wrong-resource-mime', path + ': online response unchanged');
    online = false;
    await assert.rejects(visit(), /offline/, path + ': invalid MIME persisted');
  }
});

test('legacy cached wrong-MIME fonts and webmanifest are evicted before replay', async () => {
  for (const [path, mime] of [
    ['/fonts/interface.woff2', 'application/json'],
    ['/fonts/interface.woff', 'application/json'],
    ['/manifest.webmanifest', 'text/plain'],
  ]) {
    const url = 'https://app.test' + path;
    const app = worker();
    const cache = await app.caches.open('axom-shell-previous');
    await cache.put(url, withNetworkUrl(new Response('invalid-legacy-resource', {
      headers: { 'content-type': mime, 'cache-control': 'public, max-age=600' },
    }), url));
    let pending;
    app.events.get('fetch')({
      request: { url, method: 'GET', mode: 'same-origin' },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    await assert.rejects(pending, /offline/, path + ': invalid cached resource replayed');
    assert.equal(await cache.match(url), undefined, path + ': invalid cache entry retained');
  }
});

test('genuine font and webmanifest MIME stays available offline', async () => {
  for (const [path, mime] of [
    ['/fonts/interface.woff2', 'font/woff2; charset=utf-8'],
    ['/fonts/interface.woff', 'font/woff'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/manifest.webmanifest', 'application/json'],
  ]) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('valid-resource', {
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
    assert.equal(await visit(), 'valid-resource');
    online = false;
    assert.equal(await visit(), 'valid-resource', path + ': legitimate resource blocked');
  }
});

test('install never stores protected or wrong-MIME mandatory precache responses', async () => {
  const chunk = './assets/critical-12345678.js';
  for (const [label, codeHeaders] of [
    ['private', { 'content-type': 'text/javascript', 'cache-control': 'private, no-store' }],
    ['auth-varying', { 'content-type': 'text/javascript', vary: 'Cookie' }],
    ['HTML rewrite', { 'content-type': 'text/html', 'cache-control': 'public, max-age=600' }],
    ['JSON rewrite', { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' }],
  ]) {
    const app = worker({
      precache: [chunk], shippedChunks: [chunk],
      fetchResponse: async (url) => new URL(url).pathname.endsWith('.js')
        ? new Response('protected-bundle', { headers: codeHeaders })
        : new Response('<!doctype html>public', {
          headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
        }),
    });
    let install;
    app.events.get('install')({ waitUntil: (task) => { install = task; } });
    await assert.rejects(install, /Unsafe install asset/i, label);
    const cache = await app.caches.open('axom-shell-current');
    assert.equal(await cache.match(chunk), undefined, label + ': protected bytes persisted during install');
    assert.equal(await cache.match('./index.html'), undefined, label + ': invalid install must not install shell');
  }
});

test('install skips nonessential protected manifest/icon but preserves canonical shell', async () => {
  const app = worker({
    fetchResponse: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/manifest.webmanifest') {
        return new Response('private-manifest', {
          headers: { 'content-type': 'application/manifest+json', 'cache-control': 'private, no-store' },
        });
      }
      if (path === '/icon-192.png') {
        return new Response('private-icon', {
          headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
        });
      }
      return new Response('<!doctype html>public', { headers: {
        'content-type': 'text/html', 'cache-control': 'no-cache',
      } });
    },
  });
  let install;
  app.events.get('install')({ waitUntil: (task) => { install = task; } });
  await install;
  const cache = await app.caches.open('axom-shell-current');
  assert.equal(await cache.match('./manifest.webmanifest'), undefined);
  assert.equal(await cache.match('./icon-192.png'), undefined);
  assert.ok(await cache.match('./index.html'), 'public shell remains available');
});

test('install retains exact manifest-listed hashed JS/CSS despite no-store/no-cache', async () => {
  const chunks = ['./assets/critical-12345678.js', './assets/critical-12345678.css'];
  const app = worker({
    precache: chunks, shippedChunks: chunks,
    fetchResponse: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('.js') || path.endsWith('.css')) {
        return new Response('immutable-build-code', { headers: {
          'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css',
          'cache-control': path.endsWith('.js') ? 'no-store' : 'no-cache',
        } });
      }
      if (path.endsWith('.webmanifest')) {
        return new Response('{}', { headers: { 'content-type': 'application/manifest+json' } });
      }
      if (path.endsWith('.png')) {
        return new Response('icon', { headers: { 'content-type': 'image/png' } });
      }
      return new Response('<!doctype html>public', { headers: {
        'content-type': 'text/html', 'cache-control': 'no-cache',
      } });
    },
  });
  let install;
  app.events.get('install')({ waitUntil: (task) => { install = task; } });
  await install;
  const cache = await app.caches.open('axom-shell-current');
  for (const chunk of chunks) assert.equal(await (await cache.match(chunk)).text(), 'immutable-build-code', chunk);
  assert.ok(await cache.match('./index.html'));
});


test('update verifier redacts arbitrary page, worker and network diagnostic text', () => {
  const source = readFileSync(new URL('../web/scripts/verify-app-updates.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const installBrowserErrors = [];');
  const end = source.indexOf('const safePath =', start);
  assert.ok(start >= 0 && end > start, 'find the actual harness diagnostics block');
  const sandbox = vm.createContext({});
  vm.runInContext(source.slice(start, end) + '\nglobalThis.diagnostics = { recordBrowserError, installBrowserErrors };', sandbox);
  const { recordBrowserError, installBrowserErrors } = sandbox.diagnostics;
  const secret = 'SYNTHETIC_QUERY_SECRET_R47';
  recordBrowserError('page-console', `TypeError: failed to fetch https://app.test/path?access_token=${secret}`);
  recordBrowserError('worker-console', `QuotaExceededError: bearer ${secret}`);
  recordBrowserError('page-error', `SyntaxError: cookie=${secret}`);
  recordBrowserError('request-failed', `net::ERR_NAME_NOT_RESOLVED /api/?token=${secret}`);
  recordBrowserError(`untrusted-${secret}`, `unknown error with ${secret}`);
  const visible = JSON.parse(JSON.stringify(installBrowserErrors));
  assert.deepEqual(visible, [
    { kind: 'page-console', category: 'network' },
    { kind: 'worker-console', category: 'cache-quota' },
    { kind: 'page-error', category: 'script' },
    { kind: 'request-failed', category: 'network' },
    { kind: 'other', category: 'other' },
  ]);
  assert.ok(!JSON.stringify(visible).includes(secret), 'untrusted browser messages must not enter CI artifacts');
  for (let index = 0; index < 30; index++) recordBrowserError('worker-closed', secret);
  assert.equal(installBrowserErrors.length, 20, 'browser diagnostics remain bounded');
});


test('install caps concurrent CacheStorage writes without losing vetted assets or shell ordering', async () => {
  const chunks = Array.from({ length: 24 }, (_, index) =>
    `./assets/chunk-${String(index).padStart(8, '0')}.js`);
  let inflight = 0;
  let peak = 0;
  let completed = 0;
  const written = [];
  const app = worker({
    precache: chunks, shippedChunks: chunks,
    fetchResponse: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('.js')) return new Response('public-chunk', {
        headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000' },
      });
      if (path.endsWith('.webmanifest')) return new Response('{}', {
        headers: { 'content-type': 'application/manifest+json' },
      });
      if (path.endsWith('.png')) return new Response('icon', {
        headers: { 'content-type': 'image/png' },
      });
      return new Response('<!doctype html>public', {
        headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
      });
    },
    onCachePut: async (key) => {
      const path = new URL(key, 'https://app.test/').pathname;
      if (path.endsWith('.js')) {
        inflight++;
        peak = Math.max(peak, inflight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
        } finally {
          inflight--;
        }
        completed++;
      }
      written.push(path);
    },
  });
  let install;
  app.events.get('install')({ waitUntil: (task) => { install = task; } });
  await install;
  assert.equal(completed, chunks.length, 'each validated immutable chunk must finish caching');
  assert.ok(peak > 1 && peak <= 4, `CacheStorage write fan-out must be 2–4, observed ${peak}`);
  const cache = await app.caches.open('axom-shell-current');
  for (const chunk of chunks) {
    assert.equal(await (await cache.match(chunk))?.text(), 'public-chunk', chunk);
  }
  assert.ok(await cache.match('./index.html'), 'canonical offline shell must remain installed');
  assert.ok(await cache.match('./'), 'root offline shell must remain installed');
  assert.ok(await cache.match('./__axom-retained-public-chunks.json'), 'generation manifest must remain installed');
  assert.equal(written.at(-1), '/index.html', 'canonical shell must be written last');
});

test('R53 install phase probe reports deferred CacheStorage write without exposing URLs or account markers', async () => {
  let unblock, entered;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  const reached = new Promise((resolve) => { entered = resolve; });
  const asset = './assets/bootstrap-12345678.js';
  const app = worker({
    precache: [asset],
    fetchResponse: async (url) => new Response(url.endsWith('.js') ? 'export const ready = true;' : '<!doctype html>public', {
      headers: {
        'content-type': url.endsWith('.js') ? 'text/javascript' : 'text/html',
        'cache-control': url.endsWith('.js') ? 'no-store' : 'no-cache',
      },
    }),
    onCachePut: async (key) => { if (key === asset) { entered(); await blocked; } },
  });
  const progress = () => {
    let response;
    app.events.get('message')({ data: { type: 'AXOM_QUERY_INSTALL_PROGRESS', access_token: 'must-not-leak' },
      ports: [{ postMessage: (value) => { response = value; } }] });
    return response;
  };
  assert.equal(progress().phase, 'idle');
  let install;
  app.events.get('install')({ waitUntil: (promise) => { install = promise; } });
  await reached;
  const stalled = progress();
  assert.deepEqual(Object.keys(stalled).sort(), ['phase', 'shells', 'assetsTotal', 'assetsChecked', 'assetsWritten'].sort());
  assert.equal(stalled.phase, 'assets-write');
  assert.equal(stalled.shells, 2);
  assert.equal(stalled.assetsTotal, 3);
  assert.equal(stalled.assetsChecked, 3);
  assert.equal(stalled.assetsWritten, 0);
  assert.equal(JSON.stringify(stalled).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(stalled).includes('bootstrap'), false);
  unblock();
  await install;
  assert.equal(progress().phase, 'complete');
  assert.equal(progress().assetsWritten, 1);
});

test('R54 fetch backpressure: installation drains validated streamed assets before caching', async () => {
  const chunks = Array.from({ length: 24 }, (_, i) => './assets/fetch-' + String(i).padStart(8, '0') + '.js');
  let occupied = 0;
  let peak = 0;
  let drained = 0;
  let earlyWrites = 0;
  const waiting = [];
  const app = worker({
    precache: chunks,
    shippedChunks: chunks,
    fetchResponse: async (url) => {
      const path = new URL(url).pathname;
      if (!path.endsWith('.js')) {
        if (path.endsWith('.webmanifest')) {
          return new Response('{}', { headers: { 'content-type': 'application/manifest+json' } });
        }
        if (path.endsWith('.png')) {
          return new Response('icon', { headers: { 'content-type': 'image/png' } });
        }
        return new Response('<!doctype html>public', {
          headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
        });
      }
      // Model a connection pool that cannot serve more responses until one
      // existing response body has been consumed. Old unbounded Promise.all
      // reaches this limit without entering the CacheStorage write stage.
      if (occupied >= 3) await new Promise((resolve) => { waiting.push(resolve); });
      occupied++;
      peak = Math.max(peak, occupied);
      const response = new Response('public-streamed-chunk', {
        headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
      });
      const originalClone = response.clone.bind(response);
      let released = false;
      response.clone = () => {
        const clone = originalClone();
        const originalBlob = clone.blob.bind(clone);
        clone.blob = async () => {
          const blob = await originalBlob();
          if (!released) {
            released = true;
            occupied--;
            drained++;
            waiting.shift()?.();
          }
          return blob;
        };
        return clone;
      };
      return response;
    },
    onCachePut: async (path) => {
      if (path.endsWith('.js') && drained !== chunks.length) earlyWrites++;
    },
  });
  let install;
  app.events.get('install')({ waitUntil: (promise) => { install = promise; } });
  let timer;
  try {
    await Promise.race([
      install,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('asset fetch stalled on unread response bodies')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(drained, chunks.length, 'all public network bodies must drain before caching');
  assert.ok(peak >= 1 && peak <= 3, 'simulated concurrent response budget respected');
  assert.equal(earlyWrites, 0, 'no cache writes before all public assets validated and drained');
  const cache = await app.caches.open('axom-shell-current');
  for (const path of chunks) {
    assert.equal(await (await cache.match(path))?.text(), 'public-streamed-chunk', path);
  }
  assert.ok(await cache.match('./index.html'), 'offline shell installed');
  assert.ok(await cache.match('./__axom-retained-public-chunks.json'), 'retained build inventory installed');
});

test('R55 retained cached Response.url credentials and wrong build versions are evicted', async () => {
  const image = 'https://app.test/landing/hero.png';
  const badCases = [
    [image, image + '?access_token=SYNTHETIC_ACCOUNT_A_ONLY'],
    [image + '?v=build-20261111', image + '?v=build-20261109&__axom_revalidate=123'],
    [image, image + '?__axom_revalidate=123&sig=SYNTHETIC_SIGNATURE'],
    [image, image + '?__axom_revalidate=123&__axom_revalidate=456'],
  ];
  for (const [key, finalUrl] of badCases) {
    const app = worker();
    const legacy = await app.caches.open('axom-shell-legacy');
    await legacy.put(key, withNetworkUrl(new Response('SYNTHETIC_PRIVATE_BYTES', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
    }), finalUrl));
    await legacy.put('https://app.test/landing/unrelated.png', withNetworkUrl(
      new Response('keep-unrelated', { headers: { 'content-type': 'image/png' } }),
      'https://app.test/landing/unrelated.png'));
    let pending;
    app.events.get('fetch')({
      request: { url: key, method: 'GET', mode: 'same-origin', cache: 'default', headers: new Headers() },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending, 'shipped public resource must be intercepted');
    await assert.rejects(pending, /offline/, 'unsafe final URL must never replay');
    assert.equal(await legacy.match(key), undefined, 'evict only the unsafe cached key');
    assert.equal(await (await legacy.match('https://app.test/landing/unrelated.png')).text(),
      'keep-unrelated', 'retain unrelated public assets');
  }
});

test('R55 matching public query provenance keeps offline cache and internal revalidation', async () => {
  const image = 'https://app.test/landing/hero.png';
  const validCases = [
    [image, image],
    [image, image + '?__axom_revalidate=123'],
    [image + '?v=build-20261111', image + '?v=build-20261111&__axom_revalidate=123'],
  ];
  for (const [key, finalUrl] of validCases) {
    const app = worker();
    const legacy = await app.caches.open('axom-shell-legacy');
    await legacy.put(key, withNetworkUrl(new Response('public-image', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
    }), finalUrl));
    let pending;
    app.events.get('fetch')({
      request: { url: key, method: 'GET', mode: 'same-origin', cache: 'default', headers: new Headers() },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending);
    assert.equal(await (await pending).text(), 'public-image');
    assert.ok(await legacy.match(key), 'valid public response remains available offline');
  }
});

test('R56 encoded public versions replay correctly from legacy caches after internal revalidation', async () => {
  const image = 'https://app.test/landing/hero.png';
  for (const suffix of ['?v=build%2D20261111', '?v=1%2E2%2E3', '?v=build-20261111']) {
    const key = image + suffix;
    const finalUrl = new URL(key);
    finalUrl.searchParams.set('__axom_revalidate', '123');
    const app = worker();
    const legacy = await app.caches.open('axom-shell-legacy');
    await legacy.put(key, withNetworkUrl(new Response('public-encoded-image', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
    }), finalUrl.href));
    let pending;
    app.events.get('fetch')({
      request: { url: key, method: 'GET', mode: 'same-origin', cache: 'default', headers: new Headers() },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending, 'strict public version must be intercepted: ' + suffix);
    assert.equal(await (await pending).text(), 'public-encoded-image', 'replay must not fail for ' + suffix);
    assert.ok(await legacy.match(key), 'retain valid cached public asset: ' + suffix);
  }
});

test('R56 fresh encoded-version assets cache for offline replay without relaxing final-URL provenance', async () => {
  const image = 'https://app.test/landing/hero.png';
  for (const suffix of ['?v=build%2D20261111', '?v=1%2E2%2E3']) {
    let online = true;
    const app = worker({ fetchResponse: async () => {
      if (!online) throw new Error('offline');
      return new Response('fresh-public-image', {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
      });
    } });
    const request = { url: image + suffix, method: 'GET', mode: 'same-origin', cache: 'default', headers: new Headers() };
    const dispatch = async () => {
      let pending;
      const tasks = [];
      app.events.get('fetch')({
        request,
        respondWith: (value) => { pending = value; },
        waitUntil: (value) => { tasks.push(value); },
      });
      assert.ok(pending, 'approved encoded public version must be intercepted');
      const response = await pending;
      await Promise.all(tasks);
      return response.text();
    };
    assert.equal(await dispatch(), 'fresh-public-image', 'initial online response: ' + suffix);
    online = false;
    assert.equal(await dispatch(), 'fresh-public-image', 'offline cache replay: ' + suffix);
  }
});

test('R56 encoded public versions still reject substituted or credential-bearing final URLs', async () => {
  const image = 'https://app.test/landing/hero.png';
  const cases = [
    ['?v=build%2D20261111', '?v=build-20261110&__axom_revalidate=123'],
    ['?v=1%2E2%2E3', '?v=1.2.3&access_token=SYNTHETIC_ACCOUNT_A'],
    ['?v=1%2E2%2E3', '?v=1.2.3&__axom_revalidate=abc'],
    ['?v=build%2D20261111', '?v=build-20261111&__axom_revalidate=123&__axom_revalidate=456'],
  ];
  for (const [requestQuery, responseQuery] of cases) {
    const key = image + requestQuery;
    const app = worker();
    const legacy = await app.caches.open('axom-shell-legacy');
    await legacy.put(key, withNetworkUrl(new Response('SYNTHETIC_PRIVATE_BYTES', {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
    }), image + responseQuery));
    let pending;
    app.events.get('fetch')({
      request: { url: key, method: 'GET', mode: 'same-origin', cache: 'default', headers: new Headers() },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending);
    await assert.rejects(pending, /offline/, 'unsafe final URL must not replay');
    assert.equal(await legacy.match(key), undefined, 'evict only invalid final provenance');
  }
});

test('R58 install ignores rejected optional manifest/icon fetches but requires public code', async () => {
  const js = '/assets/core-12345678.js';
  const publicResponse = (pathname) => {
    const type = pathname === js ? 'application/javascript'
      : pathname.endsWith('.webmanifest') ? 'application/manifest+json'
      : pathname.endsWith('.png') ? 'image/png' : 'text/html';
    return new Response('public shell or asset', {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=600' },
    });
  };
  for (const optional of ['/manifest.webmanifest', '/icon-192.png']) {
    const app = worker({
      precache: ['./assets/core-12345678.js'],
      fetchResponse: async (url) => {
        const path = new URL(url).pathname;
        if (path === optional) throw new Error('optional public asset offline');
        return publicResponse(path);
      },
    });
    let pending;
    app.events.get('install')({ waitUntil: (task) => { pending = task; } });
    await pending;
    const cache = await app.caches.open('axom-shell-current');
    assert.ok(await cache.match('./index.html'), 'valid offline shell installed');
    assert.ok(await cache.match('./assets/core-12345678.js'), 'required JS still installed');
    assert.equal(await cache.match('.' + optional), undefined, 'failed optional asset omitted');
  }
});

test('R58 rejected optional body drain is tolerated, but required fetch failure remains fatal', async () => {
  const js = '/assets/core-12345678.js';
  const publicResponse = (pathname) => new Response('public shell or asset', {
    headers: {
      'content-type': pathname === js ? 'application/javascript'
        : pathname.endsWith('.webmanifest') ? 'application/manifest+json'
        : pathname.endsWith('.png') ? 'image/png' : 'text/html',
      'cache-control': 'public, max-age=600',
    },
  });
  const brokenIcon = () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('broken optional stream')); },
  }), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' } });
  const optionalApp = worker({
    precache: ['./assets/core-12345678.js'],
    fetchResponse: async (url) => new URL(url).pathname === '/icon-192.png'
      ? brokenIcon() : publicResponse(new URL(url).pathname),
  });
  let task;
  optionalApp.events.get('install')({ waitUntil: (value) => { task = value; } });
  await task;
  const installed = await optionalApp.caches.open('axom-shell-current');
  assert.ok(await installed.match('./index.html'));
  assert.ok(await installed.match('./assets/core-12345678.js'));
  assert.equal(await installed.match('./icon-192.png'), undefined);

  const requiredApp = worker({
    precache: ['./assets/core-12345678.js'],
    fetchResponse: async (url) => {
      if (new URL(url).pathname === js) throw new Error('required JS fetch failed');
      return publicResponse(new URL(url).pathname);
    },
  });
  let requiredTask;
  requiredApp.events.get('install')({ waitUntil: (value) => { requiredTask = value; } });
  await assert.rejects(requiredTask, /required JS fetch failed/);
  const held = await requiredApp.caches.open('axom-shell-current');
  assert.equal(await held.match('./index.html'), undefined, 'no partial offline shell');
});

test('R70 resolved navigation responses preserve online status, MIME, and body despite a cached offline shell', async () => {
  const cases = [
    ['PDF 200', 200, 'application/pdf', 'ONLINE_PDF_BYTES'],
    ['partial CSV 206', 206, 'text/csv', 'ONLINE_CSV_PARTIAL'],
    ['forbidden HTML 403', 403, 'text/html', 'ONLINE_FORBIDDEN'],
    ['server error HTML 503', 503, 'text/html', 'ONLINE_UNAVAILABLE'],
  ];
  for (const [name, status, type, body] of cases) {
    const app = worker({
      fetchResponse: async () => new Response(body, {
        status, headers: { 'content-type': type, 'cache-control': 'private, no-store' },
      }),
    });
    const cache = await app.caches.open('axom-shell-current');
    await cache.put('./index.html', withNetworkUrl(new Response('SAFE_OFFLINE_SHELL', {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
    }), 'https://app.test/index.html'));
    let pending;
    app.events.get('fetch')({
      request: { url: 'https://app.test/reports/view', method: 'GET', mode: 'navigate', headers: new Headers() },
      respondWith: (value) => { pending = value; },
      waitUntil: () => {},
    });
    assert.ok(pending, name + ': worker must handle navigation');
    const result = await pending;
    assert.equal(result.status, status, name + ': do not mask server status');
    assert.equal(result.headers.get('content-type'), type, name + ': preserve MIME');
    assert.equal(await result.text(), body, name + ': preserve online body');
    assert.equal(await (await cache.match('./index.html')).text(), 'SAFE_OFFLINE_SHELL',
      name + ': do not overwrite canonical offline shell');
  }
});

test('R70 genuine network rejection still replays only the validated offline shell', async () => {
  const app = worker({ fetchResponse: async () => { throw new Error('offline'); } });
  const cache = await app.caches.open('axom-shell-current');
  await cache.put('./index.html', withNetworkUrl(new Response('SAFE_OFFLINE_SHELL', {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' },
  }), 'https://app.test/index.html'));
  let pending;
  app.events.get('fetch')({
    request: { url: 'https://app.test/private-route', method: 'GET', mode: 'navigate', headers: new Headers() },
    respondWith: (value) => { pending = value; },
    waitUntil: () => {},
  });
  assert.ok(pending);
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'SAFE_OFFLINE_SHELL');
});


test('R71 optional cache writes may fail without discarding required offline shell', async () => {
  const required = './assets/core-12345678.js';
  const publicResponse = async (url) => {
    const path = new URL(url).pathname;
    const type = path.endsWith('.js') ? 'application/javascript'
      : path.endsWith('.webmanifest') ? 'application/manifest+json'
      : path.endsWith('.png') ? 'image/png' : 'text/html';
    return new Response('public-' + path, {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=600' },
    });
  };

  for (const optional of ['./manifest.webmanifest', './icon-192.png']) {
    const attempted = [];
    const app = worker({
      precache: [required],
      fetchResponse: publicResponse,
      onCachePut: async (key) => {
        attempted.push(key);
        if (key === optional) throw new Error('optional CacheStorage quota rejection');
      },
    });
    let pending;
    app.events.get('install')({ waitUntil: (value) => { pending = value; } });
    await pending;
    const cache = await app.caches.open('axom-shell-current');
    assert.ok(attempted.includes(optional), optional + ': injected write rejection was exercised');
    assert.equal(await cache.match(optional), undefined, optional + ': failed write stays absent');
    assert.ok(await cache.match(required), 'mandatory hashed JavaScript must remain available');
    assert.ok(await cache.match('./index.html'), 'canonical offline HTML must still install');
    assert.ok(await cache.match('./'), 'root offline HTML must still install');
  }

  const fatal = worker({
    precache: [required],
    fetchResponse: publicResponse,
    onCachePut: async (key) => {
      if (key === required) throw new Error('required JS cache write failed');
    },
  });
  let pending;
  fatal.events.get('install')({ waitUntil: (value) => { pending = value; } });
  await assert.rejects(pending, /required JS cache write failed/);
  const cache = await fatal.caches.open('axom-shell-current');
  assert.equal(await cache.match('./index.html'), undefined,
    'required code failure must not install a misleading usable offline shell');
});

test('R73 byte-range public asset requests bypass SW cache while ordinary GET remains offline-capable', async () => {
  const app = worker();
  const icon = '/icon-192.png';
  const cache = await app.caches.open('axom-shell-current');
  await cache.put(icon, withNetworkUrl(new Response('FULL_CACHED_ICON', {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' },
  }), 'https://app.test' + icon));

  for (const headers of [
    new Headers({ Range: 'bytes=0-3' }),
    new Headers({ Range: 'bytes=0-3', 'If-Range': '"icon-etag"' }),
  ]) {
    let intercepted = false;
    app.events.get('fetch')({
      request: {
        url: 'https://app.test' + icon, method: 'GET', mode: 'same-origin', headers,
      },
      respondWith: () => { intercepted = true; },
      waitUntil: () => {},
    });
    assert.equal(intercepted, false,
      'browser must handle byte ranges; never substitute a cached full HTTP 200 response');
  }

  let response;
  app.events.get('fetch')({
    request: {
      url: 'https://app.test' + icon, method: 'GET', mode: 'same-origin', headers: new Headers(),
    },
    respondWith: (value) => { response = value; },
    waitUntil: () => {},
  });
  assert.ok(response, 'normal public GET must remain intercepted for offline replay');
  assert.equal((await response).status, 200);
  assert.equal(await (await cache.match(icon)).text(), 'FULL_CACHED_ICON',
    'Range requests must not alter cached public content');
});
