import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listGitHistoryChanges, readGitFile } from "./verify-source-integration.mjs";

test("strict release attestation rejects an absent reviewed blob even when Git trees and diffs remain readable", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-release-missing-blob-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  git("init", "-q");
  git("config", "user.name", "AXOM release blob fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  mkdirSync(join(cwd, "docs"));
  const path = "docs/approved.txt";
  writeFileSync(join(cwd, path), "original\n");
  git("add", "-A");
  git("commit", "-qm", "release base");
  const integrationBaseSha = git("rev-parse", "HEAD");

  git("checkout", "-qb", "reviewed-source");
  writeFileSync(join(cwd, path), "reviewed content\n");
  git("add", "-A");
  git("commit", "-qm", "reviewed source");
  const sourceSha = git("rev-parse", "HEAD");
  const sourceBlob = readGitFile(sourceSha, path, cwd);
  const receipts = listGitHistoryChanges(integrationBaseSha, sourceSha, cwd)
    .flatMap(commit => commit.changes.filter(change => change.status !== "D")
      .map(change => {
        const file = readGitFile(commit.sha, change.path, cwd, true);
        return { commitSha: commit.sha, path: change.path, mode: file.mode, blob: file.blob };
      }));
  assert.equal(receipts.length, 1);

  git("checkout", "-qb", "release-integration", integrationBaseSha);
  git("merge", "--no-ff", "-qm", "merge approved source", sourceSha);
  const integratedSha = git("rev-parse", "HEAD");
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const manifestPath = join(cwd, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: 2, integrationBaseSha, integratedSha,
    sources: [{ baseSha: integrationBaseSha, sourceSha }],
    requireSourceBlobReceipts: true, sourceBlobReceipts: receipts,
  }));
  const invoke = () => JSON.parse(execFileSync(process.execPath, [cli, manifestPath], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  }));
  assert.equal(invoke().sourceBlobReceiptParityVerified, true);

  // A missing ordinary blob must never be attested solely from the Git tree SHA.
  // Use a loose fixture blob so this does not modify packed or shared objects.
  const objectPath = join(cwd, ".git", "objects", sourceBlob.blob.slice(0, 2),
    sourceBlob.blob.slice(2));
  unlinkSync(objectPath);
  assert.match(git("ls-tree", "-r", integratedSha, "--", path),
    new RegExp(sourceBlob.blob + "\\t" + path.replace(".", "\\.")));
  assert.match(git("diff", "--name-status", integrationBaseSha, integratedSha), /M\\s+docs\\/approved\\.txt/);
  assert.throws(() => invoke(), error => error.status === 1
    && /Missing or unreadable pinned Git blob object: docs\\/approved\\.txt/.test(String(error.stderr)),
    "a release cannot attest Git object bytes that are absent locally");
});
