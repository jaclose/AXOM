// R13: graft path metadata must not follow links into mutable external files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isGitAncestor, listGitHistoryChanges } from "./verify-source-integration.mjs";

test("release provenance refuses empty and dangling Git graft symlinks", t => {
  if (process.platform === "win32") return t.skip("Graft symlink fixture requires Unix symlink support");
  const cwd = mkdtempSync(join(tmpdir(), "axom-release-graft-link-r13-"));
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
  git("config", "user.name", "AXOM Release Regression");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "reviewed.txt"), "base\n");
  const baseSha = commit("source base");
  writeFileSync(join(cwd, "reviewed.txt"), "reviewed revision\n");
  const sourceSha = commit("source revision");
  assert.equal(isGitAncestor(baseSha, sourceSha, cwd), true);
  assert.equal(listGitHistoryChanges(baseSha, sourceSha, cwd).length, 1);

  const gitPath = git("--no-replace-objects", "rev-parse", "--git-path", "info/grafts");
  const graftPath = isAbsolute(gitPath) ? gitPath : resolve(cwd, gitPath);
  mkdirSync(resolve(graftPath, ".."), { recursive: true });

  // A plain zero-byte graft file is inert and remains acceptable.
  writeFileSync(graftPath, "");
  assert.equal(isGitAncestor(baseSha, sourceSha, cwd), true);
  assert.equal(listGitHistoryChanges(baseSha, sourceSha, cwd).length, 1);

  // R12's statSync followed this symlink and saw a normal zero-byte file:
  // the mutable external graft target was mistakenly accepted.
  rmSync(graftPath);
  const externalTarget = join(cwd, "graft-replacement.txt");
  writeFileSync(externalTarget, "");
  symlinkSync(externalTarget, graftPath);
  assert.throws(() => isGitAncestor(baseSha, sourceSha, cwd), /graft/i,
    "even an empty linked graft file must not authenticate Git ancestry");
  assert.throws(() => listGitHistoryChanges(baseSha, sourceSha, cwd), /graft/i,
    "history verification must share the same no-symlink boundary");

  // A dangling symlink cannot be conflated with an absent graft file.
  rmSync(externalTarget);
  assert.throws(() => isGitAncestor(baseSha, sourceSha, cwd), /graft/i);
  assert.throws(() => listGitHistoryChanges(baseSha, sourceSha, cwd), /graft/i);
});
