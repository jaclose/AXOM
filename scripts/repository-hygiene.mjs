#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const BOOTSTRAP_TOKEN_BUDGET = 4_000;
const BOOTSTRAP_FILES = ['AGENTS.md', 'docs/AI_STATE.md'];
const BOOTSTRAP_PROFILES = {
  'Bootstrap context': BOOTSTRAP_FILES,
  'Claude effective bootstrap': [...BOOTSTRAP_FILES, 'CLAUDE.md'],
  'Copilot routed bootstrap': [...BOOTSTRAP_FILES, '.github/copilot-instructions.md'],
};
export const DOCUMENT_BUDGETS = Object.freeze({
  'AGENTS.md': 12_000,
  'docs/AI_STATE.md': 12_000,
  'CLAUDE.md': 1_500,
  '.github/copilot-instructions.md': 1_500,
});
const ENTRYPOINTS = new Set([
  ...Object.keys(DOCUMENT_BUDGETS), 'README.md', 'web/README.md', 'docs/INDEX.md',
  'docs/directions/README.md',
  ...['architecture', 'features', 'operations', 'product', 'decisions', 'archive']
    .map((section) => `docs/${section}/README.md`),
]);
const GENERATED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.build', '.cache', '.next', '.nuxt', '.output',
  'coverage', 'target', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.turbo', '.parcel-cache', '.vite', 'deriveddata', '.swiftpm', 'playwright-report',
  'test-results', 'artifacts', 'output', 'tmp', 'temp', 'logs', 'screenshots',
]);
const RULES = new Set(['large-file', 'generated-artifact', 'root-media']);

export function isActiveDocument(filePath) {
  if (ENTRYPOINTS.has(filePath)) return true;
  // Archived source links describe their original location and remain frozen.
  return /^docs\/(?:architecture|features|operations|product|decisions)\/(?:[^/]+\/)*[a-z0-9][a-z0-9._-]*\.md$/.test(filePath);
}

export function artifactRules(filePath, bytes) {
  const rules = [];
  if (bytes > MAX_FILE_BYTES) rules.push('large-file');
  const segments = filePath.toLowerCase().split('/');
  if (segments.slice(0, -1).some((segment) => GENERATED_DIRS.has(segment))
    || /\.(?:log|pyc|tsbuildinfo)$/i.test(filePath)
    || /(?:^|\/)\.DS_Store$/.test(filePath)) rules.push('generated-artifact');
  if (segments.length === 1 && /\.(?:pdf|mp3|wav|m4a|aac|flac|ogg|aiff?|opus|mp4|mov|webm|mkv|png|jpe?g|webp|gif|heic|tiff?|avif)$/i.test(filePath)) {
    rules.push('root-media');
  }
  return rules;
}

export function checkFiles(files, baseline) {
  const errors = [];
  const exceptions = new Map();
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.exceptions)) {
    return ['Invalid hygiene baseline: expected schemaVersion 1 and exceptions array.'];
  }
  for (const exception of baseline.exceptions) {
    if (typeof exception.path !== 'string' || !exception.path || exception.path.startsWith('/')
      || exception.path.split('/').includes('..') || !Number.isSafeInteger(exception.bytes)
      || exception.bytes < 0 || !Array.isArray(exception.rules) || !exception.rules.length
      || exception.rules.some((rule) => !RULES.has(rule))
      || typeof exception.rationale !== 'string' || !exception.rationale.trim()) {
      errors.push('Invalid hygiene baseline exception: exact path, byte ceiling, rules and rationale are required.');
      continue;
    }
    if (exceptions.has(exception.path)) errors.push(`Duplicate hygiene baseline exception: ${exception.path}`);
    exceptions.set(exception.path, exception);
  }
  for (const file of files) {
    const exception = exceptions.get(file.path);
    const rules = artifactRules(file.path, file.bytes);
    if (exception && file.bytes > exception.bytes) {
      errors.push(`${file.path}: grew beyond baseline (${file.bytes} > ${exception.bytes} bytes); review the asset and document any deliberate exception.`);
      continue;
    }
    for (const rule of rules) {
      if (exception?.rules.includes(rule)) continue;
      const reason = rule === 'large-file' ? `exceeds 5 MiB (${file.bytes} bytes)`
        : rule === 'root-media' ? 'loose root PDF, audio, video or image' : 'generated/cache/log artifact';
      errors.push(`${file.path}: ${reason}; keep generated/private material out of Git or document a reviewed exact-path exception.`);
    }
  }
  return errors;
}

function measureContext(content) {
  const characters = [...content].length;
  return {
    characters, words: content.match(/\S+/gu)?.length ?? 0,
    bytes: Buffer.byteLength(content, 'utf8'), estimatedTokens: Math.ceil(characters / 4),
  };
}

export function checkDocumentBudgets(documents) {
  const byPath = new Map(documents.map((document) => [document.path, document.content]));
  const errors = [];
  const estimates = [];
  for (const [filePath, limit] of Object.entries(DOCUMENT_BUDGETS)) {
    const content = byPath.get(filePath);
    if (content === undefined) {
      errors.push(`${filePath}: required context document is missing.`);
      continue;
    }
    const measurement = measureContext(content);
    const { characters } = measurement;
    estimates.push({ path: filePath, ...measurement, limit });
    if (characters > limit) errors.push(`${filePath}: ${characters} characters exceeds ${limit}; move detail to a linked document.`);
  }
  return { errors, estimates };
}

export function checkBootstrapContext(documents) {
  const byPath = new Map(documents.map((document) => [document.path, document.content]));
  const errors = [];
  const profiles = Object.entries(BOOTSTRAP_PROFILES).map(([label, paths]) => {
    const complete = paths.every((filePath) => byPath.has(filePath));
    const measurements = paths.map((filePath) => measureContext(byPath.get(filePath) ?? ''));
    const totals = { characters: 0, words: 0, bytes: 0, estimatedTokens: 0 };
    for (const measurement of measurements) {
      for (const key of Object.keys(totals)) totals[key] += measurement[key];
    }
    const withinBudget = totals.estimatedTokens <= BOOTSTRAP_TOKEN_BUDGET;
    if (!withinBudget) errors.push(`${label}: ~${totals.estimatedTokens} tokens exceeds ${BOOTSTRAP_TOKEN_BUDGET}; compress current guidance or move detail to routed docs, preserving critical state.`);
    // Missing documents are errors in checkDocumentBudgets; never label partial sums PASS.
    return { label, paths, ...totals, limit: BOOTSTRAP_TOKEN_BUDGET, complete, withinBudget };
  });
  return { errors, profiles };
}

function withoutCode(markdown) {
  let fence;
  return markdown.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = marker[1];
      return '';
    }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
        && line.slice(marker[0].length).trim() === '') fence = undefined;
      return '';
    }
    if (/^(?: {4}|\t)/.test(line)) return '';
    return line;
  }).join('\n').replace(/(`+)([\s\S]*?)\1/g, (code) => code.replace(/[^\n]/g, ' '));
}

export function checkStartupImports(documents) {
  const byPath = new Map(documents.map((document) => [document.path, document.content]));
  const required = ['AGENTS.md', 'docs/AI_STATE.md'];
  const errors = [];
  for (const filePath of ['CLAUDE.md', ...required]) {
    const source = withoutCode(byPath.get(filePath) ?? '');
    if (filePath === 'CLAUDE.md') {
      for (const target of required) {
        if (!source.split('\n').includes(`@${target}`)) {
          errors.push(`CLAUDE.md: missing exact standalone @${target} import outside code.`);
        }
      }
    }
    for (const match of source.matchAll(/(?<![\w@\\])@([^\s<>\[\]{}\x60"'(),;!?]+)/g)) {
      const target = match[1];
      if (filePath === 'CLAUDE.md' && required.includes(target)) continue;
      errors.push(`${filePath}: unexpected @${target} auto-import; startup loads only AGENTS.md and docs/AI_STATE.md. Use a plain Markdown link for retrieval.`);
    }
  }
  return errors;
}

export function isSafeRepositoryPath(filePath) {
  return typeof filePath === 'string' && filePath.length > 0
    && !/[\\\0]/.test(filePath) && !/^(?:\/|[a-z]:)/i.test(filePath)
    && !filePath.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

export function validateSnapshotEntry(entry) {
  const errors = [];
  if (!isSafeRepositoryPath(entry?.snapshot)) errors.push('Snapshot path must be a safe relative file path inside the repository.');
  if (!/^[a-f\d]{64}$/i.test(entry?.sha256 ?? '')) errors.push('Snapshot requires a valid SHA-256 digest.');
  return errors;
}

export function checkSnapshotIntegrity(entry, actualSha256) {
  const errors = validateSnapshotEntry(entry);
  if (errors.length) return errors;
  if (actualSha256 === undefined) return [`${entry.snapshot}: preserved snapshot is missing.`];
  if (actualSha256.toLowerCase() !== entry.sha256.toLowerCase()) return [`${entry.snapshot}: preserved snapshot SHA-256 mismatch.`];
  return [];
}

function readPreservedFile(repoRoot, filePath, candidates) {
  if (!isSafeRepositoryPath(filePath)) throw new Error('path must be a safe relative file path inside the repository');
  if (!candidates.has(filePath)) throw new Error('required preserved file is missing from Git candidates (absent or ignored)');
  let current = repoRoot;
  const segments = filePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('preserved paths must not contain symbolic links');
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error('preserved path parent is not a directory');
    if (index === segments.length - 1 && !stat.isFile()) throw new Error('preserved snapshot must be a regular file');
  }
  return readFileSync(current);
}

export function checkPreservationManifests(repoRoot, manifestPaths, filePaths) {
  if (!Array.isArray(manifestPaths)) {
    return { errors: ['Invalid hygiene baseline: preservationManifests array is required.'], snapshotsChecked: 0 };
  }
  const candidates = new Set(filePaths);
  const errors = [];
  let snapshotsChecked = 0;
  for (const manifestPath of manifestPaths) {
    let manifest;
    try { manifest = JSON.parse(readPreservedFile(repoRoot, manifestPath, candidates).toString('utf8')); }
    catch (error) { errors.push(`${manifestPath}: cannot verify preservation manifest: ${error.message}.`); continue; }
    if (!Array.isArray(manifest.files) || !manifest.files.length) {
      errors.push(`${manifestPath}: preservation manifest requires a nonempty files array.`);
      continue;
    }
    const seen = new Set();
    for (const entry of manifest.files) {
      const entryErrors = validateSnapshotEntry(entry);
      if (entryErrors.length) { errors.push(...entryErrors.map((error) => `${manifestPath}: ${error}`)); continue; }
      if (seen.has(entry.snapshot)) { errors.push(`${manifestPath}: duplicate snapshot ${entry.snapshot}.`); continue; }
      seen.add(entry.snapshot);
      let content;
      try { content = readPreservedFile(repoRoot, entry.snapshot, candidates); }
      catch (error) { errors.push(`${entry.snapshot}: cannot verify preserved snapshot: ${error.message}.`); continue; }
      snapshotsChecked += 1;
      errors.push(...checkSnapshotIntegrity(entry, createHash('sha256').update(content).digest('hex')));
    }
  }
  return { errors, snapshotsChecked };
}

// Read destinations without confusing balanced parentheses or optional titles with paths.
function destinationAt(markdown, offset) {
  let index = offset;
  while (/\s/.test(markdown[index] ?? '') && index < markdown.length) index += 1;
  if (markdown[index] === '<') {
    const end = markdown.indexOf('>', index + 1);
    return end < 0 ? undefined : markdown.slice(index + 1, end);
  }
  const start = index;
  let depth = 0;
  while (index < markdown.length) {
    const character = markdown[index];
    if (character === '\\' && index + 1 < markdown.length) { index += 2; continue; }
    if (/\s/.test(character) || (character === ')' && depth === 0)) break;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    index += 1;
  }
  return markdown.slice(start, index) || undefined;
}

export function extractMarkdownLinks(markdown) {
  const source = withoutCode(markdown);
  const links = [];
  for (const match of source.matchAll(/!?\[[^\]\n]*\]\(/g)) {
    const target = destinationAt(source, match.index + match[0].length);
    if (target) links.push({ target, line: source.slice(0, match.index).split('\n').length });
  }
  for (const match of source.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*/gm)) {
    const target = destinationAt(source, match.index + match[0].length);
    if (target) links.push({ target, line: source.slice(0, match.index).split('\n').length });
  }
  return links;
}

export function checkMarkdownLinks(documents, filePaths) {
  const knownPaths = new Set(['.']);
  for (const filePath of filePaths) {
    knownPaths.add(filePath);
    let directory = path.posix.dirname(filePath);
    while (directory !== '.') {
      knownPaths.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  const errors = [];
  for (const document of documents) {
    if (!isActiveDocument(document.path)) continue;
    for (const { target, line } of extractMarkdownLinks(document.content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\?|~\/)/i.test(target)) continue;
      let localPath;
      try {
        localPath = decodeURIComponent(target.split(/[?#]/, 1)[0]).replace(/\\([\\`*{}[\]()#+.!_<> -])/g, '$1');
      } catch {
        errors.push(`${document.path}:${line}: invalid URL encoding in ${target}`);
        continue;
      }
      if (!localPath) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(document.path), localPath));
      if (resolved === '..' || resolved.startsWith('../')) {
        errors.push(`${document.path}:${line}: relative link leaves repository: ${target}`);
      } else if (!knownPaths.has(resolved.replace(/\/$/, ''))) {
        errors.push(`${document.path}:${line}: missing relative link target: ${target}`);
      }
    }
  }
  return errors;
}

export function readRepositoryFiles(repoRoot) {
  // Git supplies the boundary: do not recurse into ignored or private files.
  const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
  const files = [];
  for (const filePath of [...new Set(candidates)].sort()) {
    let stat;
    try { stat = lstatSync(path.join(repoRoot, filePath)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isFile() || stat.isSymbolicLink()) files.push({ path: filePath, bytes: stat.size, symbolicLink: stat.isSymbolicLink() });
  }
  return files;
}

export function runRepositoryHygiene(repoRoot) {
  const files = readRepositoryFiles(repoRoot);
  const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/repository-hygiene-baseline.json'), 'utf8'));
  const documents = files.filter((file) => isActiveDocument(file.path) && !file.symbolicLink)
    .map((file) => ({ path: file.path, content: readFileSync(path.join(repoRoot, file.path), 'utf8') }));
  const budgets = checkDocumentBudgets(documents);
  const bootstrap = checkBootstrapContext(documents);
  const startupErrors = checkStartupImports(documents);
  const routingErrors = checkMarkdownLinks(documents, files.map((file) => file.path));
  const preservation = checkPreservationManifests(repoRoot, baseline.preservationManifests, files.map((file) => file.path));
  const errors = [
    ...files.filter((file) => file.symbolicLink && isActiveDocument(file.path))
      .map((file) => `${file.path}: active context documents must be regular files, not symbolic links.`),
    ...budgets.errors,
    ...bootstrap.errors,
    ...startupErrors,
    ...routingErrors,
    ...checkFiles(files, baseline),
    ...preservation.errors,
  ];
  return {
    errors, estimates: budgets.estimates, bootstrap: bootstrap.profiles,
    startupProblems: startupErrors.length, routingProblems: routingErrors.length,
    archiveProblems: preservation.errors.length,
    filesChecked: files.length, documentsChecked: documents.length, snapshotsChecked: preservation.snapshotsChecked,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = runRepositoryHygiene(path.resolve(path.dirname(scriptPath), '..'));
    for (const profile of result.bootstrap) {
      const status = !profile.complete ? 'INCOMPLETE' : profile.withinBudget ? 'PASS' : 'FAIL';
      console.log(`${profile.label}: ~${profile.estimatedTokens.toLocaleString('en-US')} tokens | Budget: ${profile.limit.toLocaleString('en-US')} | ${status} | ${profile.words} words, ${profile.bytes} bytes`);
    }
    console.log('Estimates sum chars/4 per file, including bridge text; repository files only, excluding task/client/global context.');
    for (const estimate of result.estimates) {
      console.log(`${estimate.path}: ${estimate.characters}/${estimate.limit} chars, ~${estimate.estimatedTokens} tokens, ${estimate.words} words, ${estimate.bytes} bytes | ${estimate.characters <= estimate.limit ? 'PASS' : 'FAIL'}`);
    }
    console.log(`Startup imports: ${result.startupProblems ? 'FAIL' : 'PASS'} | Routing links: ${result.routingProblems} problems | Archive integrity: ${result.archiveProblems ? 'FAIL' : 'PASS'} (${result.snapshotsChecked} snapshots checked)`);
    for (const error of result.errors) console.error(`FAIL ${error}`);
    console.log(`Repository hygiene: ${result.errors.length ? 'FAIL' : 'PASS'} (${result.documentsChecked} active docs, ${result.filesChecked} candidate files, ${result.snapshotsChecked} preserved snapshots, ${result.errors.length} problems).`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`Repository hygiene: FAIL (${error.message})`);
    process.exitCode = 1;
  }
}
