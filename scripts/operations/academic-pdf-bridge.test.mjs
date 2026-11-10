import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  selectPdfJobs, verifyPdfSourceAvailability, mergePdfTriageRows, recommendNextSources,
} from "./academic-pdf-triage.mjs";
import { reconcileAcademicContent } from "./academic-reconcile.mjs";

// Compatibility contract ONLY. A synthetic file and simulated authenticated
// readback are not a real PDF parse, medical answer review, rights approval,
// Supabase authorization check, or live learner acceptance.
const PDF_SHA = "a".repeat(64);
const FOREIGN_SHA = "b".repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axom-academic-bridge-"));
  const original = join(root, "synthetic.pdf");
  writeFileSync(original, "%PDF synthetic bytes, no medical questions or private data");
  const [job] = selectPdfJobs([{
    canonical_input_key: "byte:" + PDF_SHA,
    input_mode: "pdf_original_extract_with_review",
    source_path: original, document_type: "pq", term: "T1", module: "FTM", week: 2,
  }]);
  const stat = statSync(original);
  const inspected = {
    source_sha256: PDF_SHA, source_path: original, resolved_path: original,
    bytes: stat.size, mtime_ms: stat.mtimeMs, term: "T1", module: "FTM", week: 2,
    document_type: "pq", status: "text_with_question_indicators",
    sampledQuestionHeadingIndicators: 2,
  };
  const inventory = {
    summary: { files: 1, uniqueFiles: 1, duplicateFiles: 0, templates: [] },
    entries: [{ path: original, sha256: PDF_SHA, extension: "pdf" }],
  };
  const dispositions = { sources: [{
    sha256: PDF_SHA, kind: "question-source", status: "installed",
    questionCount: 1, readyCount: 1, reviewCount: 0, figureReferences: 0,
  }] };
  const receipts = { sources: [{
    sha256: PDF_SHA, questionCount: 1, reviewCount: 0,
    bankReadbackVerified: true, ownerAuthenticated: true,
    figureReadbackVerified: true, figureReferences: 0,
    originalFileStatus: "not-provided", originalReadbackVerified: false,
  }] };
  const tracker = { activities: [] };
  const accept = pdfTriage => reconcileAcademicContent({
    inventory, dispositions, receipts, tracker, pdfTriage,
  });
  const makeLedger = (rows, runId) => ({
    schema: "axom-academic-pdf-triage-v1",
    runAt: new Date().toISOString(), runId,
    queueDistinctPdfJobs: 1, rows,
  });
  const verify = (rows, runId, runAt = new Date().toISOString()) =>
    verifyPdfSourceAvailability(rows, [job], [root],
      { runId, runAt, now: () => runAt });
  return { root, original, job, inspected, accept, makeLedger, verify,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("R21 bridge: current authorized original passes this provenance gate; omitted triage cannot certify", () => {
  const f = fixture();
  try {
    const runId = "r21-bridge-pass-001";
    const runAt = new Date().toISOString();
    const [row] = f.verify([f.inspected], runId, runAt);
    const ledger = { ...f.makeLedger([row], runId), runAt };
    assert.equal(row.status, "text_with_question_indicators");
    assert.equal(row.availabilityProof?.runId, runId);
    assert.equal(row.availabilityProof?.source_sha256, PDF_SHA);
    assert.equal(recommendNextSources([row], new Set(), 20, runId).length, 1);
    const accepted = f.accept(ledger);
    assert.equal(accepted.complete, true, JSON.stringify(accepted));
    const omitted = f.accept(undefined);
    assert.equal(omitted.complete, false);
    assert.match(omitted.blockers.join(" "), /PDF question-source|availability triage/);
  } finally { f.cleanup(); }
});

test("R21 bridge: deleted original outside incremental slice invalidates cached ready row and excludes recommendation", () => {
  const f = fixture();
  try {
    const firstRun = "r21-bridge-first";
    const [ready] = f.verify([f.inspected], firstRun);
    assert.equal(f.accept(f.makeLedger([ready], firstRun)).complete, true);
    unlinkSync(f.original);
    // Reused cache with zero newly inspected rows, just like --start/--limit
    // window exclusions. Verification MUST still inspect original presence.
    const [missing] = f.verify(mergePdfTriageRows([ready], [], [f.job]), "r21-bridge-after-delete");
    assert.equal(missing.status, "source_path_unavailable");
    assert.equal(missing.availabilityProof, undefined);
    assert.equal(recommendNextSources([missing], new Set(), 20, "r21-bridge-after-delete").length, 0);
    const result = f.accept(f.makeLedger([missing], "r21-bridge-after-delete"));
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some(x => /PDF originals lack an accessible authorized path/.test(x)), JSON.stringify(result));
  } finally { f.cleanup(); }
});

test("R21 bridge: changing only the report runId does not launder an older proof", () => {
  const f = fixture();
  try {
    const [ready] = f.verify([f.inspected], "r21-bridge-old-run");
    const forgedReport = f.makeLedger([ready], "r21-bridge-new-run");
    const rejected = f.accept(forgedReport);
    assert.equal(rejected.complete, false);
    assert.equal(rejected.counts.pdfUnverifiedCurrentAvailability, 1);
    const [refreshed] = f.verify([ready], forgedReport.runId, forgedReport.runAt);
    assert.equal(f.accept({ ...forgedReport, rows: [refreshed] }).complete, true);
  } finally { f.cleanup(); }
});

test("R21 bridge: another source's fingerprint cannot substitute for this PDF original", () => {
  const f = fixture();
  try {
    const id = "r21-bridge-wrong-source";
    const [ready] = f.verify([f.inspected], id);
    const foreign = { ...ready, source_sha256: FOREIGN_SHA,
      availabilityProof: { ...ready.availabilityProof, source_sha256: FOREIGN_SHA } };
    const result = f.accept(f.makeLedger([foreign], id));
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some(x => /PDF question-source availability missing/.test(x)),
      JSON.stringify(result));
  } finally { f.cleanup(); }
});

test("R21 bridge: canonical byte-alias with conflicting source week stays on academic review hold", () => {
  const f = fixture();
  try {
    const [job] = selectPdfJobs([
      { canonical_input_key: "byte:" + PDF_SHA, input_mode: "pdf_original_extract_with_review",
        source_path: f.original, term: "T1", module: "FTM", week: 2 },
      { canonical_input_key: "byte:" + PDF_SHA, input_mode: "pdf_original_extract_with_review",
        source_path: f.original, term: "T1", module: "FTM", week: 3 },
    ]);
    assert.equal(job.requires_scope_review, true);
    const merged = mergePdfTriageRows([f.inspected], [], [job]);
    const runId = "r21-bridge-scope-conflict";
    const rows = verifyPdfSourceAvailability(merged, [job], [f.root],
      { runId, runAt: new Date().toISOString() });
    assert.equal(rows[0].status, "academic_scope_conflict_review");
    assert.equal(recommendNextSources(rows, new Set(), 20, runId).length, 0);
    const result = f.accept(f.makeLedger(rows, runId));
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some(x => /academic scope/.test(x)), JSON.stringify(result));
  } finally { f.cleanup(); }
});
