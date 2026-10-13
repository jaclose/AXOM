// Package only reviewed gallery assets and a patch from the documented feature base.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from '../web/node_modules/jszip/lib/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const gallery = new URL('../artifacts/communications/', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
assert.equal(git('status', '--porcelain').trim(), '', 'Commit the reviewed source before packaging its handoff.');
execFileSync(process.execPath, ['scripts/verify-communications-artifacts.mjs'], { cwd: root, stdio: 'inherit' });
const manifestBytes = await readFile(new URL('preview-manifest.json', gallery));
const manifest = JSON.parse(manifestBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = new Set([...Object.keys(manifest.generated), 'preview-manifest.json', 'email-browser-verification.json', 'gallery-browser-verification.json']);
for (const report of ['email-browser-verification.json', 'gallery-browser-verification.json']) {
  const evidence = JSON.parse(await readFile(new URL(report, gallery)));
  assert.equal(evidence.previewManifestSha256, sha(manifestBytes), `${report} predates the current gallery; rerun its verifier.`);
}
const index = await readFile(new URL('index.html', gallery), 'utf8');
for (const match of index.matchAll(/\b(?:src|href|poster)="([^"]+)"/g)) {
  if (!match[1].startsWith('#')) paths.add(match[1]);
}
const archive = new JSZip(); const files = {};
for (const path of [...paths].sort()) {
  assert.ok(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes(':'), `Nonportable gallery path: ${path}`);
  const url = new URL(path, gallery);
  assert.ok((await lstat(url)).isFile(), `Expected a regular file: ${path}`);
  const bytes = await readFile(url); const name = 'communications/' + path;
  files[name] = sha(bytes); archive.file(name, bytes);
}
const commit = git('rev-parse', 'HEAD').trim();
const branch = git('branch', '--show-current').trim();
const base = git('rev-parse', 'c46ae207').trim();
git('merge-base', '--is-ancestor', base, commit);
const patch = git('diff', '--binary', base, commit);
archive.file('communications.patch', patch); files['communications.patch'] = sha(patch);
archive.file('OPEN-FIRST.txt', `AXOM Communications + Pulse\n\nOpen communications/index.html in your browser. All gallery assets and handoff documents are included.\n\nBranch: ${branch}\nCommit: ${commit}\nWorktree: ${root}\n\nThis is a visual and AI handoff, not a standalone application. Continue the existing branch. The optional communications.patch is the full feature diff from ${base}; do not reapply it to the feature branch.\n\nNext: review the visual gallery, then follow communications/docs/operations/communications-resend.md with your operator. No provider activation, deployment, migration or real send is performed by these files.\n`);
archive.file('handoff-manifest.json', JSON.stringify({ commit, branch, base, packagedAt: new Date().toISOString(), files, syntheticFixtures: true, realProviderTested: false }, null, 2) + '\n');
const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
await JSZip.loadAsync(bytes, { checkCRC32: true });
// A commit-qualified filename preserves previous deliveries and identifies the exact source.
const destination = new URL(`../artifacts/axom-communications-pulse-${commit.slice(0, 8)}-handoff.zip`, import.meta.url);
await writeFile(destination, bytes, { flag: 'wx' });
console.log(JSON.stringify({ path: fileURLToPath(destination), commit, files: Object.keys(archive.files).length, bytes: bytes.length }));
