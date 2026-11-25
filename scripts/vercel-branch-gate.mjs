#!/usr/bin/env node
// Vercel's Ignored Build Step has intentionally inverted exit codes:
// 0 means skip deployment build; 1 means continue the build.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const RELEASE_BRANCH = /^release\/\d{4}-\d{2}-\d{2}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const HOTFIX_BRANCH = /^hotfix\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Return the decision independently of process state so CI can exercise every route. */
export function decideVercelBuild(env = process.env) {
  const target = env.VERCEL_ENV;
  const ref = env.VERCEL_GIT_COMMIT_REF || '';

  if (target === 'production') {
    // Some deployment providers omit Git metadata from a legitimate production rebuild.
    // Never silently suppress the website's production rebuild for that reason.
    if (!ref || ref === 'main') return { build: true, reason: 'production main or missing Git ref' };
    return { build: false, reason: 'production ref ' + ref + ' is not main' };
  }

  if (target === 'preview') {
    if (RELEASE_BRANCH.test(ref)) return { build: true, reason: 'release-gateway candidate ' + ref };
    if (HOTFIX_BRANCH.test(ref)) return { build: true, reason: 'emergency hotfix candidate ' + ref };
    return { build: false, reason: 'feature/unknown ref ' + (ref || '(missing)') + ' is not preview-approved' };
  }

  // Unknown environments must not silently suppress local builds.
  return { build: true, reason: 'non-preview environment ' + (target || '(local)') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const decision = decideVercelBuild();
  console.log('AXOM Vercel build gate: ' + (decision.build ? 'CONTINUE BUILD' : 'SKIP BUILD') + ' (' + decision.reason + ')');
  process.exitCode = decision.build ? 1 : 0;
}
