import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { Plugin } from "vite";
import { formatReleaseNotes, parseReleaseNotes, requireReleaseNotes } from "../../scripts/release-notes.mjs";

export function buildMetadata(root: string, version: string) {
  let commit = "local";
  try { commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { /* source ZIP */ }
  const builtAt = new Date().toISOString();
  const buildId = process.env.AXOM_BUILD_ID || `${commit}-${builtAt.replace(/[^0-9]/g, "")}`;
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(buildId)) throw new Error("AXOM_BUILD_ID must be 1–160 safe identifier characters.");
  // Release packaging (scripts/release.mjs sets AXOM_REQUIRE_RELEASE_NOTES) must
  // ship notes for this exact version. An ordinary web deploy never fails over
  // them: a missing entry or an absent CHANGELOG just means no notes.
  const changelogPath = resolve(root, "../CHANGELOG.md");
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const release = process.env.AXOM_REQUIRE_RELEASE_NOTES === "1"
    ? requireReleaseNotes(changelog, version)
    : parseReleaseNotes(changelog).find((entry: { version: string }) => entry.version === version);
  return { version, buildId, builtAt, commit, notes: release ? formatReleaseNotes(release) : "" };
}

export function releaseMetadataPlugin(metadata: ReturnType<typeof buildMetadata>): Plugin {
  let dist = "";
  return {
    name: "axom-release-metadata",
    apply: "build",
    configResolved(config) { dist = resolve(config.root, config.build.outDir); },
    closeBundle() {
      writeFileSync(resolve(dist, "version.json"), `${JSON.stringify(metadata, null, 2)}\n`);
      // Only the eagerly referenced entry files are installed with the shell.
      // Optional game engines/dictionaries stay lazy and cache on first visit.
      const html = readFileSync(resolve(dist, "index.html"), "utf8");
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)].map((match) => match[1]);
      const manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8")) as Record<string, { file: string; imports?: string[]; css?: string[] }>;
      const seen = new Set<string>();
      const collect = (key: string) => {
        if (seen.has(key) || !manifest[key]) return;
        seen.add(key);
        const entry = manifest[key];
        assets.push(`./${entry.file}`, ...(entry.css ?? []).map((file) => `./${file}`));
        (entry.imports ?? []).forEach(collect);
      };
      collect("index.html");
      collect("src/App.tsx");
      // Updating must still work after the host removes the previous build's
      // hashed assets. Keep the save/checkpoint path with that build's shell,
      // even though it is lazy-loaded to preserve the pre-hydration guard.
      collect("src/lib/updateCheckpoint.ts");
      const precache = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", ...assets];
      const sw = resolve(dist, "sw.js");
      writeFileSync(sw, readFileSync(sw, "utf8").replaceAll("__AXOM_BUILD_ID__", metadata.buildId)
        .replace('const PRECACHE = []; // __AXOM_PRECACHE__', `const PRECACHE = ${JSON.stringify([...new Set(precache)])};`));
      // Plain static hosts can use these headers; Vercel config mirrors them.
      writeFileSync(resolve(dist, "_headers"), "/sw.js\n  Cache-Control: no-cache\n/version.json\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
      const entries = readdirSync(dist, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
      if (entries.some((entry) => relative(dist, resolve(entry.parentPath ?? (entry as { path?: string }).path ?? dist, entry.name)).endsWith(".map"))) throw new Error("Unexpected source map in release output.");
    },
  };
}
