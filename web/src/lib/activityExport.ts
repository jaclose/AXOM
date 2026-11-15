import type { WorkBook } from "xlsx-js-style";
import type { StudyLog } from "./types";

type XlsxModule = typeof import("xlsx-js-style");

const HEADER = {
  font: { bold: true, color: { rgb: "F6FBFF" } },
  fill: { fgColor: { rgb: "236B7D" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

/** Optional workbook writer retains the existing XLSX test seam; account guard is a distinct third argument. */
export async function exportActivityWorkbook(
  logs: StudyLog[],
  saveWorkbook?: (workbook: WorkBook, filename: string) => void,
  assertCurrent?: () => void,
) {
  const XLSX = await import("xlsx-js-style");
  // Lazy module loading crosses an async boundary. Do not serialize a previous account after it.
  assertCurrent?.();
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: "AXOM Activity History", Author: "AXOM", CreatedDate: new Date() };

  appendSheet(XLSX, wb, "Overview", overviewRows(logs), [14, 12, 12, 12]);
  appendSheet(XLSX, wb, "All Activity", detailRows(logs), [14, 20, 14, 12, 12, 42]);

  const byType = [...new Set(logs.map((log) => log.type))].sort();
  // Summary tabs and normalized/truncated study types can share an Excel title.
  // Allocate unique case-insensitive names without merging or dropping any type.
  // Excel reserves "History" even when it is not already used by this workbook.
  const usedSheetNames = new Set([...wb.SheetNames.map((name) => name.toLowerCase()), "history"]);
  for (const type of byType) {
    const baseName = safeSheetName(type);
    let sheetName = baseName;
    let duplicate = 2;
    while (usedSheetNames.has(sheetName.toLowerCase())) {
      const suffix = ` (${duplicate++})`;
      sheetName = `${sheetTitlePrefix(baseName, 31 - suffix.length)}${suffix}`;
    }
    usedSheetNames.add(sheetName.toLowerCase());
    appendSheet(XLSX, wb, sheetName, detailRows(logs.filter((log) => log.type === type)), [14, 20, 14, 12, 12, 42]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // Last possible check before the synchronous download side effect.
  assertCurrent?.();
  const filename = `axom-activity-history-${stamp}.xlsx`;
  if (saveWorkbook) saveWorkbook(wb, filename);
  else XLSX.writeFile(wb, filename);
}

function overviewRows(logs: StudyLog[]) {
  const rows: Array<Array<string | number>> = [["Type", "Events", "Minutes", "Cards"]];
  for (const type of [...new Set(logs.map((log) => log.type))].sort()) {
    const subset = logs.filter((log) => log.type === type);
    rows.push([type, subset.length, sum(subset, "minutes"), sum(subset, "cards")]);
  }
  rows.push(["Total", logs.length, sum(logs, "minutes"), sum(logs, "cards")]);
  return rows;
}

function detailRows(logs: StudyLog[]) {
  return [
    ["Study day", "Timestamp", "Type", "Minutes", "Cards", "Note"],
    ...logs.slice().sort((a, b) => b.ts.localeCompare(a.ts)).map((log) => [
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

function sum(logs: StudyLog[], key: "minutes" | "cards") {
  return logs.reduce((total, log) => total + Number(log[key] || 0), 0);
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
