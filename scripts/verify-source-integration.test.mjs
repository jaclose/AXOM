import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGitFile, validateSourceManifest, verifySourceIntegration } from "./verify-source-integration.mjs";
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const manifest = (paths = ["web/src/course.ts"]) => ({
  version: 1, integratedSha: A, sources: [{ sourceSha: B, paths }],
});
test("verifies every source blob and mode without modifying the integrated tree", () => {
  const input = manifest(["web/src/course.ts", "scripts/proof.test.mjs"]);
  input.sources.push({ sourceSha: C, paths: ["docs/AI_STATE.md"] });
  const reads = [];
  const report = verifySourceIntegration(input, (sha, path) => {
    reads.push([sha, path]);
    return { mode: "100644", blob: C };
  });
  assert.equal(report.verifiedFiles, 3);
  assert.equal(report.verifiedSources, 2);
  assert.deepEqual(reads, [
    [B, "web/src/course.ts"], [A, "web/src/course.ts"],
    [B, "scripts/proof.test.mjs"], [A, "scripts/proof.test.mjs"],
    [C, "docs/AI_STATE.md"], [A, "docs/AI_STATE.md"],
  ]);
  assert.throws(() => verifySourceIntegration(manifest(), sha =>
    ({ mode: sha === A ? "100755" : "100644", blob: C })), /differs/);
  assert.throws(() => verifySourceIntegration(manifest(), sha =>
    ({ mode: "100644", blob: sha === A ? A : C })), /differs/);
});
test("rejects invalid manifests, conflicting ownership, symlinks and missing blobs", () => {
  for (const path of ["../secret", "web/../private", "/root/file", "-flag", "web\\file", "web//file", "web/./file"]) {
    assert.throws(() => validateSourceManifest(manifest([path])), /Unsafe/);
  }
  for (const bad of ["main", "abc", "A".repeat(40), "a".repeat(39) + ";"]) {
    assert.throws(() => validateSourceManifest({ ...manifest(), integratedSha: bad }), /pinned/);
  }
  assert.throws(() => validateSourceManifest({ ...manifest(), version: 3 }), /version 1/);
  assert.throws(() => validateSourceManifest({ ...manifest(), sources: [] }), /source revisions/);
  assert.throws(() => validateSourceManifest(manifest([])), /source file paths/);
  const dup = manifest();
  dup.sources.push({ sourceSha: C, paths: ["web/src/course.ts"] });
  assert.throws(() => validateSourceManifest(dup), /Duplicate/);
  assert.throws(() => verifySourceIntegration(manifest(), () => null), /Unable to verify/);
  assert.throws(() => verifySourceIntegration(manifest(), () => ({ blob: C, mode: "120000" })), /nonregular/);
});
test("checks real Git commit objects and fails closed on a changed integrated file", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-integration-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = message => git("-c", "user.name=AXOM Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message);
  git("init", "-q");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "proof.txt"), "pinned source\n");
  writeFileSync(join(cwd, "docs", "other.txt"), "first\n");
  git("add", "--", "docs");
  commit("pinned source");
  const sourceSha = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "docs", "other.txt"), "second\n");
  git("add", "--", "docs/other.txt");
  commit("integration");
  const integratedSha = git("rev-parse", "HEAD");
  const input = { version: 1, integratedSha, sources: [{ sourceSha, paths: ["docs/proof.txt"] }] };
  assert.equal(verifySourceIntegration(input, (sha, path) => readGitFile(sha, path, cwd)).verifiedFiles, 1);
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const path = join(cwd, "source-proof.json");
  writeFileSync(path, JSON.stringify(input));
  const report = JSON.parse(execFileSync(process.execPath, [cli, path], { cwd, encoding: "utf8" }));
  assert.equal(report.verifiedFiles, 1);
  writeFileSync(join(cwd, "docs", "proof.txt"), "changed source\n");
  git("add", "--", "docs/proof.txt");
  commit("modified integration");
  assert.throws(() => verifySourceIntegration({ ...input, integratedSha: git("rev-parse", "HEAD") },
    (sha, file) => readGitFile(sha, file, cwd)), /differs from exact pinned/);
  assert.throws(() => readGitFile(sourceSha, "docs/missing.txt", cwd), /Expected exactly one/);
});
