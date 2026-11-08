#!/usr/bin/env node
// Read-only, exact-source Git tree verification for coordinated AXOM releases.
// CLI: node scripts/verify-source-integration.mjs manifest.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const PATH = /^[A-Za-z0-9._/-]+$/;
// Windows reserves device basenames even when followed by extensions.
const WINDOWS_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const MODES = new Set(["100644", "100755"]);
function validSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(label + " must be a pinned 40-character lowercase commit SHA.");
  return value;
}
function validPath(value) {
  if (typeof value !== "string" || !value || !PATH.test(value)
    || value.startsWith("/") || value.startsWith("-")
    || value.split("/").some(segment => !segment || segment === "." || segment === ".."
      || segment.endsWith(".") || WINDOWS_DEVICE.test(segment))) {
    throw new Error("Unsafe/noncanonical release file path: " + String(value));
  }
  return value;
}
/** Check all claims before any Git reads to avoid half-validated releases. */
export function validateSourceManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.version !== 1) {
    throw new Error("Expected source-integration manifest version 1.");
  }
  const integratedSha = validSha(manifest.integratedSha, "integratedSha");
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error("Missing source revisions.");
  const seen = new Map(), entries = [];
  for (const source of manifest.sources) {
    const sourceSha = validSha(source?.sourceSha, "sourceSha");
    if (!Array.isArray(source.paths) || !source.paths.length) throw new Error("Missing source file paths.");
    for (const raw of source.paths) {
      const path = validPath(raw);
      // Git tracks case-sensitive paths even if macOS/Windows checkouts cannot.
      // A source manifest must be reproducible across supported native targets.
      const folded = path.toLowerCase();
      if (seen.has(folded)) {
        throw new Error("Duplicate or case-insensitive source-file ownership: " + path + " conflicts with " + seen.get(folded));
      }
      seen.set(folded, path);
      entries.push({ sourceSha, path });
    }
  }
  return { integratedSha, entries, sources: manifest.sources.length };
}
function regularFile(value, name) {
  if (!value || typeof value !== "object" || !MODES.has(value.mode)
    || typeof value.blob !== "string" || !SHA.test(value.blob)) {
    throw new Error("Missing, symbolic or nonregular Git file: " + name);
  }
  return value;
}
/** Resolver injection supports deterministic failure tests. No writes occur. */
export function verifySourceIntegration(manifest, readFile) {
  const { integratedSha, entries, sources } = validateSourceManifest(manifest);
  if (typeof readFile !== "function") throw new Error("Missing Git blob resolver.");
  const files = [];
  for (const entry of entries) {
    let original, integrated;
    try {
      original = regularFile(readFile(entry.sourceSha, entry.path), "source " + entry.path);
      integrated = regularFile(readFile(integratedSha, entry.path), "integration " + entry.path);
    } catch (cause) {
      throw new Error("Unable to verify pinned source file " + entry.path + ": " + (cause instanceof Error ? cause.message : String(cause)));
    }
    if (original.mode !== integrated.mode || original.blob !== integrated.blob) {
      throw new Error("Integration differs from exact pinned source file: " + entry.path);
    }
    files.push({ path: entry.path, sourceSha: entry.sourceSha, mode: original.mode, blob: original.blob });
  }
  return { version: 1, completeForDeclaredRanges: false, integratedSha, verifiedSources: sources, verifiedFiles: files.length, files };
}
/** Resolve immutable local Git objects; never fetch, checkout, deploy or merge. */
export function readGitFile(sha, path, cwd = process.cwd(), allowMissing = false) {
  validSha(sha, "Git revision");
  validPath(path);
  // A tree object can have the same blobs while not being the reviewed commit.
  // Prove each claimed revision is an actual commit object, not just 40 hex digits.
  const kind = execFileSync("git", ["cat-file", "-t", sha],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (kind !== "commit") throw new Error("Expected pinned commit object: " + sha);
  const output = execFileSync("git", ["ls-tree", "-r", "--full-tree", sha, "--", path],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  const rows = output ? output.split("\n") : [];
  if (allowMissing && rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("Expected exactly one tracked file: " + path);
  const match = /^([0-9]{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[2] !== "blob" || match[4] !== path) throw new Error("Mismatched Git file identity: " + path);
  return regularFile({ mode: match[1], blob: match[3] }, path);
}
/**
 * v2 complete-range verification: derive paths from immutable Git diffs instead
 * of trusting caller-supplied file lists. The specified commit ranges remain a
 * separate release-owner assertion; this never proves PR review or deployment.
 */
/**
 * Check changed paths (including ancestor directories) against the entire
 * integrated tree, so an unchanged inherited file cannot silently collide
 * with a new filename on Windows and case-insensitive macOS.
 * Unrelated pre-existing collisions do not falsely block this change.
 */
export function assertPortableTouchedTree(changes, treePaths) {
  if (!(changes instanceof Map) || !Array.isArray(treePaths)) {
    throw new Error("Missing or invalid integrated Git tree path inventory.");
  }
  const touched = new Set();
  for (const { path } of changes.values()) {
    const components = path.split("/");
    for (let i = 1; i <= components.length; i++) touched.add(components.slice(0, i).join("/").toLowerCase());
  }
  const seen = new Map();
  for (const path of treePaths) {
    if (typeof path !== "string" || !path || path.includes("\0")) throw new Error("Invalid tracked Git tree path.");
    const components = path.split("/");
    for (let i = 1; i <= components.length; i++) {
      const prefix = components.slice(0, i).join("/");
      const folded = prefix.toLowerCase();
      const previous = seen.get(folded);
      if (previous !== undefined && previous !== prefix && touched.has(folded)) {
        throw new Error("Case-insensitive integrated tree collision touching changed source: " + previous + " <> " + prefix);
      }
      if (previous === undefined) seen.set(folded, prefix);
    }
  }
  return treePaths.length;
}

export function verifyCompleteSourceIntegration(manifest, { listChanges, isAncestor, readFile, listTreePaths } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.version !== 2) {
    throw new Error("Expected complete source-integration manifest version 2.");
  }
  const integrationBaseSha = validSha(manifest.integrationBaseSha, "integrationBaseSha");
  const integratedSha = validSha(manifest.integratedSha, "integratedSha");
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error("Missing pinned source ranges.");
  if (![listChanges, isAncestor, readFile, listTreePaths].every(x => typeof x === "function")) {
    throw new Error("Complete verification requires Git diff, ancestry and file resolvers.");
  }
  if (!isAncestor(integrationBaseSha, integratedSha)) throw new Error("Integration base is not an ancestor of integration commit.");
  const wanted = new Map(), files = [];
  const sourceRanges = [];
  const addChanges = (changes, label) => {
    if (!Array.isArray(changes)) throw new Error("Invalid Git diff inventory: " + label);
    const seen = new Map();
    for (const change of changes) {
      const path = validPath(change?.path);
      if (!["A", "M", "D", "T"].includes(change?.status)) throw new Error("Unsupported Git change status: " + String(change?.status));
      const folded = path.toLowerCase();
      if (seen.has(folded)) throw new Error("Case-colliding or repeated Git diff path: " + path);
      seen.set(folded, { path, status: change.status });
    }
    return seen;
  };
  for (const source of manifest.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source) || "paths" in source) {
      throw new Error("v2 source ranges must not contain caller-selected paths.");
    }
    const baseSha = validSha(source.baseSha, "source baseSha");
    const sourceSha = validSha(source.sourceSha, "sourceSha");
    // A reviewed source may fork from an older main; its tip need not descend
    // from this newer integration base. Both lineages must independently be
    // ancestors of the final integrated commit (checked above and below).
    if (!isAncestor(baseSha, sourceSha) || !isAncestor(sourceSha, integratedSha)) {
      throw new Error("Pinned source/base is not an ancestor of its source or the integration commit: " + sourceSha);
    }
    const changes = addChanges(listChanges(baseSha, sourceSha), "source " + sourceSha);
    if (!changes.size) throw new Error("Pinned source range has no changed files: " + sourceSha);
    for (const [folded, change] of changes) {
      if (wanted.has(folded)) throw new Error("Conflicting source range ownership: " + change.path);
      wanted.set(folded, { ...change, sourceSha });
    }
    sourceRanges.push({ baseSha, sourceSha, changedFiles: changes.size });
  }
  const integrated = addChanges(listChanges(integrationBaseSha, integratedSha), "integration");
  if (integrated.size !== wanted.size) throw new Error("Incomplete source inventory or unexpected integrated files: expected " + wanted.size + ", integrated " + integrated.size);
  const verifiedTreePaths = assertPortableTouchedTree(integrated, listTreePaths(integratedSha));
  for (const [folded, expected] of wanted) {
    const actual = integrated.get(folded);
    if (!actual || expected.path !== actual.path || expected.status !== actual.status) {
      throw new Error("Source/integration changed-path inventory differs: " + expected.path);
    }
    let original, final;
    try {
      original = readFile(expected.sourceSha, expected.path);
      final = readFile(integratedSha, expected.path);
    } catch (cause) {
      throw new Error("Cannot resolve complete source Git objects for " + expected.path + ": " + (cause instanceof Error ? cause.message : String(cause)));
    }
    if (expected.status === "D") {
      if (original !== null || final !== null) throw new Error("Deleted source file reappeared: " + expected.path);
      files.push({ ...expected, deleted: true });
      continue;
    }
    original = regularFile(original, "source " + expected.path);
    final = regularFile(final, "integration " + expected.path);
    if (original.blob !== final.blob || original.mode !== final.mode) {
      throw new Error("Integrated file differs from pinned source contents or mode: " + expected.path);
    }
    files.push({ ...expected, mode: original.mode, blob: original.blob });
  }
  return { version: 2, integratedSha, integrationBaseSha, sourceRanges, verifiedFiles: files.length,
    verifiedSources: sourceRanges.length, deletedFiles: files.filter(x => x.deleted).length,
    completeForDeclaredRanges: true, verifiedTreePaths, files };
}

/** Binary-safe NUL-delimited Git diff. No rename detection; rename = D + A. */
export function listGitChanges(baseSha, headSha, cwd = process.cwd()) {
  validSha(baseSha, "diff baseSha");
  validSha(headSha, "diff headSha");
  const raw = execFileSync("git", ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", baseSha, headSha, "--"],
    { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (!raw) return [];
  const parts = raw.split("\0");
  if (parts.pop() !== "" || parts.length % 2 !== 0) throw new Error("Invalid NUL-delimited Git diff output.");
  const result = [];
  for (let index = 0; index < parts.length; index += 2) {
    result.push({ status: parts[index], path: parts[index + 1] });
  }
  return result;
}

/** Enumerate local immutable Git tree paths with NUL-delimited binary-safe names. */
export function listGitTreePaths(sha, cwd = process.cwd()) {
  validSha(sha, "integrated tree SHA");
  const kind = execFileSync("git", ["cat-file", "-t", sha],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (kind !== "commit") throw new Error("Expected pinned Git commit object for tree path inventory.");
  const output = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "--full-tree", sha],
    { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (!output) return [];
  const paths = output.split("\0");
  if (paths.pop() !== "") throw new Error("Invalid NUL-delimited full Git tree path inventory.");
  return paths;
}

/** Do not interpret a successful blob comparison as source inclusion. */
export function isGitAncestor(baseSha, headSha, cwd = process.cwd()) {
  validSha(baseSha, "ancestor baseSha");
  validSha(headSha, "ancestor headSha");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { cwd, stdio: "ignore" });
    return true;
  } catch (cause) {
    if (cause.status === 1) return false;
    throw new Error("Unable to verify Git commit ancestry: " + (cause instanceof Error ? cause.message : String(cause)));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: verify-source-integration.mjs <manifest.json>");
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const report = manifest.version === 2
      ? verifyCompleteSourceIntegration(manifest, {
        readFile: (sha, path) => readGitFile(sha, path, process.cwd(), true),
        listChanges: (a, b) => listGitChanges(a, b),
        isAncestor: (a, b) => isGitAncestor(a, b),
        listTreePaths: sha => listGitTreePaths(sha),
      })
      : verifySourceIntegration(manifest, (sha, path) => readGitFile(sha, path));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (cause) {
    process.stderr.write("Source integration verification FAILED: " + (cause instanceof Error ? cause.message : String(cause)) + "\n");
    process.exitCode = 1;
  }
}
