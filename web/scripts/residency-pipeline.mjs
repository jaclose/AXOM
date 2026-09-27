#!/usr/bin/env node
/* global process, console */

// Residency dataset pipeline for the Application Checker.
//
//   import   ACGME "ProgramListingAY….xlsx" (or .csv) → validated JSON
//   validate an existing residency JSON file
//
// Download the listing from ACGME Cloud → Explore Public Data (program list).
// Only the official listing's own columns are used; every requirement field
// (Step minimums, visa sponsorship, signals…) stays "Unknown" until a sourced
// capture supplies it. See docs/APPLICATION-PATHWAY-DATASETS.md.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  buildResidencyDataset,
  parseResidencyDataset,
  programsFromAcgmeRows,
} from "../src/lib/residencyPrograms.ts";

const require = createRequire(import.meta.url);
const command = process.argv[2];
const args = process.argv.slice(3);
const DEFAULT_OUTPUT = "web/public/application-residency-programs.json";
const DEFAULT_SOURCE = "https://acgmecloud.org/analytics/explore-public-data/program-search";

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function usage() {
  console.log(`Usage:
  node --experimental-strip-types web/scripts/residency-pipeline.mjs import <ProgramListing.xlsx|.csv> [--output ${DEFAULT_OUTPUT}] [--source-url URL] [--retrieved-at ISO] [--dry-run]
  node --experimental-strip-types web/scripts/residency-pipeline.mjs validate <residency.json>`);
}

async function readRows(path) {
  const XLSX = require("xlsx-js-style");
  const workbook = path.toLowerCase().endsWith(".csv")
    ? XLSX.read(await readFile(path, "utf8"), { type: "string", raw: true })
    : XLSX.read(await readFile(path), { type: "buffer", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw: keep codes as text where possible; padCode restores dropped zeros.
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

async function importCommand() {
  const input = args.find((arg) => !arg.startsWith("--") && !/^\d{4}-/.test(arg) && !/^https?:/.test(arg));
  if (!input) { usage(); process.exit(2); }
  const retrievedAt = option("retrieved-at", new Date().toISOString());
  const source = { url: option("source-url", DEFAULT_SOURCE), title: "ACGME public program listing", retrievedAt };
  const rows = await readRows(resolve(input));
  const { programs, skipped } = programsFromAcgmeRows(rows, source);
  const dataset = buildResidencyDataset(programs, new Date().toISOString());
  const check = parseResidencyDataset(dataset);
  if (!check.ok) throw new Error(check.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  const specialties = new Set(programs.map((program) => program.specialty)).size;
  console.log(JSON.stringify({ rows: rows.length, programs: programs.length, skipped, specialties, academicYear: dataset.academicYear ?? "mixed" }, null, 2));
  if (args.includes("--dry-run")) return;
  const output = resolve(option("output", DEFAULT_OUTPUT));
  await writeFile(output, `${JSON.stringify(dataset)}\n`);
  console.log(`Wrote ${output}`);
}

async function validateCommand() {
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) { usage(); process.exit(2); }
  const result = parseResidencyDataset(JSON.parse(await readFile(resolve(input), "utf8")));
  const errors = result.issues.filter((issue) => issue.severity === "error");
  console.log(JSON.stringify({
    ok: result.ok,
    programs: result.ok ? result.dataset.programs.length : 0,
    errors: errors.length,
    warnings: result.issues.length - errors.length,
    issues: result.issues.slice(0, 20),
  }, null, 2));
  if (!result.ok || errors.length) process.exit(1);
}

try {
  if (command === "import") await importCommand();
  else if (command === "validate") await validateCommand();
  else { usage(); process.exit(command ? 2 : 0); }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
