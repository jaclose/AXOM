import { describe, expect, it } from "vitest";
import type { Course } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { bankSource, buildCourseQuestionBank, courseForScope } from "./questionBank";

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

  it("does not let a malformed secondary review suppress an independently verified primary", () => {
    const malformedReview = { ...set, id: "review", kind: "review" as const, questionIds: ["q1", "q1"] };
    const [module] = indexed([set, malformedReview], [question]);
    expect(module.weeks[0]).toMatchObject({ questionIds: ["q1"], ready: 1, attempted: 1 });
    expect(module.weeks[0].sets.map((entry) => entry.id)).toEqual(["s1"]);
  });

  it("keeps generated and review provenance ahead of school-like titles", () => {
    expect(bankSource({ ...set, kind: "generated" })).toBe("AXOM generated");
    expect(bankSource({ ...set, kind: "review" })).toBe("Review");
    expect(bankSource(set)).toBe("IMCQ");
  });
});
