import { createServer } from "vite";
// Use Vite's existing ?url handling for the shared browser/Node PDF reader.
const server = await createServer({ configFile: false, cacheDir: "/tmp/axom-private-preparation-vite", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
try { await server.ssrLoadModule("/scripts/prepare-private-library.ts"); }
finally { await server.close(); }
