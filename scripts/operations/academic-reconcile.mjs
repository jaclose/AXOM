/**
 * AXOM academic convergence gate.
 *
 * Reads provenance from the source inventory and optional role-produced
 * reconciliation ledgers. No app/account connection, source bytes, or uploads.
 * An omitted/unverified ledger is a blocker, never a green completion signal.
 *
 * node scripts/operations/academic-reconcile.mjs
 * node scripts/operations/academic-reconcile.mjs --dispositions artifacts/.../dispositions.json --receipts artifacts/.../readback-receipts.json --tracker artifacts/.../tracker-receipts.json --strict
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const supportedKinds = new Set(["question-source", "answer-key", "course-template", "reference", "asset", "other", "excluded"]);
const supportedStates = new Set(["installed", "review-required", "prepared", "unsupported", "excluded", "missing-source"]);
const originalFileStates = new Set(["cloud-verified", "local-only", "not-provided"]);
// Keep this enumeration aligned with academic-pdf-triage.mjs. Unknown producer
// statuses must never silently certify the original-source availability gate.
const pdfAvailabilityStatuses = new Set([
  "text_with_question_indicators", "text_without_question_indicators", "low_text_scan_or_figures",
  "source_path_unavailable", "source_volume_unmounted", "size_limit_deferred",
  "reader_failure_needs_review", "encrypted_pdf_review", "pdfinfo_unreadable",
  // Canonical PDF triage deliberately holds conflicting or changed source filings.
  "academic_scope_conflict_review", "academic_scope_changed_review",
]);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sample = (array, max = 12) => array.slice(0, max);

function indexUnique(list, key, errors, label) {
  const indexed = new Map();
  // Malformed producer ledgers are coverage holds, not uncaught exceptions.
  for (const item of Array.isArray(list) ? list : []) {
    const id = item?.[key];
    if (typeof id !== "string" || !id.trim()) { errors.push(`${label} entry lacks ${key}`); continue; }
    if (indexed.has(id)) errors.push(`Duplicate ${label} identity: ${id}`);
    else indexed.set(id, item);
  }
  return indexed;
}

/**
 * Adapt Agent 1's expanded JSONL (which intentionally doesn't hash oversized
 * unrelated/lecture references) without treating unhashed entries as verified.
 * Every *eligible priority* missing SHA remains a release blocker.
 */
export function expandedSourceInventory(manifestRows, sourceSummary) {
  const counted = new Map(), entries = [];
  for (const row of manifestRows) {
    if (!SHA256.test(row.source_sha256 ?? "")) continue;
    const path = row.original_path ?? row.relative_path ?? row.source_id ?? "(unnamed)";
    const original = counted.get(row.source_sha256);
    entries.push({ path, sha256: row.source_sha256, extension: row.file_extension,
      ...(original ? { duplicateOf: original } : {}) });
    if (!original) counted.set(row.source_sha256, path);
  }
  return {
    summary: {
      files: entries.length, uniqueFiles: counted.size,
      duplicateFiles: entries.length - counted.size,
      // An absent tracker summary is unknown coverage, never a verified zero.
      templates: [{ items: sourceSummary?.tracker_denominators?.parsed_activity_rows }],
    },
    priorityMissingSha: integer(sourceSummary?.file_denominators?.eligible_priority_files_with_unresolved_sha)
      ? sourceSummary.file_denominators.eligible_priority_files_with_unresolved_sha : null,
    // Expanded JSONL must carry an independently declared cohort census.
    // Unknown totals cannot be inferred from the filtered manifest rows.
    cataloguedPaths: sourceSummary?.file_denominators?.catalogued_document_and_asset_paths ?? null,
    expectedHashedPaths: sourceSummary?.file_denominators?.sha256_hashed_paths ?? null,
    expectedDistinctHashes: sourceSummary?.file_denominators?.distinct_byte_sha256 ?? null,
    entries,
  };
}

export function reconcileAcademicContent({ inventory, dispositions, receipts, tracker, production, pdfTriage, corpusAudit }) {
  const errors = [], blockers = [], warnings = [];
  if (!inventory || !Array.isArray(inventory.entries) || !inventory.summary) {
    return { complete: false, errors: ["Source inventory has no entries and summary."], blockers: [], warnings: [], counts: {} };
  }
  const byHash = new Map(), duplicateRecords = [];
  for (const [index, file] of inventory.entries.entries()) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      errors.push(`Invalid source inventory row at index ${index}; require an object with a canonical source checksum.`);
      continue;
    }
    if (!SHA256.test(file.sha256 ?? "")) { errors.push(`Invalid source checksum: ${file.path ?? "(unnamed)"}`); continue; }
    if (file.duplicateOf) { duplicateRecords.push(file); continue; }
    if (byHash.has(file.sha256)) errors.push(`Non-duplicate entries share checksum ${file.sha256.slice(0, 12)}`);
    else byHash.set(file.sha256, file);
  }
  const unique = [...byHash.values()];
  if (inventory.expectedHashedPaths !== undefined
    && (!integer(inventory.expectedHashedPaths) || inventory.expectedHashedPaths !== inventory.entries.length))
    errors.push(`Expanded manifest has ${inventory.entries.length} hashed paths but source summary reports ${inventory.expectedHashedPaths}; require an explicit valid hashed-path count.`);
  if (inventory.expectedDistinctHashes !== undefined
    && (!integer(inventory.expectedDistinctHashes) || inventory.expectedDistinctHashes !== unique.length))
    errors.push(`Expanded manifest has ${unique.length} unique hashes but source summary reports ${inventory.expectedDistinctHashes}; require an explicit valid distinct-hash count.`);
  if (inventory.cataloguedPaths !== undefined
    && (!integer(inventory.cataloguedPaths) || inventory.cataloguedPaths < inventory.entries.length))
    errors.push(`Source summary catalogued path count ${inventory.cataloguedPaths} is missing, invalid or smaller than ${inventory.entries.length} hashed manifest paths.`);
  const priorityMissingSha = integer(inventory.priorityMissingSha) ? inventory.priorityMissingSha : null;
  if (priorityMissingSha === null)
    blockers.push("Eligible priority missing-SHA denominator is absent or malformed; pair the source manifest with its verified source summary before certifying coverage.");
  else if (priorityMissingSha > 0)
    blockers.push(`${priorityMissingSha} eligible academic sources have no verified SHA-256; source coverage is incomplete.`);
  if (integer(inventory.cataloguedPaths) && inventory.cataloguedPaths > inventory.entries.length) warnings.push(`${inventory.cataloguedPaths - inventory.entries.length} catalogued paths were not included in the hashed cohort; the eligibility scan must distinguish excluded references from the remaining priority files.`);
  if (inventory.summary.uniqueFiles !== unique.length) errors.push(`Inventory uniqueFiles ${inventory.summary.uniqueFiles} != ${unique.length} verified unique hashes`);
  if (inventory.summary.files !== inventory.entries.length) errors.push(`Inventory files ${inventory.summary.files} != ${inventory.entries.length} entries`);
  if (inventory.summary.duplicateFiles !== duplicateRecords.length) errors.push(`Inventory duplicateFiles ${inventory.summary.duplicateFiles} != ${duplicateRecords.length} duplicates`);
  for (const entry of duplicateRecords) {
    if (!unique.some(first => first.path === entry.duplicateOf && first.sha256 === entry.sha256)) {
      errors.push(`Duplicate ${entry.path ?? "(unnamed)"} does not point to a matching canonical source`);
    }
  }
  const dispositionRows = dispositions?.sources;
  if (!Array.isArray(dispositionRows)) blockers.push("Agent 1 source-disposition ledger is absent; source eligibility and coverage remain unverified.");
  const dmap = indexUnique(dispositionRows ?? [], "sha256", errors, "source disposition");
  const missingDisposition = unique.filter(entry => !dmap.has(entry.sha256));
  if (missingDisposition.length) blockers.push(`${missingDisposition.length} unique source files have no explicit kind/disposition; cannot claim source coverage.`);
  for (const [hash, row] of dmap) {
    if (!byHash.has(hash)) errors.push(`Disposition checksum absent from current inventory: ${hash.slice(0, 12)}`);
    if (!supportedKinds.has(row.kind)) errors.push(`Unknown source kind for ${hash.slice(0, 12)}: ${row.kind}`);
    if (!supportedStates.has(row.status)) errors.push(`Unknown disposition for ${hash.slice(0, 12)}: ${row.status}`);
    for (const key of ["questionCount", "readyCount", "reviewCount", "rejectedCount"]) {
      if (row[key] !== undefined && !integer(row[key])) errors.push(`Invalid ${key} for ${hash.slice(0, 12)}`);
    }
    if (integer(row.questionCount) && integer(row.readyCount) && row.readyCount > row.questionCount) {
      errors.push(`Ready > detected question count for ${hash.slice(0, 12)}`);
    }
    if (row.kind === "question-source" && row.status !== "installed" && !row.reason) {
      blockers.push(`Question source ${hash.slice(0, 12)} is ${row.status} without an explicit reason.`);
    }
    if (row.kind === "question-source" && row.status === "installed") {
      const keys = ["questionCount", "readyCount", "reviewCount", "figureReferences"];
      const missing = keys.filter(key => !integer(row[key]));
      if (missing.length) errors.push(`Installed question source ${hash.slice(0, 12)} lacks explicit ${missing.join(", ")} counts.`);
      else if (row.readyCount + row.reviewCount + (row.rejectedCount ?? 0) !== row.questionCount)
        errors.push(`Installed source ${hash.slice(0, 12)} does not reconcile ready + review + rejected against detected.`);
    }
    // Public source publication requires affirmative rights, publisher consent,
    // and review of the current revision. A local file import is PRIVATE by default.
    if (row.visibility === "public" && !(row.rightsStatus === "verified" && row.publisherOptIn === true
      && row.reviewStatus === "approved" && typeof row.licenseEvidence === "string" && row.licenseEvidence.trim())) {
      blockers.push(`Public source ${hash.slice(0, 12)} lacks verified license, opt-in, and current approval.`);
    }
    if (row.figureReferences !== undefined && !integer(row.figureReferences)) {
      errors.push(`Invalid figureReferences for ${hash.slice(0, 12)}`);
    }
  }
  const questionSources = [...dmap.entries()].filter(([, row]) => row.kind === "question-source");
  // Source inventory and disposition records determine which PDF originals must
  // have current-run evidence. A missing optional CLI input cannot silently
  // convert completed cloud receipts into a complete PDF-source certificate.
  // A canonical question-source SHA can have both PDF and non-PDF filename
  // aliases. Check every inventory entry, not only the first canonical path.
  const pdfInventoryShas = new Set(inventory.entries.filter(file =>
    SHA256.test(file?.sha256 ?? "")
    && (/^\.?pdf$/i.test(file?.extension ?? "") || /\.pdf$/i.test(file?.path ?? ""))
  ).map(file => file.sha256));
  const pdfQuestionSourceShas = new Set(questionSources.filter(([sha]) =>
    pdfInventoryShas.has(sha)).map(([sha]) => sha));
  if (pdfQuestionSourceShas.size > 0 && pdfTriage === undefined) {
    blockers.push(`${pdfQuestionSourceShas.size} PDF question-source originals lack an availability triage ledger; current authorized path presence remains unverified.`);
  }
  const pendingSources = questionSources.filter(([, row]) => row.status !== "installed");
  if (pendingSources.length) blockers.push(`${pendingSources.length} question sources not installed (prepared, review, unsupported, or missing).`);
  const detectedQuestions = questionSources.reduce((n, [, r]) => n + (r.questionCount ?? 0), 0);
  const readyQuestions = questionSources.reduce((n, [, r]) => n + (r.readyCount ?? 0), 0);
  const reviewQuestions = questionSources.reduce((n, [, r]) => n + (r.reviewCount ?? 0), 0);
  const receiptRows = receipts?.sources;
  if (!Array.isArray(receiptRows)) blockers.push("Agent 3 verified backend-readback ledger is absent; no cloud installation can be confirmed.");
  const rmap = indexUnique(receiptRows ?? [], "sha256", errors, "cloud receipt");
  for (const [hash, row] of rmap) {
    if (!dmap.has(hash)) errors.push(`Cloud receipt references unclassified source ${hash.slice(0, 12)}`);
    if (!originalFileStates.has(row.originalFileStatus)) {
      errors.push(`Cloud receipt for ${hash.slice(0, 12)} lacks explicit original-file status.`);
    } else if (row.originalReadbackVerified !== (row.originalFileStatus === "cloud-verified")) {
      errors.push(`Cloud receipt for ${hash.slice(0, 12)} contradicts its original-file readback status.`);
    }
    if (!integer(row.questionCount)) errors.push(`Invalid stored questionCount for ${hash.slice(0, 12)}`);
    if (!integer(row.reviewCount)) errors.push(`Invalid stored reviewCount for ${hash.slice(0, 12)}`);
    if (!integer(row.figureReferences)) errors.push(`Invalid stored figureReferences for ${hash.slice(0, 12)}`);
  }
  let verifiedReadyQuestions = 0;
  let declaredFigureReferences = 0;
  let verifiedFigureReferences = 0;
  let figureBearingSources = 0;
  for (const [hash, row] of questionSources) {
    const declaredFigures = row.figureReferences;
    if (integer(declaredFigures) && declaredFigures > 0) {
      figureBearingSources++;
      declaredFigureReferences += declaredFigures;
      if (row.status === "installed") {
        const receipt = rmap.get(hash);
        if (!receipt?.bankReadbackVerified || receipt.ownerAuthenticated !== true || receipt.figureReadbackVerified !== true) {
          blockers.push(`Figure-bearing source ${hash.slice(0, 12)} lacks authenticated image-byte readback.`);
        } else if (receipt.figureReferences !== declaredFigures) {
          errors.push(`Figure count mismatch ${hash.slice(0, 12)}: expected ${declaredFigures}, read ${receipt.figureReferences ?? "unknown"}`);
        } else verifiedFigureReferences += declaredFigures;
      }
    }
    if (row.status !== "installed") continue;
    const receipt = rmap.get(hash);
    if (!receipt?.bankReadbackVerified) { blockers.push(`Installed question source ${hash.slice(0, 12)} lacks verified question-bank cloud readback.`); continue; }
    if (receipt.ownerAuthenticated !== true) {
      blockers.push(`Installed source ${hash.slice(0, 12)} has no owner-authenticated cloud receipt; admin/service-role access is insufficient.`);
      continue;
    }
    const readyCountMatches = receipt.questionCount === row.readyCount;
    const reviewCountMatches = integer(receipt.reviewCount) && receipt.reviewCount === row.reviewCount;
    if (!readyCountMatches) errors.push(`Ready/stored mismatch ${hash.slice(0, 12)}: ${row.readyCount ?? "unknown"} ready, ${receipt.questionCount} stored`);
    if (!reviewCountMatches) errors.push(`Review/stored mismatch ${hash.slice(0, 12)}: ${row.reviewCount ?? "unknown"} review, ${receipt.reviewCount ?? "unknown"} stored`);
    if (readyCountMatches && reviewCountMatches) verifiedReadyQuestions += receipt.questionCount;
  }
  // A missing or malformed template denominator is unknown, not an empty
  // curriculum. Certify Tracker activity coverage only from explicit counts.
  const templateEntries = inventory.summary.templates;
  const templateCountsVerified = Array.isArray(templateEntries)
    && templateEntries.every(entry => entry && integer(entry.items));
  const trackerTotal = templateCountsVerified
    ? templateEntries.reduce((sum, entry) => sum + entry.items, 0)
    : null;
  const expectedTracker = integer(trackerTotal) ? trackerTotal : null;
  if (expectedTracker === null)
    blockers.push("Course Tracker template activity denominator is absent or malformed; require explicit per-template nonnegative counts before certifying coverage.");
  const trackerRows = tracker?.activities;
  if (!Array.isArray(trackerRows)) blockers.push("Agent 4 installed-tracker ledger is absent; curriculum installation and progress integrity remain unverified.");
  const tmap = indexUnique(trackerRows ?? [], "activityId", errors, "tracker activity");
  for (const row of tmap.values()) {
    if (!row.term || !row.module) errors.push(`Tracker activity ${row.activityId} lacks term/module`);
    if (!["explicit", "inferred", "unassigned"].includes(row.weekBasis)) errors.push(`Tracker activity ${row.activityId} has unknown weekBasis`);
    if (row.weekBasis === "explicit" && !integer(row.week)) errors.push(`Explicit tracker week is missing for ${row.activityId}`);
    if (row.installed !== true) blockers.push(`Tracker activity ${row.activityId} has no installation receipt`);
  }
  if (expectedTracker !== null && tmap.size !== expectedTracker) {
    blockers.push(`Tracker ledger has ${tmap.size} unique activities; baseline templates have ${expectedTracker}. Coverage is not verified.`);
  }
  // Exact totals do not prove exact source scope. Where a source template names
  // its module (and optionally term), require its activity cohort to match.
  // A summary with no module assignment cannot authorize an invented mapping.
  if (templateCountsVerified) {
    const declaredScopes = new Map();
    for (const template of templateEntries) {
      if (typeof template.module !== "string" || !template.module.trim()) continue;
      const term = typeof template.term === "string" && template.term.trim() ? template.term : null;
      const key = JSON.stringify([term, template.module]);
      const prior = declaredScopes.get(key);
      declaredScopes.set(key, { term, module: template.module, items: (prior?.items ?? 0) + template.items });
    }
    for (const scope of declaredScopes.values()) {
      const actual = [...tmap.values()].filter(row =>
        row.module === scope.module && (scope.term === null || row.term === scope.term)).length;
      if (actual !== scope.items) {
        blockers.push(`Tracker source scope ${scope.term ? scope.term + "/" : ""}${scope.module} has ${actual}/${scope.items} activity identities; source-template membership is not verified.`);
      }
    }
    if (templateEntries.some(entry => typeof entry.module !== "string" || !entry.module.trim()))
      warnings.push("Some Tracker template rows lack source-declared module scope; only their aggregate activity count is verifiable.");
    // Only a complete, explicitly source-filed term/module cohort can certify
    // exact source-week membership. Do not infer weeks from installed receipts.
    for (const scope of declaredScopes.values()) {
      const matching = templateEntries.filter(entry => entry.module === scope.module
        && (scope.term === null || entry.term === scope.term));
      const weekly = matching.filter(entry => entry.week !== undefined);
      if (!weekly.length) {
        if (matching.some(entry => entry.weekBasis === "explicit")) {
          blockers.push(`Tracker source scope ${scope.term ? scope.term + "/" : ""}${scope.module} has invalid source-week evidence; explicit filing requires a numeric week.`);
        } else {
          warnings.push(`Tracker source scope ${scope.term ? scope.term + "/" : ""}${scope.module} has no source-declared week; week membership is unverified.`);
        }
        continue;
      }
      const ambiguous = !scope.term || templateEntries.some(entry =>
        !entry.module || (entry.module === scope.module && (!entry.term || !String(entry.term).trim())));
      if (ambiguous || weekly.length !== matching.length) {
        blockers.push(`Tracker source scope ${scope.term ? scope.term + "/" : ""}${scope.module} has a partial source-week census; cannot certify exact week membership.`);
        continue;
      }
      if (weekly.some(entry => !integer(entry.week)
        || (entry.weekBasis !== undefined && entry.weekBasis !== "explicit"))) {
        blockers.push(`Tracker source scope ${scope.term}/${scope.module} has invalid source-week evidence; require explicit nonnegative week numbers and source-based filing.`);
        continue;
      }
      const declaredWeeks = new Map();
      for (const entry of weekly) declaredWeeks.set(entry.week, (declaredWeeks.get(entry.week) ?? 0) + entry.items);
      for (const [week, expected] of declaredWeeks) {
        const actual = [...tmap.values()].filter(row =>
          row.term === scope.term && row.module === scope.module
          && row.weekBasis === "explicit" && row.week === week).length;
        if (actual !== expected) {
          blockers.push(`Tracker source week ${scope.term}/${scope.module}/${week} has ${actual}/${expected} explicitly filed activity identities; source-week membership is not verified.`);
        }
      }
    }
  }
  if (production !== undefined) {
    if (!production || typeof production !== "object" || typeof production.projectId !== "string"
      || typeof production.observedAt !== "string" || !Number.isFinite(Date.parse(production.observedAt))) {
      errors.push("Production snapshot lacks verified project ID or observation timestamp.");
    } else {
      for (const key of ["academicCollections", "academicRevisions", "academicFiles", "storageObjects"]) {
        if (!integer(production[key])) errors.push(`Production snapshot has invalid ${key} count.`);
      }
      if (production.academicCollections === 0 && verifiedReadyQuestions > 0) {
        errors.push("Backend source receipts claim verified academic questions but production has zero academic collections.");
      }
      if (production.academicFiles === 0 && verifiedFigureReferences > 0) {
        errors.push("Media receipts claim verified figures but production has zero academic files.");
      }
      if (production.projectId !== "jofkmfwkidubxcutkwzf") errors.push("Production snapshot is not the verified AXOM Production project.");
      const elapsed = Date.now() - Date.parse(production.observedAt);
      if (elapsed < -5 * 60_000 || elapsed > 60 * 60_000)
        blockers.push("Production database snapshot is stale or future-dated; repeat an authorized read-only query before release certification.");
    }
  }
  // A previously hashed source is not necessarily accessible today. Distinguish
  // disconnected academic storage from deletion or successful ingestion.
  let pdfTriageMetrics;
  if (pdfTriage !== undefined) {
    if (pdfTriage?.schema !== "axom-academic-pdf-triage-v1" || !Array.isArray(pdfTriage.rows)
      || !integer(pdfTriage.queueDistinctPdfJobs) || !Number.isFinite(Date.parse(pdfTriage.runAt))) {
      errors.push("PDF availability ledger is absent, malformed or has no timestamp.");
    } else {
      const seenPdf = new Set(), byStatus = {};
      let scopeFlaggedOutsideHoldStatus = 0;
      let unverifiedCurrentAvailability = 0;
      const reportTime = Date.parse(pdfTriage.runAt);
      // The report timestamp alone does not prove earlier cached PDF originals
      // were checked again. Each READY row needs a per-run, per-SHA authorized
      // path check; a source SHA from the manifest is not a current file read.
      const hasCurrentAvailabilityProof = entry => {
        const proof = entry.availabilityProof;
        const checked = Date.parse(proof?.checkedAt ?? "");
        return typeof pdfTriage.runId === "string" && pdfTriage.runId.length >= 8
          && proof?.runId === pdfTriage.runId
          && proof?.source_sha256 === entry.source_sha256
          && proof?.authorizedPathAvailable === true
          && Number.isFinite(checked)
          && checked >= reportTime - 24 * 60 * 60_000
          && checked <= reportTime + 5 * 60_000;
      };
      for (const entry of pdfTriage.rows) {
        if (!SHA256.test(entry?.source_sha256 ?? "") || seenPdf.has(entry.source_sha256)) {
          errors.push("PDF availability ledger has a missing or repeated source fingerprint.");
          continue;
        }
        seenPdf.add(entry.source_sha256);
        if (!byHash.has(entry.source_sha256)) errors.push(`PDF availability SHA ${entry.source_sha256.slice(0, 12)} is not in the source manifest.`);
        if (!pdfAvailabilityStatuses.has(entry.status)) {
          errors.push(`PDF availability SHA ${entry.source_sha256.slice(0, 12)} has unknown status: ${String(entry.status)}`);
          continue;
        }
        byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
        if (entry.status === "text_with_question_indicators" && !hasCurrentAvailabilityProof(entry))
          unverifiedCurrentAvailability += 1;
        if (entry.requires_scope_review === true
          && entry.status !== "academic_scope_conflict_review"
          && entry.status !== "academic_scope_changed_review")
          scopeFlaggedOutsideHoldStatus += 1;
      }
      const unaccountedPdfSources = [...pdfQuestionSourceShas].filter(sha => !seenPdf.has(sha));
      if (unaccountedPdfSources.length) {
        blockers.push(`PDF question-source availability missing ${unaccountedPdfSources.length}/${pdfQuestionSourceShas.size} canonical source fingerprints from the triage ledger; verify original coverage, not only row totals.`);
      }
      if (pdfTriage.rows.length !== pdfTriage.queueDistinctPdfJobs)
        blockers.push(`PDF availability triage covers ${pdfTriage.rows.length}/${pdfTriage.queueDistinctPdfJobs} queued original PDF sources; rescan the remainder.`);
      if (unverifiedCurrentAvailability)
        blockers.push(`${unverifiedCurrentAvailability} ready PDF source rows lack per-source availability proof for this triage run; recheck authorized originals and bind source SHA, run ID and checked time.`);
      const unmounted = byStatus.source_volume_unmounted ?? 0;
      const missing = byStatus.source_path_unavailable ?? 0;
      const lowText = byStatus.low_text_scan_or_figures ?? 0;
      const failed = (byStatus.reader_failure_needs_review ?? 0) + (byStatus.pdfinfo_unreadable ?? 0);
      if (unmounted) blockers.push(`${unmounted} PDF originals depend on an unmounted academic drive; reconnect before declaring corpus coverage.`);
      if (missing) blockers.push(`${missing} PDF originals lack an accessible authorized path; reconcile exact SHA aliases.`);
      if (lowText) blockers.push(`${lowText} low-text/image-heavy PDF originals need bounded OCR or explicit manual review before completeness.`);
      if (failed) blockers.push(`${failed} PDF originals failed bounded inspection and need a tracked parser disposition.`);
      const deferred = (byStatus.size_limit_deferred ?? 0) + (byStatus.encrypted_pdf_review ?? 0);
      const noIndicators = byStatus.text_without_question_indicators ?? 0;
      const scopeConflicts = byStatus.academic_scope_conflict_review ?? 0;
      const scopeChanges = byStatus.academic_scope_changed_review ?? 0;
      const scopeReviewHolds = scopeConflicts + scopeChanges + scopeFlaggedOutsideHoldStatus;
      if (scopeReviewHolds) blockers.push(`${scopeReviewHolds} PDF original triage records have conflicting or changed academic scope; manual term/module/week provenance review required.`);
      if (deferred) blockers.push(`${deferred} PDF originals are deferred or encrypted; obtain authorized source review before claiming coverage.`);
      if (noIndicators) blockers.push(`${noIndicators} PDF question jobs have no sampled question indicators; verify source classification before claiming completeness.`);
      const age = Date.now() - Date.parse(pdfTriage.runAt);
      if (age < -5 * 60000 || age > 24 * 60 * 60000)
        blockers.push("PDF availability snapshot is stale or future-dated; rerun the staged triage before accepting physical-source coverage.");
      pdfTriageMetrics = { pdfJobsRecorded: pdfTriage.rows.length, pdfJobsInQueue: pdfTriage.queueDistinctPdfJobs,
        pdfVolumeUnmounted: unmounted, pdfPathsMissing: missing, pdfLowText: lowText, pdfReaderFailures: failed,
        pdfDeferredSources: deferred, pdfNoQuestionIndicators: noIndicators,
        pdfScopeConflictReviewRows: scopeConflicts, pdfScopeChangedReviewRows: scopeChanges,
        pdfScopeReviewFlaggedOther: scopeFlaggedOutsideHoldStatus,
        pdfUnverifiedCurrentAvailability: unverifiedCurrentAvailability };
    }
  }
  // Reuse the single canonical B4 acceptance report rather than maintaining a
  // second corpus parser/checker with competing source denominators. Orphan
  // receipts from old queue revisions must stay visible, never double-counted.
  let b4AuditMetrics;
  if (corpusAudit !== undefined) {
    if (!corpusAudit || corpusAudit.format !== "axom-b4-corpus-acceptance-v1"
      || !Number.isFinite(Date.parse(corpusAudit.generatedAt ?? ""))
      || !integer(corpusAudit.queuedSources) || !integer(corpusAudit.receivedSourceDispositions)
      || !integer(corpusAudit.missingReceipts) || !integer(corpusAudit.orphanReceipts)
      || !integer(corpusAudit.pathOnlySourceJobs)
      || !integer(corpusAudit.totals?.detected)
      || !integer(corpusAudit.totals?.canonicalReadable)
      || !integer(corpusAudit.totals?.missingSources)
      || !integer(corpusAudit.totals?.unverifiedByteProofSources))
      errors.push("Canonical B4 acceptance schema or timestamp is invalid.");
    else {
      if (corpusAudit.receivedSourceDispositions !== corpusAudit.queuedSources
        || corpusAudit.missingReceipts)
        blockers.push(`B4 source preparation accounted for ${corpusAudit.receivedSourceDispositions}/${corpusAudit.queuedSources} current queue entries; resolve missing receipts.`);
      if (corpusAudit.sourceReceiptCoverageComplete !== true || corpusAudit.orphanReceipts)
        blockers.push(`B4 corpus has ${corpusAudit.orphanReceipts} orphan receipts from earlier queue versions; preserve and reconcile before claiming completion.`);
      if (corpusAudit.sourceIdentityCoverageComplete !== true
        || corpusAudit.pathOnlySourceJobs || corpusAudit.totals.unverifiedByteProofSources)
        blockers.push(`B4 source identity still has ${corpusAudit.pathOnlySourceJobs} path-only originals and ${corpusAudit.totals.unverifiedByteProofSources} unverified source-byte receipts.`);
      if (corpusAudit.totals.missingSources)
        blockers.push(`${corpusAudit.totals.missingSources} B4 originals are currently unavailable; do not represent them as installed.`);
      if (corpusAudit.academicReleaseComplete !== false
        || corpusAudit.verifiedCloudQuestionCount !== 0 || corpusAudit.verifiedScorableQuestionCount !== 0)
        errors.push("B4 offline review preparation cannot assert scored or authenticated cloud-installed content.");
      b4AuditMetrics = { b4JobsExpected: corpusAudit.queuedSources,
        b4JobsAudited: corpusAudit.receivedSourceDispositions,
        b4OrphanReceipts: corpusAudit.orphanReceipts,
        b4PathOnlySources: corpusAudit.pathOnlySourceJobs,
        b4UnverifiedByteProofSources: corpusAudit.totals.unverifiedByteProofSources,
        b4Candidates: corpusAudit.totals.detected,
        b4CanonicallyReadable: corpusAudit.totals.canonicalReadable,
        b4OriginalsUnavailable: corpusAudit.totals.missingSources };
    }
  }
  if (!Array.isArray(dispositionRows) || !Array.isArray(receiptRows) || !Array.isArray(trackerRows)) warnings.push("This is a discovery baseline, not a release acceptance certificate.");
  const counts = {
    inventoryFiles: inventory.entries.length, uniqueSourceFiles: unique.length, duplicateFiles: duplicateRecords.length,
    ...(inventory.cataloguedPaths !== undefined ? { cataloguedPaths: inventory.cataloguedPaths } : {}),
    priorityMissingSha,
    explicitlyClassified: dmap.size, missingDisposition: missingDisposition.length,
    questionSources: questionSources.length, nonInstalledQuestionSources: pendingSources.length,
    detectedQuestions, readyQuestions, reviewQuestions, verifiedReadyQuestions,
    expectedBaselineTrackerActivities: expectedTracker, reportedTrackerActivities: tmap.size,
    installedTrackerActivities: [...tmap.values()].filter(item => item.installed === true).length,
    cloudReceiptSources: rmap.size,
    ...(pdfTriageMetrics ?? {}),
    ...(b4AuditMetrics ?? {}),
    ...(figureBearingSources ? { figureBearingSources, declaredFigureReferences, verifiedFigureReferences } : {}),
    ...(production ? { productionSnapshotAt: production.observedAt,
      productionAcademicCollections: production.academicCollections,
      productionAcademicFiles: production.academicFiles } : {}),
  };
  return {
    format: "axom-academic-reconciliation-v1",
    complete: errors.length === 0 && blockers.length === 0,
    errors, blockers, warnings,
    counts,
    samples: { unclassifiedFiles: sample(missingDisposition.map(x => x.path ?? x.sha256)),
      pendingQuestionSources: sample(pendingSources.map(([h, row]) => ({ source: h.slice(0, 12), status: row.status, reason: row.reason ?? null }))) },
  };
}

function parseArgs(args) {
  const options = { strict: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strict") { options.strict = true; continue; }
    if (!["--inventory", "--inventory-jsonl", "--source-summary", "--dispositions", "--receipts", "--tracker", "--production-snapshot", "--pdf-triage", "--corpus-audit", "--out"].includes(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
    if (!args[i + 1]) throw new Error(`Missing path after ${args[i]}`);
    options[args[i].slice(2)] = args[++i];
  }
  return options;
}
function readJsonIfPresent(path) { return path ? JSON.parse(readFileSync(resolve(path), "utf8")) : undefined; }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const inventoryPath = a.inventory ?? "artifacts/qbank-6way-20261014/manifest.json";
    if (a["inventory-jsonl"] && !a["source-summary"]) throw new Error("--inventory-jsonl requires --source-summary");
    const expandedRows = a["inventory-jsonl"]
      ? readFileSync(resolve(a["inventory-jsonl"]), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      : undefined;
    const inventory = expandedRows
      ? expandedSourceInventory(expandedRows, readJsonIfPresent(a["source-summary"]))
      : readJsonIfPresent(inventoryPath);
    const report = reconcileAcademicContent({ inventory,
      dispositions: readJsonIfPresent(a.dispositions), receipts: readJsonIfPresent(a.receipts),
      tracker: readJsonIfPresent(a.tracker), production: readJsonIfPresent(a["production-snapshot"]),
      pdfTriage: readJsonIfPresent(a["pdf-triage"]), corpusAudit: readJsonIfPresent(a["corpus-audit"]) });
    const destination = resolve(a.out ?? "artifacts/qbank-6way-20261014/reconciliation.json");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
    process.stdout.write(JSON.stringify({ complete: report.complete, ...report.counts, errorCount: report.errors.length, blockerCount: report.blockers.length, report: destination }, null, 2) + "\n");
    if (a.strict && !report.complete) process.exitCode = 1;
  } catch (error) { process.stderr.write(`Academic reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
