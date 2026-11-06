import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { decideVercelBuild } from './vercel-branch-gate.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function check(expected, env, reason) {
  const decision = decideVercelBuild(env);
  assert.equal(decision.build, expected, reason);
  assert.match(decision.reason, /\S/, 'Every build/skip decision explains its reason');
}

test('production main continues; missing Git ref does not disable production by accident', () => {
  check(true, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' });
  check(true, { VERCEL_ENV: 'production' });
  check(false, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'codex/feature' });
});

test('exact release and emergency hotfix branches get previews', () => {
  for (const branch of [
    'release/2026-11-06-integrated-gateway',
    'release/2026-11-13-next-train',
    'hotfix/auth-session-repair',
  ]) check(true, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch }, branch);
});

test('every autonomous worker, task and third-party dependency branch skips previews', () => {
  for (const branch of [
    'codex/local-save-status-repair-20261106', 'feat/new-idea', 'fix/storage',
    'docs/worker-sop', 'dependabot/npm_and_yarn/web/example',
    'integration/experimental', 'release/experimental',
    'release/2026-11-06-racing/branch', 'hotfix/', 'main', '',
  ]) check(false, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch }, branch);
  check(false, { VERCEL_ENV: 'preview' }, 'unknown preview branch is not preapproved');
});

test('local and CLI builds are not silently ignored by missing Vercel environment', () => {
  check(true, {});
  check(true, { VERCEL_GIT_COMMIT_REF: 'feat/new-idea' });
  check(true, { VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: 'feat/new-idea' });
});

test('Vercel ignored build step uses the documented inverted exit contract', () => {
  const script = resolve(repo, 'scripts/vercel-branch-gate.mjs');
  function code(env) {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
    assert.equal(result.error, undefined);
    assert.match(result.stdout, /AXOM Vercel build gate:/);
    return result.status;
  }
  assert.equal(code({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), 1, 'exit 1 CONTINUES build');
  assert.equal(code({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/x' }), 0, 'exit 0 SKIPS build');
});

test('repo config wires ignoreCommand to an allowlisted upload input', () => {
  const config = JSON.parse(readFileSync(resolve(repo, 'vercel.json'), 'utf8'));
  assert.equal(config.ignoreCommand, 'node scripts/vercel-branch-gate.mjs');
  const ignoreRules = readFileSync(resolve(repo, '.vercelignore'), 'utf8').split(/\r?\n/);
  assert.ok(ignoreRules.includes('!/scripts/'), 'scripts parent must be available');
  assert.ok(ignoreRules.includes('!/scripts/vercel-branch-gate.mjs'), 'gate script must survive upload filtering');
});
