import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReleaseNotes, parseReleaseNotes, requireReleaseNotes } from './release-notes.mjs';

test('uses the current version section once and preserves safe readable notes', () => {
  const releases = parseReleaseNotes(`# Changelog
## Unreleased
- Work in progress must never become an update announcement.
## 1.0.1 — 2026-09-24 (Safer updates)
- **Save first**: preserves your
  workspace before restarting.
- Read [the guide](https://example.com/guide).
## 1.0.1 — 2026-09-23 (Superseded draft)
Old draft.
## 1.0.0 — 2026-09-01
First release.
`);
  assert.equal(releases.length, 2);
  assert.equal(releases[0].version, '1.0.1');
  assert.match(releases[0].body, /Save first: preserves your workspace/);
  assert.match(releases[0].body, /Read the guide\./);
  assert.doesNotMatch(formatReleaseNotes(releases[0]), /Superseded|Unreleased|\*\*/);
  assert.match(formatReleaseNotes(releases[0]), /^Safer updates\n2026-09-24/);
});

test('fails closed on absent, empty or oversized release notes', () => {
  assert.throws(() => requireReleaseNotes('# Changelog\n## 1.0.0 — 2026-09-24\n', '1.0.0'), /Add user-facing notes/);
  assert.throws(() => requireReleaseNotes('## 1.0.0 — 2026-09-24\nChanges.', '1.0.1'), /1.0.1/);
  assert.throws(() => parseReleaseNotes(`## 1.0.0 — 2026-09-24\n${'x'.repeat(16_001)}`), /concise/);
  assert.throws(() => parseReleaseNotes(null), /Markdown/);
});
