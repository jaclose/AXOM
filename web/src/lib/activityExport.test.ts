import { describe, expect, it } from "vitest";
import type { WorkBook } from "xlsx-js-style";
import { ActivityExportCellLimitError, ActivityExportNumericError, ActivityExportTextEncodingError, allocateActivitySheetName, compareStudyLogsNewestFirst, exportActivityWorkbook, sumActivityMetric } from "./activityExport";
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

  it("uses locale-independent Unicode tie breaks for same-instant and invalid timestamps", async () => {
    const logs = studyLogs(["Manual", "Manual", "Manual", "Manual"]);
    logs[0].ts = "2026-11-14T15:00:00Z";
    logs[1].ts = logs[0].ts;
    logs[0].id = "ä-1";
    logs[1].id = "z-1";
    logs[2].ts = "z-invalid";
    logs[3].ts = "ä-invalid";
    const original = logs.map((log) => ({ ...log }));

    // JavaScript's default en-US locale collates ä before z, while Swedish
    // collates it after z. Cross-device exports must use the same ordinal order.
    expect(compareStudyLogsNewestFirst(logs[0], logs[1])).toBeGreaterThan(0);
    expect(compareStudyLogsNewestFirst(logs[2], logs[3])).toBeGreaterThan(0);
    const workbook = await captureWorkbook(logs);
    for (const sheetName of ["All Activity", "Manual"]) {
      expect(Array.from({ length: 4 }, (_, index) => workbook.Sheets[sheetName]?.[`F${index + 2}`]?.v))
        .toEqual(["unique-note-1", "unique-note-0", "unique-note-3", "unique-note-2"]);
    }
    expect(logs).toEqual(original);
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

  it("keeps impossible Gregorian days behind genuine instants in screen and workbook order", async () => {
    const logs = studyLogs(Array(7).fill("Manual"));
    logs[0].ts = "2026-02-29T23:30:00-05:00"; // impossible non-leap February
    logs[1].ts = "2026-11-31T12:00:00Z"; // impossible November 31
    logs[2].ts = "2026-11-30T12:00:00Z"; // valid, newest
    logs[3].ts = "2024-02-29T23:15:00+02:00"; // valid leap day with offset
    logs[4].ts = "1900-02-29T09:00:00Z"; // century is not leap
    logs[5].ts = "2000-02-29T09:00:00Z"; // century divisible by 400 is leap
    logs[6].ts = "not-a-date";
    const source = logs.map((log) => ({ ...log }));
    for (const valid of [logs[2], logs[3], logs[5]]) {
      for (const invalid of [logs[0], logs[1], logs[4], logs[6]]) {
        expect(compareStudyLogsNewestFirst(invalid, valid)).toBeGreaterThan(0);
      }
    }
    const expected = logs.slice().sort(compareStudyLogsNewestFirst).map((log) => log.note);
    expect(expected.slice(0, 3)).toEqual(["unique-note-2", "unique-note-3", "unique-note-5"]);
    const workbook = await captureWorkbook(logs);
    for (const tab of ["All Activity", "Manual"]) {
      expect(Array.from({ length: logs.length }, (_, i) => workbook.Sheets[tab]?.[`F${i + 2}`]?.v))
        .toEqual(expected);
    }
    const XLSX = await import("xlsx-js-style");
    const restored = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
    expect(Array.from({ length: logs.length }, (_, i) => restored.Sheets["All Activity"]?.[`F${i + 2}`]?.v))
      .toEqual(expected);
    expect(logs).toEqual(source);
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


  it("refuses nonfinite minutes and cards before workbook serialization without mutating records", async () => {
    const cases: Array<{ field: "minutes" | "cards"; value: number }> = [
      { field: "minutes", value: Number.NaN },
      { field: "cards", value: Number.POSITIVE_INFINITY },
      { field: "minutes", value: Number.NEGATIVE_INFINITY },
    ];
    for (const { field, value } of cases) {
      const logs = studyLogs(["Manual"]);
      logs[0][field] = value;
      const original = logs.map((log) => ({ ...log }));
      let writerCalls = 0;
      await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
        .rejects.toBeInstanceOf(ActivityExportNumericError);
      expect(writerCalls).toBe(0);
      expect(logs).toEqual(original);
    }
  });

  it("refuses finite totals that silently swallow a nonzero study event", async () => {
    // Both sequences are mathematically nonzero, but ordinary floating-point
    // accumulation yields zero when an intervening contribution disappears.
    for (const field of ["minutes", "cards"] as const) {
      for (const values of [[1e16, 1, -1e16], [-1e16, -1, 1e16]]) {
        const logs = studyLogs(["Manual", "Manual", "Manual"]);
        logs.forEach((log, index) => { log[field] = values[index]; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }
  });

  it("refuses partial loss of integer study contributions before writing workbook", async () => {
    // IEEE-754 can round 1e16 + 5 to 1e16 + 4: unlike fully absorbed
    // increments, the accumulator changes while still losing one saved unit.
    for (const field of ["minutes", "cards"] as const) {
      for (const values of [[1e16, 5, -1e16], [-1e16, -5, 1e16]]) {
        const logs = studyLogs(["Manual", "Manual", "Manual"]);
        logs.forEach((log, index) => { log[field] = values[index]; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }
  });

  it("rejects false exact integer totals when adding a huge value to a small running value", async () => {
    // Reverse subtraction itself rounds here: (1 + 1e16) - 1 === 1e16.
    // The previous delta check therefore permitted a false workbook total.
    for (const field of ["minutes", "cards"] as const) {
      for (const values of [[1, 1e16], [-1, -1e16]]) {
        const logs = studyLogs(["Manual", "Manual"]);
        logs.forEach((log, index) => { log[field] = values[index]; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        expect(() => sumActivityMetric(logs, field)).toThrow(ActivityExportNumericError);
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }
  });

  it("rejects fractional contributions rounded by very large integers before workbook write", async () => {
    // These are valid binary fractions; all three sequences have an exact
    // nonzero mathematical result, but the previous integer-only guard let
    // a false 0 or 4 appear in the overview and in the on-screen total.
    for (const field of ["minutes", "cards"] as const) {
      for (const values of [
        [0.5, 1e16, -1e16],
        [1e16, 4.5, -1e16],
        [0.25, 2 ** 53, -(2 ** 53)],
      ]) {
        const logs = studyLogs(["Manual", "Manual", "Manual"]);
        values.forEach((value, index) => { logs[index][field] = value; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        expect(() => sumActivityMetric(logs, field)).toThrow(ActivityExportNumericError);
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }
  });

  it("accepts exactly representable reverse-order large integer totals", async () => {
    const logs = studyLogs(["Manual", "Manual"]);
    logs[0].minutes = 4;
    logs[1].minutes = 1e16;
    logs[0].cards = -4;
    logs[1].cards = -1e16;
    const original = logs.map((log) => ({ ...log }));
    expect(sumActivityMetric(logs, "minutes")).toBe(1e16 + 4);
    expect(sumActivityMetric(logs, "cards")).toBe(-1e16 - 4);
    const workbook = await captureWorkbook(logs);
    expect(workbook.Sheets["Overview"]?.C2?.v).toBe(1e16 + 4);
    expect(workbook.Sheets["Overview"]?.D2?.v).toBe(-1e16 - 4);
    expect(logs).toEqual(original);
  });

  it("still exports exactly represented large integer additions and ordinary fractions", async () => {
    const logs = studyLogs(["Manual", "Manual", "Manual"]);
    [1e16, 4, -1e16].forEach((value, index) => { logs[index].minutes = value; });
    [0.1, 0.2, 0.3].forEach((value, index) => { logs[index].cards = value; });
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    expect(workbook.Sheets["Overview"]?.C2?.v).toBe(4);
    expect(workbook.Sheets["Overview"]?.D2?.v).toBeCloseTo(0.6);
    expect(logs).toEqual(original);
  });

  it("accepts genuine zero increments even alongside large cancelling counts", async () => {
    const logs = studyLogs(["Manual", "Manual", "Manual"]);
    [1e16, 0, -1e16].forEach((value, index) => { logs[index].minutes = value; });
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    expect(workbook.Sheets["Overview"]?.C2?.v).toBe(0);
    expect(workbook.Sheets["Overview"]?.D2?.v).toBe(3);
    expect(logs).toEqual(original);
  });

  it("refuses finite-input summary overflow rather than producing an infinite Excel total", async () => {
    for (const field of ["minutes", "cards"] as const) {
      const logs = studyLogs(["Manual", "Manual"]);
      for (const log of logs) log[field] = Number.MAX_VALUE;
      const original = logs.map((log) => ({ ...log }));
      let writerCalls = 0;
      await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
        .rejects.toBeInstanceOf(ActivityExportNumericError);
      expect(writerCalls).toBe(0);
      expect(logs).toEqual(original);
    }
  });

  it("preserves finite zeros and normal numeric totals in actual XLSX cells", async () => {
    const logs = studyLogs(["Manual", "Manual"]);
    logs[0].minutes = 0;
    logs[0].cards = 0;
    logs[1].minutes = 42;
    logs[1].cards = 7;
    const original = logs.map((log) => ({ ...log }));
    const workbook = await captureWorkbook(logs);
    expect(workbook.Sheets["Overview"]?.C2?.v).toBe(42);
    expect(workbook.Sheets["Overview"]?.D2?.v).toBe(7);
    expect(workbook.Sheets["All Activity"]?.D3?.v).toBe(0);
    expect(workbook.Sheets["All Activity"]?.E3?.v).toBe(0);
    const XLSX = await import("xlsx-js-style");
    const restored = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
    expect(restored.Sheets["Overview"]?.C2?.v).toBe(42);
    expect(restored.Sheets["Overview"]?.D2?.v).toBe(7);
    expect(restored.Sheets["All Activity"]?.D3?.v).toBe(0);
    expect(logs).toEqual(original);
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


describe("Activity History XLSX asynchronous account and history revocation", () => {
  it("checks the current session before inspecting even an invalid saved numeric row", async () => {
    const logs = studyLogs(["Manual"]);
    logs[0].minutes = Number.NaN;
    const original = logs.map((log) => ({ ...log }));
    const stale = new Error("Session changed before export validation");
    let guardCalls = 0;
    let writerCalls = 0;
    await expect(exportActivityWorkbook(
      logs,
      () => { writerCalls++; },
      () => { guardCalls++; throw stale; },
    )).rejects.toBe(stale);
    expect(guardCalls).toBe(1);
    expect(writerCalls).toBe(0);
    expect(logs).toEqual(original);
  });

  it("rechecks session revision after workbook construction and before any writer", async () => {
    const logs = studyLogs(["Manual", "Manual"]);
    const original = logs.map((log) => ({ ...log }));
    const stale = new Error("Study logs replaced while preparing XLSX");
    let guardCalls = 0;
    let writerCalls = 0;
    await expect(exportActivityWorkbook(
      logs,
      () => { writerCalls++; },
      () => {
        guardCalls++;
        if (guardCalls === 2) throw stale;
      },
    )).rejects.toBe(stale);
    expect(guardCalls).toBe(2);
    expect(writerCalls).toBe(0);
    expect(logs).toEqual(original);
  });

  it("writes a valid workbook when both session checkpoints still match", async () => {
    const logs = studyLogs(["Manual"]);
    const original = logs.map((log) => ({ ...log }));
    let guardCalls = 0;
    let writerCalls = 0;
    let writtenFilename = "";
    let savedWorkbook: WorkBook | undefined;
    await exportActivityWorkbook(logs, (workbook, filename) => {
      writerCalls++;
      writtenFilename = filename;
      savedWorkbook = workbook;
    }, () => { guardCalls++; });
    expect(guardCalls).toBe(2);
    expect(writerCalls).toBe(1);
    expect(writtenFilename).toMatch(/^axom-activity-history-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(savedWorkbook?.Sheets["Overview"]?.C2?.v).toBe(logs[0].minutes);
    expect(savedWorkbook?.Sheets["All Activity"]?.F2?.v).toBe(logs[0].note);
    expect(logs).toEqual(original);
  });
});


describe("lossless unsafe-magnitude two-fraction totals", () => {
  it("refuses a plausible integer when summing two large fractional operands loses a quarter", async () => {
    // Both operands are fractional, so a simple integer-vs-fraction check
    // misses the 0.25 lost when IEEE-754 rounds the result to a large integer.
    for (const field of ["minutes", "cards"] as const) {
      for (const values of [
        [2251799813685247.5, 0.75],
        [4503599627370495.5, 0.75],
      ]) {
        const logs = studyLogs(["Manual", "Manual"]);
        logs.forEach((log, index) => { log[field] = values[index]; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        expect(() => sumActivityMetric(logs, field)).toThrow(ActivityExportNumericError);
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }
  });

  it("keeps exact large fractional cancellation and ordinary decimals exportable", async () => {
    const large = studyLogs(["Manual", "Manual"]);
    large[0].minutes = 2251799813685247.5;
    large[1].minutes = 0.5;
    expect(sumActivityMetric(large, "minutes")).toBe(2251799813685248);
    await expect(captureWorkbook(large)).resolves.toBeDefined();

    const normal = studyLogs(["Manual", "Manual"]);
    normal[0].minutes = 0.1;
    normal[1].minutes = 0.9;
    expect(sumActivityMetric(normal, "minutes")).toBe(1);
    await expect(captureWorkbook(normal)).resolves.toBeDefined();
  });
  it("rejects noninteger rounded totals at large fractional magnitudes without writing XLSX", async () => {
    // A noninteger IEEE-754 result can still have lost an exact saved fraction.
    // TwoSum's residual is nonzero even though the rounded next total is fractional.
    const lossyPairs = [
      [2 ** 50 + 0.25, 0.125],
      [2 ** 50 + 0.25, 0.375],
      [2 ** 50, 0.375],
    ];
    for (const field of ["minutes", "cards"] as const) {
      for (const values of lossyPairs) {
        const logs = studyLogs(["Manual", "Manual"]);
        logs.forEach((log, index) => { log[field] = values[index]; });
        const original = logs.map((log) => ({ ...log }));
        let writerCalls = 0;
        expect(() => sumActivityMetric(logs, field)).toThrow(ActivityExportNumericError);
        await expect(exportActivityWorkbook(logs, () => { writerCalls++; }))
          .rejects.toBeInstanceOf(ActivityExportNumericError);
        expect(writerCalls).toBe(0);
        expect(logs).toEqual(original);
      }
    }

    const exact = studyLogs(["Manual", "Manual"]);
    exact[0].minutes = 2 ** 50 + 0.25;
    exact[1].minutes = 0.5;
    exact[0].cards = 0.1;
    exact[1].cards = 0.9;
    expect(sumActivityMetric(exact, "minutes")).toBe(2 ** 50 + 0.75);
    expect(sumActivityMetric(exact, "cards")).toBe(1);
    await expect(captureWorkbook(exact)).resolves.toBeDefined();
  });

});
