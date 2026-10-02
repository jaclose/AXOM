#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMediaAuditReport, DEFAULT_MEDIA_ROOTS, DEFAULT_REFERENCE_ROOTS, formatMediaAuditReport } from "../src/lib/media/audit.ts";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const rootArg = process.argv.find((entry) => entry.startsWith("--root="));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const roots = rootArg
  ? [resolve(process.cwd(), rootArg.slice("--root=".length))]
  : DEFAULT_MEDIA_ROOTS.map((root) => resolve(repoRoot, root));
const sourceRoots = DEFAULT_REFERENCE_ROOTS.map((root) => resolve(repoRoot, root));

const report = await buildMediaAuditReport(roots, sourceRoots, [repoRoot, resolve(repoRoot, "web")]);
if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatMediaAuditReport(report));
}
