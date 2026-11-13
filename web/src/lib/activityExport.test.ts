import { describe, expect, it, vi } from "vitest";
import { exportActivityWorkbook } from "./activityExport";
import type { StudyLog } from "./types";

const { writtenSheets, writeFile } = vi.hoisted(() => ({
  writtenSheets: [] as Array<{ name: string; rows: unknown[][] }>,
  writeFile: vi.fn(),
}));

vi.mock("xlsx-js-style", () => ({
  utils: {
    book_new: () => ({}),
    aoa_to_sheet: (rows: unknown[][]) => ({ "!ref": "A1:F3", rows }),
    decode_range: () => ({ s: { c: 0, r: 0 }, e: { c: 5, r: 0 } }),
    encode_cell: ({ c }: { c: number }) => String.fromCharCode(65 + c) + "1",
    book_append_sheet: (_book: unknown, sheet: { rows: unknown[][] }, name: string) => {
      // Excel worksheet names are case-insensitive. Mirror the real writer's collision guard.
      if (
        !name || name.length > 31 ||
        /[\\/?*[\]:]/.test(name) ||
        name.startsWith("'") || name.endsWith("'") ||
        name.toLowerCase() === "history"
      ) {
        throw new Error(`Invalid Excel worksheet: ${name}`);
      }
      if (writtenSheets.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Duplicate worksheet: ${name}`);
      }
      writtenSheets.push({ name, rows: sheet.rows });
    },
  },
  writeFile,
}));

function entry(id: string, ts: string, type = "Reading"): StudyLog {
  return { id, ts, type, dayKey: "2026-07-12", minutes: 30, cards: 5 };
}

describe("activity workbook sheet names", () => {
  it("retains all custom types when sanitized, truncated or case-folded names collide", async () => {
    writtenSheets.length = 0;
    const types = [
      "Anki/Review",
      "Anki?Review",
      "Overview",
      "overview",
      "all activity",
      `${"A".repeat(31)}1`,
      `${"A".repeat(31)}2`,
    ];
    const logs = types.map((type, index) => ({
      ...entry(String(index), "2026-11-13T12:00:00Z", type),
      note: `original:${type}`,
    }));

    await exportActivityWorkbook(logs);

    expect(writtenSheets).toHaveLength(types.length + 2);
    expect(writtenSheets.map((item) => item.name).slice(0, 2)).toEqual(["Overview", "All Activity"]);
    expect(new Set(writtenSheets.map((item) => item.name.toLowerCase())).size).toBe(writtenSheets.length);
    for (const sheet of writtenSheets) {
      expect(sheet.name.length).toBeLessThanOrEqual(31);
    }
    const typeSheets = writtenSheets.slice(2);
    expect(typeSheets.some((item) => item.name === "Anki Review")).toBe(true);
    expect(typeSheets.some((item) => item.name === "Anki Review (2)")).toBe(true);
    expect(typeSheets.map((item) => item.rows[1][5]).sort()).toEqual(logs.map((log) => log.note).sort());
    expect(writtenSheets[1].rows.slice(1).map((row) => row[5]).sort()).toEqual(
      logs.map((log) => log.note).sort(),
    );
  });
});


describe("Excel-compatible custom worksheet names", () => {
  it("avoids reserved History and edge apostrophes, including truncated collision suffixes", async () => {
    writtenSheets.length = 0;
    writeFile.mockClear();
    const stem = `${"A".repeat(26)}'WXYZ`;
    const types = [
      "History",
      "history",
      "'History'",
      "'Rounds",
      "Rounds'",
      "'Rounds'",
      "Rounds",
      "Team's Notes",
      "'",
      `${stem}1`,
      `${stem}2`,
    ];
    const logs = types.map((type, index) => ({
      ...entry(`excel-${index}`, "2026-11-13T12:00:00Z", type),
      note: `source-${index}`,
    }));

    await exportActivityWorkbook(logs);

    expect(writtenSheets).toHaveLength(types.length + 2);
    const names = writtenSheets.map((sheet) => sheet.name);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names).toContain("Team's Notes");
    expect(names).toContain("Rounds");
    expect(names.some((name) => name.toLowerCase() === "history")).toBe(false);
    expect(names.every((name) => !name.startsWith("'") && !name.endsWith("'"))).toBe(true);
    expect(writtenSheets.slice(2).map((sheet) => sheet.rows[1][5]).sort()).toEqual(
      logs.map((log) => log.note).sort(),
    );
    expect(writtenSheets[1].rows.slice(1).map((row) => row[5]).sort()).toEqual(
      logs.map((log) => log.note).sort(),
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("activity workbook chronology", () => {
  it("orders both All Activity and per-type sheets by actual UTC instant across offsets", async () => {
    writtenSheets.length = 0;
    writeFile.mockClear();
    const later = entry("local", "2026-07-12T12:00:00-04:00"); // 16:00 UTC
    const earlier = entry("utc", "2026-07-12T15:00:00Z"); // 15:00 UTC
    const logs = [earlier, later];

    await exportActivityWorkbook(logs);

    for (const name of ["All Activity", "Reading"]) {
      const sheet = writtenSheets.find((item) => item.name === name);
      expect(sheet, `missing ${name} sheet`).toBeDefined();
      expect(sheet?.rows.slice(1).map((row) => row[1])).toEqual([later.ts, earlier.ts]);
    }
    expect(logs).toEqual([earlier, later]);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("places a valid timestamp ahead of a malformed imported timestamp", async () => {
    writtenSheets.length = 0;
    const valid = entry("valid", "2026-07-12T15:00:00Z", "Review");
    const invalid = entry("invalid", "zzz-not-a-date", "Review");

    await exportActivityWorkbook([valid, invalid]);

    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[1]))
      .toEqual([valid.ts, invalid.ts]);
  });

  it("uses one deterministic order for all permutations of valid offsets and malformed records", async () => {
    const a = entry("A", "2026-07-12T12:00:00-04:00"); // 16:00 UTC
    const b = entry("B", "2026-07-12T15:00:00Z"); // 15:00 UTC
    const x = entry("X", "2026-07-12T14:00:00Bad"); // invalid
    const permutations = [[a, b, x], [a, x, b], [b, a, x], [b, x, a], [x, a, b], [x, b, a]];

    for (const logs of permutations) {
      writtenSheets.length = 0;
      await exportActivityWorkbook(logs);
      for (const name of ["All Activity", "Reading"]) {
        expect(writtenSheets.find((item) => item.name === name)?.rows.slice(1).map((row) => row[1]))
          .toEqual([a.ts, b.ts, x.ts]);
      }
    }
  });

  it("orders multiple malformed timestamps lexically and breaks equal timestamps by ID", async () => {
    writtenSheets.length = 0;
    const invalidA = entry("invalid-a", "aaa-not-a-date", "Review");
    const invalidZ = entry("invalid-z", "zzz-not-a-date", "Review");
    const sameB = { ...entry("b", "2026-07-12T15:00:00Z", "Review"), note: "from-b" };
    const sameA = { ...entry("a", "2026-07-12T15:00:00Z", "Review"), note: "from-a" };

    await exportActivityWorkbook([invalidA, sameB, invalidZ, sameA]);
    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[1]))
      .toEqual([sameA.ts, sameB.ts, invalidZ.ts, invalidA.ts]);
    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[5]))
      .toEqual(["from-a", "from-b", "", ""]);
  });
});
