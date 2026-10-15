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
    { sha256: a, kind: "question-source", status: "installed", questionCount: 2, readyCount: 2, reviewCount: 0, figureReferences: 0 },
    { sha256: b, kind: "course-template", status: "installed" },
    { sha256: c, kind: "asset", status: "excluded", reason: "Referenced by source A" },
  ],
});
const receipts = () => ({ sources: [{ sha256: a, questionCount: 2, readbackVerified: true, ownerAuthenticated: true }] });
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
  const r = run({ receipts: { sources: [{ sha256: a, questionCount: 1, readbackVerified: true, ownerAuthenticated: true }] } });
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

test("public academic source requires verified rights and current review approval", () => {
  const d = dispositions();
  d.sources[0].visibility = "public";
  let r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.ok(r.blockers.some(x => x.includes("lacks verified license")));
  Object.assign(d.sources[0], {
    rightsStatus: "verified", publisherOptIn: true, reviewStatus: "approved",
    licenseEvidence: "original author explicitly authorized redistribution",
  });
  r = run({ dispositions: d });
  assert.equal(r.complete, true);
});

test("original question figures must be re-read as authenticated bytes, not inferred from a local asset", () => {
  const d = dispositions();
  d.sources[0].figureReferences = 3;
  let r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.equal(r.counts.declaredFigureReferences, 3);
  assert.equal(r.counts.verifiedFigureReferences, 0);
  assert.ok(r.blockers.some(x => x.includes("lacks authenticated image-byte readback")));
  r = run({ dispositions: d, receipts: { sources: [{
    sha256: a, questionCount: 2, readbackVerified: true, ownerAuthenticated: true,
    figureReadbackVerified: true, figureReferences: 2,
  }] } });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("Figure count mismatch")));
  r = run({ dispositions: d, receipts: { sources: [{
    sha256: a, questionCount: 2, readbackVerified: true, ownerAuthenticated: true,
    figureReadbackVerified: true, figureReferences: 3,
  }] } });
  assert.equal(r.complete, true, JSON.stringify(r.blockers));
  assert.equal(r.counts.verifiedFigureReferences, 3);
});

test("invalid claimed image count is not silently cast into a number", () => {
  const d = dispositions();
  d.sources[0].figureReferences = -1;
  const r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("Invalid figureReferences")));
});

test("production snapshot contradicting claimed installed content blocks acceptance", () => {
  const production = { projectId: "jofkmfwkidubxcutkwzf",
    observedAt: "2026-10-14T18:30:00Z", academicCollections: 0,
    academicRevisions: 0, academicFiles: 0, storageObjects: 0 };
  const r = run({ production });
  assert.equal(r.complete, false);
  assert.equal(r.counts.productionAcademicCollections, 0);
  assert.ok(r.errors.some(x => x.includes("zero academic collections")));
});

test("production snapshot for unrelated project never certifies AXOM", () => {
  const production = { projectId: "unrelated", observedAt: "2026-10-14T18:30:00Z",
    academicCollections: 1, academicRevisions: 1, academicFiles: 1, storageObjects: 1 };
  const r = run({ production });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("not the verified AXOM Production project")));
});

test("management or service-role readback is not accepted as an owner session", () => {
  const r = run({ receipts: { sources: [{ sha256: a, questionCount: 2, readbackVerified: true }] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.blockers.some(x => x.includes("no owner-authenticated cloud receipt")));
});

test("installed source must declare image count even when zero", () => {
  const d = dispositions();
  delete d.sources[0].figureReferences;
  const r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("lacks explicit figureReferences")));
});

test("installed source reconciles ready, review and rejected counts exactly", () => {
  const d = dispositions();
  d.sources[0].questionCount = 4;
  let r = run({ dispositions: d });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("does not reconcile ready + review + rejected")));
  d.sources[0].reviewCount = 1;
  d.sources[0].rejectedCount = 1;
  r = run({ dispositions: d });
  assert.equal(r.complete, true);
});

test("service-role image access cannot count as user-verified figure persistence", () => {
  const d = dispositions();
  d.sources[0].figureReferences = 2;
  const r = run({ dispositions: d, receipts: { sources: [{
    sha256: a, questionCount: 2, readbackVerified: true,
    figureReadbackVerified: true, figureReferences: 2,
  }] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedFigureReferences, 0);
  assert.ok(r.blockers.some(x => x.includes("image-byte readback")));
  assert.ok(r.blockers.some(x => x.includes("no owner-authenticated cloud receipt")));
});

test("complete status cannot survive an unmounted previously hashed academic PDF volume", () => {
  const triage = { schema: "axom-academic-pdf-triage-v1",
    runAt: new Date().toISOString(), queueDistinctPdfJobs: 1,
    rows: [{ source_sha256: a, status: "source_volume_unmounted" }] };
  const blocked = run({ pdfTriage: triage });
  assert.equal(blocked.complete, false);
  assert.equal(blocked.counts.pdfVolumeUnmounted, 1);
  assert.ok(blocked.blockers.some(msg => msg.includes("unmounted academic drive")));
  triage.rows[0].status = "text_with_question_indicators";
  const current = run({ pdfTriage: triage });
  assert.equal(current.complete, true, JSON.stringify(current.blockers));
  assert.equal(current.counts.pdfJobsRecorded, 1);
});

test("partial and duplicate PDF sampling cannot be mistaken for corpus coverage", () => {
  const triage = { schema: "axom-academic-pdf-triage-v1",
    runAt: new Date().toISOString(), queueDistinctPdfJobs: 2,
    rows: [{ source_sha256: a, status: "text_with_question_indicators" }] };
  const partial = run({ pdfTriage: triage });
  assert.equal(partial.complete, false);
  assert.ok(partial.blockers.some(msg => msg.includes("covers 1/2")));
  triage.rows.push({ source_sha256: a, status: "text_with_question_indicators" });
  const repeated = run({ pdfTriage: triage });
  assert.equal(repeated.complete, false);
  assert.ok(repeated.errors.some(msg => msg.includes("repeated source fingerprint")));
});

test("stale source availability snapshots cannot count as current verified coverage", () => {
  const triage = { schema: "axom-academic-pdf-triage-v1",
    runAt: "2024-01-01T00:00:00Z", queueDistinctPdfJobs: 1,
    rows: [{ source_sha256: a, status: "text_with_question_indicators" }] };
  const r = run({ pdfTriage: triage });
  assert.equal(r.complete, false);
  assert.ok(r.blockers.some(msg => msg.includes("stale or future-dated")));
});

const canonicalB4Audit = (overrides = {}) => ({
  format: "axom-b4-corpus-acceptance-v1", generatedAt: new Date().toISOString(),
  queuedSources: 2, receivedSourceDispositions: 2, missingReceipts: 0,
  orphanReceipts: 0, pathOnlySourceJobs: 0,
  sourceReceiptCoverageComplete: true, sourceIdentityCoverageComplete: true,
  academicReleaseComplete: false, verifiedCloudQuestionCount: 0, verifiedScorableQuestionCount: 0,
  totals: { detected: 15, canonicalReadable: 14, missingSources: 0, unverifiedByteProofSources: 0 },
  ...overrides,
});

test("canonical B4 source audit preserves orphan, path-only and unavailable blockers", () => {
  const corpusAudit = canonicalB4Audit({
    orphanReceipts: 2, pathOnlySourceJobs: 1,
    sourceReceiptCoverageComplete: false, sourceIdentityCoverageComplete: false,
    totals: { detected: 15, canonicalReadable: 14, missingSources: 1, unverifiedByteProofSources: 1 },
  });
  const r = run({ corpusAudit });
  assert.equal(r.complete, false);
  assert.equal(r.counts.b4Candidates, 15);
  assert.equal(r.counts.b4OrphanReceipts, 2);
  assert.equal(r.counts.b4PathOnlySources, 1);
  assert.equal(r.counts.b4OriginalsUnavailable, 1);
  assert.ok(r.blockers.some(x => x.includes("orphan receipts")));
  assert.ok(r.blockers.some(x => x.includes("path-only originals")));
});

test("canonical B4 partial queue and forged cloud/scored claims are rejected", () => {
  const corpusAudit = canonicalB4Audit({
    receivedSourceDispositions: 1, missingReceipts: 1,
    verifiedCloudQuestionCount: 8, verifiedScorableQuestionCount: 8,
  });
  const r = run({ corpusAudit });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("offline review")));
  assert.ok(r.blockers.some(x => x.includes("1/2 current queue entries")));
});

test("independent ready sources can coexist with valid separate B4 source-only audit", () => {
  const corpusAudit = canonicalB4Audit();
  const r = run({ corpusAudit });
  assert.equal(r.complete, true, JSON.stringify(r.blockers));
  assert.equal(r.counts.b4JobsAudited, 2);
  assert.equal(r.counts.verifiedReadyQuestions, 2);
  assert.equal(r.counts.b4Candidates, 15);
});

test("stale or noncanonical audit schema never replaces the verified B4 denominator", () => {
  const corpusAudit = canonicalB4Audit({ format: "axom-b4-source-receipt-audit-v1" });
  const r = run({ corpusAudit });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("Canonical B4 acceptance schema")));
});

test("yesterday's production counts cannot certify a release even if all synthetic receipts appear valid", () => {
  const production = { projectId: "jofkmfwkidubxcutkwzf", observedAt: "2026-10-14T18:39:58.776Z",
    academicCollections: 1, academicRevisions: 1, academicFiles: 2, storageObjects: 2 };
  const r = run({ production });
  assert.equal(r.complete, false);
  assert.ok(r.blockers.some(message => message.includes("Production database snapshot is stale")));
  const current = run({ production: { ...production, observedAt: new Date().toISOString() } });
  assert.equal(current.complete, true, JSON.stringify(current.blockers));
});
