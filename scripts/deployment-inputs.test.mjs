import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeploymentInputs, requiredManifests } from './deployment-inputs.mjs';
import { materializeDeployment } from './verify-deployment.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignore = readFileSync(join(repo, '.vercelignore'), 'utf8');
const manifests = requiredManifests(repo);

async function withDeployment(t, ignoreText = ignore) {
  const source = mkdtempSync(join(tmpdir(), 'axom-deployment-test-source-'));
  const target = mkdtempSync(join(tmpdir(), 'axom-deployment-test-target-'));
  t.after(() => {
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });
  const files = [
    'package.json', 'package-lock.json', 'web/package.json', 'web/package-lock.json',
    'vercel.json', 'scripts/deployment-inputs.mjs', 'scripts/toolchain.mjs',
    'scripts/release-notes.mjs', 'scripts/release-notes.d.mts',
    'web/scripts/verify-daily-games-bundle.mjs',
    'web/src/lib/question-content/knownBanks.ts', ...manifests,
  ];
  for (const file of files) {
    mkdirSync(dirname(join(source, file)), { recursive: true });
    copyFileSync(join(repo, file), join(source, file));
  }
  const excluded = [
    'fixtures/qbank/synthetic/unrelated/manifest.json',
    'fixtures/qbank/goer/t5/week-02/unrelated/assets/figure.svg',
    'fixtures/qbank/goer/t5/week-02/unrelated/questions.json',
    'fixtures/qbank/goer/t5/week-03/unrelated/manifest.json',
    'node_modules/unrelated/index.js', 'web/node_modules/unrelated/index.js',
    'web/dist/old-build.js', 'scripts/not-a-build-input.mjs',
  ];
  for (const file of excluded) {
    mkdirSync(dirname(join(source, file)), { recursive: true });
    writeFileSync(join(source, file), 'excluded regression sentinel');
  }
  // A clean commit must not silently pick up even allowlisted local-only files.
  const git = args => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', '--', ...files, ...excluded]);
  git(['-c', 'user.name=AXOM Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Deployment fixture']);
  writeFileSync(join(source, 'web/local-only.txt'), 'not committed');
  const selected = await materializeDeployment(source, 'HEAD', target, ignoreText);
  return { source, target, selected, excluded };
}

test('targeted allowlist survives real Vercel filtering and materializes required inputs', async t => {
  const { target, selected, excluded } = await withDeployment(t);
  assert.deepEqual(checkDeploymentInputs(target), manifests);
  for (const file of manifests) {
    assert.equal(readFileSync(join(target, file), 'utf8'), readFileSync(join(repo, file), 'utf8'));
  }
  for (const file of [...excluded, 'web/local-only.txt']) assert.ok(!selected.includes(file), file);
});

test('original exclusion fails after filtering, despite manifests existing in source', async t => {
  const original = ignore.slice(0, ignore.indexOf('# AXOM GOER manifest allowlist'));
  assert.ok(original.length && original !== ignore);
  const { source, target } = await withDeployment(t, original);
  assert.deepEqual(checkDeploymentInputs(source), manifests);
  assert.throws(() => checkDeploymentInputs(target), /Missing deployment input: fixtures\/qbank\/goer/);
});

test('excluding one required manifest fails instead of silently reducing the bank', async t => {
  const { target } = await withDeployment(t, `${ignore}\n/${manifests[0]}\n`);
  assert.throws(() => checkDeploymentInputs(target), /Missing deployment input:.*manifest.json/);
});

test('missing deployed manifest fails with an actionable path', async t => {
  const { target } = await withDeployment(t);
  rmSync(join(target, manifests[0]));
  assert.throws(() => checkDeploymentInputs(target), { message: `Missing deployment input: ${manifests[0]}` });
});

test('filename case mismatch fails on both case-sensitive and case-insensitive hosts', async t => {
  const { target } = await withDeployment(t);
  const path = join(target, manifests[0]);
  renameSync(path, `${path}.temporary`);
  renameSync(`${path}.temporary`, join(dirname(path), 'Manifest.json'));
  assert.throws(() => checkDeploymentInputs(target), /case mismatch:.*found Manifest.json, expected manifest.json/);
});

test('a newly excluded build-time guard is detected in deployment inputs', async t => {
  const { target } = await withDeployment(t, `${ignore}\n/scripts/deployment-inputs.mjs\n`);
  assert.throws(() => checkDeploymentInputs(target), /Missing deployment input: scripts\/deployment-inputs.mjs/);
});

test('Vercel parent exclusions must be reopened, not merely a leaf negated', async t => {
  const { selected } = await withDeployment(t, `/*\n!/web\n!/web/**\n!/${manifests[0]}\n`);
  assert.ok(selected.includes('web/src/lib/question-content/knownBanks.ts'));
  assert.ok(!selected.includes(manifests[0]), 'negating a leaf cannot reopen its excluded parent');
});
