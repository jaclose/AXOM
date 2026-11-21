import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listGitHistoryChanges, readGitFile } from "./verify-source-integration.mjs";

test("strict v2 CLI refuses unclaimed merge gitlinks under diff.ignoreSubmodules=all", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-release-gitlink-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q");
  git("config", "user.name", "AXOM release regression fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "approved.txt"), "base\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const integrationBaseSha = git("rev-parse", "HEAD");
  git("checkout", "-qb", "reviewed-source");
  writeFileSync(join(cwd, "docs", "approved.txt"), "reviewed\n");
  git("add", "-A"); git("commit", "-qm", "approved source");
  const sourceSha = git("rev-parse", "HEAD");
  const receipts = listGitHistoryChanges(integrationBaseSha, sourceSha, cwd)
    .flatMap(commit => commit.changes.filter(c => c.status !== "D").map(c => {
      const file = readGitFile(commit.sha, c.path, cwd, true);
      return { commitSha: commit.sha, path: c.path, mode: file.mode, blob: file.blob };
    }));
  assert.equal(receipts.length, 1);
  git("checkout", "-qb", "clean-integration", integrationBaseSha);
  git("merge", "--no-ff", "-qm", "approved merge", sourceSha);
  const cleanSha = git("rev-parse", "HEAD");
  git("checkout", "-qb", "contaminated-integration", integrationBaseSha);
  git("merge", "--no-ff", "--no-commit", sourceSha);
  git("update-index", "--add", "--cacheinfo",
    "160000," + "1".repeat(40) + ",vendor/hidden");
  git("commit", "-qm", "merge includes extra unapproved gitlink");
  const contaminatedSha = git("rev-parse", "HEAD");
  assert.equal(git("rev-list", "--parents", "-n", "1", contaminatedSha).split(" ").length, 3);
  assert.match(git("ls-tree", "-r", contaminatedSha), /160000 commit [a-f0-9]{40}\tvendor\/hidden/);
  git("config", "diff.ignoreSubmodules", "all");
  assert.doesNotMatch(git("diff", "--no-ext-diff", "--no-renames",
    "--name-status", integrationBaseSha, contaminatedSha), /vendor\/hidden/);
  assert.match(git("diff", "--no-ext-diff", "--no-renames",
    "--ignore-submodules=none", "--name-status", integrationBaseSha, contaminatedSha),
    /A\s+vendor\/hidden/);
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const manifestPath = join(cwd, "manifest.json");
  const invoke = integratedSha => {
    writeFileSync(manifestPath, JSON.stringify({
      version: 2, integrationBaseSha, integratedSha,
      requireSourceBlobReceipts: true, sourceBlobReceipts: receipts,
      sources: [{ baseSha: integrationBaseSha, sourceSha }],
    }));
    return JSON.parse(execFileSync(process.execPath, [cli, manifestPath],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  };
  assert.equal(invoke(cleanSha).sourceBlobReceiptParityVerified, true);
  // Before R16 this falsely PASSES. The patched verifier must reject it.
  assert.throws(() => invoke(contaminatedSha),
    error => error.status === 1
      && /Incomplete source inventory or unexpected integrated files: vendor\/hidden/.test(error.stderr));
});
