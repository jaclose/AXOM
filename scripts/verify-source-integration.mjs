#!/usr/bin/env node
// Read-only, exact-source Git tree verification for coordinated AXOM releases.
// CLI: node scripts/verify-source-integration.mjs manifest.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const PATH = /^[A-Za-z0-9._/-]+$/;
const MODES = new Set(["100644", "100755"]);
function validSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(label + " must be a pinned 40-character lowercase commit SHA.");
  return value;
}
function validPath(value) {
  if (typeof value !== "string" || !value || !PATH.test(value)
    || value.startsWith("/") || value.startsWith("-")
    || value.split("/").some(segment => !segment || segment === "." || segment === "..")) {
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
  return { integratedSha, verifiedSources: sources, verifiedFiles: files.length, files };
}
/** Resolve immutable local Git objects; never fetch, checkout, deploy or merge. */
export function readGitFile(sha, path, cwd = process.cwd()) {
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
  if (rows.length !== 1) throw new Error("Expected exactly one tracked file: " + path);
  const match = /^([0-9]{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[2] !== "blob" || match[4] !== path) throw new Error("Mismatched Git file identity: " + path);
  return regularFile({ mode: match[1], blob: match[3] }, path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: verify-source-integration.mjs <manifest.json>");
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const report = verifySourceIntegration(manifest, (sha, path) => readGitFile(sha, path));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (cause) {
    process.stderr.write("Source integration verification FAILED: " + (cause instanceof Error ? cause.message : String(cause)) + "\n");
    process.exitCode = 1;
  }
}
