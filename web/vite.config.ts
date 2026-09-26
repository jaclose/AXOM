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
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  build: {
    manifest: true,
    outDir: "dist",
    sourcemap: false,
  },
});
