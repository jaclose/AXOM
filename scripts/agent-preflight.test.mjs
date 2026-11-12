import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  summarizePorcelain, countWorktrees, evaluatePreflight, runPreflight, formatPreflight,
} from './agent-preflight.mjs';

const head = 'a'.repeat(40);
const budget = [
  { label: 'Bootstrap context', estimatedTokens: 100, limit: 4000, complete: true, withinBudget: true },
  { label: 'Claude effective bootstrap', estimatedTokens: 120, limit: 4000, complete: true, withinBudget: true },
  { label: 'Copilot routed bootstrap', estimatedTokens: 125, limit: 4000, complete: true, withinBudget: true },
];
const empty = { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
const input = (changes = empty) => ({ branch: 'main', head, worktrees: 1, changes, contextProfiles: budget, budgetErrors: [] });

test('porcelain v1 -z counts staged, modified, untracked and conflict entries without returning names', () => {
  const data = [
    'M  private-staged.txt',
    ' M dirty.txt',
    '?? secret untracked.pdf',
    'UU conflicted.txt',
    'R  new-name.txt', 'original-name.txt',
  ].join('\0') + '\0';
  assert.deepEqual(summarizePorcelain(data), { staged: 2, modified: 2, untracked: 1, conflicts: 1 });
});

test('NUL-delimited status handles filenames containing newline and does not echo filenames', () => {
  const result = summarizePorcelain('?? hidden\nname.pdf\0 M line\nbreak.md\0');
  assert.deepEqual(result, { staged: 0, modified: 1, untracked: 1, conflicts: 0 });
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});

test('malformed or unterminated git status is rejected rather than silently considered clean', () => {
  for (const status of [' M truncated', 'X\0', 'R  renamed\0', '?? \0']) {
    assert.throws(() => summarizePorcelain(status), /Invalid Git status/);
  }
});

test('worktree parser returns count without exposing worktree paths', () => {
  const output = 'worktree /Users/jd/Developer/AXOM\nHEAD ' + head + '\nbranch refs/heads/main\n\nworktree /secret/other\nHEAD ' + head + '\ndetached\n';
  assert.equal(countWorktrees(output), 2);
  assert.equal(countWorktrees('nonsense'), 0);
});

test('clean attached branch and complete contexts are READY', () => {
  const result = evaluatePreflight(input());
  assert.equal(result.disposition, 'READY');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.checkout.head, head);
  assert.equal(result.contextProfiles[0].estimatedTokens, 100);
});

test('changes and detached HEAD block work, but additional worktrees only warn', () => {
  const dirty = evaluatePreflight({ ...input({ ...empty, untracked: 1 }), worktrees: 3, branch: null });
  assert.equal(dirty.disposition, 'HOLD');
  assert.deepEqual(dirty.reasons, ['detached_head', 'dirty_worktree']);
  assert.equal(dirty.worktreeWarning, true);
  const multi = evaluatePreflight({ ...input(), worktrees: 2 });
  assert.equal(multi.disposition, 'READY');
  assert.equal(multi.worktreeWarning, true);
});

test('merge conflicts and context-budget errors hold the checkout', () => {
  const result = evaluatePreflight({ ...input({ ...empty, conflicts: 1 }), budgetErrors: ['Bootstrap context exceeded'] });
  assert.deepEqual(result.reasons, ['merge_conflicts', 'dirty_worktree', 'context_budget']);
});

test('invalid head or missing worktree data fails closed', () => {
  assert.throws(() => evaluatePreflight({ ...input(), head: 'short' }), /Invalid HEAD/);
  assert.throws(() => evaluatePreflight({ ...input(), worktrees: 0 }), /Invalid worktree count/);
});

test('human output contains useful counts and no private filesystem paths', () => {
  const result = evaluatePreflight({ ...input({ ...empty, untracked: 1 }), worktrees: 2 });
  const summary = formatPreflight(result);
  assert.match(summary, /AXOM agent preflight: HOLD/);
  assert.match(summary, /Untracked: 1/);
  assert.match(summary, /worktrees: 2/);
  assert.doesNotMatch(summary, /Users\/|secret|private/);
});

test('a real temporary Git repository reports clean then dirty without displaying untracked names', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'axom-agent-preflight-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git('init', '-q');
    for (const rel of ['AGENTS.md', 'docs/AI_STATE.md', 'CLAUDE.md', '.github/copilot-instructions.md']) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), '# Small context\n');
    }
    git('add', 'AGENTS.md', 'docs/AI_STATE.md', 'CLAUDE.md', '.github/copilot-instructions.md');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
    assert.equal(runPreflight(root).disposition, 'READY');
    writeFileSync(path.join(root, 'private-secret-file.pdf'), 'not a real PDF');
    const result = runPreflight(root);
    assert.equal(result.disposition, 'HOLD');
    assert.equal(result.changes.untracked, 1);
    assert.equal(JSON.stringify(result).includes('private-secret-file'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
