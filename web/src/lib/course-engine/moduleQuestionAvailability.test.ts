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


describe("primary-source proof gates runnable course availability", () => {
  it("holds a keyed question whose declared primary collection is missing", () => {
    const orphan = question("orphan", { setId: "missing-source", ...goerScope });
    const before = JSON.stringify(orphan);
    const index = buildQuestionAvailabilityIndex(input([], [orphan]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
      unresolvedWeekQuestions: 1, indexedWeeks: [],
    });
    expect(index.unassignedQuestions).toBe(0);
    expect(JSON.stringify(orphan)).toBe(before);
  });

  it("holds a forged primary membership even if the source collection advertises the same week", () => {
    const source = set("primary", ["not-on-device"], { scope: goerScope });
    const forged = question("forged", { setId: "primary", ...goerScope });
    const index = buildQuestionAvailabilityIndex(input([source], [forged]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
      unresolvedWeekQuestions: 1,
      // The source collection's independently documented week remains indexed.
      indexedWeeks: [2],
    });
    expect(index.unassignedQuestions).toBe(0);
  });

  it("holds a question whose declared week contradicts the exact primary source", () => {
    const primary = set("primary", ["moved"], {
      scope: { module: "GOER", week: 3, courseId: "ppm-501" },
    });
    const moved = question("moved", {
      setId: "primary", module: "GOER", week: 2, courseId: "ppm-501",
      status: "correct", attempts: [{ at: stamp, status: "correct" }],
    });
    const before = JSON.stringify([primary, moved]);
    const index = buildQuestionAvailabilityIndex(input([primary], [moved]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
      unresolvedWeekQuestions: 1, indexedWeeks: [],
    });
    expect(index.unassignedCollections).toBe(1);
    expect(JSON.stringify([primary, moved])).toBe(before);
  });

  it("keeps verified primary membership and legitimate explicitly filed personal questions ready", () => {
    const primary = set("primary", ["verified"], { scope: goerScope });
    const verified = question("verified", { setId: "primary" });
    const personal = question("personal", { setId: undefined, ...goerScope });
    const index = buildQuestionAvailabilityIndex(input([primary], [verified, personal]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 2, readyQuestions: 2, reviewQuestions: 0,
      unresolvedWeekQuestions: 0, indexedWeeks: [2],
    });
  });
});


describe("duplicate original IDs cannot inflate shared academic availability", () => {
  it("holds valid and forged primary copies as one review question in either order", () => {
    const primary = set("primary", ["shared"], { scope: goerScope });
    const legitimate = question("shared", { setId: "primary", ...goerScope });
    const forged = question("shared", { setId: "missing-source", ...goerScope });
    const before = JSON.stringify([primary, legitimate, forged]);
    for (const records of [[legitimate, forged], [forged, legitimate]]) {
      const index = buildQuestionAvailabilityIndex(input([primary], records));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        unresolvedWeekQuestions: 1,
      });
      expect(index.unassignedQuestions).toBe(0);
    }
    expect(JSON.stringify([primary, legitimate, forged])).toBe(before);
  });

  it("holds one original ID with conflicting scoring keys in either order", () => {
    const primary = set("primary", ["shared"], { scope: goerScope });
    const keyA = question("shared", { setId: "primary", ...goerScope, correctKey: "A" });
    const keyB = question("shared", { setId: "primary", ...goerScope, correctKey: "B" });
    for (const records of [[keyA, keyB], [keyB, keyA]]) {
      const index = buildQuestionAvailabilityIndex(input([primary], records));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        unresolvedWeekQuestions: 1,
      });
    }
  });

  it("never allows one reviewed mapping to make an unreviewed duplicate ready", () => {
    const primary = set("primary", ["shared"], { scope: goerScope });
    const ready = question("shared", { setId: "primary", ...goerScope });
    const unreviewed = question("shared", { setId: "primary", ...goerScope,
      extraction: { reviewed: false } as QuestionRecord["extraction"] });
    for (const records of [[ready, unreviewed], [unreviewed, ready]]) {
      const index = buildQuestionAvailabilityIndex(input([primary], records));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
      });
    }
  });

  it("keeps identical source and scoring duplicates eligible exactly once", () => {
    const primary = set("primary", ["shared"], { scope: goerScope });
    const first = question("shared", { setId: "primary", ...goerScope });
    const duplicate = { ...first, updatedAt: "2026-11-06T12:00:00Z" };
    const index = buildQuestionAvailabilityIndex(input([primary], [first, duplicate]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, reviewQuestions: 0,
      unresolvedWeekQuestions: 0, indexedWeeks: [2],
    });
  });

  it("does not attribute the same original ID to two conflicting course owners", () => {
    const goer = set("goer-source", ["shared"], { scope: goerScope });
    const ncrs = set("ncrs-source", ["shared"], {
      scope: { module: "NCRS", week: 4, courseId: "ppm-500" },
    });
    const left = question("shared", { setId: "goer-source", ...goerScope });
    const right = question("shared", { setId: "ncrs-source",
      module: "NCRS", week: 4, courseId: "ppm-500" });
    for (const records of [[left, right], [right, left]]) {
      const index = buildQuestionAvailabilityIndex(input([goer, ncrs], records));
      expect(index.unassignedQuestions).toBe(1);
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))?.readyQuestions ?? 0).toBe(0);
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 4", "NCRS"))?.readyQuestions ?? 0).toBe(0);
    }
  });
});


describe("original-ID collection provenance is independent of record order", () => {
  it("preserves two independently indexed source weeks while holding the conflicted original", () => {
    const second = { module: "GOER", week: 2, courseId: "ppm-501" };
    const third = { module: "GOER", week: 3, courseId: "ppm-501" };
    const sources = [
      set("primary-w2", ["shared"], { scope: second }),
      set("primary-w3", ["shared"], { scope: third }),
    ];
    const q2 = question("shared", { setId: "primary-w2", ...second });
    const q3 = question("shared", { setId: "primary-w3", ...third });
    const before = JSON.stringify([sources, q2, q3]);
    for (const records of [[q2, q3], [q3, q2]]) {
      const index = buildQuestionAvailabilityIndex(input(sources, records));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        unresolvedWeekQuestions: 1, collections: 2, indexedWeeks: [2, 3],
      });
      expect(index.unassignedCollections).toBe(0);
    }
    expect(JSON.stringify([sources, q2, q3])).toBe(before);
  });

  it("does not let a review-only collection create a third source week for the conflict", () => {
    const second = { module: "GOER", week: 2, courseId: "ppm-501" };
    const third = { module: "GOER", week: 3, courseId: "ppm-501" };
    const sources = [
      set("primary-w2", ["shared"], { scope: second }),
      set("primary-w3", ["shared"], { scope: third }),
      set("secondary-review", ["shared"], { scope: { ...third, week: 4 }, kind: "review" }),
    ];
    for (const records of [
      [question("shared", { setId: "primary-w2", ...second }), question("shared", { setId: "primary-w3", ...third })],
      [question("shared", { setId: "primary-w3", ...third }), question("shared", { setId: "primary-w2", ...second })],
    ]) {
      const index = buildQuestionAvailabilityIndex(input(sources, records));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        collections: 2, indexedWeeks: [2, 3],
      });
      expect(index.unassignedCollections).toBe(1);
    }
  });

  it("keeps a compatible independently sourced question eligible when its set also references a held ID", () => {
    const second = { module: "GOER", week: 2, courseId: "ppm-501" };
    const third = { module: "GOER", week: 3, courseId: "ppm-501" };
    const sources = [
      set("primary-w2", ["shared", "distinct"], { scope: second }),
      set("primary-w3", ["shared"], { scope: third }),
    ];
    const q2 = question("shared", { setId: "primary-w2", ...second });
    const q3 = question("shared", { setId: "primary-w3", ...third });
    const distinct = question("distinct", { setId: "primary-w2", ...second });
    for (const rows of [[q2, distinct, q3], [q3, distinct, q2]]) {
      const index = buildQuestionAvailabilityIndex(input(sources, rows));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 2, readyQuestions: 1, reviewQuestions: 1,
        unresolvedWeekQuestions: 1, collections: 2, indexedWeeks: [2, 3],
      });
      expect(index.unassignedCollections).toBe(0);
    }
  });
});


describe("review-only source collections cannot certify unsupported weeks", () => {
  it("holds a review-only week when its sole question declares a missing primary", () => {
    const review = set("secondary", ["unproven"], {
      scope: { module: "GOER", week: 3, courseId: "ppm-501" }, kind: "review",
    });
    const unproven = question("unproven", {
      setId: "missing-source", module: "GOER", week: 3, courseId: "ppm-501",
    });
    const before = JSON.stringify([review, unproven]);
    const index = buildQuestionAvailabilityIndex(input([review], [unproven]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
      unresolvedWeekQuestions: 1, indexedWeeks: [], collections: 0,
    });
    expect(index.unassignedCollections).toBe(1);
    expect(JSON.stringify([review, unproven])).toBe(before);
  });

  it("preserves a review set's aligned week when another valid primary member proves it", () => {
    const scope = { module: "GOER", week: 3, courseId: "ppm-501" };
    const primary = set("primary", ["verified"], { scope });
    const review = set("review", ["verified", "unproven"], { scope, kind: "review" });
    const verified = question("verified", { setId: "primary", ...scope });
    const unproven = question("unproven", { setId: "missing-source", ...scope });
    const index = buildQuestionAvailabilityIndex(input([primary, review], [verified, unproven]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 2, readyQuestions: 1, reviewQuestions: 1,
      unresolvedWeekQuestions: 1, indexedWeeks: [3], collections: 2,
    });
    expect(index.unassignedCollections).toBe(0);
  });
});


describe("review-set weeks require original source or explicit question-week evidence", () => {
  it("does not infer a legacy question's course or week from review-only membership", () => {
    const secondary = set("review-only", ["legacy"], {
      scope: { module: "GOER", week: 3, courseId: "ppm-501" }, kind: "review",
    });
    const legacy = question("legacy", { setId: undefined, module: undefined, week: undefined, courseId: undefined });
    const index = buildQuestionAvailabilityIndex(input([secondary], [legacy]));
    expect(index.unassignedQuestions).toBe(1);
    expect(index.unassignedCollections).toBe(1);
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toBeUndefined();
  });

  it("indexes the true original source week, not a secondary review-set week, for a legacy question", () => {
    const primary = set("original", ["legacy"], {
      scope: { module: "GOER", week: 2, courseId: "ppm-501" },
    });
    const secondary = set("review", ["legacy"], {
      scope: { module: "GOER", week: 4, courseId: "ppm-501" }, kind: "review",
    });
    const legacy = question("legacy", { setId: undefined, module: undefined, week: undefined, courseId: undefined });
    const before = JSON.stringify([primary, secondary, legacy]);
    const index = buildQuestionAvailabilityIndex(input([primary, secondary], [legacy]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, reviewQuestions: 0,
      unresolvedWeekQuestions: 0, indexedWeeks: [2], collections: 1,
    });
    expect(index.unassignedCollections).toBe(1);
    expect(JSON.stringify([primary, secondary, legacy])).toBe(before);
  });

  it("does not invent a week for a personally filed but unscheduled question in a review set", () => {
    const secondary = set("review", ["personal"], {
      scope: { module: "GOER", week: 3, courseId: "ppm-501" }, kind: "review",
    });
    const personal = question("personal", { setId: undefined, module: "GOER", courseId: "ppm-501", week: undefined });
    const index = buildQuestionAvailabilityIndex(input([secondary], [personal]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, reviewQuestions: 0,
      unresolvedWeekQuestions: 1, indexedWeeks: [], collections: 0,
    });
    expect(index.unassignedCollections).toBe(1);
  });
});


describe("held originals cannot erase invalid primary source evidence", () => {
  it("quarantines a source with one incompatible held primary even beside a valid member, both orders", () => {
    const original = set("original", ["verified", "refiled"], { scope: goerScope });
    const verified = question("verified", { setId: "original", ...goerScope });
    const refiled = question("refiled", {
      setId: "original", module: "NCRS", week: 2, courseId: "ppm-500",
    });
    const before = JSON.stringify([original, verified, refiled]);
    for (const rows of [[verified, refiled], [refiled, verified]]) {
      const index = buildQuestionAvailabilityIndex(input([original], rows));
      expect(index.unassignedCollections).toBe(1);
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        collections: 0, storedQuestions: 1, readyQuestions: 1,
      });
    }
    expect(JSON.stringify([original, verified, refiled])).toBe(before);
  });

  it("preserves independently proven original metadata while holding a conflicting duplicate", () => {
    const original = set("original", ["shared"], { scope: goerScope });
    const real = question("shared", { setId: "original", ...goerScope });
    const orphan = question("shared", { setId: "removed-source", ...goerScope });
    for (const rows of [[real, orphan], [orphan, real]]) {
      const index = buildQuestionAvailabilityIndex(input([original], rows));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        collections: 1, storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        indexedWeeks: [2], unresolvedWeekQuestions: 1,
      });
      expect(index.unassignedCollections).toBe(0);
    }
  });
});

describe("secondary collection IDs do not confer primary academic provenance", () => {
  it("holds review, custom and legacy missed-review primary pointers even with matching membership", () => {
    for (const meta of [
      { kind: "review" as const, tags: [] },
      { kind: "custom" as const, tags: [] },
      { kind: undefined, tags: ["missed-review"] },
    ]) {
      const secondary = set("secondary", ["original"], { scope: goerScope, ...meta });
      const original = question("original", {
        setId: "secondary", ...goerScope, status: "correct",
        attempts: [{ at: stamp, status: "correct" }],
      });
      const before = JSON.stringify([secondary, original]);
      const index = buildQuestionAvailabilityIndex(input([secondary], [original]));
      expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
        storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
        unresolvedWeekQuestions: 1, collections: 0, indexedWeeks: [],
      });
      expect(index.unassignedCollections).toBe(1);
      expect(JSON.stringify([secondary, original])).toBe(before);
    }
  });

  it("preserves a compatible generated primary source as a distinct reviewed-content path", () => {
    const generated = set("generated", ["verified"], { scope: goerScope, kind: "generated" });
    const original = question("verified", { setId: "generated", ...goerScope });
    const index = buildQuestionAvailabilityIndex(input([generated], [original]));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, reviewQuestions: 0,
      collections: 1, indexedWeeks: [2],
    });
  });
});

describe("immutable original question body conflicts", () => {
  it("holds duplicate original IDs with different stems or options in both orders", () => {
    const original = question("collision", { setId: "source", ...goerScope });
    const source = set("source", ["collision"], { scope: goerScope, kind: "source" });
    for (const altered of [
      { ...original, stem: "A second, different source question" },
      { ...original, options: [{ key: "A", text: "Changed answer text" }, { key: "B", text: "Other" }] },
      { ...original, questionNumber: 7 },
    ]) {
      for (const pair of [[original, altered], [altered, original]]) {
        const snapshot = JSON.stringify([source, ...pair]);
        const index = buildQuestionAvailabilityIndex(input([source], pair));
        expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
          storedQuestions: 1, readyQuestions: 0, reviewQuestions: 1,
          collections: 1, indexedWeeks: [2],
        });
        expect(index.unassignedQuestions).toBe(0);
        expect(JSON.stringify([source, ...pair])).toBe(snapshot);
      }
    }
  });

  it("does not hold identical source-body clones for learner-owned notes", () => {
    const original = question("equivalent", { setId: "source", ...goerScope });
    const clone = { ...original, notes: "Personal review overlay", marked: true };
    const index = buildQuestionAvailabilityIndex(input(
      [set("source", ["equivalent"], { scope: goerScope })],
      [original, clone],
    ));
    expect(index.byModule.get(questionAvailabilityModuleKey("Term 5", "GOER"))).toMatchObject({
      storedQuestions: 1, readyQuestions: 1, reviewQuestions: 0,
      collections: 1, indexedWeeks: [2],
    });
  });
});
