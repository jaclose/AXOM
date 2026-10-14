#!/usr/bin/env node
/**
 * Independent, metadata-only acceptance gate for Agent 2's B4 private corpus.
 *
 * Uses existing SHA-indexed priority queue and bulkQueue receipt contract.
 * Does not change sources, execute parsers, inspect answer text for correctness,
 * create a question store, upload to Supabase, or certify scored-practice keys.
 *
 * Usage: node scripts/operations/academic-b4-reconcile.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = join(checkout, "artifacts/qbank-6way-20261014");
const privateRoot = join(dataRoot, "role-2-corpus-v2");
const SHA = /^[0-9a-f]{64}$/;
const DONE = new Set(["review-prepared", "review-partial"]);
const STATES = new Set([
  "unavailable", "source-over-limit", "unsupported-format",
  "checksum-mismatch", "extraction-error", "no-questions",
  "review-prepared", "review-partial",
]);
const validCount = value => Number.isSafeInteger(value) && value >= 0;

export function reconcileB4(jobs, receipts, inspectPackage = () => ({ valid: true })) {
  const errors = [], byStatus = {}, seen = new Set();
  const totals = { detected: 0, canonicalReadable: 0, ready: 0, reviewRequired: 0,
    unresolved: 0, rejected: 0, imageAssets: 0, packagesVerified: 0,
    byteCheckedSources: 0, missingSources: 0, unverifiedByteProofSources: 0 };
  const expected = new Map();
  let pathOnlySources = 0;
  jobs.forEach((job, index) => {
    const key = job?.canonical_input_key;
    const byteSha = typeof key === "string" && /^byte:[a-f0-9]{64}$/.test(key);
    const sourcePath = typeof key === "string" && key.startsWith("path:/") && key.length <= 2048;
    if (!(byteSha || sourcePath) || expected.has(key)) {
      errors.push(`B4 queue index ${index} has no unique, supported canonical source identity.`);
      return;
    }
    if (sourcePath) pathOnlySources++;
    expected.set(key, { index, sha: byteSha ? key.slice(5) : undefined,
      displayId: byteSha ? key.slice(5, 17) : createHash("sha256").update(key).digest("hex").slice(0, 12) });
  });
  for (const receipt of receipts) {
    const key = receipt?.sourceKey;
    const item = expected.get(key);
    if (!item) { errors.push("Unexpected B4 receipt identity."); continue; }
    if (seen.has(key)) { errors.push(`Duplicate B4 receipt ${item.displayId}.`); continue; }
    seen.add(key);
    if (receipt.schemaVersion !== 1 || receipt.batch !== "B4"
      || !receipt.adapterVersion?.startsWith("axom-existing-parsers-bulk-")
      || receipt.queueIndex !== item.index
      || (item.sha && receipt.sourceSha256 !== item.sha)
      || (!item.sha && receipt.sourceSha256 !== undefined && !SHA.test(receipt.sourceSha256))
      || (!item.sha && receipt.inventoryChecksumVerified === true)
      || !STATES.has(receipt.status) || !Array.isArray(receipt.reasons))
      errors.push(`Invalid B4 receipt metadata ${item.displayId}.`);
    if (!["detected", "canonicalReadable", "ready", "reviewRequired", "unresolved", "rejected", "imageAssets"]
      .every(field => validCount(receipt[field]))
      || receipt.detected !== receipt.ready + receipt.reviewRequired + receipt.unresolved + receipt.rejected
      || receipt.canonicalReadable > receipt.detected || receipt.ready !== 0
      || receipt.accountCloudReadbackVerified !== false || receipt.answerIndependentlyVerified !== false)
      errors.push(`Unsafe candidate/answer/cloud counts ${item.displayId}.`);
    // Old (already persisted) review receipts can lack a boolean byte proof.
    // Keep their source disposition visible without certifying file integrity.
    if (DONE.has(receipt.status) && item.sha && receipt.inventoryChecksumVerified !== true)
      totals.unverifiedByteProofSources++;
    byStatus[receipt.status] = (byStatus[receipt.status] ?? 0) + 1;
    for (const name of ["detected","canonicalReadable","ready","reviewRequired","unresolved","rejected","imageAssets"])
      totals[name] += validCount(receipt[name]) ? receipt[name] : 0;
    if (receipt.inventoryChecksumVerified === true) totals.byteCheckedSources++;
    if (receipt.status === "unavailable") totals.missingSources++;
    if (DONE.has(receipt.status)) {
      // Review-partial packages deliberately retain every detected original
      // candidate in questions.json and separately state which failed to parse.
      if (receipt.canonicalReadable + receipt.rejected !== receipt.detected
        || receipt.ready + receipt.reviewRequired + receipt.unresolved !== receipt.canonicalReadable)
        errors.push(`Prepared source lost or miscounted candidate rows ${item.displayId}.`);
      if (!receipt.packagePath || !SHA.test(receipt.packageQuestionsSha256 ?? "")) {
        errors.push(`Prepared candidate lacks a verifiable private package ${item.displayId}.`);
      } else {
        const check = inspectPackage(receipt);
        if (!check.valid || check.questions !== receipt.detected || check.unreadable !== receipt.rejected)
          errors.push(`Prepared question package checksum/record mismatch ${item.displayId}.`);
        else totals.packagesVerified++;
      }
    } else if (receipt.detected > 0) errors.push(`Unprepared source claims questions ${item.displayId}.`);
  }
  const missing = [...expected.keys()].filter(key => !seen.has(key));
  if (missing.length) errors.push(`${missing.length} B4 sources have no disposition receipt.`);
  return {
    format: "axom-b4-corpus-acceptance-v1",
    sourceReceiptCoverageComplete: errors.length === 0 && !missing.length,
    sourceIdentityCoverageComplete: errors.length === 0 && !missing.length
      && pathOnlySources === 0 && totals.unverifiedByteProofSources === 0,
    pathOnlySourceJobs: pathOnlySources,
    academicReleaseComplete: false,
    verifiedCloudQuestionCount: 0,
    verifiedScorableQuestionCount: 0,
    queuedSources: jobs.length,
    receivedSourceDispositions: seen.size,
    missingReceipts: missing.length,
    byStatus, totals,
    errors: errors.slice(0, 80),
    caveats: [
      "All B4 questions are STRUCTURAL extraction candidates, NOT source-key-verified or ready for scored practice.",
      "A missing source on the unplugged SSD is not a parser failure and must be retried after remount.",
    `${pathOnlySources} originals are path-only priority exceptions; an old path is not a verified immutable byte identity.`,
    `${totals.unverifiedByteProofSources} prepared sources lack an explicit fresh byte-SHA check in their persisted receipt; keep them in review until reverified.`,
      "No owner-authenticated Supabase cloud data receipt is claimed by this audit.",
    ],
  };
}

function readCandidate(receipt) {
  const root = realpathSync(join(privateRoot, "packages"));
  const folder = resolve(receipt.packagePath);
  if (!folder.startsWith(root + sep) || !existsSync(folder)) return { valid: false };
  const real = realpathSync(folder);
  if (!real.startsWith(root + sep)) return { valid: false };
  const questionsFile = join(real, "questions.json");
  if (!existsSync(questionsFile) || statSync(questionsFile).size > 32 * 1048576) return { valid: false };
  const bytes = readFileSync(questionsFile);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== receipt.packageQuestionsSha256) return { valid: false };
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    const prepared = JSON.parse(readFileSync(join(real, "prepared-bank.json"), "utf8"));
    return { valid: Array.isArray(parsed.questions) && validCount(prepared.unreadableQuestions),
      questions: parsed.questions?.length, unreadable: prepared.unreadableQuestions };
  } catch { return { valid: false }; }
}

export function runB4(root = dataRoot) {
  const queue = JSON.parse(readFileSync(join(root, "agent-2-priority-batches.json"), "utf8"));
  const sourceJobs = JSON.parse(readFileSync(join(root, "agent-2-import-inputs-deduplicated.json"), "utf8"));
  const selected = queue?.processing_order?.find(item => item.id === "B4");
  if (!Array.isArray(selected?.job_indices)) throw new Error("B4 SHA-indexed queue is unavailable.");
  const jobs = selected.job_indices.map(index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= sourceJobs.length)
      throw new Error("B4 queue has an out-of-range source index.");
    return sourceJobs[index];
  });
  const resultDir = join(root, "role-2-corpus-v2/results");
  const receipts = readdirSync(resultDir).filter(name => /^[A-Za-z0-9-]+\.json$/.test(name))
    .map(name => JSON.parse(readFileSync(join(resultDir, name), "utf8")));
  const result = reconcileB4(jobs, receipts, readCandidate);
  const target = join(root, "lead-b4-acceptance.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2) + "\n");
  console.log(JSON.stringify({ sourceReceiptCoverageComplete: result.sourceReceiptCoverageComplete,
    academicReleaseComplete: result.academicReleaseComplete,
    sourceIdentityCoverageComplete: result.sourceIdentityCoverageComplete,
    pathOnlySourceJobs: result.pathOnlySourceJobs,
    queuedSources: result.queuedSources, receivedSourceDispositions: result.receivedSourceDispositions,
    byStatus: result.byStatus, totals: result.totals, errors: result.errors.length, report: target }, null, 2));
  if (!result.sourceReceiptCoverageComplete) process.exitCode = 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runB4();
