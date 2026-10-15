import test from "node:test";
import assert from "node:assert/strict";
import { classifyPdfText, isWithinRoot, parsePdfInfo, selectPdfJobs, sourceRoots, summarizeTriage, recommendNextSources, recommendBalancedSources } from "./academic-pdf-triage.mjs";

const HASH1 = "a".repeat(64);
const HASH2 = "b".repeat(64);
const HASH3 = "c".repeat(64);

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
      sampledQuestionHeadingIndicators: 8, sampledChoiceLineIndicators: 8, module: "NCRS", term: "T4", week: 3 },
    { source_sha256: HASH2, status: "text_with_question_indicators", document_type: "imcq",
      sampledQuestionHeadingIndicators: 3, sampledChoiceLineIndicators: 8, module: null, term: null, week: null },
    { source_sha256: HASH3, status: "source_volume_unmounted", document_type: "pq",
      sampledQuestionHeadingIndicators: 50, sampledChoiceLineIndicators: 20 },
  ];
  assert.deepEqual(recommendNextSources(rows,new Set([HASH1])).map(x=>x.source_sha256),[HASH2]);
  const next = recommendNextSources(rows,new Set(),5);
  assert.deepEqual(next.map(x=>x.source_sha256),[HASH1,HASH2]);
  assert.ok(next.every(item=>item.reviewStatus==="source_prefilter_only_not_answer_validated"));
  assert.ok(next.every(item=>!Object.keys(item).includes("correctAnswer")));
});

test("balanced next batch does not starve a lower-scoring supported term", () => {
  const rows = Array.from({ length: 35 }, (_, idx) => ({
    source_sha256: (idx + 1).toString(16).padStart(64, "0"),
    status: "text_with_question_indicators", document_type: "pq",
    term: idx < 30 ? "T1" : "T4", module: "NCRS",
    sampledQuestionHeadingIndicators: idx < 30 ? 10 : 1,
    sampledChoiceLineIndicators: 5,
  }));
  const result = recommendBalancedSources(rows, new Set(), 10);
  assert.equal(result.length, 10);
  assert.equal(new Set(result.map(x => x.source_sha256)).size, 10);
  assert.ok(result.some(x => x.term === "T4"));
  assert.ok(result.some(x => x.term === "T1"));
});
