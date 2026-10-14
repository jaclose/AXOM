import test from "node:test";
import assert from "node:assert/strict";
import { reconcileB3 } from "./academic-b3-reconcile.mjs";

const SHA_A = "a".repeat(64), SHA_B = "b".repeat(64);
const queue = { processing_order: [
  { id: "B3", jobs: [
    { canonical_input_key: "byte:" + SHA_A, source_path: "/authorized/a.pdf" },
    { canonical_input_key: "byte:" + SHA_B, source_path: "/authorized/b.pptx" },
  ] },
]};
const prepared = {
  sourceSha256: SHA_A, fileName: "a.pdf", originalFile: "sources/a/original.pdf",
  questionsFile: "sources/a/questions.json", sourceBytes: 2000, status: "prepared-review",
  detected: 2, ready: 0, needsReview: 0, unresolved: 2, pages: 1, pageMapped: 1,
  originalKeyIndependentlyVerified: false,
  headlessFigureAssetsVerified: false, cloudReadbackVerified: false,
};
const unsupported = {
  sourceSha256: SHA_B, fileName: "b.pptx", originalFile: "sources/b/original.pptx",
  sourceBytes: 2000, status: "unsupported-format",
  detected: 0, ready: 0, pages: 0, pageMapped: 0,
};
const assess = (rows, read = () => ({ questions: [{}, {}] })) => reconcileB3({
  queue, batches: [{ sources: rows }], readQuestionsFile: read, checkFile: () => true,
});
test("accepts exact source SHA and structurally counted candidates but never invents readiness", () => {
  const report = assess([prepared, unsupported]);
  assert.equal(report.summary.queued, 2);
  assert.equal(report.summary.structurallyPreparedSources, 1);
  assert.equal(report.summary.detectedQuestionCandidates, 2);
  assert.equal(report.summary.structurallyStoredQuestionRecords, 2);
  assert.equal(report.summary.reviewRequiredQuestionRecords, 2);
  assert.equal(report.summary.answerReadyVerified, 0);
  assert.equal(report.summary.cloudReadbackVerified, 0);
  assert.equal(report.summary.exceptionCount, 1);
  assert.equal(report.sources[0].originalShaVerified, true);
  assert.equal(report.releaseGate.complete, false);
});
test("detects missing source receipts and does not certify a partial import", () => {
  const report = assess([prepared]);
  assert(report.exceptions.some((entry) => entry.status === "missing-b3-receipt"));
  assert.equal(report.summary.reported, 1);
  assert.equal(report.summary.queued, 2);
});
test("does not merge or count duplicate receipt sources twice", () => {
  const report = assess([prepared, prepared, unsupported]);
  assert.equal(report.summary.reported, 2);
  assert(report.exceptions.some((entry) => entry.status === "duplicate-receipt"));
});
test("fails structural completeness on missing or mismatched prepared bank records", () => {
  const report = assess([prepared, unsupported], () => ({ questions: [{}] }));
  assert.equal(report.summary.structurallyPreparedSources, 0);
  assert(report.exceptions.some((entry) => entry.status === "candidate-to-package-count-mismatch"));
});
test("rejects forged verified-key or cloud state in unreviewed headless records", () => {
  const report = assess([{ ...prepared, cloudReadbackVerified: true }, unsupported]);
  assert.equal(report.summary.structurallyPreparedSources, 0);
  assert(report.exceptions.some((entry) => entry.status === "unverified-headless-batch-marked-trusted"));
});
test("fails closed when an original is missing or its SHA was not verified", () => {
  const report = reconcileB3({ queue, batches: [{ sources: [prepared, unsupported] }],
    readQuestionsFile: () => ({ questions: [{}, {}] }), checkFile: () => false });
  assert(report.exceptions.some((entry) => entry.status === "source-original-missing"));
});
