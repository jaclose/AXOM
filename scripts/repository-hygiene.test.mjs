import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MAX_FILE_BYTES, DOCUMENT_BUDGETS, artifactRules, checkDocumentBudgets, checkBootstrapContext,
  checkFiles, checkMarkdownLinks, extractMarkdownLinks, isActiveDocument,
  readRepositoryFiles, runRepositoryHygiene, checkStartupImports,
  isSafeRepositoryPath, checkSnapshotIntegrity, checkPreservationManifests,
} from './repository-hygiene.mjs';

const emptyBaseline = { schemaVersion: 1, exceptions: [], preservationManifests: [] };
const contextDocuments = () => Object.keys(DOCUMENT_BUDGETS).map((filePath) => ({
  path: filePath,
  content: filePath === 'CLAUDE.md' ? '# Context\n@AGENTS.md\n@docs/AI_STATE.md\n' : '# Context\n',
}));
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const exceptionFor = (filePath, bytes) => ({
  path: filePath, bytes, rules: artifactRules(filePath, bytes),
  rationale: 'Existing tracked evidence preserved; no new artifacts approved.',
});

function withRepository(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'axom-hygiene-'));
  const write = (filePath, content) => {
    mkdirSync(path.dirname(path.join(directory, filePath)), { recursive: true });
    writeFileSync(path.join(directory, filePath), content);
  };
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    return run({ directory, write });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('context budgets pass at the limit and report a chars/4 token estimate', () => {
  const documents = contextDocuments();
  documents[0].content = 'a'.repeat(DOCUMENT_BUDGETS['AGENTS.md']);
  const result = checkDocumentBudgets(documents);
  assert.deepEqual(result.errors, []);
  assert.equal(result.estimates[0].characters, 12_000);
  assert.equal(result.estimates[0].estimatedTokens, 3_000);
});

test('over-budget context documents and missing bridges fail', () => {
  const documents = contextDocuments();
  documents[0].content = 'a'.repeat(DOCUMENT_BUDGETS['AGENTS.md'] + 1);
  documents.pop();
  const result = checkDocumentBudgets(documents);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /12001 characters exceeds 12000/);
  assert.match(result.errors[1], /copilot-instructions\.md: required context document is missing/);
});

test('context telemetry distinguishes Unicode characters, UTF-8 bytes, words and estimated tokens', () => {
  const documents = contextDocuments();
  documents[0].content = 'A é 🧠\n';
  const measurement = checkDocumentBudgets(documents).estimates[0];
  assert.equal(measurement.characters, 6);
  assert.equal(measurement.bytes, 10);
  assert.equal(measurement.words, 3);
  assert.equal(measurement.estimatedTokens, 2);
});

test('aggregate bootstrap growth fails even when individual documents fit their budgets', () => {
  const documents = contextDocuments();
  documents[0].content = 'a'.repeat(9_000);
  documents[1].content = 'b'.repeat(9_000);
  assert.deepEqual(checkDocumentBudgets(documents).errors, []);
  const result = checkBootstrapContext(documents);
  assert.equal(result.profiles[0].estimatedTokens, 4_500);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /Bootstrap context: ~4500 tokens exceeds 4000/);
});

test('the aggregate limit is inclusive and each bridge must fit within its effective budget', () => {
  const documents = contextDocuments();
  documents[0].content = 'a'.repeat(8_000);
  documents[1].content = 'b'.repeat(8_000);
  documents[2].content = '';
  documents[3].content = '';
  assert.deepEqual(checkBootstrapContext(documents).errors, []);
  documents[2].content = 'x';
  let result = checkBootstrapContext(documents);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Claude effective bootstrap: ~4001/);
  assert.equal(result.profiles[0].withinBudget, true);
  documents[2].content = '';
  documents[3].content = 'x';
  result = checkBootstrapContext(documents);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Copilot routed bootstrap: ~4001/);
});

test('routed documents are excluded from bootstrap totals and bridge files are counted once', () => {
  const documents = contextDocuments();
  const before = checkBootstrapContext(documents);
  const estimates = checkDocumentBudgets(documents).estimates;
  documents.push({ path: 'docs/INDEX.md', content: 'unrelated '.repeat(10_000) });
  const after = checkBootstrapContext(documents);
  assert.deepEqual(after, before);
  for (const key of ['characters', 'words', 'bytes', 'estimatedTokens']) {
    assert.equal(after.profiles[0][key], estimates[0][key] + estimates[1][key]);
    assert.equal(after.profiles[1][key], after.profiles[0][key] + estimates[2][key]);
    assert.equal(after.profiles[2][key], after.profiles[0][key] + estimates[3][key]);
  }
});

test('a missing bootstrap document cannot produce a complete passing profile', () => {
  const documents = contextDocuments().filter((document) => document.path !== 'docs/AI_STATE.md');
  assert.match(checkDocumentBudgets(documents).errors[0], /required context document is missing/);
  assert.ok(checkBootstrapContext(documents).profiles.every((profile) => !profile.complete));
});

test('aggregate budgets participate in the repository gate and report routing and archive status', () => {
  withRepository(({ directory, write }) => {
    for (const document of contextDocuments()) write(document.path, document.content);
    write('scripts/repository-hygiene-baseline.json', JSON.stringify(emptyBaseline));
    write('AGENTS.md', 'a'.repeat(9_000));
    write('docs/AI_STATE.md', 'b'.repeat(9_000));
    const result = runRepositoryHygiene(directory);
    assert.equal(result.errors.length, 3);
    assert.ok(result.errors.every((error) => /tokens exceeds 4000/.test(error)));
    assert.equal(result.routingProblems, 0);
    assert.equal(result.archiveProblems, 0);
    assert.equal(result.startupProblems, 0);
  });
});

test('active-document scope excludes historical archive sources and legacy uppercase plans', () => {
  for (const filePath of ['AGENTS.md', 'README.md', 'docs/archive/README.md', 'docs/architecture/map.md', 'docs/features/study/notes.md']) {
    assert.equal(isActiveDocument(filePath), true, filePath);
  }
  for (const filePath of ['docs/archive/2026/notes.md', 'docs/archive/source/README.md', 'docs/feature-development/PLAN.md', 'docs/operations/OLD-PLAN.md']) {
    assert.equal(isActiveDocument(filePath), false, filePath);
  }
});

test('relative links accept encoded paths, angle brackets, balanced parentheses, directories and reference definitions', () => {
  const documents = [{ path: 'docs/INDEX.md', content: [
    '[encoded](architecture/a%20b.md#section)',
    '[angle](<architecture/a b.md> "Title")',
    '[parentheses](architecture/a(b).md)',
    '[escaped](architecture/a\\(b\\).md)',
    '[directory](architecture/)',
    '[reference][architecture]',
    '[architecture]: architecture/map.md "Architecture"',
    '![image](../assets/icon.png?width=20)',
  ].join('\n') }];
  assert.deepEqual(checkMarkdownLinks(documents, [
    'docs/INDEX.md', 'docs/architecture/a b.md', 'docs/architecture/a(b).md',
    'docs/architecture/map.md', 'assets/icon.png',
  ]), []);
});

test('missing relative targets include file and line in the failure', () => {
  const documents = [{ path: 'README.md', content: '# Title\n\n[missing](docs/missing.md)' }];
  assert.deepEqual(checkMarkdownLinks(documents, ['README.md']), [
    'README.md:3: missing relative link target: docs/missing.md',
  ]);
});

test('Obsidian maps use the active Markdown link gate, including title-cased filenames', () => {
  assert.equal(isActiveDocument('docs/graph/AXOM-System-Map.md'), true);
  assert.equal(isActiveDocument('docs/graph/README.md'), true);
  const documents = [{ path: 'docs/graph/AXOM-System-Map.md', content: '[Feature](../features/missing.md)' }];
  assert.match(checkMarkdownLinks(documents, ['docs/graph/AXOM-System-Map.md'])[0], /missing relative link target/);
  assert.deepEqual(checkMarkdownLinks(documents, ['docs/graph/AXOM-System-Map.md', 'docs/features/missing.md']), []);
});

test('personal Obsidian state is rejected if staged, while two portable defaults remain allowed', () => {
  const files = [
    'docs/.obsidian/app.json', 'docs/.obsidian/graph.json',
    'docs/.obsidian/workspace.json', 'docs/.obsidian/workspace-mobile.json',
    'docs/.obsidian/plugins/example/main.js', 'docs/.obsidian/themes/example/theme.css',
    'docs/.trash/deleted.md', '.obsidian/app.json',
  ].map((filePath) => ({ path: filePath, bytes: 50 }));
  const errors = checkFiles(files, emptyBaseline);
  assert.equal(errors.length, 6);
  assert.ok(errors.every((error) => /generated\/cache\/log artifact/.test(error)));
  assert.match(checkFiles([{ path: 'docs/.obsidian/app.json', bytes: MAX_FILE_BYTES + 1 }], emptyBaseline)[0], /exceeds 5 MiB/);
});

test('links inside backtick/tilde fences and inline code are not interpreted', () => {
  const markdown = [
    '```markdown', '[not a link to check](missing-1.md)', '```',
    '~~~~', '[also not](missing-2.md)', '~~~~',
    '`[example](missing-3.md)`', '[real](docs/INDEX.md)',
  ].join('\n');
  assert.deepEqual(extractMarkdownLinks(markdown), [{ target: 'docs/INDEX.md', line: 8 }]);
});

test('external, absolute, query-only and fragment links are ignored; archived source links stay frozen', () => {
  const documents = [
    { path: 'README.md', content: '[web](https://example.org) [email](mailto:hello@example.org) [ssh](ssh://host/path) [fragment](#intro) [query](?mode=1) [absolute](/local/file)' },
    { path: 'docs/archive/history/source.md', content: '[frozen original relative path](../no-longer-here.md)' },
  ];
  assert.deepEqual(checkMarkdownLinks(documents, ['README.md']), []);
});

test('invalid encoding and relative links outside the repository fail', () => {
  const errors = checkMarkdownLinks([{ path: 'README.md', content: '[bad](%zz.md) [outside](../private.md)' }], ['README.md']);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /invalid URL encoding/);
  assert.match(errors[1], /relative link leaves repository/);
});

test('new generated/cache/log files and loose root media fail without blocking ordinary product assets', () => {
  const errors = checkFiles([
    { path: 'web/.cache/state.json', bytes: 2 },
    { path: 'artifacts/audit.png', bytes: 2 },
    { path: 'debug.log', bytes: 2 },
    { path: 'screenshot.png', bytes: 2 },
    { path: 'notes.pdf', bytes: 2 },
    { path: 'voice.m4a', bytes: 2 },
    { path: 'clip.mp4', bytes: 2 },
    { path: 'web/public/icons/icon.png', bytes: 2 },
    { path: 'docs/operations/logging.md', bytes: 2 },
  ], emptyBaseline);
  assert.equal(errors.length, 7);
  assert.match(errors[0], /generated\/cache\/log artifact/);
  assert.match(errors[3], /loose root PDF, audio, video or image/);
});

test('5 MiB is allowed; one byte above requires a reviewed exact-path exception', () => {
  assert.deepEqual(checkFiles([{ path: 'assets/model.glb', bytes: MAX_FILE_BYTES }], emptyBaseline), []);
  const file = { path: 'assets/model.glb', bytes: MAX_FILE_BYTES + 1 };
  assert.match(checkFiles([file], emptyBaseline)[0], /exceeds 5 MiB/);
  const baseline = { schemaVersion: 1, exceptions: [exceptionFor(file.path, file.bytes)] };
  assert.deepEqual(checkFiles([file], baseline), []);
  assert.match(checkFiles([{ ...file, path: 'assets/copy.glb' }], baseline)[0], /exceeds 5 MiB/);
});

test('grandfathered artifacts may shrink but growth is rejected', () => {
  const baseline = { schemaVersion: 1, exceptions: [exceptionFor('artifacts/evidence.png', 100)] };
  assert.deepEqual(checkFiles([{ path: 'artifacts/evidence.png', bytes: 100 }], baseline), []);
  assert.deepEqual(checkFiles([{ path: 'artifacts/evidence.png', bytes: 90 }], baseline), []);
  assert.match(checkFiles([{ path: 'artifacts/evidence.png', bytes: 101 }], baseline)[0], /grew beyond baseline/);
});

test('an exception without a rationale cannot silently approve an artifact', () => {
  const baseline = { schemaVersion: 1, exceptions: [{ ...exceptionFor('debug.log', 10), rationale: '' }] };
  const errors = checkFiles([{ path: 'debug.log', bytes: 10 }], baseline);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /rationale are required/);
  assert.match(errors[1], /generated\/cache\/log artifact/);
});

test('Git candidate boundary includes tracked and proposed files, excludes ignored private/cache files, and retains tracked ignored paths', () => {
  withRepository(({ directory, write }) => {
    write('tracked.txt', 'tracked');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory });
    write('.gitignore', 'node_modules/\nprivate/\ntracked.txt\n');
    write('proposed.txt', 'new');
    write('node_modules/package/payload', 'ignored');
    write('private/personal.pdf', 'ignored');
    const files = readRepositoryFiles(directory);
    assert.deepEqual(files.map((file) => file.path), ['.gitignore', 'proposed.txt', 'tracked.txt']);
  });
});

test('end-to-end repository fixture passes, then rejects a missing link and generated artifact', () => {
  withRepository(({ directory, write }) => {
    for (const document of contextDocuments()) write(document.path, document.content);
    write('scripts/repository-hygiene-baseline.json', JSON.stringify(emptyBaseline));
    write('docs/INDEX.md', '[entry](../AGENTS.md)');
    assert.deepEqual(runRepositoryHygiene(directory).errors, []);
    write('docs/INDEX.md', '[broken](missing.md)');
    write('output/report.json', '{}');
    const result = runRepositoryHygiene(directory);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /missing relative link target/);
    assert.match(result.errors[1], /generated\/cache\/log artifact/);
  });
});

test('active-document symlinks are rejected without following private targets', () => {
  withRepository(({ directory, write }) => {
    for (const document of contextDocuments()) write(document.path, document.content);
    write('scripts/repository-hygiene-baseline.json', JSON.stringify(emptyBaseline));
    write('.gitignore', 'private/\n');
    write('private/hidden.md', '[must not be read](secret-missing.md)');
    symlinkSync('private/hidden.md', path.join(directory, 'README.md'));
    const result = runRepositoryHygiene(directory);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /active context documents must be regular files/);
  });
});

test('startup graph accepts only the two exact standalone imports with ordinary retrieval links', () => {
  const documents = contextDocuments();
  documents[0].content += '[On demand](docs/archive/README.md)\n';
  assert.deepEqual(checkStartupImports(documents), []);
});

test('a prose link cannot replace a required startup import', () => {
  const documents = contextDocuments();
  documents.find((document) => document.path === 'CLAUDE.md').content = '@AGENTS.md\n[State](docs/AI_STATE.md)\n';
  const errors = checkStartupImports(documents);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing exact standalone @docs\/AI_STATE\.md/);
});

test('imports hidden in fenced, inline or indented code do not satisfy the startup graph', () => {
  const documents = contextDocuments();
  documents.find((document) => document.path === 'CLAUDE.md').content = [
    '```markdown', '@AGENTS.md', '@docs/AI_STATE.md', '```',
    '`@AGENTS.md`', '    @docs/AI_STATE.md',
  ].join('\n');
  const errors = checkStartupImports(documents);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.includes('missing exact standalone')));
});

test('unexpected archive imports and transitive imports expand the graph and fail', () => {
  const documents = contextDocuments();
  documents.find((document) => document.path === 'CLAUDE.md').content += 'See @docs/archive/README.md\n';
  documents.find((document) => document.path === 'AGENTS.md').content += '@docs/architecture/README.md\n';
  documents.find((document) => document.path === 'docs/AI_STATE.md').content += '@../README.md\n';
  const errors = checkStartupImports(documents);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((error) => error.includes('unexpected @')));
});

test('snapshot integrity accepts the preserved digest and rejects tampering or a missing snapshot', () => {
  const entry = { snapshot: 'docs/archive/preserved.md', sha256: sha256('original\n') };
  assert.deepEqual(checkSnapshotIntegrity(entry, sha256('original\n')), []);
  assert.match(checkSnapshotIntegrity(entry, sha256('tampered\n'))[0], /SHA-256 mismatch/);
  assert.match(checkSnapshotIntegrity(entry, undefined)[0], /preserved snapshot is missing/);
});

test('snapshot paths reject traversal, absolute paths, ambiguous separators and invalid digests', () => {
  for (const snapshot of ['../secret.md', 'docs/../secret.md', '/tmp/secret.md', 'C:/secret.md', 'docs\\secret.md', './docs/a.md', 'docs//a.md']) {
    assert.equal(isSafeRepositoryPath(snapshot), false, snapshot);
    assert.match(checkSnapshotIntegrity({ snapshot, sha256: sha256('content') }, sha256('content'))[0], /safe relative file path/);
  }
  assert.match(checkSnapshotIntegrity({ snapshot: 'docs/archive/a.md', sha256: 'bad' }, sha256('content'))[0], /valid SHA-256 digest/);
});

test('preservation manifests verify snapshots while allowing replacement of original active guidance', () => {
  withRepository(({ directory, write }) => {
    const manifestPath = 'docs/archive/manifest.json';
    const snapshot = 'docs/archive/preserved.md';
    write('AGENTS.md', 'replacement active guidance');
    write(snapshot, 'original guidance');
    write(manifestPath, JSON.stringify({ files: [{ original: 'AGENTS.md', snapshot, sha256: sha256('original guidance') }] }));
    const result = checkPreservationManifests(directory, [manifestPath], readRepositoryFiles(directory).map((file) => file.path));
    assert.deepEqual(result, { errors: [], snapshotsChecked: 1 });
    write(snapshot, 'changed snapshot');
    assert.match(checkPreservationManifests(directory, [manifestPath], readRepositoryFiles(directory).map((file) => file.path)).errors[0], /SHA-256 mismatch/);
  });
});

test('missing preservation manifests and missing snapshots fail', () => {
  withRepository(({ directory, write }) => {
    assert.match(checkPreservationManifests(directory, ['docs/archive/missing.json'], []).errors[0], /cannot verify preservation manifest/);
    write('docs/archive/manifest.json', JSON.stringify({ files: [{ snapshot: 'docs/archive/missing.md', sha256: sha256('original') }] }));
    const result = checkPreservationManifests(directory, ['docs/archive/manifest.json'], ['docs/archive/manifest.json']);
    assert.match(result.errors[0], /required preserved file is missing/);
  });
});

test('preservation rejects symlink snapshots without reading their targets', () => {
  withRepository(({ directory, write }) => {
    write('.gitignore', 'private/\n');
    write('private/original.md', 'original');
    write('docs/archive/manifest.json', JSON.stringify({ files: [{ snapshot: 'docs/archive/link.md', sha256: sha256('original') }] }));
    symlinkSync('../../private/original.md', path.join(directory, 'docs/archive/link.md'));
    const result = checkPreservationManifests(directory, ['docs/archive/manifest.json'], readRepositoryFiles(directory).map((file) => file.path));
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /must not contain symbolic links/);
    assert.equal(result.snapshotsChecked, 0);
  });
});

test('preservation rejects symlink parent directories and ignored snapshot paths', () => {
  withRepository(({ directory, write }) => {
    write('.gitignore', 'private/\n');
    write('private/original.md', 'original');
    write('docs/archive/manifest.json', JSON.stringify({ files: [
      { snapshot: 'docs/archive/link/original.md', sha256: sha256('original') },
      { snapshot: 'private/original.md', sha256: sha256('original') },
    ] }));
    symlinkSync('../../private', path.join(directory, 'docs/archive/link'));
    const candidates = ['docs/archive/manifest.json', 'docs/archive/link/original.md'];
    const result = checkPreservationManifests(directory, ['docs/archive/manifest.json'], candidates);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /must not contain symbolic links/);
    assert.match(result.errors[1], /absent or ignored/);
    assert.equal(result.snapshotsChecked, 0);
  });
});

test('end-to-end hygiene checks both startup imports and the configured preservation manifest', () => {
  withRepository(({ directory, write }) => {
    for (const document of contextDocuments()) write(document.path, document.content);
    const manifestPath = 'docs/archive/manifest.json';
    const snapshot = 'docs/archive/original.md';
    write('scripts/repository-hygiene-baseline.json', JSON.stringify({ ...emptyBaseline, preservationManifests: [manifestPath] }));
    write(snapshot, 'original');
    write(manifestPath, JSON.stringify({ files: [{ original: 'AGENTS.md', snapshot, sha256: sha256('original') }] }));
    assert.deepEqual(runRepositoryHygiene(directory).errors, []);
    write('CLAUDE.md', '@AGENTS.md\n');
    write(snapshot, 'tampered');
    const result = runRepositoryHygiene(directory);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /missing exact standalone/);
    assert.match(result.errors[1], /SHA-256 mismatch/);
  });
});
