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
  for (const type of byType) {
    appendSheet(XLSX, wb, safeSheetName(type), detailRows(logs.filter((log) => log.type === type)), [14, 20, 14, 12, 12, 42]);
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

function safeSheetName(input: string) {
  return input.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Activity";
}
