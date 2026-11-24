import { describe, expect, it } from "vitest";
import type { Course } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { bankSource, buildCourseQuestionBank, courseForScope } from "./questionBank";
import { buildQuestionAvailabilityIndex } from "./moduleQuestionAvailability";

const course: Course = { id: "c1", termId: "t1", code: "TEST 1", name: "First course", files: 0, modules: [{ id: "m1", name: "FTM 1" }] };
const question: QuestionRecord = { id: "q1", source: "manual", stem: "Which sample?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
  correctKey: "A", status: "correct", tags: [], attempts: [{ at: "2026-10-08", status: "correct", answerKey: "A" }], createdAt: "2026-10-08", updatedAt: "2026-10-08", setId: "s1" };
const set: QuestionSet = { id: "s1", title: "IMCQ 1", questionIds: ["q1"], sourceDocumentIds: [], tags: [], aiEnhanced: false,
  parserWarnings: [], createdAt: "2026-10-08", scope: { module: "FTM 1", week: 2 } };
const term = { id: "t1", name: "Term 1" };
const indexed = (sets: QuestionSet[], questions: QuestionRecord[], courses: Course[] = [course]) =>
  buildCourseQuestionBank(sets, questions, courses, [term]);

describe("course bank read model", () => {
  it("uses canonical primary membership, counts same-week reviews once and sorts source weeks numerically", () => {
    const later = { ...set, id: "later", questionIds: ["q2"], scope: { module: "ftm1", week: 10 } };
    const [module] = indexed([set, { ...set, id: "review", kind: "review" }, later],
      [question, { ...question, id: "q2", setId: "later" }]);
    expect(module).toMatchObject({ module: "FTM 1", term: "Term 1", course: "First course", courseId: "c1" });
    expect(module.weeks.map((week) => week.week)).toEqual([2, 10]);
    expect(module.weeks[0]).toMatchObject({ questionIds: ["q1"], attempted: 1, ready: 1 });
    expect(module.weeks[0].sets).toHaveLength(2);
    expect(module.weeks[1].questionIds).toEqual(["q2"]);
  });
  it("does not choose between two courses that teach the same module", () => {
    const second = { ...course, id: "c2", termId: "t2" };
    expect(courseForScope(set.scope!, [course, second])).toBeUndefined();
    expect(courseForScope({ ...set.scope, courseId: "c2" }, [course, second])).toBe(second);
    const other = { ...set, id: "other", questionIds: ["q2"], scope: { ...set.scope!, courseId: "c2" } };
    const modules = indexed([set, other], [question, { ...question, id: "q2", setId: "other" }], [course, second]);
    expect(modules).toHaveLength(2);
    expect(modules.find((module) => !module.courseId)?.term).toBe("Not yet assigned");
    expect(modules.find((module) => module.courseId === "c2")?.weeks[0].questionIds).toEqual(["q2"]);
  });
  it("infers legacy set scope from unanimous question fields and leaves mixed sets unfiled", () => {
    const legacy = { ...set, scope: undefined };
    const qs = [{ ...question, module: "FTM 1", week: 3 }, { ...question, id: "q2", setId: undefined, module: "FTM 2", week: 4 }];
    const bank = indexed([legacy, { ...legacy, id: "mixed", questionIds: ["q1", "q2"] }], qs);
    expect(bank[0].weeks[0].week).toBe(3);
    expect(bank[1].module).toBe("Unfiled & mixed");
  });
  it("does not count a question in a stale week, module or course after primary refiling", () => {
    const source = { ...set, scope: { module: "FTM 1", week: 2, courseId: "c1" } };
    for (const moved of [{ week: 3 }, { module: "FTM 2" }, { courseId: "c2" }]) {
      expect(indexed([source], [{ ...question, ...moved }])).toEqual([]);
    }
  });
  it("holds an entire collection if one member contradicts the indexed week", () => {
    const source = { ...set, questionIds: ["q1", "q2"] };
    const changed = { ...question, id: "q2", week: 3 };
    expect(indexed([source], [question, changed])).toEqual([]);
  });
  it("does not give a primary question a second week through a review collection", () => {
    const secondary = { ...set, id: "secondary", kind: "review" as const, scope: { module: "FTM 1", week: 3 } };
    const [module] = indexed([set, secondary], [question]);
    expect(module.weeks.map((week) => week.week)).toEqual([2]);
    expect(module.weeks[0].sets.map((entry) => entry.id)).toEqual(["s1"]);
  });
  it("holds a secondary review collection when its declared primary contradicts valid own filing", () => {
    const record = { ...question, setId: "primary", module: "FTM 1", week: 2, courseId: "c1" };
    const review = { ...set, id: "secondary", kind: "review" as const, scope: { module: "FTM 1", week: 2, courseId: "c1" } };
    for (const primaryScope of [
      { module: "FTM 2", week: 2, courseId: "c1" },
      { module: "FTM 1", week: 3, courseId: "c1" },
      { module: "FTM 1", week: 2, courseId: "c2" },
    ]) {
      const original = { ...set, id: "primary", scope: primaryScope };
      for (const collections of [[original, review], [review, original]]) {
        expect(indexed(collections, [record])
          .flatMap((module) => module.weeks.flatMap((week) => week.questionIds))).toEqual([]);
      }
    }
    const consistent = { ...set, id: "primary", scope: { module: "FTM 1", week: 2, courseId: "c1" } };
    expect(indexed([review, consistent], [record])[0].weeks[0].questionIds).toEqual(["q1"]);
  });

  it("does not borrow a review collection when an explicit primary lacks this question", () => {
    const record = { ...question, setId: "primary", module: "FTM 1", week: 2, courseId: "c1" };
    const secondary = { ...set, id: "secondary", kind: "review" as const, scope: { module: "FTM 1", week: 2, courseId: "c1" } };
    expect(indexed([{ ...set, id: "primary", questionIds: [] }, secondary], [record])
      .flatMap((module) => module.weeks.flatMap((week) => week.questionIds))).toEqual([]);
  });

  it("requires unanimous valid source membership to infer legacy questions with no primary set", () => {
    const legacy = { ...question, setId: undefined };
    const agree = { ...set, id: "agree" };
    const [module] = indexed([set, agree], [legacy]);
    expect(module.weeks[0]).toMatchObject({ week: 2, questionIds: ["q1"], ready: 1, attempted: 1 });
    expect(module.weeks[0].sets).toHaveLength(2);
    const conflicting = { ...set, id: "elsewhere", scope: { module: "FTM 1", week: 3 } };
    expect(indexed([set, conflicting], [legacy])).toEqual([]);
  });
  it("keeps inferred legacy week and counts stable regardless of review collection ordering", () => {
    const legacy = { ...question, setId: undefined };
    const review = { ...set, id: "secondary", kind: "review" as const };
    const left = indexed([review, set], [legacy]);
    const right = indexed([set, review], [legacy]);
    expect(left[0].weeks[0].questionIds).toEqual(["q1"]);
    expect(left[0].weeks[0].ready).toBe(1);
    expect(left[0].weeks[0].attempted).toBe(1);
    expect(right[0].weeks[0].questionIds).toEqual(["q1"]);
    expect(right[0].weeks[0].ready).toBe(1);
  });
  it("does not borrow a week from a review collection if the declared primary set is absent", () => {
    expect(indexed([set], [{ ...question, setId: "missing" }])).toEqual([]);
  });
  it("holds invalid explicit source and question weeks rather than inventing a week", () => {
    for (const invalid of [0, "2026-11-06", "Week 2-3", 101]) {
      expect(indexed([{ ...set, scope: { ...set.scope!, week: invalid as number } }], [question])).toEqual([]);
      expect(indexed([set], [{ ...question, week: invalid as number }])).toEqual([]);
    }
    expect(indexed([{ ...set, scope: { ...set.scope!, week: "Week 2" as unknown as number } }], [question])[0].weeks[0].week).toBe(2);
  });
  it("rejects cross-course members when an unowned set infers a course from its module", () => {
    const source = { ...set, questionIds: ["q1", "q2"] };
    const other = { ...question, id: "q2", courseId: "c2" };
    expect(indexed([source], [{ ...question, courseId: "c1" }, other])).toEqual([]);
  });
  it("does not treat an ownerless source week as a course-indexed week", () => {
    const source = { ...set, scope: { week: 2 } };
    expect(indexed([source], [question])).toEqual([]);
  });
  it("does not infer a source week from review-only legacy memberships", () => {
    const legacy = { ...question, setId: undefined };
    expect(indexed([{ ...set, kind: "review" }], [legacy])).toEqual([]);
  });
  it("rejects a secondary review-set member when its claimed primary source does not contain it", () => {
    const emptyPrimary = { ...set, questionIds: [] };
    const secondary = { ...set, id: "secondary", kind: "review" as const };
    expect(indexed([emptyPrimary, secondary], [question])
      .flatMap((module) => module.weeks.flatMap((week) => week.questionIds))).toEqual([]);
  });
  it("does not mutate saved question IDs, progress or the original source-set membership", () => {
    const original = structuredClone(set);
    const row = structuredClone(question);
    const [module] = indexed([set, { ...set, id: "review", kind: "review" }], [question]);
    expect(module.weeks[0]).toMatchObject({ questionIds: ["q1"], ready: 1, attempted: 1 });
    expect(set).toEqual(original);
    expect(question).toEqual(row);
  });
  it("holds colliding raw set IDs and all dependent review membership regardless of input order", () => {
    const conflicting = { ...set, scope: { module: "FTM 1", week: 3, courseId: "c1" }, sourceDocumentIds: ["other-origin"] };
    const review = { ...set, id: "review-q1", kind: "review" as const };
    const cleanSet = { ...set, id: "unique", questionIds: ["q2"] };
    const cleanQuestion = { ...question, id: "q2", setId: "unique" };
    const original = structuredClone([set, conflicting, review, cleanSet, question, cleanQuestion]);
    for (const originals of [[set, conflicting], [conflicting, set]]) {
      const modules = indexed([...originals, review, cleanSet], [question, cleanQuestion]);
      const weeks = modules.flatMap((module) => module.weeks);
      expect(weeks.flatMap((week) => week.questionIds)).toEqual(["q2"]);
      expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["unique"]);
      expect(weeks[0]).toMatchObject({ ready: 1, attempted: 1 });
    }
    expect([set, conflicting, review, cleanSet, question, cleanQuestion]).toEqual(original);
  });
  it("does not credit a duplicated raw question ID to any source week even when one copy looks ready", () => {
    const other = { ...question, sourceDocumentId: "other-original", correctKey: "B" };
    const cleanSet = { ...set, id: "unique", questionIds: ["q2"] };
    const cleanQuestion = { ...question, id: "q2", setId: "unique" };
    for (const originals of [[question, other], [other, question]]) {
      const weeks = indexed([set, cleanSet], [...originals, cleanQuestion])
        .flatMap((module) => module.weeks);
      expect(weeks.flatMap((week) => week.questionIds)).toEqual(["q2"]);
      expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["unique"]);
      expect(weeks[0]).toMatchObject({ ready: 1, attempted: 1 });
    }
  });

  it("holds repeated original membership entries instead of silently deduplicating them", () => {
    const duplicateMembers = { ...set, questionIds: ["q1", "q1"] };
    const review = { ...set, id: "secondary", kind: "review" as const };
    const cleanSet = { ...set, id: "unique", questionIds: ["q2"] };
    const cleanQuestion = { ...question, id: "q2", setId: "unique" };
    const weeks = indexed([duplicateMembers, review, cleanSet], [question, cleanQuestion])
      .flatMap((module) => module.weeks);
    expect(weeks.flatMap((week) => week.questionIds)).toEqual(["q2"]);
    expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["unique"]);
    expect(duplicateMembers.questionIds).toEqual(["q1", "q1"]);
  });

  it("isolates duplicate review-only collection IDs without suppressing independent originals", () => {
    const review = { ...set, id: "review", kind: "review" as const };
    const duplicate = { ...review, title: "Stale review", scope: { module: "FTM 1", week: 3 } };
    for (const setId of ["s1", undefined]) {
      const records = [{ ...question, setId }];
      for (const collections of [[set, review, duplicate], [duplicate, review, set]]) {
        const snapshot = structuredClone([collections, records]);
        const weeks = indexed(collections, records).flatMap((module) => module.weeks);
        expect(weeks).toHaveLength(1);
        expect(weeks[0]).toMatchObject({ week: 2, questionIds: ["q1"], ready: 1, attempted: 1 });
        expect(weeks[0].sets.map((entry) => entry.id)).toEqual(["s1"]);
        expect([collections, records]).toEqual(snapshot);
      }
      const mixed = { ...review, id: "s1" };
      for (const collections of [[set, mixed], [mixed, set]]) {
        expect(indexed(collections, records)).toEqual([]);
      }
    }
  });

  it("holds explicit review-only primary bindings even with matching own filing", () => {
    const review = { ...set, id: "review", kind: "review" as const };
    for (const own of [{}, { module: "FTM 1", week: 2 }]) {
      const record = { ...question, ...own, setId: "review" };
      const snapshot = structuredClone(record);
      expect(indexed([review], [record])).toEqual([]);
      expect(record).toEqual(snapshot);
    }
  });

  it("does not let a malformed secondary review suppress an independently verified primary", () => {
    const malformedReview = { ...set, id: "review", kind: "review" as const, questionIds: ["q1", "q1"] };
    const [module] = indexed([set, malformedReview], [question]);
    expect(module.weeks[0]).toMatchObject({ questionIds: ["q1"], ready: 1, attempted: 1 });
    expect(module.weeks[0].sets.map((entry) => entry.id)).toEqual(["s1"]);
  });

  it("does not let a secondary collection certify a healthy sibling of a held primary", () => {
    const primary = { ...set, questionIds: ["q1", "sibling"] };
    const secondary = { ...set, id: "secondary", kind: "review" as const, questionIds: ["sibling"] };
    const clean = { ...set, id: "clean", questionIds: ["clean-q"] };
    const sibling = { ...question, id: "sibling", module: "FTM 1", week: 2 };
    const cleanQuestion = { ...question, id: "clean-q", setId: "clean" };
    const collision = { ...question, sourceDocumentId: "different-original" };
    const original = structuredClone([primary, secondary, clean, question, collision, sibling, cleanQuestion]);
    for (const collections of [[primary, secondary, clean], [secondary, primary, clean]]) {
      for (const records of [[question, collision], [collision, question]]) {
        const weeks = indexed(collections, [...records, sibling, cleanQuestion]).flatMap((module) => module.weeks);
        expect(weeks.flatMap((week) => week.questionIds)).toEqual(["clean-q"]);
        expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["clean"]);
      }
    }
    expect([primary, secondary, clean, question, collision, sibling, cleanQuestion]).toEqual(original);
  });

  it("does not inherit legacy source scope from a held original into a review collection", () => {
    const primary = { ...set, questionIds: ["q1", "legacy"] };
    const secondary = { ...set, id: "secondary", kind: "review" as const, questionIds: ["legacy"] };
    const legacy = { ...question, id: "legacy", setId: undefined };
    const collision = { ...question, sourceDocumentId: "different-original" };
    for (const collections of [[primary, secondary], [secondary, primary]]) {
      expect(indexed(collections, [question, collision, legacy])).toEqual([]);
      const healthy = indexed(collections, [question, legacy]).flatMap((module) => module.weeks);
      expect(healthy.flatMap((week) => week.questionIds).sort()).toEqual(["legacy", "q1"]);
      expect(healthy[0].ready).toBe(2);
    }
  });


  it("propagates whole-primary filing holds to secondary and legacy practice in either order", () => {
    const primary = { ...set, questionIds: ["q1", "sibling"] };
    const review = { ...set, id: "review", kind: "review" as const, questionIds: ["sibling"] };
    const clean = { ...set, id: "clean", questionIds: ["clean-q"] };
    const cleanQuestion = { ...question, id: "clean-q", setId: "clean" };
    for (const invalid of [{ week: 3 }, { week: 0 }, { setId: "missing" }, { courseId: "c2" }]) {
      for (const primaryId of ["s1", undefined]) {
        const records = [{ ...question, ...invalid }, { ...question, id: "sibling", setId: primaryId }, cleanQuestion];
        const snapshot = structuredClone(records);
        for (const collections of [[primary, review, clean], [review, clean, primary]]) {
          const weeks = indexed(collections, records).flatMap((module) => module.weeks);
          expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["clean"]);
          expect(weeks.flatMap((week) => week.questionIds)).toEqual(["clean-q"]);
          expect(weeks[0]).toMatchObject({ ready: 1, attempted: 1 });
        }
        expect(records).toEqual(snapshot);
      }
    }
  });

  it("propagates dependent primary holds transitively but keeps an independent primary", () => {
    const primary = { ...set, questionIds: ["q1", "sibling"] };
    const dependent = { ...set, id: "dependent", questionIds: ["sibling", "other"] };
    const review = { ...set, id: "other-review", kind: "review" as const, questionIds: ["other"] };
    const clean = { ...set, id: "clean", questionIds: ["clean-q"] };
    const records = [{ ...question, week: 3 }, { ...question, id: "sibling" },
      { ...question, id: "other", setId: "dependent" }, { ...question, id: "clean-q", setId: "clean" }];
    for (const collections of [[primary, dependent, review, clean], [review, dependent, clean, primary]]) {
      const weeks = indexed(collections, records).flatMap((module) => module.weeks);
      expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["clean"]);
      expect(weeks.flatMap((week) => week.questionIds)).toEqual(["clean-q"]);
    }
  });

  it("keeps an unambiguously filed legacy original available when a secondary review is stale", () => {
    const legacy = { ...question, setId: undefined };
    const primary = { ...set, scope: { module: "FTM 1", week: 2, courseId: "c1" } };
    for (const stale of [{ week: 3 }, { week: 0 }, { module: "FTM 2" }, { courseId: "c2" }]) {
      const review = { ...primary, id: "review", kind: "review" as const, scope: { ...primary.scope, ...stale } };
      for (const collections of [[primary, review], [review, primary]]) {
        const snapshot = structuredClone([collections, legacy]);
        const weeks = indexed(collections, [legacy]).flatMap((module) => module.weeks);
        expect(weeks).toHaveLength(1);
        expect(weeks[0]).toMatchObject({ week: 2, questionIds: ["q1"], ready: 1, attempted: 1 });
        expect(weeks[0].sets.map((entry) => entry.id)).toEqual(["s1"]);
        expect([collections, legacy]).toEqual(snapshot);
      }
    }
    const reviewOnly = { ...primary, id: "review", kind: "review" as const };
    const otherOriginal = { ...primary, id: "other", scope: { ...primary.scope, week: 3 } };
    expect(indexed([reviewOnly], [legacy])).toEqual([]);
    expect(indexed([primary, otherOriginal], [legacy])).toEqual([]);
  });

  it("closes cyclic primary dependencies only when seeded by a filing hold, in every collection order", () => {
    const scope = { module: "FTM 1", week: 2, courseId: "c1" };
    const primaryA = { ...set, id: "a", scope, questionIds: ["qa", "qb", "seed"] };
    const primaryB = { ...set, id: "b", scope, questionIds: ["qa", "qb"] };
    const review = { ...set, id: "review", kind: "review" as const, scope, questionIds: ["qb"] };
    const clean = { ...set, id: "clean", scope, questionIds: ["qc"] };
    const orderings = (entries: QuestionSet[]): QuestionSet[][] => entries.length === 0 ? [[]]
      : entries.flatMap((entry, index) => orderings(entries.filter((_, i) => i !== index)).map((rest) => [entry, ...rest]));
    const permutations = orderings([primaryA, primaryB, review, clean]);
    expect(permutations).toHaveLength(24);
    for (const held of [false, true]) {
      const records = [
        { ...question, id: "qa", setId: "a" },
        { ...question, id: "qb", setId: "b" },
        { ...question, id: "seed", setId: "a", week: held ? 3 : 2 },
        { ...question, id: "qc", setId: "clean" },
      ];
      for (const collections of permutations) {
        const snapshot = structuredClone([collections, records]);
        const weeks = indexed(collections, records).flatMap((module) => module.weeks);
        expect(weeks).toHaveLength(1);
        expect(weeks[0]).toMatchObject({ week: 2, ready: held ? 1 : 4, attempted: held ? 1 : 4 });
        expect(weeks[0].questionIds.slice().sort()).toEqual(held ? ["qc"] : ["qa", "qb", "qc", "seed"]);
        expect(weeks[0].sets.map((entry) => entry.id).sort()).toEqual(held ? ["clean"] : ["a", "b", "clean", "review"]);
        expect([collections, records]).toEqual(snapshot);
      }
    }
  });

  it("keeps missing raw member references repairable without inventing a question", () => {
    const primary = { ...set, questionIds: ["q1", "missing"] };
    const review = { ...set, id: "review", kind: "review" as const };
    const [module] = indexed([review, primary], [question]);
    expect(module.weeks[0].questionIds).toEqual(["q1"]);
    expect(module.weeks[0].sets.map((entry) => entry.id).sort()).toEqual(["review", "s1"]);
    expect(primary.questionIds).toEqual(["q1", "missing"]);
  });

  it("keeps generated and review provenance ahead of school-like titles", () => {
    expect(bankSource({ ...set, kind: "generated" })).toBe("AXOM generated");
    expect(bankSource({ ...set, kind: "review" })).toBe("Review");
    expect(bankSource(set)).toBe("IMCQ");
  });
});

describe("catalog course/module ownership", () => {
  it("agrees with Tracker availability for explicit catalog contradictions without refiling stored records", () => {
    const second = { ...course, id: "c2", code: "TEST 2", name: "Second course", termId: "t2",
      modules: [{ id: "m2", name: "DERS" }] };
    const terms = [term, { id: "t2", name: "Term 2" }];
    const curriculum = { id: "synthetic", label: "Synthetic outline", terms: [
      { name: "Term 1", courses: [{ code: course.code, name: course.name, modules: ["FTM 1"] }] },
      { name: "Term 2", courses: [{ code: second.code, name: second.name, modules: ["DERS"] }] },
    ] };
    for (const invalid of [
      { courseId: "c1", module: "DERS" },
      { courseId: "c1", module: "Unknown module" },
      { courseId: "deleted", module: "DERS" },
      { courseId: "empty", module: "FTM 1" },
    ]) {
      const courses = [course, second, { ...course, id: "empty", modules: [] }];
      const scope = { ...invalid, week: 2 };
      const original = { ...set, scope };
      const record = { ...question, ...scope };
      const review = { ...original, id: "secondary", kind: "review" as const };
      const validScope = { courseId: "c2", module: "DERS", week: 2 };
      const clean = { ...set, id: "clean", questionIds: ["clean-q"], scope: validScope };
      const records = [record, { ...question, ...validScope, id: "clean-q", setId: "clean" }];
      for (const sets of [[original, review, clean], [clean, review, original]]) {
        const snapshot = structuredClone([sets, records, courses]);
        const bank = buildCourseQuestionBank(sets, records, courses, terms);
        const weeks = bank.flatMap((branch) => branch.weeks);
        expect(weeks.flatMap((week) => week.questionIds)).toEqual(["clean-q"]);
        expect(weeks.flatMap((week) => week.sets.map((entry) => entry.id))).toEqual(["clean"]);
        expect(bank[0].courseId).toBe("c2");
        expect(weeks[0]).toMatchObject({ ready: 1, attempted: 1 });
        const tracker = buildQuestionAvailabilityIndex({ curriculum, terms, courses, sets, questions: records });
        expect(tracker.unassignedQuestions).toBe(1);
        expect(tracker.unassignedCollections).toBe(2);
        expect([...tracker.byModule.values()]).toHaveLength(1);
        expect([...tracker.byModule.values()][0]).toMatchObject({ readyQuestions: 1, storedQuestions: 1, indexedWeeks: [2] });
        expect([sets, records, courses]).toEqual(snapshot);
      }
    }
  });

  it("preserves aliases, explicit ownership of repeated modules and unscheduled/custom practice", () => {
    const repeated = { ...course, id: "c2", termId: "t2" };
    const custom = { ...course, modules: [{ id: "custom", name: "Personal practice" }] };
    for (const { scope, courses, expectedCourse } of [
      { scope: { courseId: "c1", module: "FTM-1", week: 2 }, courses: [course], expectedCourse: "c1" },
      { scope: { courseId: "c2", module: "ftm1", week: 2 }, courses: [course, repeated], expectedCourse: "c2" },
      { scope: { courseId: "c1", module: "Personal practice", week: 2 }, courses: [custom], expectedCourse: "c1" },
      { scope: { module: "Personal practice" }, courses: [course], expectedCourse: undefined },
      { scope: { courseId: "c1" }, courses: [course], expectedCourse: "c1" },
    ]) {
      const [branch] = indexed([{ ...set, scope }], [{ ...question, ...scope }], courses);
      expect(branch.courseId).toBe(expectedCourse);
      expect(branch.weeks[0]).toMatchObject({ questionIds: ["q1"], ready: 1, attempted: 1 });
    }
  });
});

describe("local catalog identity and curriculum evidence", () => {
  it("holds duplicate course identities in either order without suppressing an unrelated original", () => {
    const second = { ...course, termId: "t2", code: "TEST 2", name: "Other owner" };
    const cleanCourse = { ...course, id: "clean-course", termId: "t2", code: "TEST 3",
      modules: [{ id: "m2", name: "DERS" }] };
    const scope = { courseId: "c1", module: "FTM 1", week: 2 };
    const cleanScope = { courseId: cleanCourse.id, module: "DERS", week: 2 };
    const original = { ...set, scope };
    const review = { ...original, id: "secondary", kind: "review" as const };
    const clean = { ...set, id: "clean", scope: cleanScope, questionIds: ["clean-q"] };
    const records = [{ ...question, ...scope }, { ...question, ...cleanScope, id: "clean-q", setId: "clean" }];
    for (const duplicate of [second, { ...second, modules: [{ id: "other", name: "Other module" }] }, { ...course }]) {
      for (const catalog of [[course, duplicate, cleanCourse], [duplicate, course, cleanCourse]]) {
        for (const collections of [[original, review, clean], [clean, review, original]]) {
          const snapshot = structuredClone([collections, records, catalog]);
          const bank = buildCourseQuestionBank(collections, records, catalog, [term, { id: "t2", name: "Term 2" }]);
          expect(bank.flatMap((branch) => branch.weeks.flatMap((week) => week.questionIds))).toEqual(["clean-q"]);
          expect(bank.flatMap((branch) => branch.weeks.flatMap((week) => week.sets.map((entry) => entry.id)))).toEqual(["clean"]);
          expect([collections, records, catalog]).toEqual(snapshot);
        }
      }
    }
  });

  it("preserves local practice without asserting curriculum-indexed availability for unsupported owners", () => {
    const outline = { id: "synthetic", label: "Synthetic outline", terms: [
      { name: "Term 1", courses: [{ code: course.code, name: course.name, modules: ["FTM 1"] }] },
    ] };
    const duplicateOutline = { ...outline, terms: [{ ...outline.terms[0],
      courses: [...outline.terms[0].courses, ...outline.terms[0].courses] }] };
    for (const { local, terms, curriculum, module } of [
      { local: course, terms: [term], curriculum: outline, module: "FTM 1" },
      { local: course, terms: [], curriculum: outline, module: "FTM 1" },
      { local: { ...course, code: "UNKNOWN" }, terms: [term], curriculum: outline, module: "FTM 1" },
      { local: course, terms: [term], curriculum: duplicateOutline, module: "FTM 1" },
      { local: { ...course, modules: [{ id: "custom", name: "Personal practice" }] },
        terms: [term], curriculum: outline, module: "Personal practice" },
    ]) {
      const scope = { courseId: local.id, module, week: 2 };
      const collections = [{ ...set, scope }];
      const records = [{ ...question, ...scope }];
      const catalog = [local];
      const snapshot = structuredClone([collections, records, catalog, terms, curriculum]);
      const bank = buildCourseQuestionBank(collections, records, catalog, terms);
      expect(bank[0].weeks[0]).toMatchObject({ questionIds: ["q1"], ready: 1, attempted: 1 });
      const tracker = buildQuestionAvailabilityIndex({ sets: collections, questions: records, courses: catalog, terms, curriculum });
      const indexedOwner = local === course && terms.length === 1 && curriculum === outline;
      expect(tracker.unassignedQuestions).toBe(indexedOwner ? 0 : 1);
      expect(tracker.unassignedCollections).toBe(indexedOwner ? 0 : 1);
      expect(tracker.byModule.size).toBe(indexedOwner ? 1 : 0);
      expect([collections, records, catalog, terms, curriculum]).toEqual(snapshot);
    }
  });
});
