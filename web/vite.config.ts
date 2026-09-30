import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json";
import { buildMetadata, releaseMetadataPlugin } from "./scripts/build-metadata";

const metadata = buildMetadata(fileURLToPath(new URL(".", import.meta.url)), packageJson.version);

// base: "./" keeps all asset URLs relative, so the same build works
// (1) served at any path / subdomain, (2) embedded in an <iframe>, and
// (3) embedded in the native Tauri app. Web ZIPs must be served over HTTP.
export default defineConfig({
  plugins: [react(), releaseMetadataPlugin(metadata)],
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(metadata.buildId),
    "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(metadata.commit),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(metadata.builtAt),
  },
  base: "./",
  // releaseNotes.ts imports ../CHANGELOG.md?raw from the repo root. Vite 8
  // denies ?raw loads outside server.fs.allow (dev server and vitest alike),
  // and a file entry can't match the ?raw id, so allow the repo root.
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Whole-app render suites run ~0.5-3 s alone but pass 5 s on a busy
    // machine (two agents building at once); 15 s still catches real hangs.
    testTimeout: 15_000,
  },
  build: {
    manifest: true,
    outDir: "dist",
    sourcemap: false,
  },
});
