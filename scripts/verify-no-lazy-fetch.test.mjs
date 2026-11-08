import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isGitAncestor, listGitChanges, listGitHistoryChanges, listGitTreePaths, readGitFile,
} from "./verify-source-integration.mjs";

test("release Git readers never hydrate missing partial-clone trees from a promisor", t => {
  if (process.platform === "win32") return t.skip("file:// promisor fixture uses Unix Git paths");
  const root = mkdtempSync(join(tmpdir(), "axom-release-offline-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin");
  mkdirSync(origin);
  const git = (cwd, ...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git(origin, "init", "-q");
  git(origin, "config", "user.name", "AXOM offline fixture");
  git(origin, "config", "user.email", "offline-fixture@example.invalid");
  git(origin, "config", "uploadpack.allowFilter", "true");
  mkdirSync(join(origin, "docs"));
  const path = "docs/approved.txt";
  writeFileSync(join(origin, path), "original\\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "fixture base");
  const base = git(origin, "rev-parse", "HEAD");
  writeFileSync(join(origin, path), "reviewed version\\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "fixture source revision");
  const head = git(origin, "rev-parse", "HEAD");
  const rootTree = git(origin, "rev-parse", head + "^{tree}");
  const originalBlob = git(origin, "rev-parse", head + ":" + path);

  const cloneFor = label => {
    const client = join(root, label);
    git(root, "-c", "protocol.file.allow=always", "clone", "--quiet",
      "--no-checkout", "--filter=tree:0", pathToFileURL(origin).href, client);
    return client;
  };
  // Inspect the object database without allowing a missing tree to be fetched.
  const hasLocalRootTree = client => spawnSync("git",
    ["cat-file", "-e", rootTree + "^{tree}"], {
      cwd: client, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      stdio: "ignore",
    }).status === 0;
  const isolated = (label, attempt) => {
    const client = cloneFor(label);
    assert.equal(hasLocalRootTree(client), false,
      "the fixture must begin with an absent, promisor-backed tree");
    assert.throws(() => attempt(client), undefined,
      "release verification must not consult the promisor to hydrate a tree");
    assert.equal(hasLocalRootTree(client), false,
      "a denied release read must leave the root tree absent locally");
  };

  assert.deepEqual(readGitFile(head, path, origin),
    { mode: "100644", blob: originalBlob },
    "ordinary complete local Git repositories must still attest valid source files");
  assert.ok(listGitTreePaths(head, origin).includes(path));
  isolated("file-reader", client => readGitFile(head, path, client));
  isolated("tree-inventory", client => listGitTreePaths(head, client));
  isolated("diff-inventory", client => listGitChanges(base, head, client));
  isolated("history-inventory", client => listGitHistoryChanges(base, head, client));

  // Pure ancestry over locally present commits is allowed; it must not hydrate
  // unrelated trees while evaluating a history predicate.
  const ancestry = cloneFor("ancestry");
  assert.equal(hasLocalRootTree(ancestry), false);
  assert.equal(isGitAncestor(base, head, ancestry), true);
  assert.equal(hasLocalRootTree(ancestry), false);
});
