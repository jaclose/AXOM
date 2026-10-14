#!/usr/bin/env node
/**
 * AXOM academic B3 batch acceptance.
 * Reconciles existing Agent2 private processing receipts WITHOUT importing,
 * parsing source content, assigning answers, or contacting Supabase.
 * Outputs metadata and SHA counts into ignored artifacts only.
 *
 * node scripts/operations/academic-b3-reconcile.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const shaRegex = /^[a-f0-9]{64}$/;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const load = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Explicit audit of every B3 source and prepared question array. */
export function reconcileB3({ queue, batches, readQuestionsFile, checkFile }) {
  const expected = queue?.processing_order?.find((batch) => batch.id === "B3")?.jobs;
  if (!Array.isArray(expected) || expected.length < 1) throw new Error("Missing B3 priority queue.");
  const bySha = new Map();
  for (const item of expected) {
    const sha = typeof item.canonical_input_key === "string"
      ? item.canonical_input_key.replace(/^byte:/, "") : "";
    if (!shaRegex.test(sha)) throw new Error("Priority queue contains a source without SHA256.");
    if (bySha.has(sha)) throw new Error("Priority queue has duplicate source SHA256.");
    bySha.set(sha, item);
  }
  const all = batches.flatMap((batch) => batch.sources ?? []);
  const seen = new Set(), results = [], exceptions = [];
  for (const row of all) {
    if (!shaRegex.test(row.sourceSha256 ?? "")) {
      exceptions.push({ status: "invalid-sha", sourceId: row.sourceSha256 ?? null });
      continue;
    }
    if (seen.has(row.sourceSha256)) {
      exceptions.push({ status: "duplicate-receipt", sha256: row.sourceSha256 });
      continue;
    }
    seen.add(row.sourceSha256);
    const source = bySha.get(row.sourceSha256);
    if (!source) {
      exceptions.push({ status: "out-of-queue", sha256: row.sourceSha256 });
      continue;
    }
    if (!count(row.detected) || !count(row.ready) || row.ready > row.detected) {
      exceptions.push({ status: "invalid-counts", sha256: row.sourceSha256 });
      continue;
    }
    const result = {
      sha256: row.sourceSha256, sourceName: row.fileName, status: row.status,
      detected: row.detected, ready: 0, reviewRequired: row.detected,
      sourceBytes: row.sourceBytes, pages: row.pages ?? 0,
      pageMappedCandidates: row.pageMapped ?? 0,
      originalShaVerified: Boolean(row.sourceSha256 && row.originalFile && checkFile(row.originalFile, row.sourceSha256)),
      answerKeyVerified: row.originalKeyIndependentlyVerified === true,
      figureAssetsVerified: row.headlessFigureAssetsVerified === true,
      cloudReadbackVerified: row.cloudReadbackVerified === true,
      suggestedScope: row.suggestedScope ?? {},
      originalPath: source.source_path,
      originalFile: row.originalFile,
      questionsFile: row.questionsFile,
      storedQuestionCount: null,
      exception: null,
    };
    if (row.status === "prepared-review" && row.questionsFile) {
      try {
        const parsed = readQuestionsFile(row.questionsFile);
        const actual = Array.isArray(parsed.questions) ? parsed.questions.length : null;
        result.storedQuestionCount = actual;
        if (actual !== row.detected) result.exception = "candidate-to-package-count-mismatch";
      } catch (error) {
        result.exception = "prepared-package-unreadable";
      }
      if (result.answerKeyVerified || result.figureAssetsVerified || result.cloudReadbackVerified) {
        result.exception = "unverified-headless-batch-marked-trusted";
      }
    } else if (row.status === "unsupported-format") {
      result.reviewRequired = 0;
      result.exception = "unsupported-format-needs-conversion";
    } else {
      result.exception = "source-requires-manual-triage";
    }
    if (!result.originalShaVerified) result.exception = result.exception ?? "source-original-missing";
    results.push(result);
    if (result.exception) exceptions.push({ status: result.exception, sha256: result.sha256, fileName: result.sourceName });
  }
  for (const [sha, job] of bySha) if (!seen.has(sha)) {
    exceptions.push({ status: "missing-b3-receipt", sha256: sha, sourceName: job.source_path });
  }
  const accepted = results.filter((item) => item.status === "prepared-review" && !item.exception);
  const fileCounts = Object.fromEntries([...new Set(results.map((r) => r.status))].map((status) =>
    [status, results.filter((r) => r.status === status).length]));
  const stats = {
    queued: expected.length, reported: results.length,
    uniqueShaReceipts: seen.size,
    ...fileCounts,
    structurallyPreparedSources: accepted.length,
    detectedQuestionCandidates: results.reduce((n, r) => n + r.detected, 0),
    structurallyStoredQuestionRecords: accepted.reduce((n, r) => n + (r.storedQuestionCount ?? 0), 0),
    reviewRequiredQuestionRecords: accepted.reduce((n, r) => n + r.reviewRequired, 0),
    answerReadyVerified: 0, figureLinksVerified: 0, cloudReadbackVerified: 0,
    sourcePageCount: accepted.reduce((n, r) => n + r.pages, 0),
    questionRecordsWithPageRef: accepted.reduce((n, r) => n + r.pageMappedCandidates, 0),
    exceptionCount: exceptions.length,
  };
  return {
    format: "axom-b3-source-acceptance-v1", source: "Agent2 B3 private batch receipts",
    summary: stats, sources: results, exceptions,
    releaseGate: {
      complete: false,
      reason: "Headless PDF candidates require original answer-key/figure/page verification and authenticated cloud readback.",
      sourceQuestionsArePrivate: true,
      publicDistributionAuthorized: false,
    },
  };
}

export function runB3(root = process.cwd()) {
  const folder = join(root, "artifacts/qbank-6way-20261014");
  const queue = load(join(folder, "agent-2-priority-batches.json"));
  const offsets = [0, 30, 60, 90];
  const batches = offsets.map((i) => load(join(folder, `role-2-b3-part-${i}.json`)));
  const privateRoot = join(folder, "role-2-prepared/portable-B3");
  const report = reconcileB3({
    queue, batches,
    readQuestionsFile: (path) => load(join(privateRoot, path)),
    checkFile: (path, expectedSha256) => {
      const filename = join(privateRoot, path);
      if (!existsSync(filename)) return false;
      return createHash("sha256").update(readFileSync(filename)).digest("hex") === expectedSha256;
    },
  });
  const target = join(folder, "lead-round2/b3-source-acceptance.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(JSON.stringify({ ...report.summary, releaseComplete: report.releaseGate.complete, output: target }, null, 2));
  if (report.summary.reported !== report.summary.queued
    || report.summary.structurallyPreparedSources + (report.summary["unsupported-format"] ?? 0) !== report.summary.reported) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runB3(resolve(process.cwd()));
}
