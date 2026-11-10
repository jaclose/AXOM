import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyPdfText, isWithinRoot, parsePdfInfo, selectPdfJobs, mergePdfTriageRows, sourceRoots, summarizeTriage, recommendNextSources, recommendBalancedSources, verifyPdfSourceAvailability } from "./academic-pdf-triage.mjs";

const HASH1 = "a".repeat(64);
const HASH2 = "b".repeat(64);
const HASH3 = "c".repeat(64);
const syntheticAvailabilityProof = sha => ({ runId: "r19-synthetic-run", source_sha256: sha,
  authorizedPathAvailable: true, checkedAt: "2026-11-10T20:10:00.000Z" });

test("pdfinfo extracts page number and encryption without storing metadata text", () => {
  assert.deepEqual(parsePdfInfo("Title: Fictional\nPages: 49\nEncrypted: no\n"), { pages: 49, encrypted: false });
  assert.deepEqual(parsePdfInfo("Pages: 3\nEncrypted: yes (print:yes)\n"), { pages: 3, encrypted: true });
  assert.deepEqual(parsePdfInfo("Title: missing\n"), { pages: null, encrypted: null });
});

test("sample indicators never equate to a parsed question total", () => {
  const detected = classifyPdfText("Question 1: Synthetic?\nA. First\nB. Second\nC. Third\nD. Fourth\nAnswer: C\n".repeat(3));
  assert.equal(detected.kind, "text_with_question_indicators");
  assert.equal(detected.sampledQuestionHeadingIndicators, 3);
  assert.equal(detected.sampledAnswerLineIndicators, 3);
  assert.match(detected.countBasis, /sample_not_full_pdf/);
  assert.ok(!JSON.stringify(detected).includes("Synthetic?"));
  const imageOnly = classifyPdfText("\f\f \t");
  assert.equal(imageOnly.kind, "low_text_scan_or_figures");
  const narrative = classifyPdfText("An academic lecture with histology and physiology content. ".repeat(9));
  assert.equal(narrative.kind, "text_without_question_indicators");
});

test("canonical job selection is source-hash driven and excludes non-PDF parser paths", () => {
  const job = (sha, path, mode = "pdf_original_extract_with_review") =>
    ({ canonical_input_key: "byte:" + sha, source_path: path,
       input_mode: mode, document_type: "pq", priority: 3, term: null });
  const q = [
    job(HASH1, "/user/authorized/PQs.pdf"),
    job(HASH1, "/user/authorized/Mirror.pdf"),
    job(HASH2, "/user/authorized/source.txt"),
    job(HASH3, "/user/authorized/ZIP.pdf", "native_package_folder"),
    { ...job(HASH2, "/user/authorized/other.pdf"), canonical_input_key: "path:/user/authorized/other.pdf" },
    job(HASH2, "/user/authorized/another.PDF"),
  ];
  const selected = selectPdfJobs(q);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(row => row.source_sha256), [HASH1, HASH2]);
  assert.equal(selected[0].document_type, "pq");
});

test("byte-identical PDFs from conflicting source weeks are review-held, independent of queue order", () => {
  const first = { canonical_input_key: "byte:" + HASH1, input_mode: "pdf_original_extract_with_review",
    source_id: "T1-original", source_path: "/authorized/t1.pdf", term: "T1", module: "FTM", week: 2 };
  const second = { ...first, source_id: "T4-mirror", source_path: "/authorized/t4.pdf",
    term: "T4", module: "NCRS", week: 5 };
  for (const queue of [[first, second], [second, first]]) {
    const jobs = selectPdfJobs(queue);
    assert.equal(jobs.length, 1);
    const [held] = jobs;
    assert.equal(held.requires_scope_review, true);
    assert.equal(held.term, null);
    assert.equal(held.module, null);
    assert.equal(held.week, null);
    assert.deepEqual(held.scope_evidence.map(row => row.source_id).sort(), ["T1-original", "T4-mirror"]);
    assert.deepEqual(held.scope_evidence.map(row => row.source_path).sort(),
      ["/authorized/t1.pdf", "/authorized/t4.pdf"]);
    assert.equal(recommendNextSources([{ ...held, status: "text_with_question_indicators",
      sampledQuestionHeadingIndicators: 10 }]).length, 0);
  }
});

test("missing week versus assigned week is a conflict, but equal-scope mirrors remain eligible", () => {
  const original = { canonical_input_key: "byte:" + HASH2, input_mode: "pdf_original_extract_with_review",
    source_id: "first", source_path: "/authorized/first.pdf", term: "T2", module: "CPR", week: 3 };
  const unknown = { ...original, source_id: "unknown", source_path: "/authorized/unknown.pdf", week: null };
  const [held] = selectPdfJobs([original, unknown]);
  assert.equal(held.requires_scope_review, true);
  assert.equal(held.week, null);
  const [good] = selectPdfJobs([original, { ...original,
    source_id: "mirror", source_path: "/authorized/mirror.pdf" }]);
  assert.equal(good.requires_scope_review, false);
  assert.equal(good.week, 3);
  assert.deepEqual(good.equivalent_paths, ["/authorized/mirror.pdf"]);
});

test("stale positive PDF triage cache cannot recommend a newly conflicted scope", () => {
  const first = { canonical_input_key: "byte:" + HASH3, input_mode: "pdf_original_extract_with_review",
    source_id: "source-a", source_path: "/authorized/a.pdf", term: "T1", module: "FTM", week: 1 };
  const second = { ...first, source_id: "source-b", source_path: "/authorized/b.pdf", week: 2 };
  const jobs = selectPdfJobs([first, second]);
  const oldReady = { source_sha256: HASH3, source_path: "/authorized/a.pdf",
    term: "T1", module: "FTM", week: 1, status: "text_with_question_indicators",
    sampledQuestionHeadingIndicators: 7 };
  const rows = mergePdfTriageRows([oldReady], [], jobs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "academic_scope_conflict_review");
  assert.equal(rows[0].term, null);
  assert.equal(rows[0].week, null);
  assert.equal(recommendNextSources(rows).length, 0);
  assert.equal(summarizeTriage(rows).scopeConflictReviewRows, 1);
});

test("same PDF digest with a refilled week must not reuse old positive triage scope", () => {
  const job = { canonical_input_key: "byte:" + HASH1,
    input_mode: "pdf_original_extract_with_review",
    source_id: "current", source_path: "/authorized/same.pdf", term: "T1", module: "FTM", week: 4 };
  const previous = { source_sha256: HASH1, source_path: "/authorized/same.pdf",
    term: "T1", module: "FTM", week: 1,
    status: "text_with_question_indicators", sampledQuestionHeadingIndicators: 8 };
  const held = mergePdfTriageRows([previous], [], selectPdfJobs([job]));
  assert.equal(held.length, 1);
  assert.equal(held[0].status, "academic_scope_changed_review");
  assert.equal(held[0].week, null);
  assert.equal(held[0].scope_evidence.length, 2);
  assert.deepEqual(held[0].scope_evidence.map(item => item.week), [1, 4]);
  assert.equal(recommendNextSources(held).length, 0);
  assert.equal(summarizeTriage(held).scopeChangedReviewRows, 1);
  assert.deepEqual(mergePdfTriageRows(held, [], selectPdfJobs([job])), held,
    "held filing evidence must remain idempotent across repeated runs");
});

test("incremental report retains matching prior cache but drops out-of-queue source hashes", () => {
  const job = { canonical_input_key: "byte:" + HASH1, input_mode: "pdf_original_extract_with_review",
    source_path: "/authorized/current.pdf", module: "NCRS", term: "T4", week: 1 };
  const rows = mergePdfTriageRows([
    { source_sha256: HASH1, source_path: "/authorized/current.pdf", term: "T4", module: "NCRS", week: 1,
      status: "text_with_question_indicators", sampledQuestionHeadingIndicators: 2 },
    { source_sha256: HASH2, status: "text_with_question_indicators", sampledQuestionHeadingIndicators: 99 },
  ], [], selectPdfJobs([job]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_sha256, HASH1);
});

test("root validation prevents traversal and unrelated personal file access", () => {
  const roots = sourceRoots("/Users/mock");
  assert.ok(isWithinRoot("/Users/mock/Downloads/Term 3/questions.pdf", roots));
  assert.ok(isWithinRoot("/Users/mock/Desktop/NCRS/IMCQ2.pdf", roots));
  assert.equal(isWithinRoot("/Users/mock/Downloads-other/file.pdf", roots), false);
  assert.equal(isWithinRoot("/Users/mock/.ssh/secret", roots), false);
  assert.equal(isWithinRoot("/Users/mock/Downloads/../.config/secret", roots), false);
  assert.equal(isWithinRoot("../Downloads/pq.pdf", roots), false);
});

test("summary preserves denominators and meaningful unsupported/scan count", () => {
  const data = [
    { status: "text_with_question_indicators", module: "GOER" },
    { status: "low_text_scan_or_figures", module: "GOER" },
    { status: "size_limit_deferred", module: null },
    { status: "reader_failure_needs_review", module: null },
    { status: "source_volume_unmounted", module: null },
  ];
  const sum = summarizeTriage(data);
  assert.equal(sum.measuredPdfJobRows, 5);
  assert.equal(sum.textWithQuestionIndicators, 1);
  assert.equal(sum.lowTextScanOrFigures, 1);
  assert.equal(sum.unreadableOrDeferred, 3);
  assert.equal(sum.unmountedVolumeSources, 1);
  assert.equal(sum.byModule.GOER, 2);
});

test("next-batch ranking excludes already-processed B3 fingerprints without asserting readiness", () => {
  const rows = [
    { source_sha256: HASH1, status: "text_with_question_indicators", document_type: "pq",
      sampledQuestionHeadingIndicators: 8, sampledChoiceLineIndicators: 8, module: "NCRS", term: "T4", week: 3,
       availabilityProof: syntheticAvailabilityProof(HASH1) },
    { source_sha256: HASH2, status: "text_with_question_indicators", document_type: "imcq",
      sampledQuestionHeadingIndicators: 3, sampledChoiceLineIndicators: 8, module: null, term: null, week: null,
       availabilityProof: syntheticAvailabilityProof(HASH2) },
    { source_sha256: HASH3, status: "source_volume_unmounted", document_type: "pq",
      sampledQuestionHeadingIndicators: 50, sampledChoiceLineIndicators: 20 },
  ];
  assert.deepEqual(recommendNextSources(rows,new Set([HASH1])).map(x=>x.source_sha256),[HASH2]);
  const next = recommendNextSources(rows,new Set(),5);
  assert.deepEqual(next.map(x=>x.source_sha256),[HASH1,HASH2]);
  assert.ok(next.every(item=>item.reviewStatus==="source_prefilter_only_not_answer_validated"));
  assert.ok(next.every(item=>!Object.keys(item).includes("correctAnswer")));
  assert.deepEqual(recommendNextSources(rows, new Set(), 5, "other-run"), []);
  assert.deepEqual(recommendNextSources(rows, new Set(), 5, "r19-synthetic-run").map(item => item.source_sha256), [HASH1, HASH2]);
});

test("balanced next batch does not starve a lower-scoring supported term", () => {
  const rows = Array.from({ length: 35 }, (_, idx) => ({
    source_sha256: (idx + 1).toString(16).padStart(64, "0"),
    status: "text_with_question_indicators", document_type: "pq",
    term: idx < 30 ? "T1" : "T4", module: "NCRS",
    sampledQuestionHeadingIndicators: idx < 30 ? 10 : 1,
    sampledChoiceLineIndicators: 5,
    availabilityProof: syntheticAvailabilityProof((idx + 1).toString(16).padStart(64, "0")),
  }));
  const result = recommendBalancedSources(rows, new Set(), 10);
  assert.equal(result.length, 10);
  assert.equal(new Set(result.map(x => x.source_sha256)).size, 10);
  assert.ok(result.some(x => x.term === "T4"));
  assert.ok(result.some(x => x.term === "T1"));
});

function fakePdfJob(sha, sourcePath, extra = {}) {
  return { canonical_input_key: "byte:" + sha, input_mode: "pdf_original_extract_with_review",
    source_path: sourcePath, document_type: "pq", term: "T1", module: "FTM", week: 2, ...extra };
}

function fakeReadyRow(job, stat, sourcePath = job.source_path) {
  return { source_sha256: job.source_sha256, source_path: job.source_path,
    resolved_path: sourcePath, bytes: stat.size, mtime_ms: stat.mtimeMs,
    term: job.term, module: job.module, week: job.week,
    status: "text_with_question_indicators", sampledQuestionHeadingIndicators: 3,
    sampledPagesMax: 3 };
}

test("R19 RED: a previously ready but removed original cannot be recommended on an incremental zero-inspection run", () => {
  const absent = "/allowed/nonexistent-r19.pdf";
  const [job] = selectPdfJobs([fakePdfJob(HASH1, absent)]);
  const cached = { ...fakeReadyRow(job, { size: 120, mtimeMs: 1 }), reusedCache: true };
  const merged = mergePdfTriageRows([cached], [], [job]);
  assert.equal(recommendNextSources(merged).length, 0,
    "cached positive source hints must not survive a missing original");
});

test("R19: first inspection and cached repeat both receive their own current-run path-only availability proof", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-"));
  try {
    const original = join(root, "synthetic.pdf");
    writeFileSync(original, "%PDF synthetic test bytes, not real medical content");
    const [job] = selectPdfJobs([fakePdfJob(HASH1, original)]);
    const sourceStat = statSync(original);
    const originalRow = fakeReadyRow(job, sourceStat);
    const firstAt = "2026-11-10T20:10:00.000Z";
    const [first] = verifyPdfSourceAvailability([originalRow], [job], [root],
      { runId: "r19-first-run", runAt: firstAt, now: () => firstAt });
    assert.equal(first.status, "text_with_question_indicators");
    assert.deepEqual(first.availabilityProof, { runId: "r19-first-run",
      source_sha256: HASH1, authorizedPathAvailable: true, checkedAt: firstAt });
    assert.equal(first.source_sha_is_ledger_declared_not_rehashed, true);
    const secondAt = "2026-11-10T20:11:00.000Z";
    const [second] = verifyPdfSourceAvailability([first], [job], [root],
      { runId: "r19-cached-run", runAt: secondAt, now: () => secondAt });
    assert.equal(second.status, "text_with_question_indicators");
    assert.equal(second.availabilityProof.runId, "r19-cached-run");
    assert.equal(second.availabilityProof.checkedAt, secondAt);
    assert.equal(recommendNextSources([second]).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R19: disconnected original outside processing slice loses prior ready status and prior-run proof", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-"));
  try {
    const original = join(root, "synthetic.pdf");
    writeFileSync(original, "synthetic");
    const [job] = selectPdfJobs([fakePdfJob(HASH2, original)]);
    const cached = { ...fakeReadyRow(job, statSync(original)),
      availabilityProof: { runId: "previous-run", source_sha256: HASH2,
        authorizedPathAvailable: true, checkedAt: "2026-11-10T20:05:00.000Z" } };
    unlinkSync(original);
    const [missing] = verifyPdfSourceAvailability([cached], [job], [root],
      { runId: "r19-incremental-run", runAt: "2026-11-10T20:20:00.000Z",
        inspectedShas: new Set() });
    assert.equal(missing.status, "source_path_unavailable");
    assert.equal(missing.availabilityProof, undefined);
    assert.equal(recommendNextSources([missing]).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R19: changed mtime or different authorized mirror never inherits stale sampled ready status", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-"));
  try {
    const original = join(root, "synthetic.pdf"), alias = join(root, "alias.pdf");
    writeFileSync(original, "synthetic");
    writeFileSync(alias, "different synthetic data");
    const [job] = selectPdfJobs([fakePdfJob(HASH3, original, { equivalent_paths: [alias] })]);
    const cached = fakeReadyRow(job, statSync(original));
    utimesSync(original, new Date(10_000), new Date(10_000));
    const [mtimeHeld] = verifyPdfSourceAvailability([cached], [job], [root],
      { runId: "r19-modified-run", runAt: "2026-11-10T20:20:00.000Z", inspectedShas: new Set() });
    assert.equal(mtimeHeld.status, "reader_failure_needs_review");
    assert.equal(recommendNextSources([mtimeHeld]).length, 0);
    unlinkSync(original);
    const [aliasHeld] = verifyPdfSourceAvailability([cached], [job], [root],
      { runId: "r19-mirror-run", runAt: "2026-11-10T20:21:00.000Z", inspectedShas: new Set() });
    assert.equal(aliasHeld.status, "reader_failure_needs_review");
    assert.equal(aliasHeld.resolved_path, alias);
    assert.equal(aliasHeld.usedMirror, true);
    assert.equal(recommendNextSources([aliasHeld]).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R19: scope-conflicted original remains held even when the source becomes unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-"));
  try {
    const [job] = selectPdfJobs([fakePdfJob(HASH1, join(root, "missing.pdf"),
      { equivalent_paths: [] }), fakePdfJob(HASH1, join(root, "missing-mirror.pdf"), { week: 4 })]);
    const [held] = verifyPdfSourceAvailability(mergePdfTriageRows([], [], [job]),
      [job], [root], { runId: "r19-held-run", runAt: "2026-11-10T20:20:00.000Z",
        inspectedShas: new Set() });
    assert.equal(held.status, "academic_scope_conflict_review");
    assert.equal(held.sourceAvailabilityStatus, "source_path_unavailable");
    assert.equal(held.availabilityProof, undefined);
    assert.equal(held.scope_evidence.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R19: symlink escaping the authorized source root cannot receive availability proof", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-root-"));
  const outside = mkdtempSync(join(tmpdir(), "axom-pdf-r19-outside-"));
  try {
    const external = join(outside, "private.pdf"), link = join(root, "escaped.pdf");
    writeFileSync(external, "synthetic");
    symlinkSync(external, link);
    const [job] = selectPdfJobs([fakePdfJob(HASH1, link)]);
    const [held] = verifyPdfSourceAvailability(
      [fakeReadyRow(job, statSync(external), external)], [job], [root],
      { runId: "r19-symlink-run", runAt: "2026-11-10T20:20:00.000Z", inspectedShas: new Set() });
    assert.equal(held.status, "source_path_unavailable");
    assert.equal(held.availabilityProof, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("R19: actual zero-inspection CLI refresh issues a new run ID, invalidates missing original, and writes no source bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "axom-pdf-r19-cli-"));
  try {
    const original = join(root, "synthetic.pdf"), queuePath = join(root, "queue.json");
    const reportPath = join(root, "report.json");
    writeFileSync(original, "%PDF synthetic, never processed by Poppler");
    const [job] = selectPdfJobs([fakePdfJob(HASH1, original)]);
    writeFileSync(queuePath, JSON.stringify([fakePdfJob(HASH1, original)]));
    writeFileSync(reportPath, JSON.stringify({ rows: [fakeReadyRow(job, statSync(original))] }));
    const cliPath = new URL("./academic-pdf-triage.mjs", import.meta.url);
    const invoke = () => {
      const child = spawnSync(process.execPath, [cliPath.pathname, "--input", queuePath,
        "--out", reportPath, "--start", "1", "--limit", "1", "--allow-root", root],
        { encoding: "utf8", timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(readFileSync(reportPath, "utf8"));
    };
    const first = invoke();
    assert.equal(first.selectedJobs, 0);
    assert.match(first.runId, /^[0-9a-f-]{36}$/);
    assert.equal(first.rows[0].availabilityProof.runId, first.runId);
    assert.equal(first.rows[0].status, "text_with_question_indicators");
    assert.equal(recommendNextSources(first.rows, new Set(), 100, first.runId).length, 1);
    unlinkSync(original);
    const missing = invoke();
    assert.equal(missing.selectedJobs, 0);
    assert.notEqual(missing.runId, first.runId);
    assert.equal(missing.rows[0].status, "source_path_unavailable");
    assert.equal(missing.rows[0].availabilityProof, undefined);
    assert.equal(missing.recommendedNextAfterB3.length, 0);
    assert.equal(missing.balancedNextAfterB3.length, 0);
    assert.equal(missing.rows[0].source_sha256, HASH1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
