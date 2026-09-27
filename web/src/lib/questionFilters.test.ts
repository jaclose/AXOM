import { describe, expect, it } from "vitest";
import {
  applyQuestionFilter, countActiveFilters, isEmptyQuestionFilter, normalizeQuestionFilter,
  normalizeSavedQuestionFilters,
} from "./questionFilters";
import type { QuestionRecord } from "./questions";

function q(patch: Partial<QuestionRecord> & { id: string }): QuestionRecord {
  return {
    source: "imported", stem: "Stem", options: [{ key: "A", text: "Alpha" }], status: "unseen",
    tags: [], attempts: [], createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", ...patch,
  };
}

const NOW = Date.parse("2026-07-18T12:00:00.000Z");

const bank: QuestionRecord[] = [
  q({ id: "1", stem: "Cardiac output question", tags: ["cardiology", "high-yield"], difficulty: "hard", status: "incorrect", attempts: [{ status: "incorrect", at: "x" } as never], marked: true }),
  q({ id: "2", stem: "Renal tubule", tags: ["renal"], difficulty: "easy", status: "correct", attempts: [{ status: "correct", at: "x" } as never], reviewDueAt: "2026-07-17T00:00:00.000Z", notes: "review this" }),
  q({ id: "3", stem: "Ethics scenario", tags: ["ethics", "high-yield"], difficulty: "medium", status: "unseen", attempts: [], attachments: [{ id: "a", fileName: "f.png", mimeType: "image/png", byteSize: 1, altText: "", createdAt: "x", updatedAt: "x", blobKey: "a" }] }),
  q({ id: "4", stem: "Micro basics", tags: ["microbiology"], status: "unseen", attempts: [], source: "manual" }),
  q({ id: "5", stem: "Other", explanation: "Loop diuretics block NKCC", objective: "Manage pulmonary edema", bank: "BPM week 7", status: "unseen" }),
];

describe("applyQuestionFilter", () => {
  it("empty criteria returns all, order preserved", () => {
    expect(applyQuestionFilter(bank, {}, NOW).map((x) => x.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("search matches stem, tags, and notes", () => {
    expect(applyQuestionFilter(bank, { search: "cardiac" }, NOW).map((x) => x.id)).toEqual(["1"]);
    expect(applyQuestionFilter(bank, { search: "high-yield" }, NOW).map((x) => x.id)).toEqual(["1", "3"]);
    expect(applyQuestionFilter(bank, { search: "review this" }, NOW).map((x) => x.id)).toEqual(["2"]);
    expect(applyQuestionFilter(bank, { search: "nkcc" }, NOW).map((x) => x.id)).toEqual(["5"]);
    expect(applyQuestionFilter(bank, { search: "pulmonary edema" }, NOW).map((x) => x.id)).toEqual(["5"]);
    expect(applyQuestionFilter(bank, { search: "bpm week" }, NOW).map((x) => x.id)).toEqual(["5"]);
  });
  it("tags ALL vs ANY", () => {
    expect(applyQuestionFilter(bank, { tags: ["high-yield", "ethics"], tagMatch: "all" }, NOW).map((x) => x.id)).toEqual(["3"]);
    expect(applyQuestionFilter(bank, { tags: ["high-yield", "renal"], tagMatch: "any" }, NOW).map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
  it("composes facets with AND", () => {
    expect(applyQuestionFilter(bank, { tags: ["high-yield"], difficulty: ["hard"], incorrect: true }, NOW).map((x) => x.id)).toEqual(["1"]);
  });
  it("answered/unanswered", () => {
    expect(applyQuestionFilter(bank, { answered: false }, NOW).map((x) => x.id)).toEqual(["3", "4", "5"]);
    expect(applyQuestionFilter(bank, { answered: true }, NOW).map((x) => x.id)).toEqual(["1", "2"]);
  });
  it("boolean facets: bookmarked, reviewDue, hasAttachment, hasNotes", () => {
    expect(applyQuestionFilter(bank, { bookmarked: true }, NOW).map((x) => x.id)).toEqual(["1"]);
    expect(applyQuestionFilter(bank, { reviewDue: true }, NOW).map((x) => x.id)).toEqual(["2"]);
    expect(applyQuestionFilter(bank, { hasAttachment: true }, NOW).map((x) => x.id)).toEqual(["3"]);
    expect(applyQuestionFilter(bank, { hasNotes: true }, NOW).map((x) => x.id)).toEqual(["2"]);
  });
  it("source facet", () => {
    expect(applyQuestionFilter(bank, { sources: ["manual"] }, NOW).map((x) => x.id)).toEqual(["4"]);
  });
  it("reviewDue excludes future/absent due dates", () => {
    const future = Date.parse("2026-07-16T00:00:00.000Z");
    expect(applyQuestionFilter(bank, { reviewDue: true }, future).map((x) => x.id)).toEqual([]);
  });
});

describe("normalizeQuestionFilter", () => {
  it("drops unknown enums, blank facets, and normalizes tags", () => {
    const c = normalizeQuestionFilter({ tags: ["Cardiology", "cardiology"], difficulty: ["hard", "bogus"], status: ["nope"], search: "  x ", sources: ["manual", "junk"], answered: "yes", bookmarked: true });
    expect(c.tags).toEqual(["cardiology"]);
    expect(c.tagMatch).toBe("all");
    expect(c.difficulty).toEqual(["hard"]);
    expect(c.status).toBeUndefined();
    expect(c.search).toBe("x");
    expect(c.sources).toEqual(["manual"]);
    expect(c.answered).toBeUndefined();
    expect(c.bookmarked).toBe(true);
  });
  it("countActiveFilters / isEmpty", () => {
    expect(isEmptyQuestionFilter({})).toBe(true);
    expect(countActiveFilters({ tags: ["a"], incorrect: true, search: "x" })).toBe(3);
  });
  it("drops false for require-only facets but keeps answered:false (honest active count)", () => {
    const c = normalizeQuestionFilter({ bookmarked: false, incorrect: false, hasNotes: false, answered: false });
    expect(c.bookmarked).toBeUndefined();
    expect(c.incorrect).toBeUndefined();
    expect(c.hasNotes).toBeUndefined();
    expect(c.answered).toBe(false);
    expect(countActiveFilters(c)).toBe(1);
  });
});

describe("normalizeSavedQuestionFilters", () => {
  it("keeps valid presets, dedupes by id, drops nameless/idless", () => {
    const presets = normalizeSavedQuestionFilters([
      { id: "p1", name: "Cardio", criteria: { tags: ["Cardiology"] }, ordering: "random", createdAt: "t", updatedAt: "t" },
      { id: "p1", name: "Cardio dup", criteria: {}, createdAt: "t2", updatedAt: "t2" },
      { id: "", name: "no id", criteria: {} },
      { name: "no id field", criteria: {} },
    ]);
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe("Cardio dup");
    expect(presets[0].ordering).toBeUndefined();
  });
});
