#!/usr/bin/env node
/* global process, console */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  diffApplicationSchoolDatasets,
  mergeApplicationSchoolDatasets,
  parseApplicationSchoolDataset,
} from "../src/lib/applicationSchools.ts";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(command ? 0 : 2);
}

if (!["validate", "merge", "diff"].includes(command)) {
  console.error(`Unknown school dataset command: ${command}`);
  printUsage();
  process.exit(2);
}

try {
  if (command === "validate") await validateCommand(args);
  else if (command === "merge") await mergeCommand(args);
  else await diffCommand(args);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

async function validateCommand(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const inputPath = positionalArgs(argv)[0];
  if (!inputPath) throw new Error("validate requires an input JSON path.");
  const outputPath = option(argv, "--output");
  const now = parseNow(option(argv, "--now"));
  const raw = await readJson(inputPath);
  const result = parseApplicationSchoolDataset(raw, now);
  const report = summarize(raw, result);
  printReport(`School dataset validation: ${inputPath}`, report);
  if (result.ok && report.errorCount === 0 && outputPath) {
    await writeJson(outputPath, result.dataset);
    console.log(`INFO: normalized v2 dataset written to ${outputPath}`);
  }
  if (report.errorCount > 0 || !result.ok) process.exitCode = 1;
}

async function mergeCommand(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const paths = positionalArgs(argv);
  if (paths.length < 2) throw new Error("merge requires base and incoming JSON paths.");
  const outputPath = option(argv, "--output");
  const now = parseNow(option(argv, "--now"));
  const baseRaw = await readJson(paths[0]);
  const incomingRaw = await readJson(paths[1]);
  const base = parseApplicationSchoolDataset(baseRaw, now);
  const incoming = parseApplicationSchoolDataset(incomingRaw, now);
  const baseReport = summarize(baseRaw, base);
  const incomingReport = summarize(incomingRaw, incoming);
  const diagnostic = outputPath ? console.log : console.error;
  printReport(`Base dataset validation: ${paths[0]}`, baseReport, diagnostic);
  printReport(`Incoming dataset validation: ${paths[1]}`, incomingReport, diagnostic);
  if (!base.ok || !incoming.ok || baseReport.errorCount > 0 || incomingReport.errorCount > 0) {
    console.error("ERROR: merge refused because one or more inputs are unsafe.");
    process.exitCode = 1;
    return;
  }
  const merged = mergeApplicationSchoolDatasets(base.dataset, incoming.dataset);
  const mergedReport = summarize(merged.dataset, { ok: true, dataset: merged.dataset, issues: [] });
  printReport("Merged dataset", mergedReport, diagnostic);
  diagnostic(`INFO: preserved ${merged.conflicts} field conflict(s) for review.`);
  for (const warning of merged.warnings.slice(0, 20)) diagnostic(`WARNING: ${warning}`);
  if (merged.warnings.length > 20) diagnostic(`WARNING: ${merged.warnings.length - 20} additional conflict warning(s) omitted.`);
  if (outputPath) {
    await writeJson(outputPath, merged.dataset);
    console.log(`INFO: merged v2 dataset written to ${outputPath}`);
  } else {
    process.stdout.write(`${JSON.stringify(merged.dataset, null, 2)}\n`);
  }
}

async function diffCommand(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const paths = positionalArgs(argv);
  if (paths.length < 2) throw new Error("diff requires base and incoming JSON paths.");
  const asJson = argv.includes("--json");
  const now = parseNow(option(argv, "--now"));
  const inputs = [];
  for (const path of paths.slice(0, 2)) {
    const raw = await readJson(path);
    const result = parseApplicationSchoolDataset(raw, now);
    inputs.push({ path, result, report: summarize(raw, result) });
  }
  const unsafe = inputs.filter(({ result, report }) => !result.ok || report.errorCount > 0);
  if (unsafe.length) {
    for (const { path, report } of unsafe) printReport(`School dataset validation: ${path}`, report, console.error);
    console.error("ERROR: diff refused because one or more inputs are unsafe.");
    process.exitCode = 1;
    return;
  }
  const [base, incoming] = inputs.map(({ result }) => result.dataset);
  const diff = diffApplicationSchoolDatasets(base, incoming);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
    return;
  }
  const count = (dataset, pick) => dataset.schools.reduce((total, school) => total + pick(school), 0);
  const describe = ({ path, report }, dataset) => `${path} (${dataset.schools.length} schools, ${count(dataset, (school) => school.researchFacts?.length ?? 0)} facts, `
    + `${report.warningCount} warning(s), pipeline ${dataset.sourcePipelineVersion ?? "unknown"})`;
  const list = (title, items, format) => {
    if (!items.length) return;
    console.log(`${title}:`);
    for (const item of items.slice(0, 20)) console.log(`  ${format(item)}`);
    if (items.length > 20) console.log(`  ... ${items.length - 20} more (use --json for the full list)`);
  };
  console.log("School dataset diff");
  console.log(`base: ${describe(inputs[0], base)}`);
  console.log(`incoming: ${describe(inputs[1], incoming)}`);
  console.log(`schools: +${diff.addedSchools.length} added, -${diff.removedSchools.length} removed`);
  console.log(`facts: +${diff.addedFacts.length} added, -${diff.removedFacts.length} removed, ${diff.changedFacts.length} changed`);
  console.log(`review checks reopened: ${diff.reviewChecksReopened}`);
  console.log(`estimate changes: ${diff.estimateChanges.length} school(s)`);
  console.log(`reported statistics: ${count(base, (school) => school.reportedStats?.length ?? 0)} -> ${count(incoming, (school) => school.reportedStats?.length ?? 0)}`
    + ` (${diff.statChanges.length} added, removed or changed)`);
  console.log(`risk flags: ${count(base, (school) => Number(Boolean(school.riskFlag)))} -> ${count(incoming, (school) => Number(Boolean(school.riskFlag)))}`);
  list("Added schools", diff.addedSchools, (id) => id);
  list("Removed schools", diff.removedSchools, (id) => id);
  list("Changed facts", diff.changedFacts, (change) => `${change.schoolId} ${change.factId} [${change.fields.join(", ")}]: `
    + `${JSON.stringify(change.before.value)} -> ${JSON.stringify(change.after.value)}`);
  list("Removed facts", diff.removedFacts, (fact) => `${fact.schoolId} ${fact.factId}`);
  list("Reported statistic changes", diff.statChanges, (stat) => `${stat.schoolId} ${stat.statId} ${stat.change}`
    + (stat.fields.length ? ` [${stat.fields.join(", ")}]` : ""));
  const addedByField = new Map();
  for (const { factId } of diff.addedFacts) addedByField.set(factId, (addedByField.get(factId) ?? 0) + 1);
  list("Added facts by field", [...addedByField].sort(([a], [b]) => a.localeCompare(b)), ([factId, total]) => `${factId}: ${total} school(s)`);
}

function summarize(raw, result) {
  const input = isRecord(raw) ? raw : {};
  const rawSchools = Array.isArray(input.schools) ? input.schools : [];
  const dataset = result.ok ? result.dataset : undefined;
  const issues = result.issues ?? [];
  const count = (pattern) => issues.filter((item) => pattern.test(item.message)).length;
  const statuses = dataset?.schools ?? [];
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const errorCount = issues.filter((item) => item.severity === "error").length;
  return {
    schemaVersion: input.schemaVersion ?? "missing",
    declaredRecordCount: typeof input.recordCount === "number" ? input.recordCount : "not declared",
    actualRecordCount: rawSchools.length,
    uniqueSchoolCount: new Set(statuses.map((school) => school.id)).size,
    validRecords: dataset?.successfulRecords ?? 0,
    incompleteRecords: statuses.filter((school) => school.verificationStatus === "incomplete").length,
    unknownRecords: statuses.filter((school) => school.verificationStatus === "unknown").length,
    conflictingRecords: statuses.filter((school) => school.verificationStatus === "conflicting").length,
    staleRecords: Math.max(statuses.filter((school) => school.verificationStatus === "needs-refresh").length, count(/older than one year/i)),
    rejectedRecords: dataset?.rejectedRecords ?? rawSchools.length,
    duplicateIds: count(/duplicate school id/i),
    duplicateCanonicalNames: count(/duplicate canonical school name/i),
    malformedUrls: count(/source url and retrieval timestamp|website must be an http/i),
    missingProvenance: count(/verified schools require a valid source|provenance/i),
    // "invalid date" rejections are not future timestamps; only messages that say "in the future" count here.
    futureTimestamps: count(/\bin the future\b/i),
    impossibleNumericFields: count(/class size|non-negative integer|numeric|implausible/i),
    unsupportedProgramTypes: count(/unsupported program type/i),
    warningCount,
    errorCount,
    issues,
  };
}

function printReport(title, report, write = console.log) {
  write(`\n${report.errorCount ? "FAIL" : "PASS"}: ${title}`);
  write(`schema version: ${report.schemaVersion}`);
  write(`declared records: ${report.declaredRecordCount}`);
  write(`actual records: ${report.actualRecordCount}`);
  write(`unique schools: ${report.uniqueSchoolCount}`);
  write(`valid: ${report.validRecords}`);
  write(`incomplete: ${report.incompleteRecords}`);
  write(`unknown: ${report.unknownRecords}`);
  write(`conflicting: ${report.conflictingRecords}`);
  write(`stale/needs-refresh: ${report.staleRecords}`);
  write(`rejected: ${report.rejectedRecords}`);
  write(`duplicate IDs: ${report.duplicateIds}`);
  write(`duplicate canonical names: ${report.duplicateCanonicalNames}`);
  write(`malformed URLs: ${report.malformedUrls}`);
  write(`missing provenance: ${report.missingProvenance}`);
  write(`future timestamps: ${report.futureTimestamps}`);
  write(`impossible numeric fields: ${report.impossibleNumericFields}`);
  write(`unsupported program types: ${report.unsupportedProgramTypes}`);
  write(`errors: ${report.errorCount}`);
  write(`warnings: ${report.warningCount}`);
  for (const item of report.issues) write(`${item.severity.toUpperCase()}: ${item.path}: ${item.message}`);
}

async function readJson(path) {
  const text = await readFile(resolve(path), "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${path}.`);
  }
}

async function writeJson(path, value) {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positionalArgs(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("-")) {
      if (argv[index] === "--output" || argv[index] === "--now") index += 1;
      continue;
    }
    values.push(argv[index]);
  }
  return values;
}

function parseNow(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --now timestamp: ${value}`);
  return date;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run schools:validate -- path/to/export.json [--output web/public/application-schools.json]");
  console.log("  npm run schools:merge -- existing.json incoming.json --output web/public/application-schools.json");
  console.log("  npm run schools:diff -- existing.json incoming.json [--json]");
  console.log("  Add --now 2026-08-11T00:00:00Z for deterministic freshness checks.");
}
