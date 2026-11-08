#!/usr/bin/env node
// Read-only, exact-source Git tree verification for coordinated AXOM releases.
// CLI: node scripts/verify-source-integration.mjs manifest.json
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
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
// In release attestation, local refs/replace must NEVER rewrite an immutable SHA.
export function readGitFile(sha, path, cwd = process.cwd(), allowMissing = false) {
  validSha(sha, "Git revision");
  validPath(path);
  // A tree object can have the same blobs while not being the reviewed commit.
  // Prove each claimed revision is an actual commit object, not just 40 hex digits.
  const kind = execFileSync("git", ["--no-replace-objects", "cat-file", "-t", sha],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (kind !== "commit") throw new Error("Expected pinned commit object: " + sha);
  const output = execFileSync("git", ["--no-replace-objects", "ls-tree", "-r", "--full-tree", sha, "--", path],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  const rows = output ? output.split("\n") : [];
  if (allowMissing && rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("Expected exactly one tracked file: " + path);
  const match = /^([0-9]{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[2] !== "blob" || match[4] !== path) throw new Error("Mismatched Git file identity: " + path);
  const file = regularFile({ mode: match[1], blob: match[3] }, path);
  // A tree can reference an unavailable blob (for example in a partial or
  // damaged object database). Never attest bytes from the tree OID alone.
  // Disable lazy promisor fetching: this verifier must remain read-only and
  // must not silently contact a remote to populate missing objects.
  try {
    execFileSync("git", ["--no-replace-objects", "cat-file", "-e", file.blob + "^{blob}"],
      { cwd, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, stdio: "ignore" });
  } catch {
    throw new Error("Missing or unreadable pinned Git blob object: " + path);
  }
  return file;
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

export function verifyCompleteSourceIntegration(manifest, { listChanges, isAncestor, readFile, listTreePaths, listHistoryChanges } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.version !== 2) {
    throw new Error("Expected complete source-integration manifest version 2.");
  }
  const integrationBaseSha = validSha(manifest.integrationBaseSha, "integrationBaseSha");
  const integratedSha = validSha(manifest.integratedSha, "integratedSha");
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error("Missing pinned source ranges.");
  if (![listChanges, isAncestor, readFile, listTreePaths, listHistoryChanges].every(x => typeof x === "function")) {
    throw new Error("Complete verification requires Git diff, ancestry, tree, file and history resolvers.");
  }
  // An opt-in review inventory binds every nondeletion source-history event
  // to an exact immutable Git object. The caller's receipts are assertions:
  // independent content/rights/security approval must be separately established.
  if (manifest.requireSourceBlobReceipts !== undefined
    && typeof manifest.requireSourceBlobReceipts !== "boolean") {
    throw new Error("requireSourceBlobReceipts must be a boolean.");
  }
  const strictReceipts = manifest.requireSourceBlobReceipts === true;
  if ((strictReceipts && !Array.isArray(manifest.sourceBlobReceipts))
    || (!strictReceipts && Object.hasOwn(manifest, "sourceBlobReceipts"))) {
    throw new Error("Source blob receipts require explicit opt-in and an array.");
  }
  const sourceBlobReceipts = strictReceipts ? new Map() : null;
  if (strictReceipts) {
    for (const entry of manifest.sourceBlobReceipts) {
      const commitSha = validSha(entry?.commitSha, "source blob receipt commitSha");
      const path = validPath(entry?.path);
      if (!MODES.has(entry?.mode) || typeof entry?.blob !== "string" || !SHA.test(entry.blob)) {
        throw new Error("Invalid source blob receipt mode or SHA: " + path);
      }
      const key = commitSha + "\0" + path;
      if (sourceBlobReceipts.has(key)) {
        throw new Error("Duplicate source blob receipt: " + path + " at " + commitSha);
      }
      sourceBlobReceipts.set(key, { blob: entry.blob, mode: entry.mode });
    }
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
  // A reviewed change may already exist byte-for-byte in newer main, giving
  // it no net diff in the eventual merge. The integrated delta must still
  // contain NO unclaimed paths, but its size need not equal source inventory.
  for (const [folded, change] of integrated) {
    if (!wanted.has(folded)) {
      throw new Error("Incomplete source inventory or unexpected integrated files: " + change.path);
    }
  }
  // Include all pinned source paths, even those with zero net integrated diff,
  // in the case-insensitive full-tree collision safety boundary.
  const verifiedTreePaths = assertPortableTouchedTree(wanted, listTreePaths(integratedSha));
  let alreadyPresentInBase = 0;
  for (const [folded, expected] of wanted) {
    const actual = integrated.get(folded);
    // Git statuses are relative to different bases: A/M/T can legitimately
    // differ. A deletion must remain deleted. An absent final diff is allowed
    // only when the advanced integration base already has exact source state.
    if (actual && (expected.path !== actual.path
      || (expected.status === "D") !== (actual.status === "D"))) {
      throw new Error("Source/integration changed-path inventory differs: " + expected.path);
    }
    let original, final, base;
    try {
      original = readFile(expected.sourceSha, expected.path);
      final = readFile(integratedSha, expected.path);
      if (!actual) base = readFile(integrationBaseSha, expected.path);
    } catch (cause) {
      throw new Error("Cannot resolve complete source Git objects for " + expected.path + ": " + (cause instanceof Error ? cause.message : String(cause)));
    }
    if (expected.status === "D") {
      if (original !== null || final !== null) throw new Error("Deleted source file reappeared: " + expected.path);
      if (!actual && base !== null) throw new Error("Deleted source file not already absent from integration base: " + expected.path);
      if (!actual) alreadyPresentInBase++;
      files.push({ ...expected, integratedStatus: actual?.status ?? "UNCHANGED", deleted: true });
      continue;
    }
    original = regularFile(original, "source " + expected.path);
    final = regularFile(final, "integration " + expected.path);
    if (original.blob !== final.blob || original.mode !== final.mode) {
      throw new Error("Integrated file differs from pinned source contents or mode: " + expected.path);
    }
    if (!actual) {
      base = regularFile(base, "integration base " + expected.path);
      if (original.blob !== base.blob || original.mode !== base.mode) {
        throw new Error("Pinned source not already present in integration base: " + expected.path);
      }
      alreadyPresentInBase++;
    }
    files.push({ ...expected, integratedStatus: actual?.status ?? "UNCHANGED", mode: original.mode, blob: original.blob });
  }
  const history = assertReviewedGitHistory({ integrationBaseSha, integratedSha, sourceRanges, wanted, sourceBlobReceipts }, { listHistoryChanges, readFile, isAncestor });
  return { version: 2, integratedSha, integrationBaseSha, sourceRanges, verifiedFiles: files.length,
    verifiedSources: sourceRanges.length, deletedFiles: files.filter(x => x.deleted).length,
    alreadyPresentInBase, completeForDeclaredRanges: true, verifiedTreePaths, ...history, files };
}


/**
 * History proof complements net-diff/file parity: an intermediate Git commit
 * can still expose a file after that file is removed from the final tree.
 * Review scope is explicit source base..tip commits, plus merge-only carriers.
 */
export function assertReviewedGitHistory({ integrationBaseSha, integratedSha, sourceRanges, wanted, sourceBlobReceipts = null }, { listHistoryChanges, readFile, isAncestor }) {
  const sourceCommits = new Set();
  const remainingReceipts = sourceBlobReceipts === null ? null : new Map(sourceBlobReceipts);
  let sourceBlobReceiptsVerified = 0;
  let sourceHistoryCommits = 0, integrationHistoryCommits = 0, extraMergeCommits = 0, verifiedHistoryEvents = 0;
  const inspect = (base, tip, label) => {
    const commits = listHistoryChanges(base, tip);
    if (!Array.isArray(commits) || commits.length > 4096) throw new Error("Missing or excessive Git history inventory for " + label);
    const seen = new Set();
    for (const commit of commits) {
      const sha = validSha(commit?.sha, "history commit SHA");
      if (seen.has(sha)) throw new Error("Duplicate Git history commit: " + sha);
      seen.add(sha);
      if (!Array.isArray(commit.parents) || !commit.parents.length || !Array.isArray(commit.changes)) {
        throw new Error("Malformed Git commit parents/changes: " + sha);
      }
      for (const parent of commit.parents) validSha(parent, "history parent SHA");
      // A merge carrier needs distinct ancestry, not duplicated parent headers.
      // Git plumbing can store a raw commit with repeated parent SHAs.
      if (new Set(commit.parents).size !== commit.parents.length) {
        throw new Error("Duplicate Git history parent in commit: " + sha);
      }
      const paths = new Set();
      for (const change of commit.changes) {
        const path = validPath(change?.path);
        if (!["A", "M", "D", "T"].includes(change?.status)) throw new Error("Invalid Git history status for " + path);
        const folded = path.toLowerCase();
        if (paths.has(folded)) throw new Error("Case-colliding paths in Git history: " + path);
        paths.add(folded);
        verifiedHistoryEvents++;
      }
    }
    if (base !== tip && !seen.has(tip)) throw new Error("Incomplete Git history inventory for " + label);
    // Seeing the tip is not enough: a shortened or faulty resolver can omit
    // reachable intermediate parents and falsely claim complete provenance.
    // Parents outside base..tip must already be reachable from the declared
    // base; source-owned parents are separately validated before integration.
    for (const commit of commits) {
      for (const parent of commit.parents) {
        if (seen.has(parent) || parent === base
          || (label === "integration" && sourceCommits.has(parent))) continue;
        if (!isAncestor(parent, base)) {
          throw new Error("Incomplete Git history inventory: missing unreviewed parent "
            + parent + " of " + commit.sha + " in " + label);
        }
      }
    }
    return commits;
  };
  for (const { baseSha, sourceSha } of sourceRanges) {
    for (const commit of inspect(baseSha, sourceSha, "source " + sourceSha)) {
      if (sourceCommits.has(commit.sha)) throw new Error("Overlapping source commit ownership: " + commit.sha);
      sourceCommits.add(commit.sha);
      sourceHistoryCommits++;
      for (const change of commit.changes) {
        const approved = wanted.get(change.path.toLowerCase());
        if (!approved || approved.path !== change.path || approved.sourceSha !== sourceSha) {
          throw new Error("Unreviewed transient source history path: " + change.path + " at " + commit.sha);
        }
        // Every reachable source-history revision is part of the public release
        // history. A symlink/gitlink must not be hidden by a later regular file
        // at an otherwise approved path. Deletion events remain permitted.
        let historical;
        try {
          historical = readFile(commit.sha, change.path);
        } catch (cause) {
          throw new Error("Nonregular intermediate source Git object: " + change.path
            + " at " + commit.sha + ": " + (cause instanceof Error ? cause.message : String(cause)));
        }
        if (change.status === "D") {
          if (historical !== null) throw new Error("Deleted intermediate source Git object still present: " + change.path);
        } else {
          let actual;
          try {
            actual = regularFile(historical, "source history " + change.path);
          } catch (cause) {
            throw new Error("Nonregular intermediate source Git object: " + change.path
              + " at " + commit.sha + ": " + (cause instanceof Error ? cause.message : String(cause)));
          }
          if (remainingReceipts !== null) {
            const key = commit.sha + "\0" + change.path;
            const receipt = remainingReceipts.get(key);
            if (!receipt) throw new Error("Missing source blob receipt: " + change.path + " at " + commit.sha);
            if (receipt.blob !== actual.blob || receipt.mode !== actual.mode) {
              throw new Error("Mismatched source blob receipt: " + change.path + " at " + commit.sha);
            }
            remainingReceipts.delete(key);
            sourceBlobReceiptsVerified++;
          }
        }
      }
    }
  }
  for (const commit of inspect(integrationBaseSha, integratedSha, "integration")) {
    integrationHistoryCommits++;
    const sourceOwned = sourceCommits.has(commit.sha);
    if (!sourceOwned && commit.parents.length < 2) {
      throw new Error("Unclaimed non-merge release history commit: " + commit.sha);
    }
    if (!sourceOwned) extraMergeCommits++;
    for (const change of commit.changes) {
      const approved = wanted.get(change.path.toLowerCase());
      if (!approved || approved.path !== change.path) {
        throw new Error("Unreviewed transient integration history path: " + change.path + " at " + commit.sha);
      }
      if (!sourceOwned) {
        let atMerge, sourceTip, baseState;
        try {
          atMerge = readFile(commit.sha, change.path);
          sourceTip = readFile(approved.sourceSha, change.path);
          baseState = readFile(integrationBaseSha, change.path);
        } catch (cause) {
          throw new Error("Missing intermediate merge source Git object: " + change.path + ": " + String(cause));
        }
        const equivalent = (a, b) => (a === null && b === null)
          || (a !== null && b !== null && a?.blob === b?.blob && a?.mode === b?.mode
            && ["100644", "100755"].includes(a?.mode));
        if (!equivalent(atMerge, sourceTip) && !equivalent(atMerge, baseState)) {
          throw new Error("Unreviewed intermediate merge blob or mode: " + change.path + " at " + commit.sha);
        }
      }
    }
  }
  if (remainingReceipts?.size) {
    const [first] = remainingReceipts.keys();
    throw new Error("Unexpected source blob receipt outside source-history changes: " + first.replace("\0", " at "));
  }
  return { sourceHistoryCommits, integrationHistoryCommits, extraMergeCommits, verifiedHistoryEvents,
    commitHistoryAttested: true,
    sourceBlobReceiptParityVerified: remainingReceipts !== null,
    sourceBlobReceiptsVerified,
    independentContentApprovalVerified: false };
}

/** Binary-safe NUL-delimited Git diff; force submodule visibility despite local Git config. No rename detection. */
export function listGitChanges(baseSha, headSha, cwd = process.cwd()) {
  validSha(baseSha, "diff baseSha");
  validSha(headSha, "diff headSha");
  const raw = execFileSync("git", ["--no-replace-objects", "diff", "--no-ext-diff", "--no-renames", "--ignore-submodules=none", "--name-status", "-z", baseSha, headSha, "--"],
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


/**
 * Git's deprecated info/grafts rewrites rev-list and merge-base ancestry even
 * under --no-replace-objects. Never attest pinned commits against that local
 * mutable history override. Worktree paths are resolved through Git itself.
 */
function assertNoGitGrafts(cwd = process.cwd()) {
  const graftPath = execFileSync("git",
    ["--no-replace-objects", "rev-parse", "--git-path", "info/grafts"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!graftPath) throw new Error("Cannot locate Git graft file for release ancestry.");
  try {
    // Never follow a link: even an empty target can be replaced with forged ancestry.
    const graft = lstatSync(resolve(cwd, graftPath));
    if (!graft.isFile() || graft.size !== 0) {
      throw new Error("Refusing release ancestry from repository with Git graft file.");
    }
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
}

/**
 * List every newly reachable commit and its first-parent changed-file paths.
 * In contrast to base..tip net diffs, temporary add/remove blobs remain visible.
 * No local refs/replace, shell, checkout, fetch or write is allowed.
 */
export function listGitHistoryChanges(baseSha, headSha, cwd = process.cwd()) {
  assertNoGitGrafts(cwd);
  validSha(baseSha, "history baseSha");
  validSha(headSha, "history headSha");
  const raw = execFileSync("git", [
    "--no-replace-objects", "rev-list", "--parents", "--topo-order", headSha, "^" + baseSha,
  ], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!raw) return [];
  const rows = raw.split("\n");
  if (rows.length > 4096) throw new Error("Excessive Git history: " + rows.length);
  return rows.map(row => {
    const [sha, ...parents] = row.split(" ");
    validSha(sha, "history commit");
    for (const parent of parents) validSha(parent, "history parent");
    if (!parents.length) throw new Error("Unexpected root commit in release history: " + sha);
    return { sha, parents, changes: listGitChanges(parents[0], sha, cwd) };
  });
}

/** Enumerate local immutable Git tree paths with NUL-delimited binary-safe names. */
export function listGitTreePaths(sha, cwd = process.cwd()) {
  validSha(sha, "integrated tree SHA");
  const kind = execFileSync("git", ["--no-replace-objects", "cat-file", "-t", sha],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (kind !== "commit") throw new Error("Expected pinned Git commit object for tree path inventory.");
  const output = execFileSync("git", ["--no-replace-objects", "ls-tree", "-r", "-z", "--name-only", "--full-tree", sha],
    { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (!output) return [];
  const paths = output.split("\0");
  if (paths.pop() !== "") throw new Error("Invalid NUL-delimited full Git tree path inventory.");
  return paths;
}

/** Do not interpret a successful blob comparison as source inclusion. */
export function isGitAncestor(baseSha, headSha, cwd = process.cwd()) {
  assertNoGitGrafts(cwd);
  validSha(baseSha, "ancestor baseSha");
  validSha(headSha, "ancestor headSha");
  try {
    execFileSync("git", ["--no-replace-objects", "merge-base", "--is-ancestor", baseSha, headSha], { cwd, stdio: "ignore" });
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
    // The executable is the release attestation entrypoint, not a permissive
    // diagnostic adapter. Every reachable ordinary source-history revision must
    // have its pinned Git blob receipt before a v2 success report is emitted.
    if (manifest.version === 2 && manifest.requireSourceBlobReceipts !== true) {
      throw new Error("v2 CLI requires exact source-history blob receipts (requireSourceBlobReceipts=true); caller assertions do not establish independent content approval.");
    }
    const report = manifest.version === 2
      ? verifyCompleteSourceIntegration(manifest, {
        readFile: (sha, path) => readGitFile(sha, path, process.cwd(), true),
        listChanges: (a, b) => listGitChanges(a, b),
        isAncestor: (a, b) => isGitAncestor(a, b),
        listTreePaths: sha => listGitTreePaths(sha),
        listHistoryChanges: (base, head) => listGitHistoryChanges(base, head),
      })
      : verifySourceIntegration(manifest, (sha, path) => readGitFile(sha, path));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (cause) {
    process.stderr.write("Source integration verification FAILED: " + (cause instanceof Error ? cause.message : String(cause)) + "\n");
    process.exitCode = 1;
  }
}
