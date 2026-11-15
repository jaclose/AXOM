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
      "Zero\u0000Byte", "Control\u0001Name", "Line\nBreak", "Tab\tType",
      "Unit\u001fSeparator", "Noncharacter\uFFFEName", "Noncharacter\uFFFFName",
    ]);
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

  it("orders offset-aware ISO events by instant without changing source timestamps", async () => {
    const logs = studyLogs(["Manual", "Manual", "Manual"]);
    logs[0].ts = "2026-11-14T10:00:00-05:00"; // 15:00 UTC, latest
    logs[1].ts = "2026-11-14T14:00:00.000Z"; // 14:00 UTC
    logs[2].ts = "2026-11-14T10:00:00+01:00"; // 09:00 UTC, earliest
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    expect(workbook.SheetNames).toEqual(["Overview", "All Activity", "Manual"]);
    for (const sheetName of ["All Activity", "Manual"]) {
      const sheet = workbook.Sheets[sheetName];
      expect([sheet?.F2?.v, sheet?.F3?.v, sheet?.F4?.v])
        .toEqual(["unique-note-0", "unique-note-1", "unique-note-2"]);
      expect([sheet?.B2?.v, sheet?.B3?.v, sheet?.B4?.v])
        .toEqual(original.map((log) => log.ts));
    }
    // The workbook must remain readable, and no input log may be rewritten.
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const restored = XLSX.read(bytes, { type: "buffer" });
    expect(restored.SheetNames).toEqual(workbook.SheetNames);
    expect([restored.Sheets["All Activity"]?.F2?.v, restored.Sheets["All Activity"]?.F3?.v,
      restored.Sheets["All Activity"]?.F4?.v]).toEqual([
      "unique-note-0", "unique-note-1", "unique-note-2",
    ]);
    expect(logs).toEqual(original);
  });

  it("keeps distinct activities when 31-character Excel titles would collide", async () => {
    const shared = "Long protocol study session " + "x".repeat(40);
    const logs = studyLogs([shared + "Alpha", shared + "Beta"]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    expect(workbook.SheetNames[2]).not.toBe(workbook.SheetNames[3]);
  });
  it("groups many distinct types without rescanning every original activity for each worksheet", async () => {
    const types = Array.from({ length: 80 }, (_, index) => `custom-type-${String(index).padStart(3, "0")}`);
    const logs = studyLogs(types);
    const original = logs.map((log) => ({ ...log }));
    let originalRecordReads = 0;
    // Deterministic complexity guard: count reads of source records, not wall-clock time.
    const instrumented = new Proxy(logs, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\\d+$/.test(property)) originalRecordReads++;
        return Reflect.get(target, property, receiver);
      },
    });
    const workbook = await captureWorkbook(instrumented);
    expect(originalRecordReads).toBeLessThan(logs.length * 10);
    expect(workbook.SheetNames).toEqual(["Overview", "All Activity", ...types]);
    expect(workbook.Sheets["Overview"]?.B82?.v).toBe(logs.length);
    expect(workbook.Sheets["Overview"]?.C82?.v).toBe(
      logs.reduce((sum, log) => sum + log.minutes, 0),
    );
    expect(workbook.Sheets["Overview"]?.D82?.v).toBe(
      logs.reduce((sum, log) => sum + log.cards, 0),
    );
    expect(workbook.Sheets["All Activity"]?.F2?.v).toBe("unique-note-79");
    expect(logs).toEqual(original);
  });

});
