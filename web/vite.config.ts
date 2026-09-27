import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import packageJson from "./package.json";
import { buildMetadata, releaseMetadataPlugin } from "./scripts/build-metadata";

const metadata = buildMetadata(fileURLToPath(new URL(".", import.meta.url)), packageJson.version);
const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));

/** Bundles the repository CHANGELOG without widening Vite's file-serving allow list. */
function changelogModule(): Plugin {
  const id = "virtual:axom-changelog";
  return {
    name: "axom-changelog",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return undefined;
      this.addWatchFile(changelogPath);
      return `export default ${JSON.stringify(readFileSync(changelogPath, "utf8"))};`;
    },
  };
}

// base: "./" keeps all asset URLs relative, so the same build works
// (1) served at any path / subdomain, (2) embedded in an <iframe>, and
// (3) embedded in the native Tauri app. Web ZIPs must be served over HTTP.
export default defineConfig({
  plugins: [react(), changelogModule(), releaseMetadataPlugin(metadata)],
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(metadata.buildId),
    "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(metadata.commit),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(metadata.builtAt),
  },
  base: "./",
  server: {
    // The release-notes parser is shared with ../scripts (release tooling).
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../scripts/", import.meta.url)),
      ],
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Unit tests never read a developer's web/.env.local account keys; tests
    // that need a configured backend mock lib/account/supabase explicitly.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "", VITE_SUPABASE_ANON_KEY: "" },
  },
  build: {
    manifest: true,
    outDir: "dist",
    sourcemap: false,
  },
});
