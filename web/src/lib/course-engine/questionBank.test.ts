import { describe, expect, it } from "vitest";
import type { Course } from "../types";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { bankSource, buildCourseQuestionBank, courseForScope } from "./questionBank";

const course: Course = { id: "c1", termId: "t1", code: "TEST 1", name: "First course", files: 0, modules: [{ id: "m1", name: "FTM 1" }] };
const question: QuestionRecord = { id: "q1", source: "manual", stem: "Which sample?", options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
  correctKey: "A", status: "correct", tags: [], attempts: [{ at: "2026-10-08", status: "correct", answerKey: "A" }], createdAt: "2026-10-08", updatedAt: "2026-10-08" };
const set: QuestionSet = { id: "s1", title: "IMCQ 1", questionIds: ["q1"], sourceDocumentIds: [], tags: [], aiEnhanced: false,
  parserWarnings: [], createdAt: "2026-10-08", scope: { module: "FTM 1", week: 2 } };

describe("course bank read model", () => {
  it("uses canonical membership, counts reviewed questions once, and orders weeks numerically", () => {
    const [module] = buildCourseQuestionBank([set, { ...set, id: "review", kind: "review" }, { ...set, id: "later", scope: { module: "ftm1", week: 10 } }], [question], [course], [{ id: "t1", name: "Term 1" }]);
    expect(module).toMatchObject({ module: "FTM 1", term: "Term 1", course: "First course", courseId: "c1" });
    expect(module.weeks.map((week) => week.week)).toEqual([2, 10]);
    expect(module.weeks[0]).toMatchObject({ questionIds: ["q1"], attempted: 1, ready: 1 });
    expect(module.weeks[0].sets).toHaveLength(2);
  });
  it("does not choose between two courses that teach the same module", () => {
    const second = { ...course, id: "c2", termId: "t2" };
    expect(courseForScope(set.scope!, [course, second])).toBeUndefined();
    expect(courseForScope({ ...set.scope, courseId: "c2" }, [course, second])).toBe(second);
    const modules = buildCourseQuestionBank([set, { ...set, id: "other", scope: { ...set.scope, courseId: "c2" } }], [question], [course, second], []);
    expect(modules).toHaveLength(2);
    expect(modules.find((module) => !module.courseId)?.term).toBe("Not yet assigned");
  });
  it("infers legacy set scope from unanimous question fields and leaves mixed sets unfiled", () => {
    const legacy = { ...set, scope: undefined };
    const qs = [{ ...question, module: "FTM 1", week: 3 }, { ...question, id: "q2", module: "FTM 2", week: 4 }];
    const bank = buildCourseQuestionBank([legacy, { ...legacy, id: "mixed", questionIds: ["q1", "q2"] }], qs, [course], []);
    expect(bank[0].weeks[0].week).toBe(3);
    expect(bank[1].module).toBe("Unfiled & mixed");
  });
  it("keeps generated and review provenance ahead of school-like titles", () => {
    expect(bankSource({ ...set, kind: "generated" })).toBe("AXOM generated");
    expect(bankSource({ ...set, kind: "review" })).toBe("Review");
    expect(bankSource(set)).toBe("IMCQ");
  });
});
