import { describe, expect, it } from "vitest";
import { normalizeStudyWorkflow, resolveStudyPlan, studyPlanCourse } from "./studyPreferences";
import type { Course, TrackerItem } from "./types";

const item: TrackerItem = { id: "i", path: "CARD 101/Week 1", label: "Renal", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "high", updated: "2026-08-01T00:00:00Z" };
const course: Course = { id: "c", termId: "t", code: "CARD 101", name: "Cardiology", files: 0, modules: [], studyPlanOverride: { lecturePasses: 3 } };

describe("study workflow resolution", () => {
  it("matches course path segments without inheriting from a partial or blank course name", () => {
    const partial = { ...course, id: "partial", code: "CARD 10", name: "" };
    expect(studyPlanCourse([partial, course], { ...item, path: "Term 1/ card  101 /Week 1" })).toBe(course);
    expect(studyPlanCourse([partial], item)).toBeUndefined();
    expect(studyPlanCourse([course], { ...item, path: "Cardiology/Week 1" })).toBe(course);
  });

  it("does not guess between ambiguous courses", () => {
    expect(studyPlanCourse([course, { ...course, id: "other-term" }], item)).toBeUndefined();
  });

  it("resolves learner, course, kind, and item layers in order", () => {
    const plan = resolveStudyPlan({ configured: true, lecturePasses: 2, methods: [{ id: "anki", enabled: true }], itemKindDefaults: { Lecture: { reviewAfterDays: 4 } } }, course, { ...item, studyPlanOverride: { lecturePasses: 1, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }] } });
    expect(plan.lecturePasses).toBe(1);
    expect(plan.reviewAfterDays).toBe(4);
    expect(plan.methods.find((method) => method.id === "anki")?.enabled).toBe(false);
    expect(plan.methods.find((method) => method.id === "notes")?.enabled).toBe(true);
    expect(plan.sources).toEqual(["learner defaults", "course override", "item-kind default", "item override"]);
  });

  it("preserves original free text without truncation and rejects unknown methods", () => {
    const normalized = normalizeStudyWorkflow({ configured: true, customContext: "x".repeat(700), methods: [{ id: "anki", enabled: true }, { id: "telepathy", enabled: true }] });
    expect(normalized.customContext).toHaveLength(700);
    expect(normalized.methods).toEqual([{ id: "anki", enabled: true, label: undefined, timing: undefined }]);
  });
});
