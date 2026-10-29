import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const readJson = path => JSON.parse(readFileSync(new URL(path, repoRoot), 'utf8'));
const pinnedNode = readFileSync(new URL('.nvmrc', repoRoot), 'utf8').trim();

// October 21, 2026 Node.js security release (TLS, DNS, Brotli fixes).
test('Node 22 pin includes the October 2026 security fixes', () => {
  assert.match(pinnedNode, /^22\.\d+\.\d+$/);
  const [major, minor, patch] = pinnedNode.split('.').map(Number);
  assert.equal(major, 22);
  assert.ok(minor > 23 || (minor === 23 && patch >= 4),
    `Node ${pinnedNode} is older than the patched 22.23.4 baseline`);
});

test('root and web engine floors match the pin and lockfile metadata', () => {
  for (const packageRoot of ['', 'web/']) {
    const manifest = readJson(`${packageRoot}package.json`);
    const lockfile = readJson(`${packageRoot}package-lock.json`);
    assert.equal(manifest.engines.node, `>=${pinnedNode} <23`, `${packageRoot}package.json`);
    assert.deepEqual(lockfile.packages[''].engines, manifest.engines,
      `${packageRoot}package-lock.json`);
  }
});
