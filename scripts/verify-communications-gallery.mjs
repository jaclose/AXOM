// Verify the portable gallery through HTTP, including its entire local link closure.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';

const root = fileURLToPath(new URL('../artifacts/communications/', import.meta.url));
const mime = { '.html': 'text/html', '.md': 'text/plain', '.txt': 'text/plain', '.png': 'image/png', '.webm': 'video/webm', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Outside gallery');
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
let browser;
const softwareGraphics = process.env.AXOM_E2E_SOFTWARE_GRAPHICS === '1';
try {
  browser = await chromium.launch({ channel: process.env.AXOM_E2E_CHANNEL ?? 'chrome', args: softwareGraphics ? ['--disable-gpu'] : [] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultNavigationTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  const pending = await page.locator('[src],a[href],link[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src') ?? node.getAttribute('href')));
  const seen = new Set();
  while (pending.length) {
    const url = new URL(pending.pop(), base); url.hash = '';
    assert.equal(url.origin + '/', base, `Gallery asset or link must be local: ${url}`);
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const result = await page.request.get(url.href);
    assert.equal(result.status(), 200, `Broken gallery link: ${url.pathname}`);
    if (url.pathname.endsWith('.md')) {
      for (const match of (await result.text()).matchAll(/\]\(([^)]+)\)/g)) {
        const target = new URL(match[1], url);
        if (target.origin === url.origin) pending.push(target.href);
      }
    }
  }
  let selections = 0;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const template of ['pulse', 'weekly_report', 'essay', 'welcome']) {
      await page.locator(`[data-template="${template}"]`).click();
      assert.equal(await page.locator('#template').inputValue(), template);
      assert.equal(await page.locator(`[data-template="${template}"]`).getAttribute('aria-pressed'), 'true');
      selections++;
    }
    for (const [id, values] of Object.entries({ template: await page.locator('#template option').evaluateAll(nodes => nodes.map(node => node.value)), theme: ['dark', 'light'], accent: ['gold', 'teal', 'violet', 'rose'], width: ['desktop', 'mobile'] })) {
      for (const value of values) {
        await page.locator('#' + id).selectOption(value);
        const source = await page.locator('#preview').getAttribute('src');
        await page.frameLocator('#preview').locator('h1').waitFor();
        assert.equal(await page.locator('#open-email').getAttribute('href'), source);
        assert.equal((await page.request.get(new URL(source, base).href)).status(), 200);
        assert.equal((await page.request.get(new URL(await page.locator('#open-text').getAttribute('href'), base).href)).status(), 200);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: gallery overflow`);
        selections++;
      }
    }
    await page.locator('#template').selectOption('pulse');
    await page.locator('#theme').selectOption('dark');
    await page.locator('#accent').selectOption('gold');
    await page.locator('#width').selectOption(width === 390 ? 'mobile' : 'desktop');
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: root + `gallery-${width}.png`, fullPage: true });
    const video = await page.locator('video').evaluate(async el => {
      await el.play(); el.pause();
      return { controls: el.controls, duration: el.duration, paused: el.paused, autoplay: el.autoplay };
    });
    assert.ok(video.controls && video.paused && !video.autoplay && video.duration > 0);
  }
  assert.deepEqual(errors, []);
  const previewManifestSha256 = createHash('sha256').update(await readFile(root + 'preview-manifest.json')).digest('hex');
  const result = { checkedAt: new Date().toISOString(), previewManifestSha256, softwareGraphics, localLinks: seen.size, controlSelections: selections, videoChecks: 2, consoleIssues: errors.length };
  await writeFile(root + 'gallery-browser-verification.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
