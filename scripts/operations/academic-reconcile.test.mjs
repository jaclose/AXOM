import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAcademicContent, expandedSourceInventory } from "./academic-reconcile.mjs";

const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
const fixture = () => ({
  priorityMissingSha: 0,
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
const receipt = (overrides = {}) => ({
  sha256: a, questionCount: 2, reviewCount: 0, bankReadbackVerified: true, ownerAuthenticated: true,
  figureReadbackVerified: true, figureReferences: 0,
  originalFileStatus: "not-provided", originalReadbackVerified: false,
  ...overrides,
});
const receipts = () => ({ sources: [receipt()] });
const tracker = () => ({ activities: [
  { activityId: "FTM1:L1", sourceSha256: b, term: "T1", module: "FTM 1", week: 2, weekBasis: "explicit", installed: true },
  { activityId: "FTM1:IMCQ1", sourceSha256: b, term: "T1", module: "FTM 1", weekBasis: "unassigned", installed: true },
] });
const run = (input = {}) => reconcileAcademicContent({
  // The default synthetic PDF receipt is explicit: source coverage is no longer
  // implied by unrelated question-bank/cloud/tracker receipts.
  inventory: fixture(), dispositions: dispositions(), receipts: receipts(), tracker: tracker(),
  pdfTriage: completePdfTriage("text_with_question_indicators"), ...input,
});

test("malformed source inventory rows produce a deterministic report instead of crashing reconciliation", () => {
  const healthy = run();
  assert.equal(healthy.complete, true, JSON.stringify(healthy));
  for (const invalid of [null, undefined, false, 0, "", []]) {
    const inventory = fixture();
    inventory.entries[0] = invalid;
    const result = run({ inventory });
    assert.equal(result.complete, false, `Invalid inventory entry ${String(invalid)} must fail closed.`);
    assert.ok(result.errors.some(error => error.includes("Invalid source inventory row at index 0")),
      `Missing row error for ${String(invalid)}: ${JSON.stringify(result)}`);
  }
});

test("non-array disposition, cloud receipt, and tracker ledgers hold without throwing", () => {
  for (const [label, key, shape] of [
    ["disposition object", "dispositions", { sources: {} }],
    ["disposition string", "dispositions", { sources: "not-an-array" }],
    ["disposition null", "dispositions", { sources: null }],
    ["receipt object", "receipts", { sources: {} }],
    ["receipt string", "receipts", { sources: "not-an-array" }],
    ["receipt null", "receipts", { sources: null }],
    ["tracker object", "tracker", { activities: {} }],
    ["tracker string", "tracker", { activities: "not-an-array" }],
    ["tracker null", "tracker", { activities: null }],
  ]) {
    const result = run({ [key]: shape });
    assert.equal(result.complete, false, `${label} must not certify acceptance.`);
    assert.ok(result.blockers.length > 0, `${label} must leave an actionable coverage hold.`);
  }
  assert.equal(run().complete, true, "Well-formed baseline remains valid.");
});

test("direct JSON inventory must declare a verified nonnegative missing-SHA denominator", () => {
  const complete = run();
  assert.equal(complete.complete, true, JSON.stringify(complete.blockers));
  assert.equal(complete.counts.priorityMissingSha, 0);

  const missingField = fixture();
  delete missingField.priorityMissingSha;
  const omitted = run({ inventory: missingField });
  assert.equal(omitted.complete, false, "Omitting a direct inventory count must not certify source coverage.");
  assert.equal(omitted.counts.priorityMissingSha, null);
  assert.ok(omitted.blockers.some(x => x.includes("missing-SHA denominator")));

  for (const invalid of [undefined, null, "0", "", true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = run({ inventory: { ...fixture(), priorityMissingSha: invalid } });
    assert.equal(result.complete, false, `Unverified direct inventory count ${String(invalid)} must hold.`);
    assert.equal(result.counts.priorityMissingSha, null);
    assert.ok(result.blockers.some(x => x.includes("missing-SHA denominator")));
  }

  const actuallyMissing = run({ inventory: { ...fixture(), priorityMissingSha: 2 } });
  assert.equal(actuallyMissing.complete, false);
  assert.equal(actuallyMissing.counts.priorityMissingSha, 2);
  assert.ok(actuallyMissing.blockers.some(x => x.includes("eligible academic sources have no verified SHA-256")));
});

test("Course Tracker template baseline denominator is required and strictly counted", () => {
  const malformed = [
    ["omitted", undefined], ["null", null], ["string", "2"], ["object", {}],
    ["missing item count", [{}]], ["string item count", [{ items: "2" }]],
    ["negative", [{ items: -1 }]], ["fraction", [{ items: 0.5 }]],
    ["unsafe count", [{ items: Number.MAX_SAFE_INTEGER + 1 }]],
    ["aggregate overflow", [{ items: Number.MAX_SAFE_INTEGER }, { items: 1 }]],
  ];
  for (const [label, candidate] of malformed) {
    const inventory = fixture();
    if (label === "omitted") delete inventory.summary.templates;
    else inventory.summary.templates = candidate;
    const r = run({ inventory });
    assert.equal(r.complete, false, `Unverified Tracker denominator ${label} must hold.`);
    assert.equal(r.counts.expectedBaselineTrackerActivities, null);
    assert.ok(r.blockers.some(message => message.includes("template activity denominator")),
      `Missing denominator hold for ${label}: ${JSON.stringify(r.blockers)}`);
  }

  const explicitEmpty = fixture();
  explicitEmpty.summary.templates = [];
  const empty = run({ inventory: explicitEmpty, tracker: { activities: [] } });
  assert.equal(empty.complete, true, JSON.stringify(empty.blockers));
  assert.equal(empty.counts.expectedBaselineTrackerActivities, 0);

  const positive = fixture();
  positive.summary.templates = [{ module: "FTM 1", items: 3 }];
  const shortfall = run({ inventory: positive });
  assert.equal(shortfall.complete, false);
  assert.equal(shortfall.counts.expectedBaselineTrackerActivities, 3);
  assert.ok(shortfall.blockers.some(message => message.includes("Tracker ledger has 2 unique activities")));
});

test("expanded source adapter cannot invent zero Tracker activities for an absent summary", () => {
  const rows = [{ source_sha256: a, original_path: "sources/nonmedical.txt", file_extension: "txt" }];
  const sourceSummary = { file_denominators: {
    eligible_priority_files_with_unresolved_sha: 0, catalogued_document_and_asset_paths: 1,
    sha256_hashed_paths: 1, distinct_byte_sha256: 1,
  } };
  const check = summary => reconcileAcademicContent({
    inventory: expandedSourceInventory(rows, summary),
    dispositions: { sources: [{ sha256: a, kind: "reference", status: "excluded",
      reason: "synthetic non-question source" }] },
    receipts: { sources: [] }, tracker: { activities: [] },
  });

  const unknown = check(sourceSummary);
  assert.equal(unknown.complete, false, "No tracker summary cannot imply zero baseline activities.");
  assert.equal(unknown.counts.expectedBaselineTrackerActivities, null);
  assert.ok(unknown.blockers.some(message => message.includes("template activity denominator")));

  const explicitZero = check({ ...sourceSummary,
    tracker_denominators: { parsed_activity_rows: 0 } });
  assert.equal(explicitZero.complete, true, JSON.stringify(explicitZero.blockers));
  assert.equal(explicitZero.counts.expectedBaselineTrackerActivities, 0);
});

test("expanded JSONL source-cohort path and hash totals cannot silently default to observed entries", () => {
  const rows = [{ source_sha256: a, original_path: "sources/known.txt", file_extension: "txt" }];
  const fileCounts = {
    eligible_priority_files_with_unresolved_sha: 0,
    catalogued_document_and_asset_paths: 1,
    sha256_hashed_paths: 1,
    distinct_byte_sha256: 1,
  };
  const check = file_denominators => reconcileAcademicContent({
    inventory: expandedSourceInventory(rows, {
      file_denominators, tracker_denominators: { parsed_activity_rows: 0 },
    }),
    dispositions: { sources: [{ sha256: a, kind: "reference", status: "excluded",
      reason: "synthetic non-PDF reference" }] },
    receipts: { sources: [] }, tracker: { activities: [] },
  });
  assert.equal(check(fileCounts).complete, true,
    "An explicitly enumerated, matching source census remains valid.");

  for (const field of [
    "catalogued_document_and_asset_paths", "sha256_hashed_paths", "distinct_byte_sha256",
  ]) {
    for (const bad of [undefined, null, "1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const candidate = { ...fileCounts, [field]: bad };
      if (bad === undefined) delete candidate[field];
      const r = check(candidate);
      assert.equal(r.complete, false, `Unverified ${field}=${String(bad)} must HOLD.`);
      assert.ok(r.errors.some(message => message.includes("summary") || message.includes("manifest")),
        JSON.stringify(r.errors));
    }
  }
  for (const [field, count] of [
    ["catalogued_document_and_asset_paths", 0],
    ["sha256_hashed_paths", 0],
    ["distinct_byte_sha256", 0],
  ]) {
    const r = check({ ...fileCounts, [field]: count });
    assert.equal(r.complete, false, `Underreported ${field} must not certify corpus coverage.`);
  }
  // A catalogued count may include legitimately excluded/unhashed references.
  const extraReferences = check({ ...fileCounts, catalogued_document_and_asset_paths: 2 });
  assert.equal(extraReferences.complete, true, JSON.stringify(extraReferences.errors));
  assert.ok(extraReferences.warnings.some(message => message.includes("not included in the hashed cohort")));
});

test("complete requires source identities, dispositions, verified receipts, and tracker records", () => {
  const r = run();
  assert.equal(r.complete, true, JSON.stringify(r.blockers));
  assert.deepEqual(r.counts, {
    inventoryFiles: 4, uniqueSourceFiles: 3, duplicateFiles: 1, priorityMissingSha: 0,
    explicitlyClassified: 3, missingDisposition: 0,
    questionSources: 1, nonInstalledQuestionSources: 0,
    detectedQuestions: 2, readyQuestions: 2, reviewQuestions: 0, verifiedReadyQuestions: 2,
    expectedBaselineTrackerActivities: 2, reportedTrackerActivities: 2,
    installedTrackerActivities: 2, cloudReceiptSources: 1,
    pdfJobsRecorded: 1, pdfJobsInQueue: 1, pdfVolumeUnmounted: 0,
    pdfPathsMissing: 0, pdfLowText: 0, pdfReaderFailures: 0,
    pdfDeferredSources: 0, pdfNoQuestionIndicators: 0,
    pdfScopeConflictReviewRows: 0, pdfScopeChangedReviewRows: 0,
    pdfScopeReviewFlaggedOther: 0, pdfUnverifiedCurrentAvailability: 0,
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
  const r = run({ receipts: { sources: [receipt({ bankReadbackVerified: false })] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.blockers.some(s => s.includes("lacks verified question-bank cloud readback")));
});

test("bank readback remains valid while local-only originals stay explicitly unverified", () => {
  const local = run({ receipts: { sources: [receipt({ originalFileStatus: "local-only" })] } });
  assert.equal(local.complete, true, JSON.stringify(local.errors));
  const falseOriginalClaim = run({ receipts: { sources: [receipt({
    originalFileStatus: "local-only", originalReadbackVerified: true,
  })] } });
  assert.equal(falseOriginalClaim.complete, false);
  assert.ok(falseOriginalClaim.errors.some(message => message.includes("contradicts its original-file readback status")));
});

test("legacy ambiguous readback receipts cannot certify a cloud installation", () => {
  const r = run({ receipts: { sources: [{
    sha256: a, questionCount: 2, readbackVerified: true, ownerAuthenticated: true,
    figureReadbackVerified: true, figureReferences: 0,
  }] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.blockers.some(message => message.includes("question-bank cloud readback")));
  assert.ok(r.errors.some(message => message.includes("original-file status")));
});

test("count mismatch between review and cloud persistence is an error", () => {
  const r = run({ receipts: { sources: [receipt({ questionCount: 1 })] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.errors.some(s => s.includes("Ready/stored mismatch")));
});

test("cloud receipt must declare a nonnegative review count", () => {
  const missing = receipt();
  delete missing.reviewCount;
  let r = run({ receipts: { sources: [missing] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.errors.some(s => s.includes("Invalid stored reviewCount")));
  assert.ok(r.errors.some(s => s.includes("Review/stored mismatch")));
  r = run({ receipts: { sources: [receipt({ reviewCount: -1 })] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.errors.some(s => s.includes("Invalid stored reviewCount")));
});

test("cloud receipt review count must equal the source disposition", () => {
  const d = dispositions();
  d.sources[0].questionCount = 3;
  d.sources[0].reviewCount = 1;
  const r = run({
    dispositions: d,
    receipts: { sources: [receipt({ reviewCount: 0 })] },
  });
  assert.equal(r.complete, false);
  assert.equal(r.counts.verifiedReadyQuestions, 0);
  assert.ok(r.errors.some(s => s.includes("Review/stored mismatch") && s.includes("1 review, 0 stored")));
});

test("template omission blocks completion even if all questions are verified", () => {
  const t = tracker();
  t.activities.pop();
  const r = run({ tracker: t });
  assert.equal(r.complete, false);
  assert.ok(r.blockers.some(s => s.includes("has 1 unique activities")));
});

test("Tracker reconciliation rejects extra installed activity identities beyond the explicit template census", () => {
  const expanded = tracker();
  expanded.activities.push({
    activityId: "FTM1:foreign", term: "T2", module: "Other", week: 1,
    weekBasis: "explicit", installed: true,
  });
  const result = run({ tracker: expanded });
  assert.equal(result.counts.expectedBaselineTrackerActivities, 2);
  assert.equal(result.counts.reportedTrackerActivities, 3);
  assert.equal(result.complete, false, "Unexpected installed activities cannot certify exact source coverage.");
  assert.ok(result.blockers.some(message =>
    message.includes("Tracker ledger has 3 unique activities") && message.includes("baseline templates have 2")));
});

test("source-declared Tracker module/term scope holds foreign substitutions at an otherwise matching total", () => {
  const inventory = fixture();
  inventory.summary.templates = [{ term: "T1", module: "FTM 1", items: 2 }];
  assert.equal(run({ inventory }).complete, true, "Unchanged explicit source scope remains accepted.");

  for (const [label, override] of [
    ["foreign module", { module: "Other" }],
    ["foreign term", { term: "T2" }],
  ]) {
    const altered = tracker();
    altered.activities[1] = { ...altered.activities[1], ...override };
    const result = run({ inventory, tracker: altered });
    assert.equal(result.counts.reportedTrackerActivities, 2, label);
    assert.equal(result.complete, false, label);
    assert.ok(result.blockers.some(message =>
      message.includes("FTM 1") && message.includes("1/2")), JSON.stringify(result.blockers));
  }

  // Multiple source templates may intentionally contribute activities to one scope.
  const grouped = fixture();
  grouped.summary.templates = [
    { term: "T1", module: "FTM 1", items: 1 },
    { term: "T1", module: "FTM 1", items: 1 },
  ];
  assert.equal(run({ inventory: grouped }).complete, true, "Declared scope counts aggregate exactly.");

  // A source summary with no term/module evidence cannot fabricate a module mapping.
  const unscoped = fixture();
  unscoped.summary.templates = [{ items: 2 }];
  assert.equal(run({ inventory: unscoped }).complete, true);
});

test("source-declared Tracker weeks reject same-module wrong-week and basis substitutions", () => {
  const inventory = fixture();
  inventory.summary.templates = [
    { term: "T1", module: "FTM 1", week: 2, items: 1 },
    { term: "T1", module: "FTM 1", week: 3, items: 1 },
  ];
  const installed = tracker();
  installed.activities[1] = { ...installed.activities[1], week: 3, weekBasis: "explicit" };
  assert.equal(run({ inventory, tracker: installed }).complete, true,
    "Two explicitly filed source weeks must reconcile to their correct installed cohorts.");

  for (const [label, change] of [
    ["wrong week in same module", { week: 4 }],
    ["inferred instead of explicit filing", { weekBasis: "inferred" }],
    ["unassigned instead of source week", { weekBasis: "unassigned" }],
  ]) {
    const mutated = { activities: installed.activities.map(item => ({ ...item })) };
    Object.assign(mutated.activities[1], change);
    const result = run({ inventory, tracker: mutated });
    assert.equal(result.complete, false, label);
    assert.ok(result.blockers.some(message => message.includes("Tracker source week")
      && message.includes("T1/FTM 1") && message.includes("3")),
      `${label}: ${JSON.stringify(result.blockers)}`);
  }
});

test("Tracker source-week verification preserves repeated contributions and unknown source filing", () => {
  const sameWeek = fixture();
  sameWeek.summary.templates = [
    { term: "T1", module: "FTM 1", week: 2, items: 1 },
    { term: "T1", module: "FTM 1", week: 2, items: 1 },
  ];
  const installed = tracker();
  installed.activities[1] = { ...installed.activities[1], week: 2, weekBasis: "explicit" };
  assert.equal(run({ inventory: sameWeek, tracker: installed }).complete, true,
    "Multiple source templates may contribute to one explicitly documented week.");

  const explicitAndUnassigned = fixture();
  explicitAndUnassigned.summary.templates = [
    { term: "T1", module: "FTM 1", week: 2, items: 1 },
    { term: "T1", module: "FTM 1", week: null, weekBasis: "unassigned", items: 1 },
  ];
  assert.equal(run({ inventory: explicitAndUnassigned, tracker: tracker() }).complete, true,
    "A source-declared unassigned activity must coexist with an explicitly filed week.");
  const wronglyFiled = tracker();
  wronglyFiled.activities[1] = { ...wronglyFiled.activities[1], week: 3, weekBasis: "inferred" };
  const wronglyFiledResult = run({ inventory: explicitAndUnassigned, tracker: wronglyFiled });
  assert.equal(wronglyFiledResult.complete, false,
    "A source-unassigned activity cannot be refiled into an inferred week and still certify coverage.");
  assert.ok(wronglyFiledResult.blockers.some(message => message.includes("source-unassigned")));

  const carriedWeek = tracker();
  carriedWeek.activities[1] = { ...carriedWeek.activities[1], week: 3 };
  const carriedWeekResult = run({ inventory: explicitAndUnassigned, tracker: carriedWeek });
  assert.equal(carriedWeekResult.complete, false,
    "Source-unassigned receipts cannot carry a competing numeric week.");
  assert.ok(carriedWeekResult.blockers.some(message => message.includes("source-unassigned")));

  const partial = fixture();
  partial.summary.templates = [
    { term: "T1", module: "FTM 1", week: 2, items: 1 },
    { term: "T1", module: "FTM 1", items: 1 },
  ];
  const partialResult = run({ inventory: partial, tracker: installed });
  assert.equal(partialResult.complete, false,
    "A partial source-week census must not certify an entire module's week membership.");
  assert.ok(partialResult.blockers.some(message => message.includes("partial source-week")));

  const malformed = fixture();
  malformed.summary.templates = [{ term: "T1", module: "FTM 1", week: "2", items: 2 }];
  const malformedResult = run({ inventory: malformed, tracker: installed });
  assert.equal(malformedResult.complete, false);
  assert.ok(malformedResult.blockers.some(message => message.includes("invalid source-week")));

  const missingExplicit = fixture();
  missingExplicit.summary.templates = [{ term: "T1", module: "FTM 1", weekBasis: "explicit", items: 2 }];
  const missingExplicitResult = run({ inventory: missingExplicit, tracker: installed });
  assert.equal(missingExplicitResult.complete, false,
    "A source marked explicitly week-filed without a week number must not pass.");
  assert.ok(missingExplicitResult.blockers.some(message => message.includes("invalid source-week")));

  const explicitUnknown = fixture();
  explicitUnknown.summary.templates = [{ term: "T1", module: "FTM 1",
    week: null, weekBasis: "unassigned", items: 2 }];
  const fullyUnassigned = tracker();
  fullyUnassigned.activities[0] = { ...fullyUnassigned.activities[0],
    week: null, weekBasis: "unassigned" };
  const explicitUnknownResult = run({ inventory: explicitUnknown, tracker: fullyUnassigned });
  assert.equal(explicitUnknownResult.complete, true,
    "JSON null with an unassigned source basis certifies only genuinely unassigned receipts.");
  const incorrectlyScheduled = run({ inventory: explicitUnknown, tracker: tracker() });
  assert.equal(incorrectlyScheduled.complete, false,
    "A source-declared unassigned cohort cannot silently include explicit week placements.");
  assert.ok(incorrectlyScheduled.blockers.some(message => message.includes("source-unassigned")));

  const explicitNull = fixture();
  explicitNull.summary.templates = [{ term: "T1", module: "FTM 1",
    week: null, weekBasis: "explicit", items: 2 }];
  const explicitNullResult = run({ inventory: explicitNull, tracker: installed });
  assert.equal(explicitNullResult.complete, false);
  assert.ok(explicitNullResult.blockers.some(message => message.includes("invalid source-week")));

  const unassigned = fixture();
  unassigned.summary.templates = [{ term: "T1", module: "FTM 1", items: 2 }];
  const unknownResult = run({ inventory: unassigned, tracker: tracker() });
  assert.equal(unknownResult.complete, true,
    "An unknown source week is not the same as a verified incorrect filing.");
  assert.ok(unknownResult.warnings.some(message => message.includes("week membership")));
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

test("expanded inventory without a verified missing-SHA denominator cannot certify source coverage", () => {
  const manifest = [
    { source_sha256: a, original_path: "one.txt", file_extension: ".txt" },
    { source_sha256: null, original_path: "unhashed-priority.pdf", file_extension: ".pdf" },
  ];
  const evaluate = sourceSummary => reconcileAcademicContent({
    inventory: expandedSourceInventory(manifest, sourceSummary),
    dispositions: { sources: [dispositions().sources[0]] },
    receipts: receipts(), tracker: { activities: [] },
  });

  // The former adapter silently skipped the PDF and fabricated zero unresolved
  // priorities when the paired source summary was missing, yielding complete=true.
  const missing = evaluate(undefined);
  assert.equal(missing.complete, false);
  assert.equal(missing.counts.priorityMissingSha, null);
  assert.ok(missing.blockers.some(x => x.includes("missing-SHA denominator")));

  for (const count of [-1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
    const malformed = evaluate({ file_denominators: {
      eligible_priority_files_with_unresolved_sha: count,
    } });
    assert.equal(malformed.complete, false, `Unverified denominator ${String(count)} must hold.`);
    assert.ok(malformed.blockers.some(x => x.includes("missing-SHA denominator")));
  }

  const paired = evaluate({
    file_denominators: { eligible_priority_files_with_unresolved_sha: 1,
      catalogued_document_and_asset_paths: 2, sha256_hashed_paths: 1,
      distinct_byte_sha256: 1 },
    tracker_denominators: { parsed_activity_rows: 0 },
  });
  assert.equal(paired.complete, false);
  assert.equal(paired.counts.priorityMissingSha, 1);
  assert.ok(paired.blockers.some(x => x.includes("eligible academic sources have no verified SHA-256")));

  // An explicit, internally consistent all-hashed source cohort remains valid.
  const readyInventory = expandedSourceInventory([manifest[0]], {
    file_denominators: { eligible_priority_files_with_unresolved_sha: 0,
      catalogued_document_and_asset_paths: 1, sha256_hashed_paths: 1,
      distinct_byte_sha256: 1 },
    tracker_denominators: { parsed_activity_rows: 0 },
  });
  const ready = reconcileAcademicContent({ inventory: readyInventory,
    dispositions: { sources: [dispositions().sources[0]] },
    receipts: receipts(), tracker: { activities: [] } });
  assert.equal(ready.complete, true, JSON.stringify(ready.blockers));
  assert.equal(ready.counts.priorityMissingSha, 0);
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
  let r = run({ dispositions: d, receipts: { sources: [receipt({ figureReadbackVerified: false })] } });
  assert.equal(r.complete, false);
  assert.equal(r.counts.declaredFigureReferences, 3);
  assert.equal(r.counts.verifiedFigureReferences, 0);
  assert.ok(r.blockers.some(x => x.includes("lacks authenticated image-byte readback")));
  r = run({ dispositions: d, receipts: { sources: [receipt({ figureReferences: 2 })] } });
  assert.equal(r.complete, false);
  assert.ok(r.errors.some(x => x.includes("Figure count mismatch")));
  r = run({ dispositions: d, receipts: { sources: [receipt({ figureReferences: 3 })] } });
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
  const r = run({ receipts: { sources: [receipt({ ownerAuthenticated: undefined })] } });
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
  r = run({ dispositions: d, receipts: { sources: [receipt({ reviewCount: 1 })] } });
  assert.equal(r.complete, true);
});

test("service-role image access cannot count as user-verified figure persistence", () => {
  const d = dispositions();
  d.sources[0].figureReferences = 2;
  const r = run({ dispositions: d, receipts: { sources: [receipt({
    ownerAuthenticated: undefined, figureReferences: 2,
  })] } });
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
  triage.runId = "synthetic-restored-source-run";
  triage.rows[0].availabilityProof = {
    runId: triage.runId, source_sha256: a, checkedAt: triage.runAt,
    authorizedPathAvailable: true,
  };
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

const completePdfTriage = status => {
  const runAt = new Date().toISOString(), runId = "synthetic-verified-batch";
  return {
    schema: "axom-academic-pdf-triage-v1", runAt, runId,
    queueDistinctPdfJobs: 1,
    rows: [{ source_sha256: a, status,
      availabilityProof: { runId, source_sha256: a,
        checkedAt: runAt, authorizedPathAvailable: true } }],
  };
};

test("unrecognized PDF triage status cannot certify physical source coverage", () => {
  for (const status of ["source_ready_ai_reviewed", null, 12]) {
    const result = run({ pdfTriage: completePdfTriage(status) });
    assert.equal(result.complete, false, `Unexpectedly accepted PDF triage status ${String(status)}`);
    assert.ok(result.errors.some(message => message.includes("unknown status")), JSON.stringify(result.errors));
  }
});

test("known academic PDF scope conflict and changed-scope statuses produce review blockers", () => {
  for (const [status, countKey] of [
    ["academic_scope_conflict_review", "pdfScopeConflictReviewRows"],
    ["academic_scope_changed_review", "pdfScopeChangedReviewRows"],
  ]) {
    const triage = completePdfTriage(status);
    triage.rows[0].requires_scope_review = true;
    triage.rows[0].scope_evidence = [
      { source_id: "synthetic-first", source_path: "FTM/first.pdf", term: 1, module: "FTM", week: 2 },
      { source_id: "synthetic-second", source_path: "FTM/second.pdf", term: 2, module: "FTM", week: 2 },
    ];
    const result = run({ pdfTriage: triage });
    assert.equal(result.complete, false, JSON.stringify(result));
    assert.ok(!result.errors.some(message => message.includes("unknown status")), JSON.stringify(result.errors));
    assert.equal(result.counts[countKey], 1, JSON.stringify(result.counts));
    assert.ok(result.blockers.some(message => message.includes("academic scope")), JSON.stringify(result.blockers));
  }
});

test("stale sampled-text PDF readiness with scope review flag cannot certify availability", () => {
  const triage = completePdfTriage("text_with_question_indicators");
  triage.rows[0].requires_scope_review = true;
  const result = run({ pdfTriage: triage });
  assert.equal(result.complete, false, JSON.stringify(result));
  assert.equal(result.counts.pdfScopeReviewFlaggedOther, 1);
  assert.ok(result.blockers.some(message => message.includes("academic scope")), JSON.stringify(result.blockers));
});

test("PDFs deferred by size or encrypted content remain explicitly held", () => {
  for (const status of ["size_limit_deferred", "encrypted_pdf_review"]) {
    const result = run({ pdfTriage: completePdfTriage(status) });
    assert.equal(result.complete, false, `Unexpectedly accepted ${status}`);
    assert.equal(result.counts.pdfDeferredSources, 1);
    assert.ok(result.blockers.some(message => message.includes("deferred or encrypted")), JSON.stringify(result.blockers));
  }
});

test("PDF question jobs without sampled question indicators require review before release", () => {
  const result = run({ pdfTriage: completePdfTriage("text_without_question_indicators") });
  assert.equal(result.complete, false);
  assert.equal(result.counts.pdfNoQuestionIndicators, 1);
  assert.ok(result.blockers.some(message => message.includes("no sampled question indicators")));
});

test("PDF triage positive control retains supported scanned-text coverage", () => {
  const result = run({ pdfTriage: completePdfTriage("text_with_question_indicators") });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.counts.pdfDeferredSources, 0);
  assert.equal(result.counts.pdfNoQuestionIndicators, 0);
});

test("malformed PDF triage rows produce release errors without crashing reconciliation", () => {
  for (const invalidRow of [null, "invalid", {}, { source_sha256: a }]) {
    const triage = completePdfTriage("text_with_question_indicators");
    triage.rows = [invalidRow];
    assert.doesNotThrow(() => run({ pdfTriage: triage }));
    const result = run({ pdfTriage: triage });
    assert.equal(result.complete, false);
    assert.ok(result.errors.some(message => message.includes("source fingerprint") || message.includes("unknown status")));
  }
});

test("per-source availability proof blocks a stale carried-forward ready PDF despite a fresh report timestamp", () => {
  const triage = completePdfTriage("text_with_question_indicators");
  triage.runId = "synthetic-current-run";
  triage.rows[0].availabilityProof = {
    runId: "synthetic-previous-run", source_sha256: a,
    checkedAt: new Date().toISOString(), authorizedPathAvailable: true,
  };
  const result = run({ pdfTriage: triage });
  assert.equal(result.complete, false, "Prior-batch availability must not certify a new incremental run.");
  assert.equal(result.counts.pdfUnverifiedCurrentAvailability, 1);
  assert.ok(result.blockers.some(message => message.includes("per-source availability")), JSON.stringify(result.blockers));
});

test("a new runAt alone cannot renew an uninspected PDF source row", () => {
  const triage = completePdfTriage("text_with_question_indicators");
  triage.runId = "synthetic-new-run";
  delete triage.rows[0].availabilityProof;
  const result = run({ pdfTriage: triage });
  assert.equal(result.complete, false);
  assert.equal(result.counts.pdfUnverifiedCurrentAvailability, 1);
});

test("per-source authorization evidence must bind the correct SHA, run, timestamp and access", () => {
  const triage = completePdfTriage("text_with_question_indicators");
  triage.runId = "synthetic-current-run";
  const now = new Date().toISOString();
  triage.rows[0].availabilityProof = {
    runId: triage.runId, source_sha256: a, checkedAt: now, authorizedPathAvailable: true,
  };
  assert.equal(run({ pdfTriage: triage }).complete, true);

  const variants = [
    { source_sha256: b }, { runId: "synthetic-old-run" },
    { authorizedPathAvailable: false }, { checkedAt: "not-a-timestamp" },
    { checkedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
    { checkedAt: new Date(Date.now() + 11 * 60_000).toISOString() },
  ];
  for (const mutation of variants) {
    const faulty = { ...triage, rows: [{ ...triage.rows[0],
      availabilityProof: { ...triage.rows[0].availabilityProof, ...mutation } }] };
    const result = run({ pdfTriage: faulty });
    assert.equal(result.complete, false, JSON.stringify(mutation));
    assert.ok(result.blockers.some(message => message.includes("per-source availability")), JSON.stringify(result));
  }
});

test("R20 RED: PDF question-source coverage cannot be certified when its triage ledger is omitted", () => {
  const result = run({ pdfTriage: undefined });
  assert.equal(result.complete, false,
    "Cloud question receipts do not prove the original PDF is currently accessible.");
  assert.ok(result.blockers.some(message => message.includes("PDF question-source") && message.includes("availability")),
    JSON.stringify(result.blockers));

  const nonPdfInventory = fixture();
  nonPdfInventory.entries[0] = { ...nonPdfInventory.entries[0],
    path: "sources/IMCQ-1.txt", extension: "txt" };
  nonPdfInventory.entries[1] = { ...nonPdfInventory.entries[1],
    path: "sources/IMCQ-1-copy.txt", extension: "txt", duplicateOf: "sources/IMCQ-1.txt" };
  const nonPdf = run({ inventory: nonPdfInventory, pdfTriage: undefined });
  assert.equal(nonPdf.complete, true,
    "Pure non-PDF source sets must not require a PDF availability ledger.");
});

test("R20 RED: unrelated present PDF triage SHA cannot substitute for the actual question source", () => {
  const triage = completePdfTriage("text_with_question_indicators");
  triage.rows = [{ ...triage.rows[0], source_sha256: b,
    availabilityProof: { ...triage.rows[0].availabilityProof, source_sha256: b } }];
  // SHA 'b' is in the inventory as a text Course Tracker template, not the PDF question original 'a'.
  const result = run({ pdfTriage: triage });
  assert.equal(result.complete, false,
    "Matching row and queue denominators do not establish coverage of the PDF question-source SHA.");
  assert.ok(result.blockers.some(message => message.includes("PDF question-source") && message.includes("missing")),
    JSON.stringify(result.blockers));
});

test("R20: PDF aliases sharing a canonical question SHA still require explicit PDF proof", () => {
  const inventory = fixture();
  inventory.entries[0] = { ...inventory.entries[0],
    path: "sources/IMCQ-1.bin", extension: "bin" };
  inventory.entries[1] = { ...inventory.entries[1],
    duplicateOf: "sources/IMCQ-1.bin" };
  const withoutTriage = run({ inventory, pdfTriage: undefined });
  assert.equal(withoutTriage.complete, false,
    "A PDF duplicate alias must not be hidden by a non-PDF canonical path.");
  assert.ok(withoutTriage.blockers.some(message => message.includes("PDF question-source")),
    JSON.stringify(withoutTriage.blockers));
  const withTriage = run({ inventory,
    pdfTriage: completePdfTriage("text_with_question_indicators") });
  assert.equal(withTriage.complete, true,
    "The exact source SHA and current-run proof should still certify this synthetic alias.");
});


test("expanded JSONL rejects malformed ledger containers and malformed rows without throwing", () => {
  const sourceSummary = {
    file_denominators: {
      eligible_priority_files_with_unresolved_sha: 0,
      catalogued_document_and_asset_paths: 0,
      sha256_hashed_paths: 0,
      distinct_byte_sha256: 0,
    },
    tracker_denominators: { parsed_activity_rows: 0 },
  };
  const check = rows => {
    const inventory = expandedSourceInventory(rows, sourceSummary);
    return reconcileAcademicContent({
      inventory, dispositions: { sources: [] }, receipts: { sources: [] },
      tracker: { activities: [] },
    });
  };
  const baseline = check([]);
  assert.equal(baseline.complete, true, JSON.stringify(baseline));
  for (const [label, malformed] of [
    ["null ledger", null], ["object ledger", {}], ["string ledger", "oops"],
    ["null row", [null]], ["boolean row", [false]], ["array row", [[]]],
    ["string row", ["invalid"]],
  ]) {
    let result;
    assert.doesNotThrow(() => { result = check(malformed); }, label);
    assert.equal(result.complete, false, `${label} must not certify source coverage`);
    assert.ok(result.errors.some(message => message.includes("malformed expanded source manifest")),
      `${label} must be diagnosed explicitly: ${JSON.stringify(result)}`);
  }
});

test("expanded JSONL malformed row cannot disappear beside a valid SHA source", () => {
  const sourceSummary = {
    file_denominators: {
      eligible_priority_files_with_unresolved_sha: 0,
      catalogued_document_and_asset_paths: 2,
      sha256_hashed_paths: 1,
      distinct_byte_sha256: 1,
    },
    tracker_denominators: { parsed_activity_rows: 0 },
  };
  const validRow = { source_sha256: a, original_path: "sources/known.txt", file_extension: "txt" };
  const receipt = rows => reconcileAcademicContent({
    inventory: expandedSourceInventory(rows, sourceSummary),
    dispositions: { sources: [{ sha256: a, kind: "reference", status: "excluded",
      reason: "synthetic non-question source" }] },
    receipts: { sources: [] }, tracker: { activities: [] },
  });
  const legitimateUnhashedReference = receipt([validRow, { original_path: "refs/unsigned.txt" }]);
  assert.equal(legitimateUnhashedReference.complete, true,
    "An explicitly non-priority unhashed reference must remain supported.");
  for (const row of [null, false, "bad", []]) {
    let result;
    assert.doesNotThrow(() => { result = receipt([validRow, row]); });
    assert.equal(result.complete, false, "Structurally invalid rows cannot be silently skipped.");
    assert.ok(result.errors.some(message => message.includes("malformed expanded source manifest")),
      JSON.stringify(result.errors));
  }
});

// R35: an unassigned Tracker receipt cannot simultaneously claim a numbered
// week, and any present week must be a nonnegative integer. Unknown source
// filing is preserved; this validates receipt shape, not invented source weeks.
test("Tracker receipts reject contradictory unassigned weeks and malformed week values", () => {
  const original = run();
  assert.equal(original.complete, true, JSON.stringify(original));
  for (const [label, changes, expectedMessage] of [
    ["unassigned positive week", { weekBasis: "unassigned", week: 3 }, "unassigned receipt claims a week"],
    ["unassigned zero week", { weekBasis: "unassigned", week: 0 }, "unassigned receipt claims a week"],
    ["unassigned negative week", { weekBasis: "unassigned", week: -1 }, "invalid week"],
    ["inferred string week", { weekBasis: "inferred", week: "3" }, "invalid week"],
    ["inferred fractional week", { weekBasis: "inferred", week: 2.5 }, "invalid week"],
    ["inferred negative week", { weekBasis: "inferred", week: -1 }, "invalid week"],
  ]) {
    const changed = tracker();
    Object.assign(changed.activities[1], changes);
    const report = run({ tracker: changed });
    assert.equal(report.complete, false, `${label} must fail closed: ${JSON.stringify(report)}`);
    assert.ok(report.errors.some(message => message.includes(expectedMessage)),
      `${label} has no explicit week-shape error: ${JSON.stringify(report.errors)}`);
  }
  for (const changes of [
    { weekBasis: "unassigned" },
    { weekBasis: "unassigned", week: null },
    { weekBasis: "inferred", week: 3 },
    { weekBasis: "explicit", week: 3 },
  ]) {
    const changed = tracker();
    Object.assign(changed.activities[1], changes);
    assert.equal(run({ tracker: changed }).complete, true,
      `valid Tracker week receipt rejected: ${JSON.stringify(changes)}`);
  }
});
// R36: an inferred week is still a concrete numeric placement, not an alias
// for source-unassigned/unknown. The source template has no authority to
// fabricate it, but the receipt cannot certify a nonexistent inferred week.
test("Tracker inferred-week receipts require an actual numeric week", () => {
  assert.equal(run().complete, true, "Baseline source-unassigned receipt remains valid.");
  for (const [label, edits] of [
    ["missing", {}],
    ["null", { week: null }],
  ]) {
    const changed = tracker();
    changed.activities[1].weekBasis = "inferred";
    delete changed.activities[1].week;
    Object.assign(changed.activities[1], edits);
    const report = run({ tracker: changed });
    assert.equal(report.complete, false, `Inferred ${label} week cannot satisfy Tracker coverage.`);
    assert.ok(report.errors.some(message => message.includes("Inferred tracker week is missing")),
      `Missing explicit inferred-week error: ${JSON.stringify(report.errors)}`);
  }
  for (const [basis, week] of [["inferred", 3], ["explicit", 3], ["unassigned", null]]) {
    const changed = tracker();
    changed.activities[1].weekBasis = basis;
    changed.activities[1].week = week;
    assert.equal(run({ tracker: changed }).complete, true,
      `Legitimate ${basis} week filing should retain its prior semantics.`);
  }
});


test("expanded JSONL rejects malformed present SHA without inventing priority-missing counts", () => {
  const sourceSummary = {
    file_denominators: {
      catalogued_document_and_asset_paths: 1,
      sha256_hashed_paths: 0,
      distinct_byte_sha256: 0,
      eligible_priority_files_with_unresolved_sha: 0,
    },
    tracker_denominators: { parsed_activity_rows: 0 },
  };
  const reference = { original_path: "synthetic/unhashed-reference.txt", file_extension: ".txt" };
  const reconcile = source_sha256 => {
    const inventory = expandedSourceInventory([{ ...reference, source_sha256 }], sourceSummary);
    const report = reconcileAcademicContent({
      inventory, dispositions: { sources: [] }, receipts: { sources: [] }, tracker: { activities: [] },
    });
    return { inventory, report };
  };
  // A present but invalid digest is a corrupted producer receipt, not an
  // intentionally un-hashed reference. The source census may otherwise match.
  for (const invalid of ["bad-sha", "A".repeat(64), " ", 42, true, [], {}]) {
    const { inventory, report } = reconcile(invalid);
    assert.equal(inventory.invalidManifestRows, 1, `Malformed SHA ${String(invalid)} must be counted.`);
    assert.equal(report.complete, false, `Malformed SHA ${String(invalid)} must not certify coverage.`);
    assert.ok(report.errors.some(message => message.includes("malformed expanded source manifest")),
      `Missing sanitized error for ${String(invalid)}: ${JSON.stringify(report.errors)}`);
  }
  // Canonical source-ledger.py uses null for intentionally deferred references.
  for (const absent of [null, undefined, ""]) {
    const { inventory, report } = reconcile(absent);
    assert.equal(inventory.invalidManifestRows, 0);
    assert.equal(report.complete, true, JSON.stringify(report));
  }
});


// R39: strict convergence must prove original Tracker IDs, not merely cohorts.
const identityProof = () => {
  const source = {
    schema: "axom-academic-tracker-source-membership-v1",
    expectedActivityCount: 2, originalReadbackVerified: true,
    activities: tracker().activities.map(row => ({
      activityId: row.activityId, sourceSha256: b, term: row.term, module: row.module,
      weekBasis: row.weekBasis, ...(row.week !== undefined ? { week: row.week } : {}),
    })),
  };
  const readback = {
    schema: "axom-academic-tracker-installed-readback-v1",
    reportedActivityCount: 2, ownerAuthenticated: true, cloudReadbackVerified: true,
    observedAt: new Date().toISOString(),
    activities: source.activities.map(row => ({ ...row, installed: true })),
  };
  return { trackerSourceMembership: source, trackerInstalledReadback: readback };
};

test("strict reconciliation holds same-count Tracker coverage until original-ID and cloud proof both arrive", () => {
  const result = run({ requireTrackerIdentity: true });
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some(x => x.includes("Tracker activity identity")));
  assert.equal(result.counts.trackerIdentityVerified, false);
});

test("strict reconciliation accepts separately attested exact original and installed IDs", () => {
  const result = run({ requireTrackerIdentity: true, ...identityProof() });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.counts.trackerIdentityVerified, true);
  assert.equal(result.counts.trackerIdentityDeclared, 2);
  assert.equal(result.counts.trackerIdentityReadback, 2);
  assert.ok(result.warnings.some(x => x.includes("attestation")));
});

test("R43 RED: strict reconciliation rejects same-ID Tracker row bound to a different original SHA", () => {
  const pair = identityProof();
  const observed = tracker();
  observed.activities[0].sourceSha256 = c;
  const result = run({ tracker: observed, requireTrackerIdentity: true, ...pair });
  assert.equal(result.complete, false, JSON.stringify(result));
  assert.equal(result.counts.trackerIdentityVerified, false);
  assert.ok(result.blockers.some(message => message.includes("Tracker readback does not match")));
  assert.ok(!JSON.stringify(result).includes(c), "Private source hash must not appear in diagnostics.");
  assert.ok(!JSON.stringify(result).includes("FTM1:L1"), "Private canonical ID must not appear in diagnostics.");
});

test("R43 RED: absent or coercible Tracker-row fingerprints cannot borrow an independent readback SHA", () => {
  for (const changed of [undefined, null, [b], "wrong-source", b.toUpperCase()]) {
    const pair = identityProof();
    const observed = tracker();
    observed.activities[1].sourceSha256 = changed;
    const result = run({ tracker: observed, requireTrackerIdentity: true, ...pair });
    assert.equal(result.complete, false, "Invalid/missing independent Tracker row SHA was accepted: " + typeof changed);
    assert.equal(result.counts.trackerIdentityVerified, false);
    assert.ok(result.blockers.some(message => message.includes("Tracker readback does not match")));
  }
});

test("same-week foreign activity substitution fails with unchanged activity and scope counts", () => {
  const pair = identityProof();
  pair.trackerInstalledReadback.activities[1].activityId = "SYNTHETIC-FOREIGN-SAME-WEEK";
  const result = run({ requireTrackerIdentity: true, ...pair });
  assert.equal(result.counts.reportedTrackerActivities, 2);
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some(x => x.includes("Tracker activity identity")));
  assert.equal(JSON.stringify(result).includes("SYNTHETIC-FOREIGN-SAME-WEEK"), false);
});

test("stale or non-owner readback and changed source SHA fail strict reconciliation", () => {
  for (const mutate of [
    pair => { pair.trackerInstalledReadback.ownerAuthenticated = false; },
    pair => { pair.trackerInstalledReadback.observedAt = "2024-01-01T00:00:00Z"; },
    pair => { pair.trackerInstalledReadback.activities[0].sourceSha256 = c; },
    pair => { pair.trackerSourceMembership.originalReadbackVerified = false; },
  ]) {
    const pair = identityProof();
    mutate(pair);
    const result = run({ requireTrackerIdentity: true, ...pair });
    assert.equal(result.complete, false, JSON.stringify(result));
    assert.equal(result.counts.trackerIdentityVerified, false);
  }
});

test("proof ledgers must match the actual Tracker reconciliation cohort, not another valid installation", () => {
  const pair = identityProof();
  const different = tracker();
  different.activities[1].activityId = "SYNTHETIC-ALTERNATE-ID";
  const result = run({ requireTrackerIdentity: true, tracker: different, ...pair });
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some(x => x.includes("Tracker readback does not match")));
  assert.equal(JSON.stringify(result).includes("SYNTHETIC-ALTERNATE-ID"), false);
});

test("one-sided optional proof fails closed; a truly empty explicit Tracker scope needs no fabricated IDs", () => {
  const pair = identityProof();
  const incomplete = run({ trackerSourceMembership: pair.trackerSourceMembership });
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.blockers.some(x => x.includes("Tracker activity identity")));
  const empty = fixture();
  empty.summary.templates = [];
  const zero = run({ inventory: empty, tracker: { activities: [] }, requireTrackerIdentity: true });
  assert.equal(zero.complete, true, JSON.stringify(zero));
  assert.equal(zero.counts.trackerIdentityVerified, true);
});


test("one-based source weeks reject Week 0 without inventing a numbered curriculum placement", () => {
  const source = fixture();
  source.summary.templates = [{ term: "T1", module: "FTM 1", week: 0, items: 2 }];
  const installed = tracker();
  for (const row of installed.activities) { row.weekBasis = "explicit"; row.week = 0; }
  const invalid = run({ inventory: source, tracker: installed });
  assert.equal(invalid.complete, false, "Matching Week 0 cohorts cannot certify a source-stated week.");
  assert.ok(invalid.blockers.some(message => message.includes("invalid source-week"))
    || invalid.errors.some(message => message.includes("invalid week")), JSON.stringify(invalid));

  const inferred = tracker();
  inferred.activities[0].weekBasis = "inferred";
  inferred.activities[0].week = 0;
  const inferredResult = run({ tracker: inferred });
  assert.equal(inferredResult.complete, false, "Week 0 is not a valid inferred week.");
  assert.ok(inferredResult.errors.some(message => message.includes("week")), JSON.stringify(inferredResult));

  for (const week of [1, 60]) {
    const declared = fixture();
    declared.summary.templates = [{ term: "T1", module: "FTM 1", week, items: 2 }];
    const actual = tracker();
    for (const row of actual.activities) { row.weekBasis = "explicit"; row.week = week; }
    const valid = run({ inventory: declared, tracker: actual });
    assert.equal(valid.complete, true, `Source Week ${week} must remain valid: ${JSON.stringify(valid)}`);
  }
  assert.equal(run().complete, true, "Unassigned unknown weeks must remain supported.");
});

test("sanitized academic report never serializes private source paths, tracker IDs or free-text review reasons", () => {
  const secret = "PRIVATE_R41_DO_NOT_EMIT";
  const cases = [
    ["malformed source path", () => {
      const inventory = fixture();
      inventory.entries[0] = { ...inventory.entries[0], path: secret + "/source.pdf", sha256: "bad" };
      return run({ inventory });
    }],
    ["unclassified source sample", () => {
      const inventory = fixture();
      inventory.entries[0] = { ...inventory.entries[0], path: secret + "/unclassified.pdf", sha256: "d".repeat(64) };
      return run({ inventory });
    }],
    ["broken duplicate alias", () => {
      const inventory = fixture();
      inventory.entries[1] = { ...inventory.entries[1], path: secret + "/duplicate.pdf", duplicateOf: "wrong-canonical" };
      return run({ inventory });
    }],
    ["pending source reason", () => {
      const held = dispositions();
      held.sources[0] = { ...held.sources[0], status: "review-required", reason: secret + " reviewer note" };
      return run({ dispositions: held });
    }],
    ["unknown source kind", () => {
      const held = dispositions();
      held.sources[0] = { ...held.sources[0], kind: secret };
      return run({ dispositions: held });
    }],
    ["unknown source status", () => {
      const held = dispositions();
      held.sources[0] = { ...held.sources[0], status: secret };
      return run({ dispositions: held });
    }],
    ["tracker duplicate and invalid week", () => {
      const installed = tracker();
      installed.activities[0] = { ...installed.activities[0], activityId: secret, week: 0, installed: false };
      installed.activities[1] = { ...installed.activities[1], activityId: secret, week: 5 };
      return run({ tracker: installed });
    }],
  ];
  for (const [label, make] of cases) {
    const report = make();
    assert.equal(report.complete, false, label);
    assert.equal(JSON.stringify(report).includes(secret), false,
      label + " leaked a private input in a supposedly sanitized report.");
  }
});

test("academic report preserves actionable counts and opaque source fingerprints after redaction", () => {
  const inventory = fixture();
  inventory.entries[0] = { ...inventory.entries[0], path: "/private/study/original.pdf", sha256: "d".repeat(64) };
  const result = run({ inventory });
  assert.equal(result.complete, false);
  assert.equal(result.counts.missingDisposition, 1);
  assert.ok(result.samples.unclassifiedFiles.every(value => typeof value === "string"));
  assert.ok(result.samples.unclassifiedFiles.some(value => value.includes("d".repeat(12))),
    "Gap report should retain a stable opaque checksum prefix for triage.");
  assert.equal(JSON.stringify(result).includes("/private/study/"), false);
});

test("producer SHA evidence requires a literal string, never coercible arrays", () => {
  const inventory = fixture();
  inventory.entries[0].sha256 = [a]; // RegExp.test coerces this into a valid-looking SHA.
  const sourceResult = run({ inventory });
  assert.equal(sourceResult.complete, false);
  assert.ok(sourceResult.errors.some(message => message.includes("Invalid source checksum at inventory row 0")),
    "A source checksum array must be explicitly rejected rather than admitted as a hash.");

  const pdfTriage = completePdfTriage("text_with_question_indicators");
  pdfTriage.rows[0].source_sha256 = [a];
  const pdfResult = run({ pdfTriage });
  assert.equal(pdfResult.complete, false);
  assert.ok(pdfResult.errors.some(message => message.includes("missing or repeated source fingerprint")),
    "A PDF receipt array must not pass digest type validation through RegExp coercion.");
});

test("malformed source census and production counts cannot echo arbitrary producer strings", () => {
  const secret = "PRIVATE_R41_UNTRUSTED_COUNT";
  for (const mutate of [
    i => { i.summary.files = secret; },
    i => { i.summary.uniqueFiles = secret; },
    i => { i.summary.duplicateFiles = secret; },
    i => { i.cataloguedPaths = secret; },
    i => { i.expectedHashedPaths = secret; },
    i => { i.expectedDistinctHashes = secret; },
  ]) {
    const inventory = fixture();
    mutate(inventory);
    const report = run({ inventory });
    assert.equal(report.complete, false);
    assert.equal(JSON.stringify(report).includes(secret), false,
      "Unverified denominators must be represented as invalid rather than echoed.");
  }
  const production = {
    projectId: "jofkmfwkidubxcutkwzf", observedAt: new Date().toISOString(),
    academicCollections: secret, academicRevisions: 2, academicFiles: 0, storageObjects: 0,
  };
  const report = run({ production });
  assert.equal(report.complete, false);
  assert.equal(JSON.stringify(report).includes(secret), false,
    "A malformed production statistic must not escape in report counts.");
  assert.equal(report.counts.productionAcademicCollections, null);
});

test("academic producer timestamps require explicit timezone and actual calendar dates", () => {
  const now = new Date().toISOString();
  const invalid = [
    [now], now.replace("Z", ""), "2026-02-30T12:00:00Z",
    "2026-11-12 02:30:00Z", "11/12/2026 02:30:00",
  ];
  const productionBase = { projectId: "jofkmfwkidubxcutkwzf",
    academicCollections: 1, academicRevisions: 1, academicFiles: 1, storageObjects: 1 };
  for (const malformed of invalid) {
    const production = run({ production: { ...productionBase, observedAt: malformed } });
    assert.ok(production.errors.some(message => message.includes("observation timestamp")),
      "Malformed production time must be a schema error: " + JSON.stringify(malformed));

    const triage = completePdfTriage("text_with_question_indicators");
    triage.runAt = malformed;
    const invalidRun = run({ pdfTriage: triage });
    assert.ok(invalidRun.errors.some(message => message.includes("no timestamp")),
      "Malformed PDF run time must be a schema error: " + JSON.stringify(malformed));

    const ready = completePdfTriage("text_with_question_indicators");
    ready.rows[0].availabilityProof.checkedAt = malformed;
    const invalidProof = run({ pdfTriage: ready });
    assert.equal(invalidProof.counts.pdfUnverifiedCurrentAvailability, 1,
      "Malformed per-original time must not prove current source availability: " + JSON.stringify(malformed));

    const b4 = run({ corpusAudit: canonicalB4Audit({ generatedAt: malformed }) });
    assert.ok(b4.errors.some(message => message.includes("Canonical B4 acceptance schema")),
      "Malformed B4 audit time must be rejected: " + JSON.stringify(malformed));
  }

  const offset = now.replace("Z", "+00:00");
  const ready = completePdfTriage("text_with_question_indicators");
  ready.runAt = offset;
  ready.rows[0].availabilityProof.checkedAt = offset;
  assert.equal(run({ pdfTriage: ready }).complete, true, "Explicit-offset PDF proof remains valid.");
  assert.equal(run({ production: { ...productionBase, observedAt: offset } }).complete, true,
    "Explicit-offset current production readback remains valid.");
  assert.equal(run({ corpusAudit: canonicalB4Audit({ generatedAt: offset }) }).complete, true,
    "Explicit-offset B4 source audit remains valid.");
});
