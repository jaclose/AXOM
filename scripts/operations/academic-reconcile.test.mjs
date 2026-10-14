import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAcademicContent, expandedSourceInventory } from "./academic-reconcile.mjs";

const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
const fixture = () => ({
  summary: { files: 4, uniqueFiles: 3, duplicateFiles: 1, templates: [{ module: "FTM 1", items: 2 }] },
  entries: [
    { path: "sources/IMCQ-1.pdf", sha256: a, extension: "pdf" },
    { path: "sources/IMCQ-1-copy.pdf", sha256: a, extension: "pdf", duplicateOf: "sources/IMCQ-1.pdf" },
    { path: "templates/FTM1.txt", sha256: b, extension: "txt" },
    { path: "assets/diagram.png", sha256: c, extension: "png" },
  ],
});
const dispositions = () => ({
  sources: [
    { sha256: a, kind: "question-source", status: "installed", questionCount: 2, readyCount: 2, reviewCount: 0 },
    { sha256: b, kind: "course-template", status: "installed" },
    { sha256: c, kind: "asset", status: "excluded", reason: "Referenced by source A" },
  ],
});
const receipts = () => ({ sources: [{ sha256: a, questionCount: 2, readbackVerified: true }] });
const tracker = () => ({ activities: [
  { activityId: "FTM1:L1", term: "T1", module: "FTM 1", week: 2, weekBasis: "explicit", installed: true },
  { activityId: "FTM1:IMCQ1", term: "T1", module: "FTM 1", weekBasis: "unassigned", installed: true },
] });
const run = (input = {}) => reconcileAcademicContent({
  inventory: fixture(), dispositions: dispositions(), receipts: receipts(), tracker: tracker(), ...input,
});

test("complete requires source identities, dispositions, verified receipts, and tracker records", () => {
  const r = run();
  assert.equal(r.complete, true, JSON.stringify(r.blockers));
  assert.deepEqual(r.counts, {
    inventoryFiles: 4, uniqueSourceFiles: 3, duplicateFiles: 1,
    explicitlyClassified: 3, missingDisposition: 0,
    questionSources: 1, nonInstalledQuestionSources: 0,
    detectedQuestions: 2, readyQuestions: 2, reviewQuestions: 0, verifiedReadyQuestions: 2,
    expectedBaselineTrackerActivities: 2, reportedTrackerActivities: 2,
    installedTrackerActivities: 2, cloudReceiptSources: 1,
  });
});

test("initial discovery state is not a false success without any specialist ledgers", () => {
  const r = reconcileAcademicContent({ inventory: fixture() });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.equal(r.counts.missingDisposition, 3);
  assert.ok(r.blockers.some(s => s.includes("cloud")));
  assert.ok(r.blockers.some(s => s.includes("tracker")));
});

test("ready questions cannot exceed detected questions", () => {
  const d = dispositions();
  d.sources[0].readyCount = 3;
  const r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(s => s.includes("Ready > detected")));
});

test("source marked installed with no confirmed backend readback is blocked", () => {
  const r = run({ receipts: { sources: [{ sha256: a, questionCount: 2, readbackVerified: false }] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.blockers.some(s => s.includes("not readback-verified")));
});

test("count mismatch between review and cloud persistence is an error", () => {
  const r = run({ receipts: { sources: [{ sha256: a, questionCount: 1, readbackVerified: true }] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.errors.some(s => s.includes("Ready/stored mismatch")));
});

test("template omission blocks completion even if all questions are verified", () => {
  const t = tracker();
  t.activities.pop();
  const r = run({ tracker: t });
  assert.equal(r.complete, false);
  assert.ok(r.blockers.some(s => s.includes("has 1 unique activities")));
});

test("duplicate paths must refer to the exact known canonical bytes", () => {
  const inv = fixture();
  inv.entries[1].duplicateOf = "sources/something-else.pdf";
  const r = run({ inventory: inv });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(s => s.includes("does not point to")));
});

test("unknown source disposition and missing reason are not silently accepted", () => {
  const d = dispositions();
  d.sources[0].status = "prepared";
  const r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.equal(r.counts.nonInstalledQuestionSources, 1);
  assert.ok(r.blockers.some(s => s.includes("without an explicit reason")));
});

test("doubled source/academic identities are detected", () => {
  const d = dispositions();
  d.sources.push({ ...d.sources[0] });
  const t = tracker();
  t.activities.push({ ...t.activities[0] });
  const r = run({ dispositions: d, tracker: t });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(s => s.includes("Duplicate source disposition")));
  assert.ok(r.errors.some(s => s.includes("Duplicate tracker activity")));
});

test("expanded corpus adaptor deduplicates SHA by bytes and retains unhashed priority blockers", () => {
  const inventory = expandedSourceInventory([
    { source_sha256: a, original_path: "/private/one.pdf", file_extension: ".pdf" },
    { source_sha256: a, original_path: "/private/one-copy.pdf", file_extension: ".pdf" },
    { source_sha256: b, original_path: "/private/template.txt", file_extension: ".txt" },
    { source_sha256: null, original_path: "/private/too-large.pdf", file_extension: ".pdf" },
  ], {
    file_denominators: {
      eligible_priority_files_with_unresolved_sha: 1,
      catalogued_document_and_asset_paths: 4,
    },
    tracker_denominators: { parsed_activity_rows: 2 },
  });
  assert.equal(inventory.summary.files, 3);
  assert.equal(inventory.summary.uniqueFiles, 2);
  assert.equal(inventory.summary.duplicateFiles, 1);
  assert.equal(inventory.entries[1].duplicateOf, "/private/one.pdf");
  const output = reconcileAcademicContent({ inventory });
  assert.equal(output.complete, false);
  assert.equal(output.counts.priorityMissingSha, 1);
  assert.equal(output.counts.cataloguedPaths, 4);
  assert.ok(output.blockers.some(x => x.includes("eligible academic sources have no verified SHA-256")));
});

test("inconsistent expanded source summary cannot certify a rolling inventory", () => {
  const inv = expandedSourceInventory([
    { source_sha256: a, original_path: "one.pdf" },
  ], {
    tracker_denominators: { parsed_activity_rows: 0 },
    file_denominators: { sha256_hashed_paths: 2, distinct_byte_sha256: 2 },
  });
  const r = reconcileAcademicContent({ inventory: inv });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("hashed paths but source summary reports")));
  assert.ok(r.errors.some(x => x.includes("unique hashes but source summary reports")));
});
