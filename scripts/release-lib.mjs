import { createHash, createPublicKey, verify } from 'node:crypto';

export function validateVersion(version) {
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const pattern = new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  if (typeof version !== 'string' || !pattern.test(version)) throw new Error('Version must be valid SemVer, e.g. 0.1.0-beta.1 or 1.0.0.');
  return version;
}

export const TARGETS = {
  'aarch64-apple-darwin': 'darwin-aarch64',
  'x86_64-apple-darwin': 'darwin-x86_64',
  'x86_64-pc-windows-msvc': 'windows-x86_64',
  'x86_64-unknown-linux-gnu': 'linux-x86_64',
  'aarch64-unknown-linux-gnu': 'linux-aarch64',
};

export function hostTarget(platform, arch) {
  const target = Object.keys(TARGETS).find((key) => TARGETS[key] === `${platform === 'win32' ? 'windows' : platform}-${arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch}`);
  if (!target) throw new Error(`Unsupported build host: ${platform}/${arch}.`);
  return target;
}

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function validateUpdaterSettings(env) {
  const publicKey = env.AXOM_UPDATER_PUBLIC_KEY?.trim();
  const endpoint = env.AXOM_UPDATER_ENDPOINT?.trim();
  if (!publicKey || !endpoint || !env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error('Signed releases require AXOM_UPDATER_PUBLIC_KEY, AXOM_UPDATER_ENDPOINT and TAURI_SIGNING_PRIVATE_KEY. See docs/DESKTOP-RELEASE.md.');
  }
  parsePublicKey(publicKey);
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || /YOUR_|your-user|example\.(com|org)/i.test(endpoint)) {
    throw new Error('Updater endpoint must be a real public HTTPS URL without credentials or placeholders.');
  }
  return { pubkey: publicKey, endpoints: [endpoint], requireSignedVersion: true, allowDowngrades: false, windows: { installMode: 'passive' } };
}

function decodeBase64(value, label) {
  // Buffer.from is deliberately permissive; the Rust updater is not. Never
  // approve a release envelope that installed clients cannot decode.
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.length === 0) {
    throw new Error(`Invalid ${label} base64 encoding.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error(`Invalid ${label} base64 encoding.`);
  return bytes;
}

function decodeEnvelope(value, label) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} envelope.`);
  const bytes = decodeBase64(value.trim(), label);
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`Invalid ${label} UTF-8 encoding.`); }
  return decoded.trimEnd().split(/\r?\n/);
}

function parsePublicKey(value) {
  const lines = decodeEnvelope(value, 'updater public key');
  if (lines.length !== 2 || !lines[0]?.startsWith('untrusted comment: ')) throw new Error('Updater public key must be the full base64 content of the Tauri .pub file.');
  const bytes = decodeBase64(lines[1], 'updater public key');
  if (bytes.length !== 42 || bytes.subarray(0, 2).toString() !== 'Ed') throw new Error('Invalid updater Ed25519 public key.');
  return bytes;
}

// Verify the same minisign envelope that the Tauri updater verifies, including
// the trusted comment. Signatures use Ed25519, optionally Blake2b prehashed.
export function verifySignature(artifact, signature, publicKey, expectedVersion) {
  const key = parsePublicKey(publicKey);
  const lines = decodeEnvelope(signature, 'updater signature');
  if (lines.length !== 4 || !lines[0]?.startsWith('untrusted comment: ')) throw new Error('Invalid updater signature envelope.');
  const signed = decodeBase64(lines[1], 'updater signature');
  if (signed.length !== 74 || !['Ed', 'ED'].includes(signed.subarray(0, 2).toString()) || !signed.subarray(2, 10).equals(key.subarray(2, 10))) {
    throw new Error('Updater signature format or key ID mismatch.');
  }
  const publicObject = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' });
  const data = signed.subarray(0, 2).toString() === 'ED' ? createHash('blake2b512').update(artifact).digest() : artifact;
  if (!verify(null, data, publicObject, signed.subarray(10))) throw new Error('Updater artifact signature verification failed.');
  if (!lines[2]?.startsWith('trusted comment: ')) throw new Error('Missing updater trusted comment.');
  const comment = Buffer.from(lines[2].slice('trusted comment: '.length));
  const globalSignature = decodeBase64(lines[3], 'updater trusted comment signature');
  if (globalSignature.length !== 64 || !verify(null, Buffer.concat([signed.subarray(10), comment]), publicObject, globalSignature)) {
    throw new Error('Updater signature trusted comment verification failed.');
  }
  if (expectedVersion !== undefined) {
    const bound = comment.toString().split('\t').find((part) => part.startsWith('version:'))?.slice('version:'.length);
    if (bound !== expectedVersion) throw new Error('Updater signature is not bound to the announced app version.');
  }
  return true;
}
