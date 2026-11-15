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

  it("keeps distinct activities when 31-character Excel titles would collide", async () => {
    const shared = "Long protocol study session " + "x".repeat(40);
    const logs = studyLogs([shared + "Alpha", shared + "Beta"]);
    const workbook = await captureWorkbook(logs);
    expectAllTypeSheets(workbook, logs);
    expect(workbook.SheetNames[2]).not.toBe(workbook.SheetNames[3]);
  });
});
