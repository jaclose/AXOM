import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeploymentInputs, requiredManifests } from './deployment-inputs.mjs';
import { assertDeploymentPrivacy, materializeDeployment } from './verify-deployment.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignore = readFileSync(join(repo, '.vercelignore'), 'utf8');
const bankRegistry = 'web/src/lib/question-content/knownBanks.ts';
const fixtureFiles = execFileSync('git', ['-C', repo, 'ls-files', 'fixtures'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

async function withDeployment(t, { ignoreText = ignore, registrySource } = {}) {
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
    bankRegistry, ...fixtureFiles,
  ];
  for (const file of files) {
    mkdirSync(dirname(join(source, file)), { recursive: true });
    copyFileSync(join(repo, file), join(source, file));
  }
  if (registrySource !== undefined) writeFileSync(join(source, bankRegistry), registrySource);
  const excluded = [
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
  git(['add', '-f', '--', ...files, ...excluded]);
  git(['-c', 'user.name=AXOM Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Deployment fixture']);
  writeFileSync(join(source, 'web/local-only.txt'), 'not committed');
  const selected = await materializeDeployment(source, 'HEAD', target, ignoreText);
  return { source, target, selected, excluded };
}

test('inline registry survives real Vercel filtering while every fixture stays excluded', async t => {
  const { target, selected, excluded } = await withDeployment(t);
  assert.deepEqual(requiredManifests(repo), []);
  assert.deepEqual(checkDeploymentInputs(target), []);
  assert.ok(selected.includes(bankRegistry));
  assert.equal(selected.some(file => file.startsWith('fixtures/')), false);
  assert.doesNotThrow(() => assertDeploymentPrivacy(selected));
  for (const file of [...excluded, 'web/local-only.txt']) assert.ok(!selected.includes(file), file);
});

test('an external manifest import is discovered and fails when fixture filtering removes it', async t => {
  const manifest = 'fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json';
  const importPath = '../../../../fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json';
  const registrySource = `import bank from "${importPath}";\nexport const knownBankManifests = [bank];\n`;
  const { source, target, selected } = await withDeployment(t, { registrySource });
  assert.deepEqual(requiredManifests(source), [manifest]);
  assert.deepEqual(checkDeploymentInputs(source), [manifest]);
  assert.ok(!selected.includes(manifest));
  assert.throws(() => checkDeploymentInputs(target), { message: `Missing deployment input: ${manifest}` });
});

test('registry filename case mismatch fails on both case-sensitive and case-insensitive hosts', async t => {
  const { target } = await withDeployment(t);
  const path = join(target, bankRegistry);
  renameSync(path, `${path}.temporary`);
  renameSync(`${path}.temporary`, join(dirname(path), 'KnownBanks.ts'));
  assert.throws(() => checkDeploymentInputs(target), /case mismatch:.*found KnownBanks.ts, expected knownBanks.ts/);
});

test('a newly excluded build-time guard is detected in deployment inputs', async t => {
  const { target } = await withDeployment(t, { ignoreText: `${ignore}\n/scripts/deployment-inputs.mjs\n` });
  assert.throws(() => checkDeploymentInputs(target), /Missing deployment input: scripts\/deployment-inputs.mjs/);
});

test('a fixture leaf negation cannot bypass the excluded parent', async t => {
  const manifest = 'fixtures/qbank/goer/t5/week-02/biostats-epidemiology/manifest.json';
  const { selected } = await withDeployment(t, {
    ignoreText: `/*\n!/web\n!/web/**\n!/${manifest}\n`,
  });
  assert.ok(selected.includes(bankRegistry));
  assert.ok(!selected.includes(manifest), 'negating a leaf cannot reopen its excluded parent');
});

test('fixture allowlisting is rejected as a deployment privacy violation', async t => {
  const { selected } = await withDeployment(t, {
    ignoreText: `${ignore}\n!/fixtures/\n!/fixtures/**\n`,
  });
  assert.ok(selected.some(file => file.startsWith('fixtures/')));
  assert.throws(() => assertDeploymentPrivacy(selected), /Deployment privacy violation: fixtures\//);
});
