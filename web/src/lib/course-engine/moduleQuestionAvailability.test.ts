import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM, type CurriculumTemplate } from "../curricula";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { buildQuestionAvailabilityIndex, questionAvailabilityModuleKey } from "./moduleQuestionAvailability";

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
