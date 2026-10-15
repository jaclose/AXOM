#!/usr/bin/env node
/**
 * AXOM lead acceptance: SOURCE-READ-ONLY dry-run of the actual existing text
 * import converter, over Agent 1's private canonical B1 queue.
 *
 * Emits METADATA only to ignored artifacts. Does not generate parallel bank
 * records, import anything into AXOM, write to Supabase, or publish answers.
 * Usage: node scripts/operations/academic-text-pilot.mjs [--limit N].
 * Requires Node 22 and the web's installed Vite.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "artifacts/qbank-6way-20261014/lead-round2/raw-text-parser-audit.json");
const manifest = join(root, "artifacts/qbank-6way-20261014/master-source-manifest.jsonl");
const batches = join(root, "artifacts/qbank-6way-20261014/agent-2-priority-batches.json");
const requireWeb = createRequire(join(root, "web/package.json"));
const { createServer } = requireWeb("vite");

function writeSecureAudit(result) {
  // Source text/answers, PII and raw images must NEVER be written into JSON.
  return JSON.stringify(result, null, 2) + "\n";
}
function parseArgs(argv) {
  if (!argv.length) return null;
  if (argv.length !== 2 || argv[0] !== "--limit" || !/^\d{1,3}$/.test(argv[1])) {
    throw new Error("Usage: node scripts/operations/academic-text-pilot.mjs [--limit N]");
  }
  const n = Number(argv[1]);
  if (!(n >= 1 && n <= 100)) throw new Error("limit must be 1–100");
  return n;
}
const limit = parseArgs(process.argv.slice(2));
await mkdir(dirname(out), { recursive: true });
const rows = (await readFile(manifest, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const byId = new Map(rows.map(row => [row.source_id, row]));
const queue = JSON.parse(await readFile(batches, "utf8")).processing_order.find(batch => batch.id === "B1")?.jobs;
if (!queue?.length) throw new Error("Agent1's B1 tagged-text source queue is empty or unavailable.");

const server = await createServer({ root: join(root, "web"), server: { middlewareMode: true }, appType: "custom" });
const results = [];
try {
  const { prepareRawTextBank } = await server.ssrLoadModule("/src/lib/question-content/batchPrepareText.ts");
  for (const job of (limit ? queue.slice(0, limit) : queue)) {
    const path = job.source_path;
    const record = byId.get(job.source_ids[0]);
    const source = { sourceId: job.source_ids[0], sourcePath: path,
      sourceSha256: record?.source_sha256 ?? null, expectedHeadingCount: job.expected_questions ?? null };
    try {
      if (!record?.source_sha256) throw new Error("No authoritative Agent1 source SHA.");
      const file = await readFile(path);
      if (file.length > 16_000_000) throw new Error("Pilot dry-run limit 16MiB: queue separately.");
      const digest = createHash("sha256").update(file).digest("hex");
      if (digest !== record.source_sha256) throw new Error("Original source file differs from inventory SHA.");
      const prepared = await prepareRawTextBank({
        filename: basename(path),
        sourceBytes: new Uint8Array(file), expectedSha256: digest,
      });
      const n = prepared.pkg.questions.length;
      const total = prepared.verifiedReadyIds.length + prepared.reviewRequiredIds.length + prepared.unresolvedIds.length;
      if (n !== prepared.detected || n !== total) throw new Error("Question counts do not reconcile.");
      const identities = new Set(prepared.pkg.questions.map(question => question.id));
      if (identities.size !== n) throw new Error("Duplicate question IDs from canonical converter.");
      const flags = prepared.pkg.questions.reduce((acc, q) => acc + (q.flags?.length ?? 0), 0);
      const duplicateNumberGroups = prepared.pkg.questions.reduce((acc, q) =>
        acc + Number((q.flags ?? []).some(flag => /number.+repeats/i.test(flag.message))), 0);
      results.push({ ...source, status: "parsed_local_dry_run_not_installed", detected: n,
        readyByParserNotHumanValidated: prepared.verifiedReadyIds.length,
        reviewRequired: prepared.reviewRequiredIds.length, unresolved: prepared.unresolvedIds.length,
        sourceNumberRepeatsFlagged: duplicateNumberGroups,
        duplicateStemHintGroups: prepared.duplicateStemGroups.length,
        imageAttachmentCount: prepared.pkg.questions.reduce((sum,q) => sum + q.assets.length,0),
        sourceInconsistencyFlags: flags, issueCount: prepared.issues.length, warningCount: prepared.warnings.length,
        sourceShaVerified: true, cloudReadbackVerified: false });
      process.stdout.write(`B1 ${results.length}/${queue.length}: ${basename(path)} — ${n} parsed / ${prepared.verifiedReadyIds.length} parser-ready / ${prepared.reviewRequiredIds.length + prepared.unresolvedIds.length} review\n`);
    } catch (error) {
      results.push({ ...source, status: "parse_failed_or_source_changed", error: String(error?.message ?? error).slice(0,260),
        sourceShaVerified: false, cloudReadbackVerified: false });
      process.stdout.write(`B1 ${results.length}/${queue.length}: ${basename(path)} — FAILED\n`);
    }
  }
} finally {
  await server.close();
}
const ok = results.filter(row => row.status === "parsed_local_dry_run_not_installed");
const summary = {
  sourceFilesInQueue: queue.length,
  filesAttempted: results.length,
  parsed: ok.length, failed: results.length - ok.length,
  detectedOccurrences: ok.reduce((n,x) => n + x.detected, 0),
  locallyParserReadyNotSourceValidated: ok.reduce((n,x) => n + x.readyByParserNotHumanValidated, 0),
  reviewRequiredOrUnresolved: ok.reduce((n,x) => n + x.reviewRequired + x.unresolved, 0),
  repeatedNumberFlags: ok.reduce((n,x) => n + x.sourceNumberRepeatsFlagged,0),
  duplicateStemHintGroups: ok.reduce((n,x) => n + x.duplicateStemHintGroups,0),
  cloudVerified: 0, installed: 0,
};
const result = { generatedAt: new Date().toISOString(), schema: "axom-local-dry-run-source-sha-v1",
  sourceFormat: "academic-tagged-raw-txt", summary, sources: results,
  evidence: "Existing AXOM importFromText→draftsToQuestions→assessBank converter executed on private originals with exact Agent1 SHA comparison.",
  caveat: "Parser readiness is not school-source answer verification, not deduplicated canonical question identity, not learner review, not local QBank installation and not authenticated cloud readback." };
await writeFile(out, writeSecureAudit(result), { flag: "w" });
process.stdout.write(JSON.stringify({ summary, report: out }, null, 2) + "\n");
if (summary.failed) process.exitCode = 1;
