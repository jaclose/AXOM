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

  it("keeps the old lexical ordering fallback for malformed imported timestamps", async () => {
    writtenSheets.length = 0;
    const valid = entry("valid", "2026-07-12T15:00:00Z", "Review");
    const invalid = entry("invalid", "zzz-not-a-date", "Review");

    await exportActivityWorkbook([valid, invalid]);

    expect(writtenSheets.find((item) => item.name === "Review")?.rows.slice(1).map((row) => row[1]))
      .toEqual([invalid.ts, valid.ts]);
  });
});
