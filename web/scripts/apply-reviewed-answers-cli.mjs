// Owner-only transform. Decisions and output must remain outside Git and public assets.
import { createServer } from "vite";

const [mode, ...args] = process.argv.slice(2);
if (!(mode === "template" && (args.length === 2 || args.length === 3)
  || mode === "build" && args.length === 3)) {
  throw new Error("Use: node scripts/apply-reviewed-answers-cli.mjs template <prepared-root> <private-decisions.json> [source-sha256] OR build <prepared-root> <private-decisions.json> <new-private-output>");
}
const server = await createServer({ configFile: false, cacheDir: "/tmp/axom-reviewed-answers-vite",
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const action = await server.ssrLoadModule("/scripts/apply-reviewed-answers.ts");
  const result = mode === "template"
    ? await action.createReviewedAnswerTemplate(args[0], args[1], args[2])
    : await action.applyReviewedAnswers(args[0], args[1], args[2]);
  console.log(JSON.stringify(result));
} finally { await server.close(); }
