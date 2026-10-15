#!/usr/bin/env node
/**
 * Private, metadata-only triage of AXOM academic PDF originals.
 *
 * This is deliberately NOT a second question parser: existing AXOM importers
 * are responsible for extraction, answer trust, image capture and review.
 * This tool chooses which source PDFs merit those expensive operations next.
 *
 * node scripts/operations/academic-pdf-triage.mjs --start 120 --limit 100
 * node scripts/operations/academic-pdf-triage.mjs --start 220 --limit 100
 *
 * No source text, answers, page screenshots, tokens or credentials are stored.
 * Every PDF read is bounded, and previous results are reused by SHA/mtime.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  renameSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const command = promisify(execFile);
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = join(checkout, "artifacts", "qbank-6way-20261014");
export const defaultQueue = join(artifactDir, "agent-2-import-inputs-deduplicated.json");
export const defaultReport = join(artifactDir, "agent0-pdf-triage-metadata.json");
const shaPattern = /^byte:([0-9a-f]{64})$/;

export function parsePdfInfo(text) {
  const pages = text.match(/^Pages:\s*(\d+)\s*$/m);
  const encrypted = text.match(/^Encrypted:\s*([^\n]+)/m);
  return {
    pages: pages ? Number(pages[1]) : null,
    encrypted: encrypted ? /^yes\b/i.test(encrypted[1]) : null,
  };
}

export function classifyPdfText(text) {
  // Counts are only indicators on sampled pages. Never turn them into
  // individual extracted/validated/answer-ready question totals.
  const source = typeof text === "string" ? text : "";
  const chars = source.replace(/\s+/g, "").length;
  const questionLabels = (source.match(/^\s*(?:(?:question|q)\s*[#.: -]*\d{1,4}[.): -]|\d{1,4}[.)]\s+.{10,})/gim) ?? []).length;
  const choiceLines = (source.match(/^\s*[A-E][.)]\s+\S.+/gim) ?? []).length;
  const answerLines = (source.match(/^\s*(?:correct\s+)?(?:answer|ans)\s*[:=-]/gim) ?? []).length;
  const likelyQuestionPages = questionLabels >= 1 || choiceLines >= 4;
  const kind = chars < 80 ? "low_text_scan_or_figures"
    : likelyQuestionPages ? "text_with_question_indicators"
    : "text_without_question_indicators";
  return { sampledNonWhitespaceCharacters: chars, sampledQuestionHeadingIndicators: questionLabels,
    sampledChoiceLineIndicators: choiceLines, sampledAnswerLineIndicators: answerLines,
    kind, countBasis: "up_to_3_page_sample_not_full_pdf_or_validated_questions" };
}

export function isWithinRoot(candidate, roots) {
  if (!isAbsolute(candidate)) return false;
  const path = resolve(candidate);
  return roots.some(root => path === resolve(root) || path.startsWith(resolve(root) + sep));
}

export function sourceRoots(home = homedir()) {
  return [
    join(home, "Downloads"), join(home, "Developer", "AXOM"),
    join(home, "Desktop", "NCRS"), join(home, "Desktop", "FTCM"),
    join(home, "Desktop", "RHPS"),
    "/Volumes/JDabSSD/Medical School",
  ];
}

export function selectPdfJobs(queue) {
  if (!Array.isArray(queue)) throw new Error("Canonical queue must be an array.");
  const selected = [];
  const seen = new Set();
  for (const job of queue) {
    if (job?.input_mode !== "pdf_original_extract_with_review"
      || extname(job.source_path ?? "").toLowerCase() !== ".pdf") continue;
    const match = shaPattern.exec(job.canonical_input_key ?? "");
    if (!match) {
      // A path-only job is not canonical byte-identifiable and must be
      // reclassified by Agent 1 before a repeat-safe batch.
      continue;
    }
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    selected.push({ source_sha256: match[1], source_path: job.source_path,
      equivalent_paths: job.equivalent_paths ?? [], module: job.module ?? null,
      term: job.term ?? null, week: Number.isInteger(job.week) ? job.week : null,
      document_type: job.document_type ?? "unclassified",
      answer_variant: job.answered_variant ?? null,
      priority: Number.isInteger(job.priority) ? job.priority : 10 });
  }
  return selected;
}

function parseArgs(argv) {
  const options = {
    input: defaultQueue, out: defaultReport, start: 0, limit: 100,
    maxBytes: 60 * 1048576, timeoutMs: 12000, workers: 3,
    roots: sourceRoots(),
  };
  for (let idx = 0; idx < argv.length; idx++) {
    const arg = argv[idx], val = argv[idx + 1];
    if (arg === "--allow-root" && val) { options.roots.push(resolve(val)); idx++; continue; }
    const map = { "--input": "input", "--out": "out", "--start": "start",
      "--limit": "limit", "--max-mb": "maxBytes", "--timeout-ms": "timeoutMs", "--workers": "workers" };
    if (!map[arg] || val === undefined) throw new Error(`Unknown or incomplete flag: ${arg}`);
    if (["input", "out"].includes(map[arg])) options[map[arg]] = resolve(val);
    else if (map[arg] === "maxBytes") options.maxBytes = Number(val) * 1048576;
    else options[map[arg]] = Number(val);
    idx++;
  }
  for (const key of ["start", "limit", "workers", "timeoutMs", "maxBytes"]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === "start" ? 0 : 1))
      throw new Error(`Invalid ${key} (must be a bounded positive integer).`);
  }
  if (options.limit > 500 || options.workers > 6 || options.timeoutMs > 60000 || options.maxBytes > 512 * 1048576)
    throw new Error("Safety bound exceeded (max 500 PDFs, 6 workers, 60 seconds and 512 MiB per job).");
  return options;
}

function existingReport(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch { return []; }
}

function scopedAvailableFile(job, roots) {
  const candidates = [job.source_path, ...job.equivalent_paths];
  for (const location of candidates) {
    if (typeof location !== "string" || !isWithinRoot(location, roots)) continue;
    try {
      if (!existsSync(location)) continue;
      const actual = realpathSync(location);
      if (!isWithinRoot(actual, roots) || !statSync(actual).isFile()) continue;
      // Reject externally supplied symlink aliases resolving into unrelated
      // personal directories or credential-bearing application folders.
      if (lstatSync(location).isSymbolicLink() && !isWithinRoot(actual, roots)) continue;
      return { path: actual, usedMirror: location !== job.source_path };
    } catch { continue; }
  }
  return null;
}

async function inspectPdf(job, options, previous) {
  const source = scopedAvailableFile(job, options.roots);
  const base = { source_sha256: job.source_sha256, source_path: job.source_path,
    document_type: job.document_type, term: job.term, module: job.module,
    week: job.week, answer_variant: job.answer_variant };
  if (!source) {
    const missingVolume = typeof job.source_path === "string"
      && job.source_path.startsWith("/Volumes/JDabSSD/") && !existsSync("/Volumes/JDabSSD");
    return { ...base, status: missingVolume ? "source_volume_unmounted" : "source_path_unavailable",
      reason: missingVolume ? "Authorized external academic drive JDabSSD is disconnected; source is not proven deleted."
        : "No authorized original or identical alias is currently accessible." };
  }
  const st = statSync(source.path);
  const identity = { ...base, resolved_path: source.path, usedMirror: source.usedMirror,
    bytes: st.size, mtime_ms: st.mtimeMs };
  if (st.size === 0 || st.size > options.maxBytes)
    return { ...identity, status: "size_limit_deferred", reason: "Zero-length or over triage byte limit; original stays queued." };
  if (previous && previous.resolved_path === identity.resolved_path
    && previous.bytes === identity.bytes && previous.mtime_ms === identity.mtime_ms
    && previous.sampledPagesMax === 3 && !previous.error)
    return { ...previous, reusedCache: true };

  const opts = { timeout: options.timeoutMs, maxBuffer: 1024 * 1024 };
  try {
    const info = await command("pdfinfo", [source.path], opts);
    const parsed = parsePdfInfo(info.stdout);
    if (!Number.isSafeInteger(parsed.pages) || parsed.pages < 1) {
      return { ...identity, status: "pdfinfo_unreadable", error: "No valid page count" };
    }
    if (parsed.encrypted === true) {
      return { ...identity, pages: parsed.pages, status: "encrypted_pdf_review", reason: "Encrypted; do not attempt automatic password bypass." };
    }
    const lastPage = Math.min(3, parsed.pages);
    const sampled = await command("pdftotext", ["-f", "1", "-l", String(lastPage), "-layout", source.path, "-"], opts);
    const evidence = classifyPdfText(sampled.stdout);
    return { ...identity, pages: parsed.pages, sampledPagesMax: 3,
      sampledPagesActual: lastPage, ...evidence, status: evidence.kind,
      evidence: "Poppler metadata and first 1–3 pages only; complete source/answer/image parsing remains Agent 2's responsibility.",
      source_sha_is_ledger_declared_not_rehashed: true };
  } catch (error) {
    return { ...identity, status: "reader_failure_needs_review",
      error: error?.code === "ETIMEDOUT" ? "timeout" : "reader_failed",
      reason: "Poppler could not inspect this source within the bounded limit." };
  }
}

export function recommendNextSources(rows, excludedShas = new Set(), count = 100) {
  const supported = new Set(["imcq", "pq", "esoft", "review_questions", "small_group", "case"]);
  return rows.filter(row => row.status === "text_with_question_indicators"
    && !excludedShas.has(row.source_sha256))
    .map(row => {
      const score = 100 + Math.min(10, row.sampledQuestionHeadingIndicators ?? 0) * 3
        + Math.min(10, row.sampledChoiceLineIndicators ?? 0)
        + (supported.has(row.document_type) ? 12 : 0)
        + (row.module ? 5 : 0) + (row.term ? 4 : 0) + (row.week ? 2 : 0)
        + (row.answer_variant === "answered_version" ? 3 : 0);
      return { source_sha256: row.source_sha256, source_path: row.resolved_path ?? row.source_path,
        document_type: row.document_type, term: row.term, module: row.module, week: row.week,
        score, sampleQuestionHeadingIndicators: row.sampledQuestionHeadingIndicators,
        sampleChoiceLineIndicators: row.sampledChoiceLineIndicators,
        reviewStatus: "source_prefilter_only_not_answer_validated",
        implementationOwner: "Agent 2 existing PDF parser" };
    })
    .sort((a, b) => b.score - a.score || a.source_sha256.localeCompare(b.source_sha256))
    .slice(0, count);
}

export function recommendBalancedSources(rows, excludedShas = new Set(), count = 100) {
  const candidates = recommendNextSources(rows, excludedShas, rows.length);
  const selected = [], used = new Set();
  const terms = ["T1", "T2", "T3", "T4", "T5"];
  const termQuota = Math.max(1, Math.floor(count / terms.length));
  for (const term of terms) {
    for (const candidate of candidates.filter(item => item.term === term).slice(0, termQuota)) {
      if (used.has(candidate.source_sha256)) continue;
      selected.push(candidate); used.add(candidate.source_sha256);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (used.has(candidate.source_sha256)) continue;
    selected.push(candidate); used.add(candidate.source_sha256);
  }
  return selected.slice(0, count);
}

export function summarizeTriage(rows) {
  const byStatus = {};
  const byModule = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.module) byModule[row.module] = (byModule[row.module] ?? 0) + 1;
  }
  return {
    measuredPdfJobRows: rows.length, byStatus, byModule,
    textWithQuestionIndicators: byStatus.text_with_question_indicators ?? 0,
    lowTextScanOrFigures: byStatus.low_text_scan_or_figures ?? 0,
    unmountedVolumeSources: byStatus.source_volume_unmounted ?? 0,
    unreadableOrDeferred: ["source_path_unavailable","source_volume_unmounted","size_limit_deferred","reader_failure_needs_review","encrypted_pdf_review","pdfinfo_unreadable"]
      .reduce((n, key) => n + (byStatus[key] ?? 0), 0),
    important: "Metadata-only triage is NOT a question count, answer review, source SHA recheck, OCR output, or backend receipt.",
  };
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const jobs = selectPdfJobs(JSON.parse(readFileSync(options.input, "utf8")));
  const slice = jobs.slice(options.start, options.start + options.limit);
  const priorRows = existingReport(options.out);
  const prior = new Map(priorRows.map(row => [row.source_sha256, row]));
  const inspected = Array(slice.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(options.workers, slice.length) }, async () => {
    while (next < slice.length) {
      const index = next++;
      const job = slice[index];
      inspected[index] = await inspectPdf(job, options, prior.get(job.source_sha256));
    }
  }));
  const map = new Map(priorRows.map(row => [row.source_sha256, row]));
  for (const row of inspected) map.set(row.source_sha256, row);
  const rows = [...map.values()].sort((a, b) => a.source_sha256.localeCompare(b.source_sha256));
  let processedB3 = new Set();
  try {
    const b3 = JSON.parse(readFileSync(join(artifactDir, "agent-2-priority-batches.json"), "utf8"))
      .processing_order.find(group => group.id === "B3");
    processedB3 = new Set((b3?.jobs ?? []).map(job => shaPattern.exec(job.canonical_input_key ?? "")?.[1]).filter(Boolean));
  } catch { /* A missing specialist manifest does not alter raw triage counts. */ }
  const report = {
    schema: "axom-academic-pdf-triage-v1", runAt: new Date().toISOString(),
    queuePath: options.input, queueDistinctPdfJobs: jobs.length,
    selectedStart: options.start, selectedJobs: slice.length,
    reportCachedSourceRows: rows.length,
    summary: summarizeTriage(rows),
    alreadyPrioritizedB3SourceHashes: processedB3.size,
    recommendedNextAfterB3: recommendNextSources(rows, processedB3, 100),
    balancedNextAfterB3: recommendBalancedSources(rows, processedB3, 100),
    recommendationEvidence: "Three-page PDF text hints only; full source SHA, answer fidelity, figures and rights require review. Balanced recommendation guarantees up to 20 candidates per represented term (T1–T5) before filling remaining capacity.",
    rows,
  };
  mkdirSync(dirname(options.out), { recursive: true });
  const temp = options.out + ".tmp-agent0";
  writeFileSync(temp, JSON.stringify(report, null, 2) + "\n");
  renameSync(temp, options.out);
  console.log(JSON.stringify({ report: options.out, queuePdfJobs: jobs.length,
    newlyInspected: inspected.length, totalRecorded: rows.length,
    byStatus: report.summary.byStatus }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`academic-pdf-triage: ${error.message}`); process.exitCode = 1; });
}
