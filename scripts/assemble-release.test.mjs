import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleRelease } from './assemble-release.mjs';
import { sha256, TARGETS } from './release-lib.mjs';

function fixture(t, version = '1.0.0') {
  const base = mkdtempSync(join(tmpdir(), 'axom-assembly-test-'));
  t.after(() => rmSync(base, { recursive: true }));
  const input = join(base, 'input');
  mkdirSync(input);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('12345678');
  const key = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64')}\n`).toString('base64');
  for (const [target, platform] of [...Object.entries(TARGETS).filter(([target]) => !target.startsWith('aarch64-unknown')), ['web', 'web']]) {
    const folder = join(input, platform);
    mkdirSync(folder);
    const file = `AXOM-${version}-${platform}${platform === 'web' ? '.zip' : platform.startsWith('darwin') ? '.app.tar.gz' : platform.startsWith('linux') ? '.AppImage' : '.exe'}`;
    const bytes = Buffer.from(`test fixture ${platform}`);
    writeFileSync(join(folder, file), bytes);
    const manifest = { version, buildId: 'same-commit', platform, target, signed: platform !== 'web', files: [{ name: file, bytes: bytes.length, sha256: sha256(bytes) }] };
    if (platform !== 'web') {
      const sig = sign(null, bytes, privateKey);
      const comment = `timestamp:1\tversion:${version}`;
      const signature = Buffer.from(`untrusted comment: signature\n${Buffer.concat([Buffer.from('Ed'), keyId, sig]).toString('base64')}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey).toString('base64')}\n`).toString('base64');
      writeFileSync(join(folder, `${file}.sig`), signature);
      manifest.files.push({ name: `${file}.sig`, bytes: signature.length, sha256: sha256(signature) });
      manifest.updater = { file, signature };
    }
    writeFileSync(join(folder, 'release-manifest.json'), JSON.stringify(manifest));
  }
  return { input, output: join(base, 'ready'), repository: 'test/repo', tag: `v${version}`, publicKey: key, changelog: `## ${version} — 2026-09-24 (Safer updates)\n\n- Your workspace is saved before restarting.\n` };
}

test('assembles all signed targets into one complete manifest only after verification', (t) => {
  const config = fixture(t);
  assert.throws(() => assembleRelease({ ...config, expectedBuildId: 'wrong-commit' }), /requested release commit/);
  assert.equal(existsSync(config.output), false);
  const result = assembleRelease({ ...config, expectedBuildId: 'same-commit' });
  assert.equal(result.platforms.length, 5);
  const latest = JSON.parse(readFileSync(join(config.output, 'latest.json')));
  assert.equal(Object.keys(latest.platforms).length, 4);
  assert.match(latest.notes, /Safer updates/);
  assert.match(readFileSync(join(config.output, 'RELEASE-NOTES.md'), 'utf8'), /Your workspace is saved before restarting/);
  assert.match(latest.platforms['darwin-aarch64'].url, /releases\/download\/v1.0.0/);
  assert.throws(() => assembleRelease(config), /already exists/);
});

test('refuses a release without version-matched notes before writing publication output', (t) => {
  const config = fixture(t);
  assert.throws(() => assembleRelease({ ...config, changelog: '# Changelog\n' }), /Add user-facing notes/);
  assert.equal(existsSync(config.output), false);
});

test('refuses missing platforms, corrupted bytes and inconsistent provenance', (t) => {
  const config = fixture(t);
  const path = join(config.input, 'web', 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(path));
  manifest.buildId = 'different';
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => assembleRelease(config), /different build IDs/);
  manifest.buildId = 'same-commit';
  writeFileSync(path, JSON.stringify(manifest));
  writeFileSync(join(config.input, 'web', manifest.files[0].name), 'tampered');
  assert.throws(() => assembleRelease(config), /Checksum or size mismatch/);
  rmSync(join(config.input, 'web'), { recursive: true });
  assert.throws(() => assembleRelease(config), /exactly five/);
  assert.equal(existsSync(config.output), false, 'Failed validation must not create a publish directory');
});

test('accepts supported SemVer build metadata and rejects malformed versions', (t) => {
  const config = fixture(t, '1.0.0-beta.1+build.5');
  assert.equal(assembleRelease(config).version, '1.0.0-beta.1+build.5');
  for (const tag of ['v01.0.0', 'v1.0.0-beta.01', 'v1.0.0-', '1.0.0']) {
    assert.throws(() => assembleRelease({ ...config, tag }), /version|SemVer/);
  }
});

test('refuses traversal, reserved outputs, symlinks and missing signature files before publication', (t) => {
  const config = fixture(t);
  const manifestPath = join(config.input, 'web', 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  const originalName = manifest.files[0].name;
  for (const name of ['../outside.zip', 'latest.json']) {
    manifest.files[0].name = name;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => assembleRelease(config), /Unsafe or reserved/);
  }
  manifest.files[0].name = originalName;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const artifact = join(config.input, 'web', originalName);
  const outside = join(config.input, 'outside.zip');
  writeFileSync(outside, readFileSync(artifact));
  rmSync(artifact);
  symlinkSync(outside, artifact);
  assert.throws(() => assembleRelease(config), /Symlinks/);
  rmSync(artifact);
  writeFileSync(artifact, readFileSync(outside));
  const nativePath = join(config.input, 'darwin-aarch64', 'release-manifest.json');
  const native = JSON.parse(readFileSync(nativePath));
  native.files = native.files.filter(file => !file.name.endsWith('.sig'));
  writeFileSync(nativePath, JSON.stringify(native));
  assert.throws(() => assembleRelease(config), /inconsistent updater signature/);
  assert.equal(existsSync(config.output), false);
});

test('rejects duplicate platforms, unsigned native packages and mismatched signatures', (t) => {
  const config = fixture(t);
  const manifestPath = join(config.input, 'darwin-aarch64', 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.signed = false;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => assembleRelease(config), /Unsigned or missing/);
  manifest.signed = true;
  const originalSignature = manifest.updater.signature;
  manifest.updater.signature += '!';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => assembleRelease(config), /inconsistent updater signature/);
  manifest.updater.signature = originalSignature;
  manifest.platform = 'darwin-x86_64';
  manifest.target = 'x86_64-apple-darwin';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => assembleRelease(config), /Duplicate platform/);
  assert.equal(existsSync(config.output), false);
});
