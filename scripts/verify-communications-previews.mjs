// Browser-check the real generated email matrix without contacting a provider.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';
const output = new URL('../artifacts/communications/', import.meta.url);
const emails = (await readdir(new URL('emails/', output))).filter(name => name.endsWith('.html'));
assert.equal(emails.length, 160, 'Generate the full email matrix first.');
const softwareGraphics = process.env.AXOM_E2E_SOFTWARE_GRAPHICS === '1';
const browser = await chromium.launch({ channel: process.env.AXOM_E2E_CHANNEL ?? 'chrome', args: softwareGraphics ? ['--disable-gpu'] : [] });
let checks = 0; let fallbackChecks = 0; let motionChecks = 0;
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultNavigationTimeout(60_000);
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
      assert.equal(await page.locator('.email-masthead').evaluate(el => getComputedStyle(el, '::after').animationName), 'none', `${name}: reduced motion must remain static`);
      if (/^(pulse|weekly_report|essay|welcome)-(dark-gold|light-teal)\.html$/.test(name)) {
        await page.screenshot({ path: fileURLToPath(new URL(`optical-${width}-${name.replace('.html', '.png')}`, output)), fullPage: true });
        const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => node.href));
        // Losing embedded CSS must not lose content, actions, or a usable narrow layout.
        await page.locator('style').evaluateAll(nodes => nodes.forEach(node => node.remove()));
        await inspect(`${name}/${width}/without-style-block`); fallbackChecks++;
        assert.deepEqual(await page.locator('a').evaluateAll(nodes => nodes.map(node => node.href)), links);
        await page.reload();
        // Freeze before enabling motion so a busy host cannot finish the finite animation
        // between navigation and inspection. Seek the browser's real animation below.
        await page.addStyleTag({ content: '.email-masthead::after{animation-play-state:paused!important}' });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const motion = await page.locator('.email-masthead').evaluate(el => {
          const style = getComputedStyle(el, '::after');
          return { name: style.animationName, iterations: Number(style.animationIterationCount), duration: parseFloat(style.animationDuration), delay: parseFloat(style.animationDelay) };
        });
        assert.equal(motion.name, 'email-luster');
        assert.equal(motion.iterations, 1, 'Inbox motion cannot loop without a pause control.');
        assert.ok(motion.duration > 0 && motion.duration + motion.delay <= 5, 'Inbox motion must settle within five seconds.');
        // Seek the real CSS animation to exercise both the visible sweep and its final state.
        const poses = await page.evaluate(() => {
          const animation = document.getAnimations().find(item => item.animationName === 'email-luster');
          const el = document.querySelector('.email-masthead');
          if (!animation || !el) return null;
          animation.pause(); animation.currentTime = 1100;
          const during = getComputedStyle(el, '::after');
          const opacity = Number(during.opacity); const transform = during.transform;
          animation.finish();
          return { opacity, transform, endOpacity: Number(getComputedStyle(el, '::after').opacity) };
        });
        assert.ok(poses?.opacity > 0 && poses.transform !== 'none');
        assert.equal(poses.endOpacity, 0);
        motionChecks++;
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
    }
  }
  assert.deepEqual(errors, []);
  const previewManifestSha256 = createHash('sha256').update(await readFile(new URL('preview-manifest.json', output))).digest('hex');
  const result = { checkedAt: new Date().toISOString(), previewManifestSha256, softwareGraphics, emailViewports: checks, staticFallbackViewports: fallbackChecks, boundedMotionViewports: motionChecks, reducedMotionViewports: checks, consoleIssues: errors.length };
  await writeFile(new URL('email-browser-verification.json', output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
