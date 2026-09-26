import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignature } from './release-lib.mjs';

test('real Tauri CLI signing is compatible and binds payload to release version', (t) => {
  const stage = mkdtempSync(join(tmpdir(), 'axom-signature-test-'));
  t.after(() => rmSync(stage, { recursive: true }));
  const cli = fileURLToPath(new URL('../web/node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
  const key = join(stage, 'test.key');
  const file = join(stage, 'payload');
  writeFileSync(file, 'AXOM disposable signature fixture');
  // Capture CLI output: signer generate can print private key material.
  for (const args of [['signer', 'generate', '--ci', '--password', '', '--write-keys', key], ['signer', 'sign', '--private-key-path', key, '--password', '', '--app-version', '1.2.3', file]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'Tauri fixture signing failed (private output intentionally withheld)');
  }
  const signature = readFileSync(file + '.sig', 'utf8');
  const publicKey = readFileSync(key + '.pub', 'utf8');
  assert.match(Buffer.from(signature.trim(), 'base64').toString(), /1\.2\.3/, 'Tauri CLI failed to bind version to signature');
  assert.equal(verifySignature(readFileSync(file), signature, publicKey, '1.2.3'), true);
  assert.throws(() => verifySignature(readFileSync(file), signature, publicKey, '9.9.9'), /announced app version/);
});
