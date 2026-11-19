import { describe, expect, it } from "vitest";
import type { Term, TrackerItem, Course } from "./types";
import type { PrimaryTrackerScope } from "./trackerFocus";
import { absenceStanding, buildModuleWeeks } from "./course-engine/weekView";
import { planTermRename } from "./termRename";

const terms: Term[] = [
  { id: "term-one", name: "Term 1", absenceAllowances: { lecture: 2, "small-group": 1 } },
  { id: "term-ten", name: "Term 10" },
];
const courses: Course[] = [
  { id: "core", termId: "term-one", code: "BPM 500", name: "Core", files: 0,
    modules: [{ id: "ftm", name: "FTM 1" }] },
];
const originalUpdated = "2026-10-05T12:00:00.000Z";
const row = (id: string, path: string, activity: TrackerItem["activity"], attendance?: TrackerItem["attendance"]): TrackerItem => ({
  id, path, label: id, kind: "Lecture", passes: id === "a" ? 3 : 1, ankiPasses: 2,
  yield: "high", note: "keep original notes", updated: originalUpdated,
  activity, attendance, templateKey: `source-${id}`, weekSource: "template",
  passEvents: [{ id: `pass-${id}`, method: "study", at: originalUpdated }],
});
const tracker = [
  row("a", "Term 1/FTM 1/Week 3", "lecture", "missed"),
  row("b", "Term 1/BPM 500/FTM 1/Week 4", "small-group", "missed"),
  row("c", "Term 10/ER/Week 1", "lecture", "missed"),
];
const focus: PrimaryTrackerScope[] = [
  { path: "Term 1/FTM 1", since: originalUpdated },
  { path: "Term 10/ER", since: originalUpdated },
];

describe("term rename keeps Course Tracker attendance and source provenance", () => {
  it("moves both legacy and canonical term paths atomically without altering activity records", () => {
    const before = JSON.stringify({ terms, tracker, focus });
    const result = planTermRename(terms, tracker, focus, "term-one", "Foundations");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms[0]).toEqual({ ...terms[0], name: "Foundations" });
    expect(result.terms[1]).toEqual(terms[1]);
    expect(result.tracker.map(({ path }) => path)).toEqual([
      "Foundations/FTM 1/Week 3",
      "Foundations/BPM 500/FTM 1/Week 4",
      "Term 10/ER/Week 1",
    ]);
    expect(result.tracker.map(({ path: _path, ...rest }) => rest)).toEqual(tracker.map(({ path: _path, ...rest }) => rest));
    expect(result.primaryTrackerScopes).toEqual([
      { ...focus[0], path: "Foundations/FTM 1" }, focus[1],
    ]);
    expect(absenceStanding(result.tracker, result.terms[0])).toEqual([
      { category: "lecture", missed: 1, allowed: 2, remaining: 1 },
      { category: "small-group", missed: 1, allowed: 1, remaining: 0 },
    ]);
    const modules = buildModuleWeeks(result.tracker, [], undefined, {
      terms: result.terms, courses,
    });
    expect(modules.filter((m) => m.term === "Foundations")).toHaveLength(2);
    expect(modules.filter((m) => m.term === "Foundations").every((m) => m.courseId === "core")).toBe(true);
    expect(JSON.stringify({ terms, tracker, focus })).toBe(before);
  });

  it("renames only complete term-path segments, including casing-only corrections", () => {
    const result = planTermRename(terms, tracker, focus, "term-one", "term 1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracker.map((r) => r.path)).toEqual([
      "term 1/FTM 1/Week 3",
      "term 1/BPM 500/FTM 1/Week 4",
      "Term 10/ER/Week 1",
    ]);
  });

  it("fails closed when the destination already contains tracker or focused data", () => {
    for (const destination of ["Term 10", "Claimed"]) {
      const existing = destination === "Claimed"
        ? [...tracker, row("unrelated", "Claimed/Independent/Week 1", "lecture", "missed")]
        : tracker;
      const result = planTermRename(terms, existing, focus, "term-one", destination);
      expect(result.ok).toBe(false);
    }
    expect(planTermRename(terms, tracker, [...focus, { path: "Claimed/Other", since: originalUpdated }],
      "term-one", "Claimed").ok).toBe(false);
  });

  it("does not move a historic path when the old term label belongs to two IDs", () => {
    const ambiguous = [...terms, { id: "collision", name: "TERM 1" }];
    expect(planTermRename(ambiguous, tracker, focus, "term-one", "Foundations").ok).toBe(false);
  });

  it("rejects invalid paths, unknown IDs, and accidental same-label collisions", () => {
    for (const name of ["", "  ", "Term 2/ER", "Term 10", "term 10"]) {
      expect(planTermRename(terms, tracker, focus, "term-one", name).ok).toBe(false);
    }
    expect(planTermRename(terms, tracker, focus, "missing", "New Term").ok).toBe(false);
  });

  it("preserves empty term scopes and allows a rename when no tracker rows exist", () => {
    const result = planTermRename(terms, [], undefined, "term-one", "New Term");
    expect(result).toMatchObject({ ok: true, tracker: [], terms: [
      { id: "term-one", name: "New Term" }, { id: "term-ten", name: "Term 10" },
    ] });
  });
  it("holds a rename rather than moving a second term under a nested historical label", () => {
    const nestedTerms: Term[] = [
      ...terms,
      { id: "nested", name: " term 1 / semester 2 " },
    ];
    const secondTermRow = row(
      "nested-row", "Term 1/Semester 2/BPM 500/Week 1", "lecture", "missed",
    );
    const rows = [...tracker, secondTermRow];
    const pinned = [...focus, { path: "Term 1/Semester 2/BPM 500", since: originalUpdated }];
    const before = JSON.stringify({ nestedTerms, rows, pinned });
    const result = planTermRename(nestedTerms, rows, pinned, "term-one", "Foundations");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/overlap|ambiguous|term/i);
    expect(JSON.stringify({ nestedTerms, rows, pinned })).toBe(before);
  });

  it("refuses a target root already used by a nested term even when that term has no tracker rows", () => {
    const nestedTerms: Term[] = [...terms, { id: "nested", name: "Foundations / Semester 2" }];
    const result = planTermRename(nestedTerms, tracker, focus, "term-one", "Foundations");
    expect(result.ok).toBe(false);
    expect(tracker[0].path).toBe("Term 1/FTM 1/Week 3");
    expect(focus[0].path).toBe("Term 1/FTM 1");
  });

  it("keeps unrelated longer labels disjoint from source and target roots", () => {
    const disjointTerms: Term[] = [...terms, { id: "longer", name: "Foundations Seminar" }];
    const result = planTermRename(disjointTerms, tracker, focus, "term-one", "Foundations");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tracker[0].path).toBe("Foundations/FTM 1/Week 3");
      expect(result.terms.find((term) => term.id === "longer")?.name).toBe("Foundations Seminar");
    }
  });

});
