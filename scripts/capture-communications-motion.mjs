// Optional local visual artifact. Uses a fresh, synthetic browser profile; never sends mail.
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';
import { rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../artifacts/communications/', import.meta.url));
const baseUrl = process.env.AXOM_E2E_BASE_URL ?? 'http://127.0.0.1:5196';
const browser = await chromium.launch({ channel: process.env.AXOM_E2E_CHANNEL ?? 'chrome' });
let raw; let trim; let duration;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', recordVideo: { dir: out + 'motion-source', size: { width: 1440, height: 900 } } });
  await context.addInitScript(() => {
    localStorage.setItem('axom.guideOffer.v1', 'declined');
    localStorage.setItem('axom.coach.v1', JSON.stringify({ seen: ['overwhelmed'], off: true }));
  });
  const started = Date.now(); const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => Boolean(window.__AXOM_DEV__));
  await page.evaluate(async () => {
    const dev = await window.__AXOM_DEV__;
    dev.useStore.getState().updateProfile({ onboarded: true, tourDone: true, name: 'Alex Morgan', promisePromptStatus: { state: 'skipped', updatedAt: new Date().toISOString(), promptVersion: 'promise-prompt-v1' } });
    dev.useStore.setState({ logs: Array.from({ length: 24 }, (_, i) => ({ id: 'optical-fixture-' + i, dayKey: `2026-09-${String(i + 1).padStart(2, '0')}`, ts: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z`, type: 'Study', minutes: 60, academic: true })), questions: [] });
    await dev.flushVault();
  });
  await page.goto(baseUrl + '/#pulse?year=2026');
  await page.locator('.pulse-hero-copy[data-optical-active=true]').waitFor();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; delete document.documentElement.dataset.motion; });
  await page.waitForTimeout(1200); trim = (Date.now() - started) / 1000;
  // A whole 12-second cycle is the subject of this capture, not a readiness wait.
  await page.waitForTimeout(13700);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(5200); duration = (Date.now() - started) / 1000 - trim;
  const video = page.video(); await context.close(); raw = await video.path();
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
const output = out + 'pulse-optical-motion.webm';
const pending = out + 'pulse-optical-motion.pending.webm';
// A 16:9 hero excerpt also excludes Chrome screencast padding below the hero.
const result = spawnSync(process.env.AXOM_FFMPEG_BINARY ?? 'ffmpeg', ['-y', '-ss', String(trim), '-i', raw, '-t', String(duration), '-an', '-vf', 'crop=1440:810:0:0', '-c:v', 'libvpx-vp9', '-threads', '2', '-deadline', 'realtime', '-cpu-used', '5', '-crf', '32', '-b:v', '0', pending], { encoding: 'utf8', timeout: 180_000 });
if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr.slice(-1200));
await rename(pending, output);
console.log(JSON.stringify({ output, duration, syntheticFixture: true }));
