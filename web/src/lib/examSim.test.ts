import { describe, expect, it } from "vitest";
import { answersFromItems, blockCounts, clockElapsedMs, formatClock, pauseClock, resumeClock, reviewIndices } from "./examSim";
import { searchLabValues, LAB_SECTIONS } from "../data/labValues";

const ids = ["a", "b", "c", "d"];
const items = {
  a: { answerKey: "B", marked: false, struck: [], seconds: 40, visited: true },
  b: { marked: true, struck: ["A"], seconds: 12, visited: true },
  c: { answerKey: "C", marked: true, struck: [], seconds: 80, visited: true },
};

describe("exam simulation engine", () => {
  it("groups items for Item Review", () => {
    expect(blockCounts(ids, items)).toEqual({ answered: 2, incomplete: 2, marked: 2, seen: 3, total: 4 });
    expect(reviewIndices(ids, items, "incomplete")).toEqual([1, 3]);
    expect(reviewIndices(ids, items, "marked")).toEqual([1, 2]);
    expect(reviewIndices(ids, items, "all")).toEqual([0, 1, 2, 3]);
  });

  it("scores only trusted keys and keeps unanswered items as wrong", () => {
    const answers = answersFromItems(ids, items, (id) => (id === "d" ? undefined : "B"));
    expect(answers.map((answer) => answer.correct)).toEqual([true, false, false, undefined]);
    expect(answers[2]).toMatchObject({ answerKey: "C", flagged: true, seconds: 80 });
  });

  it("pauses the block clock on suspend and resumes without counting the gap", () => {
    const running = { elapsedMs: 60_000, runningSince: 1_000 };
    expect(clockElapsedMs(running, 31_000)).toBe(90_000);
    const paused = pauseClock(running, 31_000);
    expect(clockElapsedMs(paused, 999_999)).toBe(90_000);
    expect(clockElapsedMs(resumeClock(paused, 500_000), 510_000)).toBe(100_000);
    expect(formatClock(1799)).toBe("00:29:59");
  });

  it("carries the official NBME lab table and searches it", () => {
    expect(LAB_SECTIONS.map((section) => section.id)).toEqual(["serum", "abg", "csf", "hematologic", "urine", "bmi"]);
    expect(searchLabValues("sodium")[0]).toMatchObject({ range: "136–146 mEq/L", section: "Serum" });
    expect(searchLabValues("csf glucose")).toEqual([expect.objectContaining({ range: "40–70 mg/dL" })]);
    expect(searchLabValues("Na+")[0].name).toBe("Sodium (Na⁺)");
    expect(searchLabValues("")).toEqual([]);
  });
});
