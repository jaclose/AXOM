import { describe, expect, it } from "vitest";
import type { WorkBook } from "xlsx-js-style";
import { ActivityExportCellLimitError, ActivityExportTextEncodingError, allocateActivitySheetName, exportActivityWorkbook } from "./activityExport";
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

  it("uses deterministic cross-offset UTC ties and malformed-timestamp order without mutating rows", async () => {
    const logs = studyLogs(["Manual", "Manual", "Manual", "Manual", "Manual", "Manual"]);
    logs[0].ts = "2026-11-14T10:00:00-05:00"; // 15:00 UTC
    logs[1].ts = "2026-11-14T15:00:00Z";      // same instant, later lexical stamp
    logs[2].ts = "2026-11-14T15:00:00Z";      // identical stamp, higher ID
    logs[3].ts = "2026-11-14T14:00:00Z";      // older valid instant
    logs[4].ts = "not-a-date";
    logs[5].ts = "zzz-invalid";
    const original = logs.map((log) => ({ ...log }));
    const expected = [1, 2, 0, 3, 5, 4].map((index) => `unique-note-${index}`);
    const workbook = await captureWorkbook(logs);
    for (const tab of ["All Activity", "Manual"]) {
      expect(Array.from({ length: 6 }, (_, index) => workbook.Sheets[tab]?.[`F${index + 2}`]?.v))
        .toEqual(expected);
    }
    const XLSX = await import("xlsx-js-style");
    const restored = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
    expect(Array.from({ length: 6 }, (_, index) => restored.Sheets["All Activity"]?.[`F${index + 2}`]?.v))
      .toEqual(expected);
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
    logs.forEach((log, index) => { log.ts = new Date(Date.UTC(2026, 10, 14, 12, 0, index)).toISOString(); });
    const original = logs.map((log) => ({ ...log }));
    let originalRecordReads = 0;
    // Deterministic complexity guard: count reads of source records, not wall-clock time.
    const instrumented = new Proxy(logs, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) originalRecordReads++;
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


  it("bounds collision probing across identical and cross-prefix Excel worksheet title families", () => {
    class CountingSet extends Set<string> {
      probes = 0;
      override has(value: string): boolean {
        this.probes++;
        return super.has(value);
      }
    }
    const samePrefix = Array.from({ length: 420 }, (_, index) => `${"z".repeat(31)}#${index}`);
    const used = new CountingSet(["overview", "all activity", "history"]);
    const suffixCursors = new Map<string, number>();
    const allocated = samePrefix.map((type) => allocateActivitySheetName(type, used, suffixCursors));
    expect(new Set(allocated.map((name) => name.toLowerCase())).size).toBe(samePrefix.length);
    expect(allocated[0]).toBe("z".repeat(31));
    expect(allocated[1]).toBe(`${"z".repeat(27)} (2)`);
    expect(allocated.every((name) => name.length <= 31)).toBe(true);
    expect(used.probes).toBeLessThan(samePrefix.length * 6);

    // All 31-unit bases differ, but fallback suffixes share the same shortened prefix.
    const crossPrefix = Array.from({ length: 420 }, (_, index) =>
      `${"S".repeat(27)}${String(index).padStart(4, "0")}`);
    const reserved = new CountingSet(crossPrefix.map((name) => name.toLowerCase()));
    const crossCursors = new Map<string, number>();
    const crossTitles = crossPrefix.map((name) => allocateActivitySheetName(name, reserved, crossCursors));
    expect(new Set(crossTitles.map((name) => name.toLowerCase())).size).toBe(crossPrefix.length);
    expect(crossTitles.every((name) => name.length <= 31)).toBe(true);
    expect(reserved.probes).toBeLessThan(crossPrefix.length * 6);
  });

  it("roundtrips many colliding type sheets with original source text and notes intact", async () => {
    const types = Array.from({ length: 40 }, (_, index) => `${"x".repeat(31)}-source-${index}`);
    const logs = studyLogs(types);
    const before = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const reloaded = XLSX.read(bytes, { type: "buffer" });
    expect(reloaded.SheetNames).toEqual(workbook.SheetNames);
    for (const name of reloaded.SheetNames.slice(2)) {
      expect(types).toContain(reloaded.Sheets[name]?.C2?.v);
      expect(reloaded.Sheets[name]?.F2?.v).toMatch(/^unique-note-/);
    }
    expect(logs).toEqual(before);
  });


  it("refuses text above Excel cell limits before building or saving XLSX, without changing records", async () => {
    const scenarios = [
      ["note", "n".repeat(32768)],
      ["type", "t".repeat(32768)],
      ["dayKey", "d".repeat(32768)],
      ["ts", "s".repeat(32768)],
      ["note", ("a\n").repeat(254)],
    ] as const;
    for (const [field, value] of scenarios) {
      const logs = studyLogs(["Anki"]);
      logs[0][field] = value;
      const original = logs.map((log) => ({ ...log }));
      let writerCalls = 0;
      await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
        .rejects.toBeInstanceOf(ActivityExportCellLimitError);
      expect(writerCalls).toBe(0);
      expect(logs).toEqual(original);
    }
  });

  it("allows Excel boundary values of 32,767 code units and 253 line feeds", async () => {
    const logs = studyLogs(["Anki"]);
    logs[0].note = "z".repeat(32767);
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const restored = XLSX.read(bytes, { type: "buffer" });
    expect(restored.Sheets["All Activity"]?.F2?.v).toBe(logs[0].note);
    logs[0].note = "a" + "\n".repeat(253) + "b";
    const withLineFeeds = await captureWorkbook(logs);
    const lineFeedBytes = XLSX.write(withLineFeeds, { bookType: "xlsx", type: "buffer" });
    const reloadedLineFeeds = XLSX.read(lineFeedBytes, { type: "buffer" });
    expect(reloadedLineFeeds.Sheets["All Activity"]?.F2?.v).toBe(logs[0].note);
    expect(original[0].note).toHaveLength(32767);
  });

  it("refuses malformed UTF-16 source text before invoking any XLSX writer, preserving original records", async () => {
    const loneHigh = String.fromCharCode(0xd800);
    const loneLow = String.fromCharCode(0xdc00);
    for (const [field, value] of [
      ["type", "B" + loneHigh + "C"],
      ["note", "B" + loneLow + "C"],
      ["ts", "2026-11-14T" + loneHigh],
      ["dayKey", "2026-11-" + loneLow],
    ] as const) {
      const logs = studyLogs(["Anki"]);
      logs[0][field] = value;
      const original = logs.map((log) => ({ ...log }));
      let writerInvocations = 0;
      await expect(exportActivityWorkbook(logs, () => { writerInvocations++; }))
        .rejects.toBeInstanceOf(ActivityExportTextEncodingError);
      expect(writerInvocations).toBe(0);
      expect(logs).toEqual(original);
    }
  });

  it("roundtrips valid paired Unicode in types and notes without a destructive encoding workaround", async () => {
    const logs = studyLogs(["Anki📚😀", "B🚀C"]);
    logs[0].note = "valid supplementary characters 🧠🫀";
    logs[1].note = "B😀C";
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    const XLSX = await import("xlsx-js-style");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const reloaded = XLSX.read(bytes, { type: "buffer" });
    expectAllTypeSheets(reloaded, logs);
    expect(logs).toEqual(original);
  });

});
