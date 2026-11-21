import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitFile, validateSourceManifest, verifyCompleteSourceIntegration } from "./verify-source-integration.mjs";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const badPaths = [".git", ".git/config", "docs/.GIT/config", "docs/.Git/hooks/pre-commit"];
const v1 = path => ({
  version: 1, integratedSha: C, sources: [{ sourceSha: B, paths: [path] }],
});
const v2 = () => ({
  version: 2, integrationBaseSha: A, integratedSha: C,
  sources: [{ baseSha: A, sourceSha: B }],
  requireSourceBlobReceipts: true, sourceBlobReceipts: [],
});

test("v1 and v2 release source manifests exclude reserved Git metadata components", () => {
  for (const path of badPaths) {
    assert.throws(() => validateSourceManifest(v1(path)), /Unsafe\/noncanonical/, path);
    assert.throws(() => verifyCompleteSourceIntegration(v2(), {
      isAncestor: () => true,
      listChanges: () => [{ status: "A", path }],
      readFile: () => ({ mode: "100644", blob: A }),
      listTreePaths: () => [path],
      listHistoryChanges: () => [],
    }), /Unsafe\/noncanonical/, path);
  }
});

test("legitimate Git companion files and ordinary path segments remain allowed", () => {
  for (const path of [
    ".gitignore", ".gitattributes", ".gitmodules", "docs/.gitkeep",
    "docs/git/config", "docs/.github/workflows/test.yml", "docs/git.settings",
  ]) {
    assert.equal(validateSourceManifest(v1(path)).entries[0].path, path);
  }
});

test("a real immutable Git tree can contain uncheckoutable .git/config: release file resolver must refuse it", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-release-reserved-git-path-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (args, input) => execFileSync("git", args, {
    cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  git(["init", "-q"]);
  const blob = git(["hash-object", "-w", "--stdin"], "unreviewed Git config\n");
  const nestedTree = git(["mktree"], "100644 blob " + blob + "\tconfig\n");
  const rootTree = git(["mktree"], "040000 tree " + nestedTree + "\t.git\n");
  const commit = git([
    "-c", "user.name=AXOM fixture", "-c", "user.email=fixture@example.invalid",
    "commit-tree", rootTree,
  ], "metadata namespace fixture\n");
  assert.match(git(["ls-tree", "-r", "--name-only", commit]), /\.git\/config/);
  assert.throws(() => git(["read-tree", "--reset", "-u", commit]), /invalid path/, 
    "Git itself refuses to check out this reserved namespace");
  assert.throws(() => readGitFile(commit, ".git/config", cwd), /Unsafe\/noncanonical/,
    "pinned blob parity cannot make a reserved metadata path release-safe");
});
