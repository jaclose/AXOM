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
      writtenSheets.push({ name, rows: sheet.rows });
    },
  },
  writeFile,
}));

function entry(id: string, ts: string, type = "Reading"): StudyLog {
  return { id, ts, type, dayKey: "2026-07-12", minutes: 30, cards: 5 };
}

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
    const sameB = entry("b", "2026-07-12T15:00:00Z", "Review");
    const sameA = entry("a", "2026-07-12T15:00:00Z", "Review");

    await exportActivityWorkbook([invalidA, sameB, invalidZ, sameA]);
    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[1]))
      .toEqual([sameA.ts, sameB.ts, invalidZ.ts, invalidA.ts]);
    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[5]))
      .toEqual(["", "", "", ""]);
  });
});
