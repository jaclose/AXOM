import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { formatReleaseNotes, parseReleaseNotes, requireReleaseNotes } from "../../scripts/release-notes.mjs";

export function buildMetadata(root: string, version: string) {
  let commit = "local";
  let matchedCheckout = false;
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (realpathSync(resolve(repoRoot, "web")) === realpathSync(root)) {
      matchedCheckout = true;
      // The changelog and release scripts live above web/, so inspect the
      // whole checkout before claiming a commit identifies these bytes.
      const changes = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"],
        { cwd: repoRoot, encoding: "utf8" }).trim();
      if (!changes) commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"],
        { cwd: repoRoot, encoding: "utf8" }).trim() || "local";
    }
  } catch { /* source ZIP */ }
  // Vercel builds from a filtered source archive without .git. Its deployment
  // commit still identifies the archived bytes; never override a dirty checkout.
  if (!matchedCheckout && /^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "")) {
    commit = process.env.VERCEL_GIT_COMMIT_SHA!.slice(0, 12).toLowerCase();
  }
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
  // Whether this build received the public Supabase config (never the values).
  // A deployment built without it runs local-only; `npm run accounts:doctor`
  // reads this from the live version.json to catch a missing Vercel variable.
  const env = loadEnv("production", root, "VITE_SUPABASE_");
  const accountsConfigured = Boolean(env.VITE_SUPABASE_URL && (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY));
  return { version, buildId, builtAt, commit, notes: release ? formatReleaseNotes(release) : "", accountsConfigured };
}

export function releaseMetadataPlugin(metadata: ReturnType<typeof buildMetadata>): Plugin {
  let dist = "";
  return {
    name: "axom-release-metadata",
    apply: "build",
    configResolved(config) { dist = resolve(config.root, config.build.outDir); },
    closeBundle() {
      writeFileSync(resolve(dist, "version.json"), `${JSON.stringify(metadata, null, 2)}\n`);
      // The entry, the shell, every route screen and the update path are
      // installed with the service worker; heavy document engines load lazily.
      const html = readFileSync(resolve(dist, "index.html"), "utf8");
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)].map((match) => match[1]);
      const manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8")) as Record<string, { file: string; name?: string; imports?: string[]; css?: string[] }>;
      const seen = new Set<string>();
      const collect = (key: string) => {
        if (seen.has(key) || !manifest[key]) return;
        seen.add(key);
        const entry = manifest[key];
        assets.push(`./${entry.file}`, ...(entry.css ?? []).map((file) => `./${file}`));
        (entry.imports ?? []).forEach(collect);
      };
      collect("index.html");
      // Public landing now loads the workspace dynamically. Preserve its
      // bootstrap too, so an installed update can still open offline.
      collect("src/main.tsx");
      collect("src/App.tsx");
      // Updating must still work after the host removes the previous build's
      // hashed assets. Keep the save/checkpoint path with that build's shell,
      // even though it is lazy-loaded to preserve the pre-hydration guard.
      collect("src/lib/updateCheckpoint.ts");
      Object.keys(manifest).filter(key => manifest[key].name === "updateCheckpoint").forEach(collect);
      // Settings promises release notes "available offline", and the update
      // panel shows them while an old build is still running.
      collect("src/components/shell/ReleaseNotesHistory.tsx");
      // Core route screens ship with the shell, so a tab left open across a
      // deploy keeps working. Optional Daily Games (the Word engine and its
      // dictionary, the Doctordle bridge) stay lazy and cache on first play
      // (verify-app-updates enforces this); if their old hash is gone, the
      // route error boundary offers a reload instead of a black screen.
      const OPTIONAL = /^src\/pages\/(?:DailyWordPage|DoctordlePage|OptionalDailyGamesPage)\.tsx$/;
      Object.keys(manifest)
        .filter((key) => /^src\/pages\/[^/]+Page\.tsx$/.test(key) && !OPTIONAL.test(key))
        .forEach(collect);
      // Precise Vite-manifest identity for shipped but optional hashed code.
      // These paths are not added to install-time precache.
      const shippedChunks = [...new Set(Object.values(manifest)
        .flatMap((entry) => [entry.file, ...(entry.css ?? [])])
        .filter((file) => /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(file))
        .map((file) => `./${file}`))];
      const precache = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", ...assets];
      const sw = resolve(dist, "sw.js");
      writeFileSync(sw, readFileSync(sw, "utf8").replaceAll("__AXOM_BUILD_ID__", metadata.buildId)
        .replace('const PRECACHE = []; // __AXOM_PRECACHE__', `const PRECACHE = ${JSON.stringify([...new Set(precache)])};`)
        .replace('const SHIPPED_CHUNKS = []; // __AXOM_SHIPPED_CHUNKS__', `const SHIPPED_CHUNKS = ${JSON.stringify(shippedChunks)};`));
      // Plain static hosts can use these headers; Vercel config mirrors them.
      writeFileSync(resolve(dist, "_headers"), "/sw.js\n  Cache-Control: no-cache\n/version.json\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
      const entries = readdirSync(dist, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
      if (entries.some((entry) => relative(dist, resolve(entry.parentPath ?? (entry as { path?: string }).path ?? dist, entry.name)).endsWith(".map"))) throw new Error("Unexpected source map in release output.");
    },
  };
}
