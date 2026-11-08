import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listGitHistoryChanges, readGitFile } from "./verify-source-integration.mjs";

// R17: Git's plumbing can store duplicate parent headers even though
// commit-tree normally deduplicates them. A repeated parent is not a merge.
test("v2 rejects a release pseudo-merge with repeated Git parent SHAs", t => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("Git is unavailable on this runner");
    return;
  }

  const cwd = mkdtempSync(join(tmpdir(), "axom-duplicate-merge-parent-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  git("init", "-q");
  git("config", "user.name", "AXOM test");
  git("config", "user.email", "release-test@example.invalid");
  writeFileSync(join(cwd, "approved.txt"), "base\n");
  git("add", "approved.txt");
  git("commit", "-qm", "base");
  const integrationBaseSha = git("rev-parse", "HEAD");

  git("checkout", "-qb", "reviewed-source");
  writeFileSync(join(cwd, "approved.txt"), "reviewed\n");
  git("add", "approved.txt");
  git("commit", "-qm", "reviewed source");
  const sourceSha = git("rev-parse", "HEAD");
  const sourceBlobReceipts = listGitHistoryChanges(integrationBaseSha, sourceSha, cwd)
    .flatMap(commit => commit.changes.filter(change => change.status !== "D")
      .map(change => {
        const file = readGitFile(commit.sha, change.path, cwd, true);
        return { commitSha: commit.sha, path: change.path, mode: file.mode, blob: file.blob };
      }));
  assert.equal(sourceBlobReceipts.length, 1);

  // A genuine merge with distinct parent commits is still accepted.
  git("checkout", "-qb", "normal-integration", integrationBaseSha);
  git("merge", "--no-ff", "-qm", "merge reviewed source", sourceSha);
  const normalSha = git("rev-parse", "HEAD");
  assert.equal(git("rev-list", "--parents", "-n", "1", normalSha).split(" ").length, 3);

  // A raw commit object can contain the same parent TWICE. Git retains both
  // headers in rev-list output even though there is only one real lineage.
  const tree = git("rev-parse", sourceSha + "^{tree}");
  const raw = [
    "tree " + tree,
    "parent " + sourceSha,
    "parent " + sourceSha,
    "author AXOM Test <release-test@example.invalid> 1794160800 +0000",
    "committer AXOM Test <release-test@example.invalid> 1794160800 +0000",
    "",
    "forged two-parent release carrier",
    "",
  ].join("\n");
  const pseudoMergeSha = execFileSync("git",
    ["hash-object", "-t", "commit", "-w", "--stdin"],
    { cwd, encoding: "utf8", input: raw, stdio: ["pipe", "pipe", "pipe"] }).trim();
  assert.equal(
    git("rev-list", "--parents", "-n", "1", pseudoMergeSha).split(" ").length, 3,
    "the raw Git object advertises two identical parent SHAs",
  );

  const manifestPath = join(cwd, "manifest.json");
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const invoke = integratedSha => {
    writeFileSync(manifestPath, JSON.stringify({
      version: 2, integrationBaseSha, integratedSha,
      sources: [{ baseSha: integrationBaseSha, sourceSha }],
      requireSourceBlobReceipts: true, sourceBlobReceipts,
    }));
    return JSON.parse(execFileSync(process.execPath, [cli, manifestPath], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
  };

  assert.equal(invoke(normalSha).commitHistoryAttested, true);
  assert.throws(() => invoke(pseudoMergeSha),
    error => error.status === 1 && /Duplicate Git history parent/.test(error.stderr),
    "a repeated parent must never satisfy the release merge-carrier rule");
});
