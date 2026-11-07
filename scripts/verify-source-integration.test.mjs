import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGitFile, validateSourceManifest, verifySourceIntegration, verifyCompleteSourceIntegration, listGitChanges, isGitAncestor, listGitTreePaths } from "./verify-source-integration.mjs";
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
  // Git running on Linux can track these names, but Windows cannot check them out.
  // Reject reserved DOS device basenames anywhere in the path, with any extension,
  // plus components ending in a dot (trailing spaces are already disallowed).
  for (const path of [
    "docs/CON", "docs/CON.txt", "docs/aux", "docs/NUL.md", "docs/COM1.js",
    "docs/com9", "docs/LPT1", "docs/sub/LpT9.webp", "docs/PRN.md",
    "docs/guide.", "docs/folder./file", "docs/sub/afile..",
  ]) assert.throws(() => validateSourceManifest(manifest([path])), /Unsafe/, path);
  for (const path of [
    "docs/console.txt", "docs/contemporary.txt", "docs/COM0.js",
    "docs/COM10.js", "docs/LPT10.txt", "docs/guide..name", "docs/auxiliary.js",
  ]) assert.equal(validateSourceManifest(manifest([path])).entries[0].path, path);
  for (const bad of ["main", "abc", "A".repeat(40), "a".repeat(39) + ";"]) {
    assert.throws(() => validateSourceManifest({ ...manifest(), integratedSha: bad }), /pinned/);
  }
  assert.throws(() => validateSourceManifest({ ...manifest(), version: 3 }), /version 1/);
  assert.throws(() => validateSourceManifest({ ...manifest(), sources: [] }), /source revisions/);
  assert.throws(() => validateSourceManifest(manifest([])), /source file paths/);
  const dup = manifest();
  dup.sources.push({ sourceSha: C, paths: ["web/src/course.ts"] });
  assert.throws(() => validateSourceManifest(dup), /Duplicate/);
  // A Linux tree can store two distinct names which collide on macOS/Windows.
  assert.throws(() => validateSourceManifest(manifest(["web/Guide.ts", "web/guide.ts"])), /case-insensitive/);
  const acrossSources = manifest(["docs/Owner.ts"]);
  acrossSources.sources.push({ sourceSha: C, paths: ["docs/owner.ts"] });
  assert.throws(() => validateSourceManifest(acrossSources), /case-insensitive/);
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
  // Real Git on Linux/macOS accepts pathnames that must never pass the verifier.
  if (process.platform !== "win32") {
    writeFileSync(join(cwd, "docs", "CON.txt"), "nonportable device name\n");
    writeFileSync(join(cwd, "docs", "guide."), "nonportable trailing dot\n");
  }
  git("add", "--", "docs");
  commit("pinned source");
  const sourceSha = git("rev-parse", "HEAD");
  if (process.platform !== "win32") {
    for (const illegal of ["docs/CON.txt", "docs/guide."]) {
      assert.match(git("ls-tree", "-r", "--name-only", sourceSha, "--", illegal), /docs\//);
      assert.throws(() => readGitFile(sourceSha, illegal, cwd), /Unsafe/);
    }
  }
  const sourceTreeSha = git("rev-parse", sourceSha + "^{tree}");
  assert.throws(() => readGitFile(sourceTreeSha, "docs/proof.txt", cwd), /Expected pinned commit object/);
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
  const modifiedSha = git("rev-parse", "HEAD");
  assert.throws(() => verifySourceIntegration({ ...input, integratedSha: modifiedSha },
    (sha, file) => readGitFile(sha, file, cwd)), /differs from exact pinned/);
  writeFileSync(path, JSON.stringify({ ...input, integratedSha: modifiedSha }));
  assert.throws(() => execFileSync(process.execPath, [cli, path], { cwd, encoding: "utf8" }),
    error => error.status === 1 && /differs from exact pinned source file/.test(error.stderr), "CLI must fail closed with nonzero exit status");
  assert.throws(() => readGitFile(sourceSha, "docs/missing.txt", cwd), /Expected exactly one/);
});


test("v2 verifies complete two-source Git ranges including deletion and rejects missing or unexpected changes", t => {
  const cwd = mkdtempSync(join(tmpdir(), "axom-strict-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (path, value) => writeFileSync(join(cwd, path), value);
  git("init", "-q");
  git("config", "user.name", "AXOM Test Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(cwd, "docs"));
  write("docs/common.txt", "base\n");
  write("docs/delete.txt", "remove\n");
  git("add", "-A"); git("commit", "-qm", "release base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "source-one");
  write("docs/common.txt", "source one\n");
  unlinkSync(join(cwd, "docs/delete.txt"));
  git("add", "-A"); git("commit", "-qm", "source one");
  const sourceOne = git("rev-parse", "HEAD");
  git("checkout", "-qb", "source-two", base);
  write("docs/new.txt", "source two\n");
  git("add", "-A"); git("commit", "-qm", "source two");
  const sourceTwo = git("rev-parse", "HEAD");
  git("checkout", "-qb", "release", base);
  git("merge", "--no-ff", "-qm", "merge first", sourceOne);
  git("merge", "--no-ff", "-qm", "merge second", sourceTwo);
  const integratedSha = git("rev-parse", "HEAD");
  const input = { version: 2, integrationBaseSha: base, integratedSha, sources: [
    { baseSha: base, sourceSha: sourceOne }, { baseSha: base, sourceSha: sourceTwo },
  ] };
  const adapters = {
    listChanges: (a, b) => listGitChanges(a, b, cwd),
    isAncestor: (a, b) => isGitAncestor(a, b, cwd),
    readFile: (sha, path) => readGitFile(sha, path, cwd, true),
    listTreePaths: sha => listGitTreePaths(sha, cwd),
  };
  assert.deepEqual(listGitChanges(base, sourceOne, cwd).map(x => x.status), ["M", "D"]);
  const report = verifyCompleteSourceIntegration(input, adapters);
  assert.equal(report.completeForDeclaredRanges, true);
  assert.equal(report.verifiedFiles, 3);
  assert.equal(report.deletedFiles, 1);
  // Old v1 silently passes the omitted second source's files.
  assert.equal(verifySourceIntegration({
    version: 1, integratedSha, sources: [{ sourceSha: sourceOne, paths: ["docs/common.txt"] }],
  }, (sha, path) => readGitFile(sha, path, cwd)).verifiedFiles, 1);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, sources: [input.sources[0]] }, adapters), /Incomplete source inventory/);
  assert.throws(() => verifyCompleteSourceIntegration({
    ...input, sources: [{ ...input.sources[0], paths: ["docs/common.txt"] }],
  }, adapters), /caller-selected paths/);
  write("docs/extra.txt", "unclaimed integration change\n");
  git("add", "-A"); git("commit", "-qm", "unexpected file");
  assert.throws(() => verifyCompleteSourceIntegration({
    ...input, integratedSha: git("rev-parse", "HEAD"),
  }, adapters), /Incomplete source inventory/);
  git("checkout", "-qb", "parallel", base);
  write("docs/common.txt", "source one\n");
  git("add", "-A"); git("commit", "-qm", "copied bytes without source ancestry");
  const parallel = git("rev-parse", "HEAD");
  assert.equal(readGitFile(parallel, "docs/common.txt", cwd).blob, readGitFile(sourceOne, "docs/common.txt", cwd).blob);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, integratedSha: parallel }, adapters), /not an ancestor/);
  const cli = fileURLToPath(new URL("./verify-source-integration.mjs", import.meta.url));
  const manifestPath = join(cwd, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(input));
  const cliResult = JSON.parse(execFileSync(process.execPath, [cli, manifestPath], { cwd, encoding: "utf8" }));
  assert.equal(cliResult.verifiedFiles, 3);
  assert.equal(cliResult.deletedFiles, 1);
});
test("v2 rejects conflicting source ranges, Windows-unsafe paths, type changes and caller-managed omissions", () => {
  const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
  const input = { version: 2, integrationBaseSha: A, integratedSha: C, sources: [{ baseSha: A, sourceSha: B }] };
  const adapters = { isAncestor: () => true,
    listChanges: () => [{ status: "A", path: "docs/proof.ts" }],
    readFile: () => ({ mode: "100644", blob: B }),
    listTreePaths: () => ["docs/proof.ts"] };
  assert.equal(verifyCompleteSourceIntegration(input, adapters).verifiedFiles, 1);
  assert.equal(verifyCompleteSourceIntegration(input, adapters).verifiedTreePaths, 1);
  assert.throws(() => verifyCompleteSourceIntegration(input, { ...adapters, listTreePaths: undefined }), /requires Git diff/);
  assert.throws(() => verifyCompleteSourceIntegration(input, { ...adapters, listTreePaths: () => null }), /tree path inventory/);
  assert.throws(() => verifyCompleteSourceIntegration(input, { ...adapters, listTreePaths: () => ["docs/proof.ts", "docs/Proof.ts"] }), /Case-insensitive/);
  assert.throws(() => verifyCompleteSourceIntegration(input, { ...adapters, listTreePaths: () => ["docs/proof.ts", "Docs/old.md"] }), /Case-insensitive/);
  // Pre-existing collisions in an unrelated directory are not attributed to changed sources.
  assert.equal(verifyCompleteSourceIntegration(input, { ...adapters,
    listTreePaths: () => ["docs/proof.ts", "Legacy/a.md", "legacy/b.md"] }).verifiedFiles, 1);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, sources: [...input.sources, ...input.sources] }, adapters), /Conflicting source range/);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, sources: [{ sourceSha: B }] }, adapters), /baseSha/);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, integrationBaseSha: "main" }, adapters), /pinned/);
  assert.throws(() => verifyCompleteSourceIntegration({ ...input, version: 1 }, adapters), /version 2/);
  assert.throws(() => verifyCompleteSourceIntegration(input, {
    ...adapters, listChanges: () => [{ status: "A", path: "docs/CON.txt" }],
  }), /Unsafe/);
  assert.throws(() => verifyCompleteSourceIntegration(input, {
    ...adapters, listChanges: () => [{ status: "R100", path: "docs/new.txt" }],
  }), /Unsupported Git change status/);
  assert.throws(() => verifyCompleteSourceIntegration(input, {
    ...adapters, listChanges: () => [{ status: "D", path: "docs/proof.ts" }],
  }), /Deleted source file reappeared/);
  assert.throws(() => verifyCompleteSourceIntegration(input, {
    ...adapters, readFile: () => ({ mode: "120000", blob: B }),
  }), /nonregular/);
});


test("v2 rejects integrated Git paths colliding with unchanged inherited file and directory casing", t => {
  if (process.platform === "win32") return t.skip("Git cannot create case-variant filenames on this host");
  const cwd = mkdtempSync(join(tmpdir(), "axom-v2-case-inherited-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "AXOM Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(cwd, "docs"));
  mkdirSync(join(cwd, "Docs"));
  writeFileSync(join(cwd, "docs", "Guide.ts"), "old file\n");
  writeFileSync(join(cwd, "Docs", "untouched.md"), "old directory\n");
  git("add", "-A");
  git("commit", "-qm", "inherited base");
  const baseSha = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "docs", "guide.ts"), "case collision\n");
  writeFileSync(join(cwd, "docs", "fresh.ts"), "directory variant\n");
  git("add", "-A");
  git("commit", "-qm", "source branch adds collision");
  const headSha = git("rev-parse", "HEAD");
  const input = { version: 2, integrationBaseSha: baseSha, integratedSha: headSha,
    sources: [{ baseSha, sourceSha: headSha }] };
  const adapters = {
    listChanges: (a, b) => listGitChanges(a, b, cwd),
    isAncestor: (a, b) => isGitAncestor(a, b, cwd),
    readFile: (sha, path) => readGitFile(sha, path, cwd, true),
    listTreePaths: sha => {
      const output = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "--full-tree", sha],
        { cwd, encoding: "utf8" });
      return output ? output.split("\0").slice(0, -1) : [];
    },
  };
  assert.deepEqual(listGitChanges(baseSha, headSha, cwd).map(c => c.path).sort(),
    ["docs/fresh.ts", "docs/guide.ts"]);
  // RED on the old verifier: it wrongly returned completeForDeclaredRanges=true
  // because its changed-only inventory never saw docs/Guide.ts or Docs/untouched.md.
  assert.throws(() => verifyCompleteSourceIntegration(input, adapters), /[Cc]ase.colli|[Cc]ase.insensitive/);
});
