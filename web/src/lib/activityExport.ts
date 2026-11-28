import type { WorkBook } from "xlsx-js-style";
import type { StudyLog } from "./types";

type XlsxModule = typeof import("xlsx-js-style");

const HEADER = {
  font: { bold: true, color: { rgb: "F6FBFF" } },
  fill: { fgColor: { rgb: "236B7D" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

/** A workbook cannot encode isolated UTF-16 surrogates without changing learner text. */
export class ActivityExportTextEncodingError extends Error {
  constructor() {
    super("Activity export stopped: saved text contains invalid Unicode that Excel cannot preserve.");
    this.name = "ActivityExportTextEncodingError";
  }
}

/** Excel cannot reliably represent NaN, infinity or an overflowing numeric summary. */
export class ActivityExportNumericError extends Error {
  constructor() {
    super("Activity export stopped: some saved study numbers or totals cannot be represented in Excel.");
    this.name = "ActivityExportNumericError";
  }
}

/** Excel accepts at most 32,767 text units and 253 line feeds in one cell. */
export class ActivityExportCellLimitError extends Error {
  constructor() {
    super("Activity export stopped: saved text exceeds Excel cell limits.");
    this.name = "ActivityExportCellLimitError";
  }
}

function assertLosslessWorkbookData(logs: StudyLog[]): void {
  // Validate exported numeric cells as well as text; source rows and IDs never change.
  // for...of iterates paired supplementary characters as a single two-unit symbol.
  for (const log of logs) {
    // NaN is otherwise silently converted to a plausible 0 by the overview sum.
    if (!Number.isFinite(log.minutes) || !Number.isFinite(log.cards)) {
      throw new ActivityExportNumericError();
    }
    for (const text of [log.dayKey, log.ts, log.type, log.note]) {
      if (!text) continue;
      // Check the actual XLSX cell content before construction: the writer rejects
      // oversized text, and Excel itself limits line feeds even when the writer does not.
      if (text.length > 32767) throw new ActivityExportCellLimitError();
      let lineFeeds = 0;
      for (const symbol of text) {
        if (symbol.length === 1 && /[\uD800-\uDFFF]/.test(symbol)) {
          throw new ActivityExportTextEncodingError();
        }
        if (symbol === "\n" && ++lineFeeds > 253) throw new ActivityExportCellLimitError();
      }
    }
  }
}

/** Optional workbook writer retains the existing XLSX test seam; account guard is a distinct third argument. */
export async function exportActivityWorkbook(
  logs: StudyLog[],
  saveWorkbook?: (workbook: WorkBook, filename: string) => void,
  assertCurrent?: () => void,
) {
  const XLSX = await import("xlsx-js-style");
  // Lazy module loading crosses an async boundary. Do not serialize a previous account after it.
  assertCurrent?.();
  // Refuse silently lossy XLSX encoding before building or downloading the workbook.
  assertLosslessWorkbookData(logs);
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: "AXOM Activity History", Author: "AXOM", CreatedDate: new Date() };

  // Group once rather than rescanning every source log for each custom activity type.
  const groupedByType = new Map<string, StudyLog[]>();
  for (const log of logs) {
    const group = groupedByType.get(log.type);
    if (group) group.push(log);
    else groupedByType.set(log.type, [log]);
  }
  const byType = [...groupedByType.keys()].sort();
  appendSheet(XLSX, wb, "Overview", overviewRows(logs, byType, groupedByType), [14, 12, 12, 12]);
  appendSheet(XLSX, wb, "All Activity", detailRows(logs), [14, 20, 14, 12, 12, 42]);
  // Summary tabs and normalized/truncated study types can share an Excel title.
  // Allocate unique case-insensitive names without merging or dropping any type.
  // Excel reserves "History" even when it is not already used by this workbook.
  const usedSheetNames = new Set([...wb.SheetNames.map((name) => name.toLowerCase()), "history"]);
  const nextSuffixByPrefix = new Map<string, number>();
  for (const type of byType) {
    const sheetName = allocateActivitySheetName(type, usedSheetNames, nextSuffixByPrefix);
    appendSheet(XLSX, wb, sheetName, detailRows(groupedByType.get(type) ?? []), [14, 20, 14, 12, 12, 42]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // Last possible check before the synchronous download side effect.
  assertCurrent?.();
  const filename = `axom-activity-history-${stamp}.xlsx`;
  if (saveWorkbook) saveWorkbook(wb, filename);
  else XLSX.writeFile(wb, filename);
}


/** Assign an Excel-safe unique title without quadratic retries for shared truncated prefixes.
 * The two maps belong to one workbook; original log types remain untouched.
 */
export function allocateActivitySheetName(
  type: string,
  usedSheetNames: Set<string>,
  nextSuffixByPrefix: Map<string, number>,
): string {
  const baseName = safeSheetName(type);
  let sheetName = baseName;
  let duplicate = 2;
  while (usedSheetNames.has(sheetName.toLowerCase())) {
    const suffix = ` (${duplicate})`;
    const prefix = sheetTitlePrefix(baseName, 31 - suffix.length);
    const prefixKey = prefix.toLowerCase();
    // A previous collision with this *candidate prefix* proves smaller suffixes
    // already occupied, even if the raw 31-character names were distinct.
    const next = nextSuffixByPrefix.get(prefixKey);
    if (next !== undefined && next > duplicate) {
      duplicate = next;
      continue;
    }
    sheetName = `${prefix}${suffix}`;
    nextSuffixByPrefix.set(prefixKey, duplicate + 1);
    duplicate++;
  }
  usedSheetNames.add(sheetName.toLowerCase());
  return sheetName;
}

function overviewRows(logs: StudyLog[], byType: string[], groupedByType: Map<string, StudyLog[]>) {
  const rows: Array<Array<string | number>> = [["Type", "Events", "Minutes", "Cards"]];
  for (const type of byType) {
    const subset = groupedByType.get(type) ?? [];
    rows.push([type, subset.length, sumActivityMetric(subset, "minutes"), sumActivityMetric(subset, "cards")]);
  }
  rows.push(["Total", logs.length, sumActivityMetric(logs, "minutes"), sumActivityMetric(logs, "cards")]);
  return rows;
}

/** Native Date.parse normalizes impossible ISO dates; do not silently promote them
 * to real activity instants. Preserve non-ISO legacy parsing and original strings. */
function parseActivityInstant(ts: string): number {
  const instant = Date.parse(ts);
  if (!Number.isFinite(instant)) return Number.NaN;
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(ts);
  if (date) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > (daysInMonth[month - 1] ?? 0)) return Number.NaN;
  }
  return instant;
}

/** JavaScript UTF-16 ordinal order is independent of the device locale. */
function compareTextCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical, deterministic chronology for both the visible ledger and downloaded XLSX. */
export function compareStudyLogsNewestFirst(a: StudyLog, b: StudyLog): number {
  const aTime = parseActivityInstant(a.ts);
  const bTime = parseActivityInstant(b.ts);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  // Always place malformed legacy timestamps after valid records, without sort cycles.
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;

  // Equal instants with different offsets and exact timestamp duplicates must agree
  // across reorders/filters, even if original insertion order differs.
  // Locale-aware collation differs across browsers and OS locales. Tie order
  // must be stable for exported rows and the visible activity ledger.
  return compareTextCodeUnits(b.ts, a.ts) || compareTextCodeUnits(a.id, b.id);
}

function detailRows(logs: StudyLog[]) {
  return [
    ["Study day", "Timestamp", "Type", "Minutes", "Cards", "Note"],
    ...logs.slice().sort(compareStudyLogsNewestFirst).map((log) => [
      log.dayKey,
      log.ts,
      log.type,
      log.minutes,
      log.cards,
      log.note ?? "",
    ]),
  ];
}

function appendSheet(XLSX: XlsxModule, wb: WorkBook, name: string, rows: unknown[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = HEADER;
  }
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: ws["!ref"] ?? "A1:A1" };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, name);
}

/** Shared guarded total for XLSX overviews and the on-screen Activity History. */
export function sumActivityMetric(logs: StudyLog[], key: "minutes" | "cards"): number {
  // Finite inputs can overflow or lose a nonzero event when a much larger
  // running total absorbs it. A plausible but false overview must not be saved.
  return logs.reduce((running, log) => {
    const value = log[key];
    const next = running + value;
    // Reverse subtraction can also round: (1 + 1e16) - 1 === 1e16.
    // Check the exact represented integer operands when the result leaves the
    // safe-integer range; fully safe integer additions need no BigInt conversion.
    // Preserve ordinary fractional IEEE-754 inputs without imposing exactness.
    const integerOperands = Number.isInteger(running) && Number.isInteger(value);
    const safelyExact = Number.isSafeInteger(running)
      && Number.isSafeInteger(value) && Number.isSafeInteger(next);
    // An integer plus a fractional operand cannot have an exact integer
    // result. If IEEE-754 produces one, some saved fraction was rounded away.
    // A fractional operand can also round to a false *noninteger* total
    // at unsafe magnitudes. Catch both integer and fractional rounded results.
    const roundedFractionToInteger = Number.isInteger(next)
      && Number.isInteger(running) !== Number.isInteger(value);
    // TwoSum's residual detects an unrepresented fractional remainder without
    // changing normal small decimal totals (for example, 0.1 + 0.9).
    // Any fractional operand matters here: a large integer plus a small
    // fraction can round to a different fractional value, not just an integer.
    const unsafeFractionRoundoff = !integerOperands
      && Math.abs(next) >= 2 ** 50
      && (() => {
        const recoveredValue = next - running;
        return (running - (next - recoveredValue)) + (value - recoveredValue) !== 0;
      })();
    if (!Number.isFinite(next)
      || (value !== 0 && next === running)
      || roundedFractionToInteger
      || unsafeFractionRoundoff
      || (integerOperands && !safelyExact && BigInt(next) !== BigInt(running) + BigInt(value))) {
      throw new ActivityExportNumericError();
    }
    return next;
  }, 0);
}

/** Prefix by UTF-16 units without splitting Unicode code points at Excel's 31-unit limit. */
function sheetTitlePrefix(input: string, maxUnits: number): string {
  let prefix = "";
  for (const symbol of input) {
    // Imported labels can contain an isolated surrogate; keep it out of XLSX XML titles.
    const safeSymbol = symbol.length === 1 && /[\uD800-\uDFFF]/.test(symbol) ? " " : symbol;
    if (prefix.length + safeSymbol.length > maxUnits) break;
    prefix += safeSymbol;
  }
  return prefix;
}

function safeSheetName(input: string) {
  // Excel also rejects blank/whitespace-only tabs and names that begin/end with a quote.
  // Strip both spaces and apostrophes at each edge in one pass, including those exposed by sanitization.
  // Worksheet titles must exclude C0 controls and XML-forbidden noncharacters.
  // Only tab labels change; the original activity types and notes remain in data cells.
  const xmlSafe = Array.from(input, (symbol) => {
    const point = symbol.codePointAt(0) ?? 0;
    return point < 0x20 || point === 0xfffe || point === 0xffff ? " " : symbol;
  }).join("");
  const title = sheetTitlePrefix(xmlSafe.replace(/[\\/?*[\]:]/g, " "), 31)
    .replace(/^[\s']+|[\s']+$/g, "");
  return title || "Activity";
}
