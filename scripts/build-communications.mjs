// Bundle the canonical web report adapters and React email renderer for Deno.
// Generated code is a deployment artifact; edit web/src/lib/communications instead.
import { build } from "../web/node_modules/vite/dist/node/index.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({ configFile: false, publicDir: false, root: root + "web", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root + "supabase/functions/communications", emptyOutDir: false, copyPublicDir: false, target: "es2022", minify: true, lib: { entry: root + "web/src/lib/communications/server/handler.ts", formats: ["es"], fileName: () => "service.js" } } });
const outputs = Array.isArray(result) ? result : [result];
const sourceFiles = new Set(["scripts/build-communications.mjs", "scripts/render-communications-auth.mjs", "web/package-lock.json"]);
for (const output of outputs) for (const chunk of output.output ?? []) if (chunk.type === "chunk") for (const path of Object.keys(chunk.modules)) if (path.startsWith(root + "web/src/")) sourceFiles.add(path.slice(root.length).split("?")[0]);
const sha = value => createHash("sha256").update(value).digest("hex");
const sources = Object.fromEntries(await Promise.all([...sourceFiles].sort().map(async path => [path, sha(await readFile(root + path))])));
const bundle = "supabase/functions/communications/service.js";
await writeFile(root + "supabase/functions/communications/source-manifest.json", JSON.stringify({ version: 1, sources, bundle: { path: bundle, sha256: sha(await readFile(root + bundle)) } }, null, 2) + "\n");
console.log("Communications Edge bundle and source integrity manifest generated.");
