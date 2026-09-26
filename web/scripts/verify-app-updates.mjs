/* global console, document, Event, indexedDB, localStorage, navigator, process, URL, window */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'axom-update-browser-'));
const builds = [join(stage, 'a'), join(stage, 'b')];
let active = builds[0];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(active, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(active + '/')) throw new Error('path');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  for (const [index, folder] of builds.entries()) {
    const build = spawnSync(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', folder], { cwd: web, env: { ...process.env, AXOM_BUILD_ID: `update-test-${index}` }, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(build.stderr + build.stdout);
    const manifest = JSON.parse(await readFile(join(folder, '.vite/manifest.json'), 'utf8'));
    const worker = await readFile(join(folder, 'sw.js'), 'utf8');
    const precache = JSON.parse(worker.match(/^const PRECACHE = (.+);$/m)[1]);
    assert.ok(precache.includes(`./${manifest['src/lib/updateCheckpoint.ts'].file}`), 'update checkpoint must survive removal of old deployment assets');
    for (const [key, entry] of Object.entries(manifest)) {
      if (/dailyWordWords|DailyWordPage/.test(key)) assert.ok(!precache.includes(`./${entry.file}`), 'optional game code must remain lazy');
    }
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.AXOM_BROWSER_CHANNEL ? { channel: process.env.AXOM_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByLabel('Display name (optional)').fill('Update persistence check');
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; localStorage.setItem('axom.theme', 'light'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const oldEntry = await page.locator('script[type="module"][src]').getAttribute('src');
  const peer = await context.newPage();
  await peer.goto(origin, { waitUntil: 'networkidle' });
  let peerNavigations = 0;
  peer.on('framenavigated', (frame) => { if (frame === peer.mainFrame()) peerNavigations++; });
  const oldWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration.active.scriptURL;
  });
  let navigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
  active = builds[1];
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  assert.equal(navigations, 0, 'new worker forced navigation');
  await page.evaluate(() => window.dispatchEvent(new Event('axom:check-for-updates')));
  const panel = page.getByRole('dialog', { name: 'AXOM updates', exact: true });
  await panel.getByRole('button', { name: 'Save and refresh', exact: true }).waitFor();
  assert.equal(navigations, 0, 'update check forced navigation');
  page.once('dialog', (dialog) => dialog.accept());
  try {
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), panel.getByRole('button', { name: 'Save and refresh', exact: true }).click()]);
  } catch (error) {
    throw new Error(`Update did not navigate. Panel: ${await panel.innerText().catch(() => 'closed')}`, { cause: error });
  }
  const newEntry = await page.locator('script[type="module"][src]').getAttribute('src');
  assert.notEqual(newEntry, oldEntry, 'refresh must run the new build, not the old cached shell');
  assert.equal(peerNavigations, 0, 'updating one tab must not navigate another open workspace');
  assert.equal(await peer.locator('script[type="module"][src]').getAttribute('src'), oldEntry);
  await page.evaluate(() => window.dispatchEvent(new Event('axom:check-for-updates')));
  await panel.getByText('You’re running the latest available build.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  const saved = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('noctyrium-local-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const state = await new Promise((resolve, reject) => {
      const request = db.transaction('state').objectStore('state').get('noctyrium-state');
      request.onsuccess = () => resolve(JSON.parse(request.result)); request.onerror = () => reject(request.error);
    });
    db.close();
    return { name: state.state.profile.name, theme: localStorage.getItem('axom.theme'), backups: Object.keys(localStorage).filter((key) => key.startsWith('axom.backups.local.')).length };
  });
  assert.equal(saved.name, 'Update persistence check');
  assert.equal(saved.theme, 'light');
  assert.ok(saved.backups > 0, 'update did not create recovery snapshot');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#root')?.textContent?.includes('Update persistence check'));
  console.log(JSON.stringify({ twoBuildUpdate: true, consentRequired: true, workspacePreserved: true, recoverySnapshotCreated: true, otherTabNotReloaded: true, offlineAfterUpdate: true, optionalGamesRemainLazy: true, oldWorker, navigations }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(stage, { recursive: true, force: true });
}
