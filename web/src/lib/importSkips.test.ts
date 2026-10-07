import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { skipImport, skippedImport, skippedImports, unskipImport } from "./importSkips";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
  removeItem: (key: string) => { values.delete(key); },
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

describe("skipped imports", () => {
  it("remembers a skipped file by its bytes, so a renamed copy is still skipped", () => {
    skipImport({ checksum: "sha-1", fileName: "Week 3 quiz.pdf" }, "2026-10-07T09:00:00.000Z");
    expect(skippedImport("sha-1")).toEqual({ checksum: "sha-1", fileName: "Week 3 quiz.pdf", skippedAt: "2026-10-07T09:00:00.000Z" });
    expect(skippedImport("sha-2")).toBeUndefined();
    expect(skippedImport(undefined)).toBeUndefined();
  });

  it("keeps one entry per file and forgets it when the learner reviews it anyway", () => {
    skipImport({ checksum: "sha-1", fileName: "a.pdf" }, "2026-10-01T00:00:00.000Z");
    skipImport({ checksum: "sha-1", fileName: "a (1).pdf" }, "2026-10-07T00:00:00.000Z");
    skipImport({ checksum: "sha-2", fileName: "b.pdf" }, "2026-10-07T00:00:00.000Z");
    expect(skippedImports().map((entry) => [entry.checksum, entry.fileName])).toEqual([["sha-1", "a (1).pdf"], ["sha-2", "b.pdf"]]);
    unskipImport("sha-1");
    expect(skippedImports().map((entry) => entry.checksum)).toEqual(["sha-2"]);
  });

  it("does nothing for a file with no checksum, and survives storage it cannot read or write", () => {
    skipImport({ fileName: "no-checksum.txt" });
    expect(skippedImports()).toEqual([]);
    values.set("axom.import.skipped.v1", "{not json");
    expect(skippedImports()).toEqual([]);
    values.set("axom.import.skipped.v1", JSON.stringify([{ checksum: 4 }, "x", { checksum: "sha-3", fileName: "c.pdf", skippedAt: "2026-10-07T00:00:00.000Z" }]));
    expect(skippedImports().map((entry) => entry.checksum)).toEqual(["sha-3"]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } });
    expect(() => skipImport({ checksum: "sha-4", fileName: "d.pdf" })).not.toThrow();
    expect(skippedImport("sha-4")).toBeUndefined();
  });
});
