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
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sample = (array, max = 12) => array.slice(0, max);

function indexUnique(list, key, errors, label) {
  const indexed = new Map();
  for (const item of list) {
    const id = item?.[key];
    if (typeof id !== "string" || !id.trim()) { errors.push(`${label} entry lacks ${key}`); continue; }
    if (indexed.has(id)) errors.push(`Duplicate ${label} identity: ${id}`);
    else indexed.set(id, item);
  }
  return indexed;
}

export function reconcileAcademicContent({ inventory, dispositions, receipts, tracker }) {
  const errors = [], blockers = [], warnings = [];
  if (!inventory || !Array.isArray(inventory.entries) || !inventory.summary) {
    return { complete: false, errors: ["Source inventory has no entries and summary."], blockers: [], warnings: [], counts: {} };
  }
  const byHash = new Map(), duplicateRecords = [];
  for (const file of inventory.entries) {
    if (!SHA256.test(file.sha256 ?? "")) { errors.push(`Invalid source checksum: ${file.path ?? "(unnamed)"}`); continue; }
    if (file.duplicateOf) { duplicateRecords.push(file); continue; }
    if (byHash.has(file.sha256)) errors.push(`Non-duplicate entries share checksum ${file.sha256.slice(0, 12)}`);
    else byHash.set(file.sha256, file);
  }
  const unique = [...byHash.values()];
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
    for (const key of ["questionCount", "readyCount", "reviewCount"]) {
      if (row[key] !== undefined && !integer(row[key])) errors.push(`Invalid ${key} for ${hash.slice(0, 12)}`);
    }
    if (integer(row.questionCount) && integer(row.readyCount) && row.readyCount > row.questionCount) {
      errors.push(`Ready > detected question count for ${hash.slice(0, 12)}`);
    }
    if (row.kind === "question-source" && row.status !== "installed" && !row.reason) {
      blockers.push(`Question source ${hash.slice(0, 12)} is ${row.status} without an explicit reason.`);
    }
  }
  const questionSources = [...dmap.entries()].filter(([, row]) => row.kind === "question-source");
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
    if (row.readbackVerified !== true) blockers.push(`Cloud receipt for ${hash.slice(0, 12)} is not readback-verified.`);
    if (!integer(row.questionCount)) errors.push(`Invalid stored questionCount for ${hash.slice(0, 12)}`);
  }
  let verifiedReadyQuestions = 0;
  for (const [hash, row] of questionSources) {
    if (row.status !== "installed") continue;
    const receipt = rmap.get(hash);
    if (!receipt?.readbackVerified) { blockers.push(`Installed question source ${hash.slice(0, 12)} lacks verified cloud readback.`); continue; }
    if (receipt.questionCount !== row.readyCount) errors.push(`Ready/stored mismatch ${hash.slice(0, 12)}: ${row.readyCount ?? "unknown"} ready, ${receipt.questionCount} stored`);
    else verifiedReadyQuestions += receipt.questionCount;
  }
  const expectedTracker = Array.isArray(inventory.summary.templates)
    ? inventory.summary.templates.reduce((sum, entry) => sum + (entry.items ?? 0), 0)
    : null;
  const trackerRows = tracker?.activities;
  if (!Array.isArray(trackerRows)) blockers.push("Agent 4 installed-tracker ledger is absent; curriculum installation and progress integrity remain unverified.");
  const tmap = indexUnique(trackerRows ?? [], "activityId", errors, "tracker activity");
  for (const row of tmap.values()) {
    if (!row.term || !row.module) errors.push(`Tracker activity ${row.activityId} lacks term/module`);
    if (!["explicit", "inferred", "unassigned"].includes(row.weekBasis)) errors.push(`Tracker activity ${row.activityId} has unknown weekBasis`);
    if (row.weekBasis === "explicit" && !integer(row.week)) errors.push(`Explicit tracker week is missing for ${row.activityId}`);
    if (row.installed !== true) blockers.push(`Tracker activity ${row.activityId} has no installation receipt`);
  }
  if (expectedTracker !== null && tmap.size < expectedTracker) {
    blockers.push(`Tracker ledger has ${tmap.size} unique activities; baseline templates have ${expectedTracker}. Coverage is not verified.`);
  }
  if (!Array.isArray(dispositionRows) || !Array.isArray(receiptRows) || !Array.isArray(trackerRows)) warnings.push("This is a discovery baseline, not a release acceptance certificate.");
  const counts = {
    inventoryFiles: inventory.entries.length, uniqueSourceFiles: unique.length, duplicateFiles: duplicateRecords.length,
    explicitlyClassified: dmap.size, missingDisposition: missingDisposition.length,
    questionSources: questionSources.length, nonInstalledQuestionSources: pendingSources.length,
    detectedQuestions, readyQuestions, reviewQuestions, verifiedReadyQuestions,
    expectedBaselineTrackerActivities: expectedTracker, reportedTrackerActivities: tmap.size,
    installedTrackerActivities: [...tmap.values()].filter(item => item.installed === true).length,
    cloudReceiptSources: rmap.size,
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
    if (!["--inventory", "--dispositions", "--receipts", "--tracker", "--out"].includes(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
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
    const report = reconcileAcademicContent({ inventory: readJsonIfPresent(inventoryPath),
      dispositions: readJsonIfPresent(a.dispositions), receipts: readJsonIfPresent(a.receipts), tracker: readJsonIfPresent(a.tracker) });
    const destination = resolve(a.out ?? "artifacts/qbank-6way-20261014/reconciliation.json");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
    process.stdout.write(JSON.stringify({ complete: report.complete, ...report.counts, errorCount: report.errors.length, blockerCount: report.blockers.length, report: destination }, null, 2) + "\n");
    if (a.strict && !report.complete) process.exitCode = 1;
  } catch (error) { process.stderr.write(`Academic reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
