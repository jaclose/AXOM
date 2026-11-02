// Keep this owner-only transform outside browser bundles and public assets.
import { createServer } from "vite";
import process from "node:process";
import console from "node:console";

const [mode, ...args] = process.argv.slice(2);
if (!(["template", "build"].includes(mode) && args.length === (mode === "template" ? 2 : 3))) {
  throw new Error("Use: node scripts/approved-only-library-cli.mjs template <prepared-root> <private-decisions.json> OR build <prepared-root> <private-decisions.json> <new-private-output>");
}
const server = await createServer({ configFile: false, cacheDir: "/tmp/axom-approved-only-vite",
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const action = await server.ssrLoadModule("/scripts/approved-only-library.ts");
  const result = mode === "template"
    ? await action.createApprovalTemplate(args[0], args[1])
    : await action.createApprovedOnlyLibrary(args[0], args[1], args[2]);
  console.log(JSON.stringify(result));
} finally { await server.close(); }
