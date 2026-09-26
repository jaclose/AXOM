#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVersion, verifySignature } from './release-lib.mjs';
import { formatReleaseNotes, requireReleaseNotes } from './release-notes.mjs';

const REQUIRED_TARGETS = new Map([
  ['darwin-aarch64', 'aarch64-apple-darwin'],
  ['darwin-x86_64', 'x86_64-apple-darwin'],
  ['windows-x86_64', 'x86_64-pc-windows-msvc'],
  ['linux-x86_64', 'x86_64-unknown-linux-gnu'],
  ['web', 'web'],
]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const RESERVED = new Set(['latest.json', 'release-summary.json', 'SHA256SUMS.txt', 'RELEASE-NOTES.md', 'release-manifest.json']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function findManifests(directory, depth = 0) {
  if (depth > 4) throw new Error('Unexpected release artifact directory depth.');
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in release artifacts: ${name}`);
    if (stat.isDirectory()) result.push(...findManifests(path, depth + 1));
    else if (name === 'release-manifest.json') result.push(path);
  }
  return result;
}

/** Validate every platform before writing anything into the publish directory. */
export function assembleRelease({ input, output, repository, tag, publicKey, expectedBuildId, now = new Date(), changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8') }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Expected repository in owner/name form.');
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Expected a semantic version tag beginning with v.');
  const version = validateVersion(tag.slice(1));
  const releaseNotes = requireReleaseNotes(changelog, version);
  if (!publicKey?.trim()) throw new Error('AXOM_UPDATER_PUBLIC_KEY is required to verify updater signatures.');
  if (existsSync(output)) throw new Error('Publish output already exists; use a fresh directory.');
  const manifests = findManifests(input);
  if (manifests.length !== REQUIRED_TARGETS.size) throw new Error('A release requires exactly five manifests: web plus all four native targets.');

  const seenPlatforms = new Set();
  const assets = new Map();
  const platforms = {};
  const provenance = [];
  let buildId;
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const { platform, target } = manifest;
    if (!REQUIRED_TARGETS.has(platform) || REQUIRED_TARGETS.get(platform) !== target) throw new Error(`Unrecognized target/platform: ${target}/${platform}`);
    if (seenPlatforms.has(platform)) throw new Error(`Duplicate platform: ${platform}`);
    seenPlatforms.add(platform);
    if (manifest.version !== version) throw new Error(`Version mismatch in ${platform}.`);
    if (typeof manifest.buildId !== 'string' || !manifest.buildId.trim()) throw new Error(`Missing build provenance in ${platform}.`);
    if (expectedBuildId !== undefined && manifest.buildId !== expectedBuildId) throw new Error(`Artifact build ID does not match the requested release commit: ${platform}.`);
    if (buildId && manifest.buildId !== buildId) throw new Error('Artifacts were built from different build IDs.');
    buildId = manifest.buildId;
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error(`Empty artifact list in ${platform}.`);
    const localFiles = new Map();
    for (const file of manifest.files) {
      if (typeof file.name !== 'string' || !SAFE_NAME.test(file.name) || basename(file.name) !== file.name || RESERVED.has(file.name)) throw new Error(`Unsafe or reserved artifact filename in ${platform}.`);
      if (assets.has(file.name)) throw new Error(`Artifact name collision: ${file.name}`);
      const path = join(dirname(manifestPath), file.name);
      if (!lstatSync(path).isFile()) throw new Error(`Artifact is not a regular file: ${file.name}`);
      const bytes = readFileSync(path);
      if (!Number.isSafeInteger(file.bytes) || file.bytes !== bytes.length || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || digest(bytes) !== file.sha256) throw new Error(`Checksum or size mismatch: ${file.name}`);
      const asset = { ...file, path };
      assets.set(file.name, asset);
      localFiles.set(file.name, { ...asset, bytes });
    }
    if (platform === 'web') {
      if (manifest.signed !== false || manifest.updater) throw new Error('Static web packages must not masquerade as desktop updater artifacts.');
      if (![...localFiles.keys()].some(name => name.endsWith('.zip'))) throw new Error('Missing static web ZIP.');
    } else {
      if (manifest.signed !== true || !manifest.updater) throw new Error(`Unsigned or missing updater artifact: ${platform}`);
      const { file, signature } = manifest.updater;
      const updater = localFiles.get(file);
      const sidecar = localFiles.get(`${file}.sig`);
      if (!updater || !sidecar || typeof signature !== 'string' || signature.trim() !== sidecar.bytes.toString('utf8').trim()) throw new Error(`Missing or inconsistent updater signature: ${platform}`);
      const extension = platform.startsWith('darwin-') ? '.app.tar.gz' : platform.startsWith('windows-') ? '.exe' : '.AppImage';
      if (!file.endsWith(extension)) throw new Error(`Unexpected updater file type: ${platform}`);
      verifySignature(updater.bytes, signature, publicKey, version);
      platforms[platform] = {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`,
      };
    }
    provenance.push({ platform, target, buildId: manifest.buildId, signed: manifest.signed });
  }

  const notes = formatReleaseNotes(releaseNotes);
  const latest = { version, notes, pub_date: now.toISOString(), platforms };
  const summary = {
    version, tag, repository, buildId,
    platforms: provenance.sort((a, b) => a.platform.localeCompare(b.platform)),
    files: [...assets.values()].map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
    verification: { sha256: true, updaterSignatures: true, completePlatformSet: true },
  };
  mkdirSync(output, { recursive: true });
  for (const asset of assets.values()) copyFileSync(asset.path, join(output, asset.name));
  writeFileSync(join(output, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  writeFileSync(join(output, 'release-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(output, 'RELEASE-NOTES.md'), [
    `AXOM ${version}`, '',
    notes, '',
    `Build: \`${buildId}\`. All four native updater signatures and every package checksum were verified before this draft was created.`, '',
    '- macOS: Apple Silicon and Intel installers; Apple signing and notarization are checked in CI.',
    '- Windows x64: installer with a signed updater payload. Authenticode publisher signing is a separate setup requirement.',
    '- Linux x64: AppImage updater and available native packages.',
    '- Web: static ZIP for an HTTP(S) host; opening index.html via file:// is unsupported.', '',
    'This is a draft. Review the changes and migration notes above, install and smoke-test each target, then explicitly publish.',
    'Export a JSON backup before updating. Do not downgrade an installation after its data schema has migrated.', '',
    'Prereleases are not returned by GitHub releases/latest. Use a separate prerelease endpoint before distributing a prerelease updater channel.', '',
  ].join('\n'));
  const checksums = readdirSync(output).sort().map(name => `${digest(readFileSync(join(output, name)))}  ${name}`).join('\n');
  writeFileSync(join(output, 'SHA256SUMS.txt'), `${checksums}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      if (!['--input', '--output', '--repository', '--tag', '--build-id'].includes(key) || !process.argv[i + 1] || values[key.slice(2)]) throw new Error('Usage: assemble-release.mjs --input DIR --output NEW_DIR --repository OWNER/REPO --tag vVERSION [--build-id COMMIT]');
      values[key.slice(2)] = process.argv[i + 1];
    }
    if (!values.input || !values.output) throw new Error('--input and --output are required.');
    const summary = assembleRelease({ ...values, expectedBuildId: values['build-id'], publicKey: process.env.AXOM_UPDATER_PUBLIC_KEY });
    console.log(`Verified AXOM ${summary.version}: ${summary.files.length} assets, 4 signed desktop targets, 1 web package.`);
  } catch (error) {
    console.error(`Release assembly failed: ${error.message}`);
    process.exitCode = 1;
  }
}
