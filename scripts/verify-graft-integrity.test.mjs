// R12: local Git grafts must not rewrite pinned source ancestry despite --no-replace-objects.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitAncestor, listGitHistoryChanges } from "./verify-source-integration.mjs";

test("release ancestry and history reject local grafts that forge a pinned commit parent", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-release-graft-r12-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commit = message => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  git("config", "user.name", "AXOM Graft Regression");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "file.txt"), "approved base\n");
  const originalParent = commit("reviewed parent");
  writeFileSync(join(cwd, "file.txt"), "approved source\n");
  const sourceSha = commit("reviewed source child");

  // A distinct root is not an actual ancestor of either reviewed commit.
  git("checkout", "--orphan", "unrelated-root");
  git("rm", "-q", "-rf", "--cached", ".");
  writeFileSync(join(cwd, "file.txt"), "unrelated bytes\n");
  const unrelated = commit("unrelated orphan");
  assert.equal(isGitAncestor(originalParent, sourceSha, cwd), true);
  assert.equal(isGitAncestor(unrelated, sourceSha, cwd), false);
  assert.equal(listGitHistoryChanges(originalParent, sourceSha, cwd).length, 1);

  // Deprecated but still supported by Git: grafts rewrite rev-list and merge-base,
  // even under --no-replace-objects; cat-file keeps the immutable commit parent.
  const graftFile = git("rev-parse", "--git-path", "info/grafts");
  const path = graftFile.startsWith("/") ? graftFile : join(cwd, graftFile);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${sourceSha} ${unrelated}\n`);
  const apparentParents = git("--no-replace-objects", "rev-list", "--parents", "-1", sourceSha);
  assert.equal(apparentParents, `${sourceSha} ${unrelated}`, "fixture must prove Git still applies grafts");
  const raw = git("--no-replace-objects", "cat-file", "-p", sourceSha);
  assert.match(raw, new RegExp(`^parent ${originalParent}$`, "m"));
  assert.throws(() => isGitAncestor(unrelated, sourceSha, cwd), /graft/i);
  assert.throws(() => listGitHistoryChanges(originalParent, sourceSha, cwd), /graft/i);
});
