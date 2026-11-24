import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM, type CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { buildQuestionAvailabilityIndex, questionAvailabilityModuleKey } from "./moduleQuestionAvailability";
import { buildCourseQuestionBank } from "./questionBank";
import { scopeProgress } from "./scope";

const stamp = "2026-10-14T12:00:00.000Z";
const terms = [
  { id: "term-4", name: "Term 4" }, { id: "term-5", name: "Term 5" },
];
const courses = [
  { id: "ppm-500", termId: "term-4", code: "PPM 500", name: "PPM I", files: 0,
    modules: [{ id: "ncrs", name: "NCRS" }] },
  { id: "ppm-501", termId: "term-5", code: "PPM 501", name: "PPM II", files: 0,
    modules: [{ id: "goer", name: "GOER" }] },
];
function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id, source: "imported", stem: `Stem for ${id}`,
    options: [{ key: "A", text: "Correct" }, { key: "B", text: "Other" }],
    correctKey: "A", status: "unseen", attempts: [], tags: [],
    createdAt: stamp, updatedAt: stamp, ...patch,
  };
}
function set(id: string, ids: string[], patch: Partial<QuestionSet> = {}): QuestionSet {
  return {
    id, title: `Collection ${id}`, questionIds: ids, sourceDocumentIds: [],
    parserWarnings: [], createdAt: stamp, tags: [], aiEnhanced: false,
    ...patch,
  };
}
const goerScope = { module: "GOER", week: 2, courseId: "ppm-501" };
const input = (sets: QuestionSet[], questions: QuestionRecord[], curriculum = SGU_CURRICULUM) =>
  ({ terms, courses, sets, questions, curriculum });

describe("course tracker source-versus-question availability", () => {
  it("holds both raw source-set ID collisions before source attribution regardless of scan order", () => {
    const a = set("same", ["ambiguous"], {
      scope: { module: "GOER", week: 2, courseId: "ppm-501" },
      sourceDocumentIds: ["original-a"],
    });
    const b = set("same", ["ambiguous"], {
      scope: { module: "NCRS", week: 6, courseId: "ppm-500" },
      sourceDocumentIds: ["original-b"],
    });
    const clean = set("clean", ["clean-q"], { scope: goerScope });
    const original = JSON.stringify([a, b, clean]);
    for (const originals of [[a, b, clean], [b, a, clean]]) {
      const result = buildQuestionAvailabilityIndex(input(originals, [
        question("ambiguous", { setId: "same" }),
        question("clean-q", { setId: "clean" }),
      ]));
      expect(result.unassignedCollections).toBe(2);
      expect(result.unassignedQuestions).toBe(1);
      expect(result.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        collections: 1, storedQuestions: 1, readyQuestions: 1, indexedWeeks: [2],
      });
      expect(result.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))?.readyQuestions ?? 0).toBe(0);
    }
    expect(JSON.stringify([a, b, clean])).toBe(original);
  });

  it("does not certify a secondary review set using a collided primary source", () => {
    const result = buildQuestionAvailabilityIndex(input([
      set("primary", ["q"], { scope: { module: "NCRS", week: 4, courseId: "ppm-500" } }),
      set("primary", ["q"], { scope: goerScope }),
      set("review", ["q"], { scope: goerScope, kind: "review" }),
    ], [question("q", { setId: "primary" })]));
    expect(result.unassignedCollections).toBe(3);
    expect(result.unassignedQuestions).toBe(1);
    expect(result.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.collections ?? 0).toBe(0);
  });

  it("does not double-credit repeated identical source-set IDs as two collections", () => {
    const a = set("same", ["only"], { scope: goerScope });
    const result = buildQuestionAvailabilityIndex(input([a, structuredClone(a)], [
      question("only", { setId: "same" }),
    ]));
    expect(result.unassignedCollections).toBe(2);
    expect(result.unassignedQuestions).toBe(1);
    expect(result.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.readyQuestions ?? 0).toBe(0);
  });
  it("counts unique locally stored, runnable and review questions, never a source-original receipt", () => {
    const questions = [
      question("ready", { setId: "main" }),
      question("needs-key", { setId: "main", correctKey: undefined }),
      question("other", { setId: "main", extraction: { reviewed: false } as QuestionRecord["extraction"] }),
    ];
    const sets = [
      set("main", ["ready", "needs-key", "other", "not-on-device"], { scope: goerScope }),
      set("review", ["ready", "other", "not-on-device"], { scope: goerScope, kind: "review" }),
    ];
    const report = buildQuestionAvailabilityIndex(input(sets, questions));
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      collections: 2, storedQuestions: 3, readyQuestions: 1,
      reviewQuestions: 2, missingReferencedQuestions: 1,
      indexedWeeks: [2], explicitCourseAssignments: 3, outlineAssignments: 0,
    });
    expect(report.unassignedCollections).toBe(0);
    expect(report.unassignedQuestions).toBe(0);
  });

  it("keeps source-set membership when legacy question rows have no setId", () => {
    const report = buildQuestionAvailabilityIndex(input(
      [set("goer-old", ["legacy"], { scope: { module: "GOER", week: 3 } })],
      [question("legacy", { setId: undefined, module: undefined, courseId: undefined })],
    ));
    expect(report.byModule.get(questionAvailabilityModuleKey("T5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, indexedWeeks: [3],
      explicitCourseAssignments: 0, outlineAssignments: 1,
    });
  });

  it("does not assign stale course ids or disputed module scopes by filename", () => {
    const report = buildQuestionAvailabilityIndex(input(
      [
        set("stale", ["stale-q"], { scope: { module: "GOER", courseId: "missing-course" } }),
        set("mixed", ["q4", "q5"], { scope: undefined }),
      ],
      [
        question("stale-q", { module: "GOER", courseId: "missing-course" }),
        question("q4", { module: "NCRS", courseId: "ppm-500" }),
        question("q5", { module: "GOER", courseId: "ppm-501" }),
      ],
    ));
    expect(report.unassignedCollections).toBe(2);
    expect(report.unassignedQuestions).toBe(1);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))?.storedQuestions).toBe(1);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.storedQuestions).toBe(1);
  });


  it("holds a collection when one of its present members contradicts its course assignment", () => {
    const setWithContradiction = set("conflicted", ["valid", "wrong-course"], {
      scope: { module: "GOER", courseId: "ppm-501", week: 2 },
    });
    const report = buildQuestionAvailabilityIndex(input([setWithContradiction], [
      question("valid", { module: "GOER", courseId: "ppm-501", week: 2 }),
      question("wrong-course", { module: "GOER", courseId: "ppm-500", week: 2 }),
    ]));
    expect(report.unassignedCollections).toBe(1);
    expect(report.unassignedQuestions).toBe(1);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      collections: 0, readyQuestions: 1,
    });
  });

  it("does not assign an arbitrary week when two set memberships disagree", () => {
    const legacy = question("legacy", {
      module: undefined, courseId: undefined, week: undefined, setId: undefined,
    });
    const report = buildQuestionAvailabilityIndex(input([
      set("first", ["legacy"], { scope: { module: "GOER", week: 2 } }),
      set("second", ["legacy"], { scope: { module: "GOER", week: 5 } }),
    ], [legacy]));
    const goer = report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))!;
    expect(goer.storedQuestions).toBe(1);
    expect(goer.unresolvedWeekQuestions).toBe(1);
    // Both collections have distinct, source-indexed weeks. The question
    // itself has no unique assigned week until it is reconciled.
    expect(goer.indexedWeeks).toEqual([2, 5]);
  });


  it("resolves a repeated module in different terms when both collections have explicit course ownership", () => {
    const sharedOutline: CurriculumTemplate = {
      id: "shared-across-terms", label: "Shared module across terms",
      terms: [
        { name: "Term 4", courses: [{ code: "PPM 500", name: "First course", modules: ["SHARED"] }] },
        { name: "Term 5", courses: [{ code: "PPM 501", name: "Second course", modules: ["SHARED"] }] },
      ],
    };
    const sharedCourses = courses.map((entry) => ({
      ...entry, modules: [{ id: entry.id + "-shared", name: "SHARED" }],
    }));
    const indexed = buildQuestionAvailabilityIndex({
      curriculum: sharedOutline, terms, courses: sharedCourses,
      sets: [
        set("t4", ["t4-answer"], { scope: { module: "SHARED", week: 2, courseId: "ppm-500" } }),
        set("t5", ["t5-answer"], { scope: { module: "SHARED", week: 3, courseId: "ppm-501" } }),
      ],
      questions: [
        question("t4-answer", { module: "SHARED", courseId: "ppm-500", week: 2, setId: "t4" }),
        question("t5-answer", { module: "SHARED", courseId: "ppm-501", week: 3, setId: "t5" }),
      ],
    });
    expect(indexed.byModule.size).toBe(2);
    expect(indexed.byModule.get(questionAvailabilityModuleKey("Term 4", "SHARED"))).toMatchObject({
      collections: 1, storedQuestions: 1, readyQuestions: 1, indexedWeeks: [2],
    });
    expect(indexed.byModule.get(questionAvailabilityModuleKey("Term 5", "SHARED"))).toMatchObject({
      collections: 1, storedQuestions: 1, readyQuestions: 1, indexedWeeks: [3],
    });
    expect(indexed.unassignedCollections).toBe(0);
    expect(indexed.unassignedQuestions).toBe(0);
  });

  it("keeps identically named modules in two courses of the same term separate, including their questions", () => {
    const sameTermOutline: CurriculumTemplate = {
      id: "same-term-collision", label: "Same-term collision",
      terms: [{
        name: "Term 4", courses: [
          { code: "PPM 500", name: "Core", modules: ["SHARED"] },
          { code: "ELECTIVE", name: "Elective", modules: ["SHARED"] },
        ],
      }],
    };
    const sameTermCourses = [
      { ...courses[0], modules: [{ id: "core-shared", name: "SHARED" }] },
      { id: "elective", termId: "term-4", code: "ELECTIVE", name: "Elective",
        files: 0, modules: [{ id: "elective-shared", name: "SHARED" }] },
    ];
    const index = buildQuestionAvailabilityIndex({
      curriculum: sameTermOutline, terms, courses: sameTermCourses,
      sets: [
        set("core-bank", ["core"], { scope: { module: "SHARED", courseId: "ppm-500", week: 1 } }),
        set("elective-bank", ["elective"], { scope: { module: "SHARED", courseId: "elective", week: 1 } }),
      ],
      questions: [
        question("core", { setId: "core-bank", module: "SHARED", courseId: "ppm-500", week: 1 }),
        question("elective", { setId: "elective-bank", module: "SHARED", courseId: "elective", week: 1 }),
        question("legacy", { module: "SHARED", week: 1 }),
      ],
    });
    expect(index.byModule.size).toBe(2);
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 4", "SHARED"))).toBeUndefined();
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 4", "SHARED", "PPM 500"))).toMatchObject({
      readyQuestions: 1, collections: 1,
    });
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 4", "SHARED", "ELECTIVE"))).toMatchObject({
      readyQuestions: 1, collections: 1,
    });
    expect(index.unassignedQuestions).toBe(1);
    expect(index.unassignedCollections).toBe(0);
  });

  it("does not infer an owner when the curriculum repeats a module across terms", () => {
    const curriculum: CurriculumTemplate = {
      id: "ambiguous", label: "Repeated",
      terms: [
        { name: "Term 4", courses: [{ code: "T4", name: "One", modules: ["SHARED"] }] },
        { name: "Term 5", courses: [{ code: "T5", name: "Two", modules: ["SHARED"] }] },
      ],
    };
    const report = buildQuestionAvailabilityIndex(input(
      [set("ambiguous", ["q"], { scope: { module: "SHARED", week: 1 } })],
      [question("q", { module: "SHARED", week: 1 })],
      curriculum,
    ));
    expect(report.byModule.size).toBe(0);
    expect(report.unassignedQuestions).toBe(1);
    expect(report.unassignedCollections).toBe(1);
  });
});

describe("raw QuestionRecord identity integrity in availability", () => {
  it("holds both conflicting originals rather than crediting either course or indexing their source set", () => {
    const conflicted = [
      question("same", { setId: "source", module: "GOER", courseId: "ppm-501", week: 2 }),
      question("same", { setId: "source", module: "NCRS", courseId: "ppm-500", week: 1 }),
    ];
    const safe = question("safe", { setId: "source", module: "GOER", courseId: "ppm-501", week: 2 });
    const source = set("source", ["same", "safe"], { scope: goerScope });
    for (const originals of [conflicted, [...conflicted].reverse()]) {
      const before = JSON.stringify([source, originals, safe]);
      const report = buildQuestionAvailabilityIndex(input([source], [...originals, safe]));
      expect(report.unassignedQuestions).toBe(2);
      expect(report.unassignedCollections).toBe(1);
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 1, collections: 0,
      });
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))?.readyQuestions ?? 0).toBe(0);
      expect(JSON.stringify([source, originals, safe])).toBe(before);
    }
  });

  it("holds even byte-identical duplicate originals, never counting a single arbitrary winner as ready", () => {
    const record = question("repeated", { module: "GOER", courseId: "ppm-501", week: 2 });
    const report = buildQuestionAvailabilityIndex(input([], [record, structuredClone(record)]));
    expect(report.unassignedQuestions).toBe(2);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.readyQuestions ?? 0).toBe(0);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.storedQuestions ?? 0).toBe(0);
  });

  it("does not let a distinct review set certify a duplicated original while unrelated sources remain usable", () => {
    const duplicate = question("same", { setId: "primary" });
    const valid = question("valid", { setId: "clean", module: "GOER", courseId: "ppm-501", week: 3 });
    const report = buildQuestionAvailabilityIndex(input([
      set("primary", ["same"], { scope: goerScope }),
      set("review", ["same"], { kind: "review", scope: goerScope }),
      set("clean", ["valid"], { scope: { ...goerScope, week: 3 } }),
    ], [duplicate, structuredClone(duplicate), valid]));
    expect(report.unassignedQuestions).toBe(2);
    expect(report.unassignedCollections).toBe(2);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      collections: 1, readyQuestions: 1, storedQuestions: 1, indexedWeeks: [3],
    });
  });
});

describe("identity-held collections cannot certify inherited scope", () => {
  it("withholds a legacy sibling whose only source evidence is a held mixed collection in either record order", () => {
    const held = set("held", ["dup", "legacy"], { scope: goerScope });
    const rows = [
      question("dup", { module: "NCRS", week: 1, courseId: "ppm-500" }),
      question("dup", { module: "GOER", week: 2, courseId: "ppm-501" }),
      question("legacy"),
    ];
    for (const originals of [rows, [...rows].reverse()]) {
      const before = JSON.stringify([held, originals]);
      const report = buildQuestionAvailabilityIndex(input([held], originals));
      expect(report.unassignedCollections).toBe(1);
      expect(report.unassignedQuestions).toBe(3);
      expect(report.byModule.has(questionAvailabilityModuleKey("Term 5", "GOER"))).toBe(false);
      expect(JSON.stringify([held, originals])).toBe(before);
    }
  });

  it("uses a clean independent membership instead of borrowing or conflicting with a held collection's week", () => {
    const held = set("held", ["dup", "legacy"], { scope: goerScope });
    const clean = set("clean", ["legacy"], { scope: { ...goerScope, week: 4 } });
    const rows = [question("dup"), question("dup"), question("legacy")];
    for (const collections of [[held, clean], [clean, held]]) {
      const report = buildQuestionAvailabilityIndex(input(collections, rows));
      expect(report.unassignedCollections).toBe(1);
      expect(report.unassignedQuestions).toBe(2);
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        collections: 1, storedQuestions: 1, readyQuestions: 1, indexedWeeks: [4], unresolvedWeekQuestions: 0,
      });
    }
  });

  it("preserves explicit own scope but does not inherit a held primary's module or week", () => {
    const held = set("held", ["dup", "primary-only", "own-module", "own-week"], { scope: goerScope });
    const rows = [
      question("dup"), question("dup"),
      question("primary-only", { setId: "held" }),
      question("own-module", { setId: "held", module: "GOER", courseId: "ppm-501" }),
      question("own-week", { module: "GOER", courseId: "ppm-501", week: 3 }),
    ];
    const before = JSON.stringify([held, rows]);
    const report = buildQuestionAvailabilityIndex(input([held], rows));
    expect(report.unassignedCollections).toBe(1);
    expect(report.unassignedQuestions).toBe(3);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      collections: 0, storedQuestions: 2, readyQuestions: 2, indexedWeeks: [3], unresolvedWeekQuestions: 1,
    });
    expect(JSON.stringify([held, rows])).toBe(before);
  });
});

describe("source-week availability proof", () => {
  it("does not infer a week from a set when the question declares an invalid one", () => {
    for (const raw of [0, 100, -1, "2026-11-05", "Week 2-3"]) {
      const report = buildQuestionAvailabilityIndex(input(
        [set("source", ["q"], { scope: goerScope })],
        [question("q", { week: raw as number })],
      ));
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, unresolvedWeekQuestions: 1, collections: 0,
      });
      expect(report.unassignedCollections).toBe(1);
    }
  });

  it("does not borrow a review collection's week when the primary set is unscheduled", () => {
    const report = buildQuestionAvailabilityIndex(input([
      set("primary", ["q"], { scope: { module: "GOER", courseId: "ppm-501" } }),
      set("review", ["q"], { scope: { module: "GOER", courseId: "ppm-501", week: 3 }, kind: "review" }),
    ], [question("q", { setId: "primary" })]));
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, unresolvedWeekQuestions: 1, collections: 1, indexedWeeks: [],
    });
    expect(report.unassignedCollections).toBe(1);
  });

  it("keeps a legacy question unscheduled when one of two sets has no week", () => {
    const report = buildQuestionAvailabilityIndex(input([
      set("dated", ["q"], { scope: { module: "GOER", week: 2 } }),
      set("undated", ["q"], { scope: { module: "GOER" } }),
    ], [question("q")]));
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, unresolvedWeekQuestions: 1, indexedWeeks: [2],
    });
  });

  it("does not attribute a moved question to its previous course's shared module", () => {
    const curriculum: CurriculumTemplate = { id: "collision", label: "Collision",
      terms: [{ name: "Term 4", courses: [
        { code: "PPM 500", name: "Core", modules: ["SHARED"] },
        { code: "ELECTIVE", name: "Elective", modules: ["SHARED"] },
      ] }] };
    const sharedCourses = [
      { ...courses[0], modules: [{ id: "core-shared", name: "SHARED" }] },
      { id: "elective", termId: "term-4", code: "ELECTIVE", name: "Elective", files: 0,
        modules: [{ id: "elective-shared", name: "SHARED" }] },
    ];
    const report = buildQuestionAvailabilityIndex({ curriculum, terms, courses: sharedCourses,
      sets: [set("original", ["moved"], { scope: { module: "SHARED", courseId: "ppm-500", week: 2 } })],
      questions: [question("moved", { setId: "original", courseId: "elective" })],
    });
    expect(report.unassignedQuestions).toBe(1);
    expect(report.unassignedCollections).toBe(1);
  });

  it("holds malformed source-set week metadata rather than displaying indexed weeks", () => {
    for (const raw of [0, 100, "Week 3-4", "2026-11-05"]) {
      const report = buildQuestionAvailabilityIndex(input([
        set("invalid", ["q"], { scope: { module: "GOER", courseId: "ppm-501", week: raw as number } }),
      ], [question("q", { setId: "invalid" })]));
      expect(report.unassignedCollections).toBe(1);
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        indexedWeeks: [], unresolvedWeekQuestions: 1, storedQuestions: 1,
      });
    }
  });

  it("preserves valid legacy week tokens and source IDs without mutating records", () => {
    const source = set("legacy", ["q"], {
      scope: { module: "GOER", week: "Week 3" as unknown as number, courseId: "ppm-501" },
    });
    const record = question("q", { setId: "legacy" });
    const before = JSON.stringify([source, record]);
    const report = buildQuestionAvailabilityIndex(input([source], [record]));
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, collections: 1, indexedWeeks: [3], unresolvedWeekQuestions: 0,
    });
    expect(report.unassignedCollections).toBe(0);
    expect(JSON.stringify([source, record])).toBe(before);
  });
});

describe("current practice eligibility versus recorded scope progress", () => {
  it("counts a clean attempted original once across source and review membership", () => {
    const rows = [question("answered", { setId: "source", status: "correct",
      attempts: [{ at: stamp, answerKey: "A", status: "correct" }] })];
    const collections = [
      set("source", ["answered"], { scope: goerScope }),
      set("review", ["answered"], { scope: goerScope, kind: "review" }),
    ];
    const report = buildQuestionAvailabilityIndex(input(collections, rows));
    const progress = scopeProgress(rows, goerScope, new Map(collections.map((item) => [item.id, item])));
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1,
    });
    expect(progress).toMatchObject({ total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0,
      questionIds: ["answered"] });
    const bank = buildCourseQuestionBank(collections, rows, courses, terms);
    const week = bank.find((item) => item.courseId === "ppm-501")?.weeks.find((item) => item.week === 2);
    expect(week).toMatchObject({ questionIds: ["answered"], ready: 1, attempted: 1, missed: 0 });
  });

  it("holds identical raw copies out of fresh availability without doubling or deleting recorded history", () => {
    const row = question("answered", { setId: "source", status: "correct",
      attempts: [{ at: stamp, answerKey: "A", status: "correct" }] });
    const collections = [set("source", ["answered"], { scope: goerScope })];
    const rows = [row, structuredClone(row)];
    const before = JSON.stringify([collections, rows]);
    const report = buildQuestionAvailabilityIndex(input(collections, rows));
    const progress = scopeProgress(rows, goerScope, new Map(collections.map((item) => [item.id, item])));
    expect(report.unassignedQuestions).toBe(2);
    expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.readyQuestions ?? 0).toBe(0);
    expect(progress).toMatchObject({ total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0,
      questionIds: ["answered"] });
    expect(JSON.stringify([collections, rows])).toBe(before);
  });

  it("withholds contradictory recorded outcomes from both projections in either record order", () => {
    const correct = question("conflict", { setId: "source", status: "correct",
      attempts: [{ at: stamp, answerKey: "A", status: "correct" }] });
    const incorrect = question("conflict", { setId: "source", status: "incorrect",
      attempts: [{ at: stamp, answerKey: "B", status: "incorrect" }] });
    const collections = [set("source", ["conflict"], { scope: goerScope })];
    for (const rows of [[correct, incorrect], [incorrect, correct]]) {
      const before = JSON.stringify([collections, rows]);
      const report = buildQuestionAvailabilityIndex(input(collections, rows));
      const progress = scopeProgress(rows, goerScope, new Map(collections.map((item) => [item.id, item])));
      expect(report.unassignedQuestions).toBe(2);
      expect(report.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.readyQuestions ?? 0).toBe(0);
      expect(progress).toMatchObject({ total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0,
        sourceReviewHeld: 1, questionIds: [] });
      expect(JSON.stringify([collections, rows])).toBe(before);
    }
  });
});

describe("duplicate installed course identity", () => {
  it("holds explicit curriculum ownership in either catalog order and preserves independent source availability", () => {
    const originalCourse = courses[1];
    const other = { ...originalCourse, termId: "term-4", code: "OTHER 500", name: "Other owner" };
    const curriculum = { id: "synthetic", label: "Synthetic outline", terms: [
      { name: "Term 4", courses: [
        { code: "OTHER 500", name: "Other owner", modules: ["GOER"] },
        { code: courses[0].code, name: courses[0].name, modules: ["NCRS"] },
      ] },
      { name: "Term 5", courses: [{ code: originalCourse.code, name: originalCourse.name, modules: ["GOER"] }] },
    ] };
    const collections = [
      set("ambiguous", ["q"], { scope: goerScope }),
      set("secondary", ["q"], { scope: goerScope, kind: "review" }),
      set("clean", ["clean-q"], { scope: { courseId: courses[0].id, module: "NCRS", week: 3 } }),
    ];
    const records = [
      question("q", { setId: "ambiguous", status: "correct",
        attempts: [{ at: stamp, status: "correct", answerKey: "A" }] }),
      question("clean-q", { setId: "clean" }),
    ];
    for (const duplicate of [other, { ...other, modules: [{ id: "other", name: "Other module" }] }, { ...originalCourse }]) {
      for (const catalog of [[originalCourse, duplicate, courses[0]], [duplicate, originalCourse, courses[0]]]) {
        for (const sets of [collections, collections.slice().reverse()]) {
          const snapshot = structuredClone([catalog, sets, records]);
          const result = buildQuestionAvailabilityIndex({ curriculum, terms, courses: catalog, sets, questions: records });
          expect(result.unassignedQuestions).toBe(1);
          expect(result.unassignedCollections).toBe(2);
          expect(result.byModule.size).toBe(1);
          expect(result.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))).toMatchObject({
            readyQuestions: 1, storedQuestions: 1, indexedWeeks: [3], collections: 1,
          });
          expect([catalog, sets, records]).toEqual(snapshot);
        }
      }
    }
  });
});

describe("duplicate installed term identity", () => {
  it("never certifies explicit curriculum ownership from duplicate term IDs while preserving unique outline credit", () => {
    const curriculum: CurriculumTemplate = { id: "term-collision", label: "Synthetic outline", terms: [
      { name: "Term 4", courses: [
        { code: "PPM 501", name: "Shared", modules: ["GOER"] },
        { code: "PPM 500", name: "Independent", modules: ["NCRS", "LEGACY"] },
      ] },
      { name: "Term 5", courses: [{ code: "PPM 501", name: "Shared", modules: ["GOER"] }] },
    ] };
    const collections = [
      set("source", ["q"], { scope: goerScope }),
      set("review", ["q"], { scope: goerScope, kind: "review" }),
      set("clean", ["clean-q"], { scope: { module: "NCRS", courseId: "ppm-500", week: 3 } }),
      set("legacy", ["legacy-q"], { scope: { module: "LEGACY", week: 4 } }),
    ];
    const records = [
      question("q", { setId: "source", status: "correct",
        attempts: [{ at: stamp, status: "correct", answerKey: "A" }] }),
      question("loose", goerScope),
      question("clean-q", { setId: "clean" }),
      question("legacy-q", { setId: "legacy" }),
    ];
    const [independent, term] = terms;
    const variants = [
      { rows: [term], expected: "Term 5" },
      { rows: [{ ...term, name: "Term 4" }], expected: "Term 4" },
      { rows: [], expected: null },
      ...["Term 4", "Term 5", "T5"].map((name) => ({
        rows: [term, { ...term, name }], expected: null,
      })),
    ];
    for (const { rows, expected } of variants) {
      for (const termRows of [rows, rows.slice().reverse()]) {
        for (const sets of [collections, collections.slice().reverse()]) {
          const fixture = { curriculum, terms: [independent, ...termRows], courses, sets, questions: records };
          const before = structuredClone(fixture);
          const result = buildQuestionAvailabilityIndex(fixture);
          expect(result.unassignedQuestions).toBe(expected ? 0 : 2);
          expect(result.unassignedCollections).toBe(expected ? 0 : 2);
          expect(result.byModule.size).toBe(expected ? 3 : 2);
          if (expected) {
            expect(result.byModule.get(questionAvailabilityModuleKey(expected, "GOER"))).toMatchObject({
              readyQuestions: 2, storedQuestions: 2, collections: 2, indexedWeeks: [2],
            });
          } else {
            expect(result.byModule.has(questionAvailabilityModuleKey("Term 4", "GOER"))).toBe(false);
            expect(result.byModule.has(questionAvailabilityModuleKey("Term 5", "GOER"))).toBe(false);
          }
          expect(result.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))).toMatchObject({
            readyQuestions: 1, collections: 1, indexedWeeks: [3],
          });
          expect(result.byModule.get(questionAvailabilityModuleKey("Term 4", "LEGACY"))).toMatchObject({
            readyQuestions: 1, collections: 1, indexedWeeks: [4], outlineAssignments: 1,
          });
          expect(fixture).toEqual(before);
        }
      }
    }
  });
});
