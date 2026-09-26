import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { hostTarget, validateVersion, validateUpdaterSettings, verifySignature } from './release-lib.mjs';

test('release versions cannot become paths, shell commands or malformed semver', () => {
  for (const v of ['0.0.1-prebeta', '1.2.3-beta.10', '1.2.3+build.1', '1.2.3']) assert.equal(validateVersion(v), v);
  for (const v of ['../1.0.0', '01.2.3', '1.2', '1.2.3-beta.01', '1.2.3;echo fail', '']) assert.throws(() => validateVersion(v));
  assert.equal(hostTarget('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(hostTarget('win32', 'x64'), 'x86_64-pc-windows-msvc');
});

test('signed release preflight refuses missing signing identity', () => {
  assert.throws(() => validateUpdaterSettings({}), /require/);
  assert.throws(() => validateUpdaterSettings({ AXOM_UPDATER_PUBLIC_KEY: 'fake', AXOM_UPDATER_ENDPOINT: 'http://test', TAURI_SIGNING_PRIVATE_KEY: 'x' }), /public key/);
  assert.throws(() => validateUpdaterSettings({ AXOM_UPDATER_PUBLIC_KEY: 'fake', AXOM_UPDATER_ENDPOINT: 'https://test', TAURI_SIGNING_PRIVATE_KEY: '  ' }), /require/);
});

for (const algorithm of ['Ed', 'ED']) test(`authentic ${algorithm} updater accepted; changed data/key/comment rejected`, () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = Buffer.from('12345678');
  const key = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`).toString('base64');
  const bytes = Buffer.from('release bytes');
  const data = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const signature = sign(null, data, privateKey);
  const comment = 'timestamp:1 file:app.tar.gz';
  const envelope = `untrusted comment: signature\n${Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString('base64')}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString('base64')}\n`;
  const encoded = Buffer.from(envelope).toString('base64');
  assert.equal(verifySignature(bytes, encoded, key), true);
  assert.throws(() => verifySignature(Buffer.from('tampered'), encoded, key), /verification failed/);
  assert.throws(() => verifySignature(bytes, Buffer.from(envelope.replace('timestamp:1', 'timestamp:2')).toString('base64'), key), /comment verification/);
  assert.throws(() => verifySignature(bytes, encoded, key, '1.2.3'), /announced app version/);
  assert.throws(() => verifySignature(bytes, encoded + '!', key), /base64 encoding/);
  assert.throws(() => verifySignature(bytes, encoded, key + '!'), /base64 encoding/);
  assert.throws(() => verifySignature(bytes, Buffer.from(envelope.replace('untrusted comment: signature', 'not a signature')).toString('base64'), key), /signature envelope/);
  assert.throws(() => verifySignature(bytes, Buffer.from(envelope + 'extra line\n').toString('base64'), key), /signature envelope/);
  const wrongId = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), Buffer.from('87654321'), raw]).toString('base64')}\n`).toString('base64');
  assert.throws(() => verifySignature(bytes, encoded, wrongId), /key ID mismatch/);
  const otherRaw = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const wrongKey = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, otherRaw]).toString('base64')}\n`).toString('base64');
  assert.throws(() => verifySignature(bytes, encoded, wrongKey), /verification failed/);
});
