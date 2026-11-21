import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listGitHistoryChanges, readGitFile } from "./verify-source-integration.mjs";

// The exported v2 API remains diagnostic. The CLI is the release-owner entrypoint.
test("v2 release CLI fails closed without exhaustive intermediate-blob receipts", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-cli-source-receipt-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q");
  git("config", "user.name", "AXOM release policy test");
  git("config", "user.email", "release-policy@example.invalid");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "approved.txt"), "base\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const integrationBaseSha = git("rev-parse", "HEAD");
  git("checkout", "-qb", "reviewed-source");
  writeFileSync(join(cwd, "docs", "approved.txt"), "intermediate unreviewed\n");
  git("add", "-A"); git("commit", "-qm", "intermediate source");
  writeFileSync(join(cwd, "docs", "approved.txt"), "approved final\n");
  git("add", "-A"); git("commit", "-qm", "final source");
  const sourceSha = git("rev-parse", "HEAD");
  git("checkout", "-qb", "integration", integrationBaseSha);
  git("merge", "--no-ff", "-qm", "integrate source", sourceSha);
  const integratedSha = git("rev-parse", "HEAD");
  const input = { version: 2, integrationBaseSha, integratedSha,
    sources: [{ baseSha: integrationBaseSha, sourceSha }] };
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const manifestPath = join(cwd, "release-manifest.json");
  const invoke = payload => {
    writeFileSync(manifestPath, JSON.stringify(payload));
    return JSON.parse(execFileSync(process.execPath, [cli, manifestPath],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  };
  const requiresReceipts = error => error.status === 1
    && /v2 CLI requires exact source-history blob receipts/.test(error.stderr);
  // RED before R15: the CLI returned completeForDeclaredRanges=true without receipts.
  assert.throws(() => invoke(input), requiresReceipts);
  assert.throws(() => invoke({ ...input, requireSourceBlobReceipts: false }), requiresReceipts);
  const receipts = listGitHistoryChanges(integrationBaseSha, sourceSha, cwd)
    .flatMap(commit => commit.changes.filter(change => change.status !== "D")
      .map(change => {
        const file = readGitFile(commit.sha, change.path, cwd, true);
        return { commitSha: commit.sha, path: change.path, mode: file.mode, blob: file.blob };
      }));
  assert.equal(receipts.length, 2);
  const strict = { ...input, requireSourceBlobReceipts: true, sourceBlobReceipts: receipts };
  const report = invoke(strict);
  assert.equal(report.completeForDeclaredRanges, true);
  assert.equal(report.commitHistoryAttested, true);
  assert.equal(report.sourceBlobReceiptParityVerified, true);
  assert.equal(report.sourceBlobReceiptsVerified, 2);
  assert.equal(report.independentContentApprovalVerified, false);
  assert.throws(() => invoke({ ...strict, sourceBlobReceipts: receipts.slice(1) }),
    error => error.status === 1 && /Missing source blob receipt/.test(error.stderr));
  assert.throws(() => invoke({ ...strict, sourceBlobReceipts: [
    { ...receipts[0], blob: "f".repeat(40) }, receipts[1],
  ] }), error => error.status === 1 && /Mismatched source blob receipt/.test(error.stderr));
});
