import type { WorkBook } from "xlsx-js-style";
import type { StudyLog } from "./types";

type XlsxModule = typeof import("xlsx-js-style");

const HEADER = {
  font: { bold: true, color: { rgb: "F6FBFF" } },
  fill: { fgColor: { rgb: "236B7D" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

export async function exportActivityWorkbook(logs: StudyLog[]) {
  const XLSX = await import("xlsx-js-style");
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: "AXOM Activity History", Author: "AXOM", CreatedDate: new Date() };

  appendSheet(XLSX, wb, "Overview", overviewRows(logs), [14, 12, 12, 12]);
  appendSheet(XLSX, wb, "All Activity", detailRows(logs), [14, 20, 14, 12, 12, 42]);

  const byType = [...new Set(logs.map((log) => log.type))].sort();
  const usedSheetNames = new Set(["overview", "all activity"]);
  for (const type of byType) {
    appendSheet(XLSX, wb, uniqueSheetName(type, usedSheetNames), detailRows(logs.filter((log) => log.type === type)), [14, 20, 14, 12, 12, 42]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `axom-activity-history-${stamp}.xlsx`);
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
    ...logs.slice().sort(compareExportTimestampDesc).map((log) => [
      log.dayKey,
      log.ts,
      log.type,
      log.minutes,
      log.cards,
      log.note ?? "",
    ]),
  ];
}

/** Export valid instants newest first, then malformed imported timestamps lexically. */
function compareExportTimestampDesc(a: StudyLog, b: StudyLog): number {
  const aTime = Date.parse(a.ts);
  const bTime = Date.parse(b.ts);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  // Never mix epoch and lexical comparisons: that creates non-transitive cycles.
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;

  const timestampOrder = b.ts.localeCompare(a.ts);
  return timestampOrder || a.id.localeCompare(b.id);
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

function uniqueSheetName(input: string, usedNames: Set<string>) {
  const base = safeSheetName(input);
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? "" : ` (${index})`;
    // Suffix truncation can expose an interior apostrophe at the new edge.
    const stem = base.slice(0, 31 - suffix.length).replace(/^'+|'+$/g, "") || "Activity";
    const name = `${stem}${suffix}`;
    const key = name.toLowerCase();
    if (!usedNames.has(key)) {
      usedNames.add(key);
      return name;
    }
  }
}

function safeSheetName(input: string) {
  const base = input.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).replace(/^'+|'+$/g, "") || "Activity";
  // Microsoft Excel reserves History regardless of case.
  return base.toLowerCase() === "history" ? `${base} Sheet` : base;
}
