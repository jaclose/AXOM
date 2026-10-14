import { describe, expect, it } from "vitest";
import { scopeProgress } from "../../lib/course-engine/scope";
import type { Course } from "../../lib/types";
import type { QuestionRecord } from "../../lib/questions";
import { questionsWithUnambiguousCourse } from "./legacyCourseQuestionScope";

const course = (id: string, moduleName: string): Course => ({
  id, code: id, termId: "term-2", name: id, files: 0,
  modules: [{ id: "mod-" + id, name: moduleName }],
});
const question = (id: string, module: string | undefined, more: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: "Synthetic course question " + id, status: "correct",
  module, week: 3, options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
  correctKey: "A", tags: [],
  attempts: [{ at: "2026-10-01T00:00:00.000Z", status: "correct", answerKey: "A" }],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...more,
});

describe("legacy QBank course attribution in Week Overview", () => {
  it("counts old unscoped answered questions when exactly one course owns the module", () => {
    const original = question("legacy", "FTM 1");
    const existing = question("explicit", "FTM 1", { courseId: "c3" });
    const courses = [course("c1", "FTM1"), course("c3", "DM")];
    const projected = questionsWithUnambiguousCourse([original, existing], courses);
    expect(projected[0]).toMatchObject({ id: "legacy", courseId: "c1" });
    expect(projected[1]).toBe(existing);
    expect(original.courseId).toBeUndefined();
    expect(scopeProgress(projected, { module: "FTM1", week: 3, courseId: "c1" }).total).toBe(1);
    expect(scopeProgress(projected, { module: "FTM1", week: 3, courseId: "c3" }).total).toBe(1);
  });

  it("withholds inferred ownership when a module exists in two courses", () => {
    const legacy = question("ambiguous", "NB Block 2");
    const courses = [course("c1", "NB2"), course("c2", "NB Block 2")];
    const projected = questionsWithUnambiguousCourse([legacy], courses);
    expect(projected[0]).toBe(legacy);
    expect(projected[0].courseId).toBeUndefined();
    expect(scopeProgress(projected, { module: "NB2", week: 3, courseId: "c1" }).total).toBe(0);
    expect(scopeProgress(projected, { module: "NB2", week: 3, courseId: "c2" }).total).toBe(0);
  });

  it("resolves source-set inheritance without writing inferred ownership to the workspace", () => {
    const legacy = question("from-set", undefined, { setId: "source-set" });
    const sets = new Map([["source-set", { scope: { module: "ER", week: 3 } }]]);
    const projected = questionsWithUnambiguousCourse([legacy], [course("c1", "ER")], sets);
    expect(projected[0].courseId).toBe("c1");
    expect(legacy.courseId).toBeUndefined();
    expect(scopeProgress(projected, { module: "ER", week: 3, courseId: "c1" }, sets).attempted).toBe(1);
  });
});
