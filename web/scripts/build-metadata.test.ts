import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMetadata } from "./build-metadata";

const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true });
});

function fixture(withGit = true) {
  const repo = mkdtempSync(join(tmpdir(), "axom-build-metadata-"));
  temporary.push(repo);
  const web = join(repo, "web");
  mkdirSync(web);
  if (withGit) {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "AXOM fixture"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), "web/dist/\n");
    writeFileSync(join(repo, "CHANGELOG.md"), "# Releases\n");
    writeFileSync(join(web, "source.ts"), "export const value = 1;\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  }
  return { repo, web };
}

describe("build revision provenance", () => {
  it("identifies a clean checkout even when ignored build output exists", () => {
    const { repo, web } = fixture();
    mkdirSync(join(web, "dist"));
    writeFileSync(join(web, "dist", "generated.js"), "built output");
    const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe(head);
  });

  it("labels tracked source and root changelog changes as local", () => {
    const { repo, web } = fixture();
    writeFileSync(join(web, "source.ts"), "export const value = 2;\n");
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("local");
    writeFileSync(join(web, "source.ts"), "export const value = 1;\n");
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changed release\n");
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("local");
  });

  it("labels untracked source and a source ZIP as local", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const { web } = fixture();
    writeFileSync(join(web, "new-source.ts"), "export const extra = true;\n");
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("local");
    expect(buildMetadata(fixture(false).web, "0.0.3-prebeta").commit).toBe("local");
  });

  it("uses the Vercel revision for a filtered archive without .git", () => {
    const { web } = fixture(false);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "A".repeat(40));
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("a".repeat(12));
  });

  it("does not trust a malformed Vercel revision", () => {
    const { web } = fixture(false);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "malformed-revision");
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("local");
  });

  it("does not hide dirty checkout changes behind a Vercel revision", () => {
    const { web } = fixture();
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    writeFileSync(join(web, "source.ts"), "export const value = 2;\n");
    expect(buildMetadata(web, "0.0.3-prebeta").commit).toBe("local");
  });
});
