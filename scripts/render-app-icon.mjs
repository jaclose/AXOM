#!/usr/bin/env node
// Renders the desktop app icon (macOS grid: 1024 canvas, 824 squircle, soft
// shadow) from vector sources, then regenerates every native size with Tauri.
//
//   node scripts/render-app-icon.mjs            # render + tauri icon
//   node scripts/render-app-icon.mjs --png-only # render the 1024 PNG only
//
// Uses the Playwright already installed for web e2e (installed Google Chrome).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'design/icon/axom-app-icon-1024.png');
const svgOut = join(root, 'design/icon/axom-app-icon.svg');
const { chromium } = createRequire(join(root, 'web/package.json'))('@playwright/test');

/** Superellipse (n = 5) — close to Apple's continuous-corner app shape. */
function squircle(x, y, size, n = 5, steps = 360) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push([cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return `M${points.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}Z`;
}

// The canonical brand artwork (ivory mark on textured black). Its mark is cut
// out by luminance and placed at ~1:1 scale, so no detail is invented or lost.
const art = `data:image/png;base64,${(await readFile(join(root, 'web/public/icon-512.png'))).toString('base64')}`;
const ART_MARK_CENTER = [266.5, 253];
const markScale = 1.14;
const body = squircle(100, 92, 824);
const artX = 512 - ART_MARK_CENTER[0] * markScale;
const artY = 502 - ART_MARK_CENTER[1] * markScale;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="body"><path d="${body}"/></clipPath>
    <linearGradient id="slate" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#26272b"/>
      <stop offset="0.5" stop-color="#16171a"/>
      <stop offset="1" stop-color="#0b0b0d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.1" r="0.95">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.09"/>
      <stop offset="0.6" stop-color="#ffffff" stop-opacity="0.01"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.46" r="0.72">
      <stop offset="0.62" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.38"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="0.3" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="11"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.11"/></feComponentTransfer>
    </filter>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.35"/>
      <feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <!-- Keep the artwork's own ivory shading; drop its black ground by luminance. -->
    <filter id="cutout" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="luminanceToAlpha" in="SourceGraphic" result="lum"/>
      <feComponentTransfer in="lum" result="matte"><feFuncA type="linear" slope="3.4" intercept="-0.62"/></feComponentTransfer>
      <feComposite in="SourceGraphic" in2="matte" operator="in" result="mark"/>
      <feDropShadow in="mark" dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.7"/>
    </filter>
  </defs>
  <g filter="url(#lift)"><path d="${body}" fill="url(#slate)"/></g>
  <g clip-path="url(#body)">
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <rect width="1024" height="1024" filter="url(#grain)"/>
    <rect width="1024" height="1024" fill="url(#vignette)"/>
    <image href="${art}" x="${artX}" y="${artY}" width="${512 * markScale}" height="${512 * markScale}" filter="url(#cutout)"/>
  </g>
  <path d="${body}" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#body)"/>
  <path d="${body}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="1.5"/>
</svg>`;

await mkdir(dirname(out), { recursive: true });
await writeFile(svgOut, svg);
const browser = await chromium.launch({ channel: process.env.AXOM_BROWSER_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
} finally {
  await browser.close();
}
console.log(`Rendered ${out}`);

if (!process.argv.includes('--png-only')) {
  const cli = join(root, 'web/node_modules/@tauri-apps/cli/tauri.js');
  const result = spawnSync(process.execPath, [cli, 'icon', out, '--output', 'src-tauri/icons'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('tauri icon failed');
}
