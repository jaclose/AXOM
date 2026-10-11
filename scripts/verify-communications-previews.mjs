// Browser-check the real generated email matrix without contacting a provider.
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';
const output = new URL('../artifacts/communications/', import.meta.url);
const emails = (await readdir(new URL('emails/', output))).filter(name => name.endsWith('.html'));
assert.equal(emails.length, 160, 'Generate the full email matrix first.');
const browser = await chromium.launch({ channel: process.env.AXOM_E2E_CHANNEL ?? 'chrome' });
let checks = 0; let fallbackChecks = 0;
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  const inspect = async name => {
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      images: [...document.images].every(img => img.complete && img.naturalWidth > 0),
      headings: document.querySelectorAll('h1').length,
      text: document.body.innerText,
    }));
    assert.equal(result.overflow, false, `${name}: horizontal overflow`);
    assert.equal(result.images, true, `${name}: broken image`);
    assert.equal(result.headings, 1, `${name}: missing main heading`);
    assert.ok(!/undefined|NaN/.test(result.text), `${name}: invalid personalization`);
  };
  for (const width of [390, 660]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const name of emails) {
      await page.goto(new URL(`emails/${name}`, output).href);
      await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
      await inspect(`${name}/${width}`); checks++;
      if (/^(pulse|weekly_report|essay|welcome)-(dark-gold|light-teal)\.html$/.test(name)) {
        await page.screenshot({ path: fileURLToPath(new URL(`optical-${width}-${name.replace('.html', '.png')}`, output)), fullPage: true });
        // Losing embedded CSS must not lose content, actions, or a usable narrow layout.
        await page.locator('style').evaluateAll(nodes => nodes.forEach(node => node.remove()));
        await inspect(`${name}/${width}/without-style-block`); fallbackChecks++;
      }
    }
  }
  assert.deepEqual(errors, []);
  const result = { emailViewports: checks, staticFallbackViewports: fallbackChecks, consoleIssues: errors.length };
  await writeFile(new URL('email-browser-verification.json', output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
