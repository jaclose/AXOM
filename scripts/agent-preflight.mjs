#!/usr/bin/env node
// Read-only developer/agent preflight. Never prints untracked file names or file contents.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DOCUMENT_BUDGETS, checkBootstrapContext, checkDocumentBudgets,
} from './repository-hygiene.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function summarizePorcelain(output) {
  if (!output) return { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  if (!output.endsWith('\0')) throw new Error('Invalid Git status: missing NUL delimiter');
  const entries = output.slice(0, -1).split('\0');
  const counts = { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  for (let i = 0; i < entries.length; i += 1) {
    const record = entries[i];
    if (record.length < 4 || record[2] !== ' ' || !record.slice(3)) {
      throw new Error('Invalid Git status: malformed entry');
    }
    const xy = record.slice(0, 2);
    const [index, worktree] = xy;
    if (xy === '??') { counts.untracked += 1; continue; }
    if (conflicts.has(xy) || index === 'U' || worktree === 'U') {
      counts.conflicts += 1;
      counts.modified += 1;
    } else {
      if (!' MADRCT'.includes(index)) throw new Error('Invalid Git status: unknown index status');
      if (!' MADRCT'.includes(worktree)) throw new Error('Invalid Git status: unknown worktree status');
      if (index !== ' ') counts.staged += 1;
      if (worktree !== ' ') counts.modified += 1;
    }
    // Porcelain v1 -z represents renames/copies with TWO NUL-delimited path fields.
    // Consume the second without exposing either filename.
    if (/[RC]/.test(xy)) {
      if (!entries[++i]) throw new Error('Invalid Git status: missing rename/copy source');
    }
  }
  return counts;
}

export function countWorktrees(output) {
  return output.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length;
}

export function evaluatePreflight({ branch, head, worktrees, changes, contextProfiles, budgetErrors }) {
  if (!/^[a-f0-9]{40}$/i.test(head ?? '')) throw new Error('Invalid HEAD');
  if (!Number.isSafeInteger(worktrees) || worktrees < 1) throw new Error('Invalid worktree count');
  if (!changes || ['staged', 'modified', 'untracked', 'conflicts'].some((key) =>
    !Number.isSafeInteger(changes[key]) || changes[key] < 0)) throw new Error('Invalid Git status counts');
  const reasons = [];
  if (!branch) reasons.push('detached_head');
  if (changes.conflicts) reasons.push('merge_conflicts');
  if (changes.staged || changes.modified || changes.untracked || changes.conflicts) reasons.push('dirty_worktree');
  if (budgetErrors.length || contextProfiles.some((profile) => !profile.complete || !profile.withinBudget)) {
    reasons.push('context_budget');
  }
  return {
    schemaVersion: 1,
    disposition: reasons.length ? 'HOLD' : 'READY',
    reasons,
    checkout: { branch: branch || null, head },
    worktrees,
    worktreeWarning: worktrees > 1,
    changes,
    contextProfiles: contextProfiles.map(({ label, estimatedTokens, limit, complete, withinBudget }) =>
      ({ label, estimatedTokens, limit, complete, withinBudget })),
  };
}

export function runPreflight(root = repoRoot) {
  const directory = realpathSync(root);
  const git = (...args) => execFileSync('git', args, {
    cwd: directory, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
  const actualRoot = realpathSync(git('rev-parse', '--show-toplevel'));
  if (actualRoot !== directory) throw new Error('Preflight must run at the repository root');
  const branch = git('branch', '--show-current');
  const head = git('rev-parse', '--verify', 'HEAD');
  // Keep NUL-delimited status intact; trimming it would silently drop the final entry.
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
    cwd: directory, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const worktrees = countWorktrees(git('worktree', 'list', '--porcelain'));
  const documents = Object.keys(DOCUMENT_BUDGETS).map((filePath) => ({
    path: filePath, content: readFileSync(resolve(directory, filePath), 'utf8'),
  }));
  const { profiles, errors: bootstrapErrors } = checkBootstrapContext(documents);
  const { errors: documentErrors } = checkDocumentBudgets(documents);
  return evaluatePreflight({ branch, head, worktrees, changes: summarizePorcelain(status),
    contextProfiles: profiles, budgetErrors: [...bootstrapErrors, ...documentErrors] });
}

export function formatPreflight(result) {
  const { checkout, changes, contextProfiles } = result;
  const lines = [
    `AXOM agent preflight: ${result.disposition}`,
    `Git: ${checkout.branch || '(detached)'} @ ${checkout.head.slice(0, 12)} | worktrees: ${result.worktrees}`,
    `Staged: ${changes.staged} | Modified: ${changes.modified} | Untracked: ${changes.untracked} | Conflicts: ${changes.conflicts}`,
    ...contextProfiles.map((profile) => `${profile.label}: ~${profile.estimatedTokens}/${profile.limit} tokens${profile.complete && profile.withinBudget ? '' : ' (review)'}`),
  ];
  if (result.worktreeWarning) lines.push('Multiple worktrees: confirm the active writer and file ownership.');
  if (result.reasons.length) lines.push(`HOLD reasons: ${result.reasons.join(', ')}`);
  lines.push('Only source/worktree and bootstrap-size checks; no API, cloud, CI or production validation.');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = process.argv.slice(2);
  if (options.length === 1 && options[0] === '--help') {
    console.log('Usage: node scripts/agent-preflight.mjs [--json]');
  } else if (options.length && !(options.length === 1 && options[0] === '--json')) {
    console.error('Usage: node scripts/agent-preflight.mjs [--json]');
    process.exitCode = 2;
  } else {
    try {
      const result = runPreflight();
      console.log(options.includes('--json') ? JSON.stringify(result, null, 2) : formatPreflight(result));
      if (result.disposition !== 'READY') process.exitCode = 2;
    } catch {
      // Never print raw Git command output, filesystem paths or file contents.
      console.error('AXOM agent preflight: HOLD (Git checkout or required context unavailable)');
      process.exitCode = 2;
    }
  }
}
