import { describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx-js-style";
import { exportActivityWorkbook } from "./activityExport";
import type { StudyLog } from "./types";
import type { WorkBook } from "xlsx-js-style";

// Keep the real XLSX writer/reader. Replace only the browser file-save side effect.
const { written } = vi.hoisted(() => ({
  written: [] as Array<{ filename: string; bytes: Uint8Array }>,
}));

vi.mock("xlsx-js-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx-js-style")>();
  return {
    ...actual,
    writeFile: (workbook: WorkBook, filename: string) => {
      written.push({
        filename,
        bytes: actual.write(workbook, { bookType: "xlsx", type: "buffer" }) as Uint8Array,
      });
    },
  };
});

function worksheetRows(book: WorkBook, name: string): unknown[][] {
  const sheet = book.Sheets[name];
  expect(sheet, `missing worksheet ${name}`).toBeDefined();
  return utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
}

describe("real activity XLSX binary roundtrip", () => {
  it("serializes Excel-compatible unique sheets and restores every original activity row", async () => {
    written.length = 0;
    const longStem = "A".repeat(31);
    const suffixStem = `${"A".repeat(26)}'WXYZ`;
    const types = [
      "History",
      "history",
      "'History'",
      "'Rounds",
      "Rounds'",
      "Team's Notes",
      "Overview",
      "overview",
      "all activity",
      "Anki/Review",
      "Anki?Review",
      `${longStem}1`,
      `${longStem}2`,
      `${suffixStem}1`,
      `${suffixStem}2`,
    ];
    const logs: StudyLog[] = types.map((type, index) => ({
      id: `xlsx-${index}`,
      type,
      ts: `2026-11-13T${String(index).padStart(2, "0")}:00:00Z`,
      dayKey: "2026-11-13",
      minutes: index + 1,
      cards: index * 2,
      note: index === 0 ? "=SUM(1,1) preserved as text" : `source:${index}`,
    }));
    const before = JSON.stringify(logs);

    await exportActivityWorkbook(logs);

    expect(written).toHaveLength(1);
    expect(written[0].filename).toMatch(/^axom-activity-history-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(written[0].bytes.byteLength).toBeGreaterThan(1000);

    // A real ZIP/XLSX serialization and parser, not the worksheet-name-only unit mock.
    const book = read(written[0].bytes, { type: "buffer" });
    expect(book.SheetNames).toHaveLength(types.length + 2);
    expect(book.SheetNames.slice(0, 2)).toEqual(["Overview", "All Activity"]);
    expect(new Set(book.SheetNames.map((name) => name.toLowerCase())).size)
      .toBe(book.SheetNames.length);
    for (const name of book.SheetNames) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[\\/?*[\]:]/);
      expect(name.startsWith("'") || name.endsWith("'")).toBe(false);
      expect(name.toLowerCase()).not.toBe("history");
    }

    const fromAll = worksheetRows(book, "All Activity").slice(1).map((row) => [
      row[2], row[3], row[4], row[5],
    ]);
    const fromTypes = book.SheetNames.slice(2).map((name) => {
      const rows = worksheetRows(book, name);
      expect(rows).toHaveLength(2);
      return [rows[1][2], rows[1][3], rows[1][4], rows[1][5]];
    });
    const expected = logs.map((log) => [log.type, log.minutes, log.cards, log.note]);
    const sorted = (rows: unknown[][]) => rows.map((row) => JSON.stringify(row)).sort();
    expect(sorted(fromAll)).toEqual(sorted(expected));
    expect(sorted(fromTypes)).toEqual(sorted(expected));
    expect(worksheetRows(book, "Overview").at(-1)?.slice(0, 2))
      .toEqual(["Total", types.length]);
    expect(JSON.stringify(logs)).toBe(before);
  });
});
