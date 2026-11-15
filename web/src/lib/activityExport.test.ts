import { describe, expect, it } from "vitest";
import type { WorkBook } from "xlsx-js-style";
import { exportActivityWorkbook } from "./activityExport";
import type { StudyLog } from "./types";

function studyLogs(types: string[]): StudyLog[] {
  return types.map((type, index) => ({
    id: `activity-type-${index}`,
    dayKey: "2026-11-14",
    ts: `2026-11-14T12:${String(index).padStart(2, "0")}:00.000Z`,
    type,
    minutes: 10 + index,
    cards: index,
    note: `unique-note-${index}`,
  }));
}

async function captureWorkbook(logs: StudyLog[]): Promise<WorkBook> {
  let captured: WorkBook | undefined;
  await exportActivityWorkbook(logs, (workbook) => { captured = workbook; });
  if (!captured) throw new Error("Workbook writer was not invoked");
  return captured;
}

function expectAllTypeSheets(workbook: WorkBook, logs: StudyLog[]): void {
  expect(workbook.SheetNames).toHaveLength(logs.length + 2);
  expect(workbook.SheetNames.slice(0, 2)).toEqual(["Overview", "All Activity"]);
  expect(new Set(workbook.SheetNames.map((name) => name.toLowerCase())).size).toBe(workbook.SheetNames.length);
  expect(workbook.SheetNames.every((name) => name.length <= 31)).toBe(true);
  const groupedSheets = workbook.SheetNames.slice(2);
  const exported = groupedSheets.map((name) => ({
    type: workbook.Sheets[name]?.C2?.v,
    note: workbook.Sheets[name]?.F2?.v,
  }));
  expect(exported).toEqual(expect.arrayContaining(logs.map((log) => ({
    type: log.type, note: log.note,
  }))));
}

describe("Activity History XLSX sheet title collisions", () => {
  it("preserves each type when a type matches a reserved tab or normalizes to another type", async () => {
    const logs = studyLogs([
      "Anki", "Overview", "overview", "All Activity", "Quiz/Review", "Quiz?Review",
    ]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    // Common nonconflicting names keep their familiar workbook tab.
    expect(workbook.SheetNames).toContain("Anki");
    // The all-activity tab is sorted newest first, independently of type-tab allocation.
    expect(workbook.Sheets["All Activity"]?.C2?.v).toBe(logs[logs.length - 1].type);
  });

  it("exports Excel-valid titles for reserved History, quote boundaries and punctuation-only types", async () => {
    const logs = studyLogs([
      "History", "history", "'History'", "'Anki", "Anki'", "O'Brien", "?", "/", "'", "  ",
    ]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    for (const name of workbook.SheetNames) {
      expect(name.trim()).not.toBe("");
      expect(name).not.toMatch(/^'|'$/);
      expect(name.toLowerCase()).not.toBe("history");
      expect(name).not.toMatch(/[\\/?*[\]:]/);
    }

    // A real .xlsx write/read verifies workbook interoperability, not only in-memory tab names.
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const reloaded = XLSX.read(bytes, { type: "buffer" });
    expect(reloaded.SheetNames).toEqual(workbook.SheetNames);
    for (const name of workbook.SheetNames.slice(2)) {
      expect(reloaded.Sheets[name]?.C2?.v).toBe(workbook.Sheets[name]?.C2?.v);
      expect(reloaded.Sheets[name]?.F2?.v).toBe(workbook.Sheets[name]?.F2?.v);
    }
  });

  it("preserves well-formed Unicode across truncated and suffixed Excel tab names", async () => {
    const logs = studyLogs([
      `${"x".repeat(30)}😀`,
      `${"x".repeat(30)}🚀`,
      `${"x".repeat(30)}🧠`,
      "📚".repeat(16),
      `${"y".repeat(28)}😀💡`,
    ]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    for (const name of workbook.SheetNames) {
      // A UTF-16 slice cannot leave half a surrogate pair in an XML worksheet title.
      expect([...name].some((symbol) => symbol.length === 1 && /[\uD800-\uDFFF]/.test(symbol))).toBe(false);
      expect(name.length).toBeLessThanOrEqual(31);
    }

    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const reloaded = XLSX.read(bytes, { type: "buffer" });
    expect(reloaded.SheetNames).toEqual(workbook.SheetNames);
    for (const name of workbook.SheetNames.slice(2)) {
      expect(reloaded.Sheets[name]?.C2?.v).toBe(workbook.Sheets[name]?.C2?.v);
      expect(reloaded.Sheets[name]?.F2?.v).toBe(workbook.Sheets[name]?.F2?.v);
    }
  });

  it("normalizes cascading edge apostrophes exposed by forbidden title characters", async () => {
    const logs = studyLogs(["'/'Hello", "A'/'", "'?'History", "History'/'", "O'Brien"]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    for (const name of workbook.SheetNames) {
      expect(name).not.toMatch(/^'|'$/);
      expect(name.toLowerCase()).not.toBe("history");
      expect(name).not.toMatch(/[\\/?*[\]:]/);
    }
    // These raw types initially sanitize into "''"-adjacent edge whitespace.
    // The Excel name is disposable; learner-supplied type and note cells are not.
    expect(workbook.SheetNames).toContain("Hello");
    expect(workbook.SheetNames).toContain("A");
    expect(workbook.SheetNames).toContain("O'Brien");
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const restored = XLSX.read(bytes, { type: "buffer" });
    expect(restored.SheetNames).toEqual(workbook.SheetNames);
    for (const name of workbook.SheetNames.slice(2)) {
      expect(restored.Sheets[name]?.C2?.v).toBe(workbook.Sheets[name]?.C2?.v);
      expect(restored.Sheets[name]?.F2?.v).toBe(workbook.Sheets[name]?.F2?.v);
    }
  });

  it("keeps XML-forbidden control characters out of worksheet titles without changing records", async () => {
    const logs = studyLogs([
      "Zero\\u0000Byte", "Control\\u0001Name", "Line\\nBreak", "Tab\\tType",
      "Unit\\u001fSeparator", "Noncharacter\\uFFFEName", "Noncharacter\\uFFFFName",
    ].map((label) => label.replace(/\\\\u([0-9A-Fa-f]{4})/g, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16))).replace(/\\\\n/g, "\\n").replace(/\\\\t/g, "\\t")));
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    for (const name of workbook.SheetNames) {
      for (const character of name) {
        const point = character.codePointAt(0) ?? 0;
        expect(point >= 0x20 && point !== 0xfffe && point !== 0xffff).toBe(true);
      }
    }
    // Only sheet titles are normalized; source type and note cells remain unchanged.
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const restored = XLSX.read(bytes, { type: "buffer" });
    expect(restored.SheetNames).toEqual(workbook.SheetNames);
    for (const name of workbook.SheetNames.slice(2)) {
      expect(restored.Sheets[name]?.C2?.v).toBe(workbook.Sheets[name]?.C2?.v);
      expect(restored.Sheets[name]?.F2?.v).toBe(workbook.Sheets[name]?.F2?.v);
    }
  });

  it("keeps distinct activities when 31-character Excel titles would collide", async () => {
    const shared = "Long protocol study session " + "x".repeat(40);
    const logs = studyLogs([shared + "Alpha", shared + "Beta"]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    expect(workbook.SheetNames[2]).not.toBe(workbook.SheetNames[3]);
  });
});
