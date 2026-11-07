import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import type { TrackerItem } from "../types";
import { absenceStanding, buildModuleWeeks } from "./weekView";

let counter = 0;
function row(patch: Partial<TrackerItem>): TrackerItem {
  counter += 1;
  return {
    id: `row-${counter}`, path: "Term 1/FTM 1/Week 3", label: `Item ${counter}`, kind: "Lecture",
    passes: 0, ankiPasses: 0, yield: "none", updated: "2026-09-01T00:00:00.000Z", ...patch,
  };
}

function question(patch: Partial<QuestionRecord>): QuestionRecord {
  counter += 1;
  return {
    id: `q-${counter}`, source: "imported", stem: "Stem", options: [], status: "unseen", tags: [], attempts: [],
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...patch,
  };
}

describe("the course by week", () => {
  it("groups week-filed rows by module and week and leaves other rows out", () => {
    const modules = buildModuleWeeks([
      row({ activity: "lecture", passes: 1 }),
      row({ activity: "small-group" }),
      row({ path: "Term 1/FTM 1/Week 4", activity: "esoft" }),
      row({ path: "Term 1/MSK/Week 6", activity: "lecture" }),
      // Not filed by week: belongs to the tracker tree only.
      row({ path: "Question Bank/Review" }),
    ], []);
    expect(modules.map((module) => [module.module, module.term, module.weeks.map((week) => week.week)])).toEqual([
      ["FTM 1", "Term 1", [3, 4]], ["MSK", "Term 1", [6]],
    ]);
    expect(modules[0]).toMatchObject({ done: 1, total: 3, currentWeek: 3 });
    expect(modules[0].weeks[0].byActivity).toEqual([
      { activity: "lecture", total: 1, done: 1 }, { activity: "small-group", total: 1, done: 0 },
    ]);
  });

  it("moves the current week on once a week is finished", () => {
    const [module] = buildModuleWeeks([
      row({ passes: 2 }), row({ path: "Term 1/FTM 1/Week 4" }),
    ], []);
    expect(module.currentWeek).toBe(4);
  });

  it("reads a week's question progress from attempts, joining on module and week", () => {
    const answered = question({
      module: "ftm1", week: 3, status: "correct",
      attempts: [{ at: "2026-09-02T00:00:00.000Z", status: "correct" }],
    });
    const [module] = buildModuleWeeks([row({})], [answered, question({ module: "FTM 1", week: 3 }), question({ module: "FTM 1", week: 9 })]);
    expect(module.weeks[0].questions).toMatchObject({ total: 2, attempted: 1, firstTimeCorrect: 1 });
  });


  it("separates the same module in two terms instead of merging week progress", () => {
    const tracker = [
      row({ path: "Term 1/NB Block 2/Week 3", passes: 1 }),
      row({ path: "Term 2/NB2/Week 3", passes: 0 }),
    ];
    const modules = buildModuleWeeks(tracker, [question({ module: "NB2", week: 3 })]);
    expect(modules).toHaveLength(2);
    expect(modules.map((module) => [module.term, module.done, module.total])).toEqual([
      ["Term 1", 1, 1], ["Term 2", 0, 1],
    ]);
    // A question without an explicit course cannot be assigned to either term.
    expect(modules.every((module) =>
      module.weeks[0].questionScopeAmbiguous === true && module.weeks[0].questions.total === 0)).toBe(true);
  });


  it("separates same-named modules filed under different courses and respects course-specific attempts", () => {
    const rows = [
      row({ path: "Term 2/BPM 501/NB2/Week 3", label: "Core" }),
      row({ path: "Term 2/ELECTIVE/NB Block 2/Week 3", label: "Elective" }),
    ];
    const answers = [
      question({ module: "NB2", week: 3, courseId: "core" }),
      question({ module: "NB Block 2", week: 3, courseId: "elective" }),
      question({ module: "NB2", week: 3 }),
    ];
    const withoutOwners = buildModuleWeeks(rows, answers);
    expect(withoutOwners).toHaveLength(2);
    expect(withoutOwners.every((module) => module.weeks[0].questionScopeAmbiguous && module.weeks[0].questions.total === 0)).toBe(true);
    const withOwners = buildModuleWeeks(rows, answers, undefined, {
      terms: [{ id: "t2", name: "Term 2" }],
      courses: [
        { id: "core", termId: "t2", code: "BPM 501", name: "Core", files: 0,
          modules: [{ id: "nb2", name: "NB2" }] },
        { id: "elective", termId: "t2", code: "ELECTIVE", name: "Elective", files: 0,
          modules: [{ id: "nb-duplicate", name: "NB Block 2" }] },
      ],
    });
    expect(withOwners.map((module) => [module.course, module.courseId, module.total, module.weeks[0].questions.total])).toEqual([
      ["BPM 501", "core", 1, 1],
      ["ELECTIVE", "elective", 1, 1],
    ]);
    expect(withOwners.every((module) => !module.weeks[0].questionScopeAmbiguous)).toBe(true);
  });


  it("binds a legacy week to the only matching course rather than crediting unrelated attempts", () => {
    const tracker = [row({ path: "Term 2/NB2/Week 3", passes: 1 })];
    const answers = [
      question({ id: "core", module: "NB2", week: 3, courseId: "core", status: "correct",
        attempts: [{ at: "2026-11-07T00:00:00Z", status: "correct" }] }),
      question({ id: "foreign", module: "NB2", week: 3, courseId: "other", status: "incorrect",
        attempts: [{ at: "2026-11-07T00:00:00Z", status: "incorrect" }] }),
      question({ id: "unowned", module: "NB2", week: 3 }),
    ];
    const before = JSON.stringify([tracker, answers]);
    const [module] = buildModuleWeeks(tracker, answers, undefined, {
      terms: [{ id: "term2", name: "Term 2" }],
      courses: [
        { id: "core", termId: "term2", code: "BPM 501", name: "Core", files: 0,
          modules: [{ id: "nb2", name: "NB2" }] },
        { id: "other", termId: "term2", code: "ELECTIVE", name: "Other", files: 0,
          modules: [{ id: "ftm", name: "FTM 1" }] },
      ],
    });
    expect(module).toMatchObject({ term: "Term 2", courseId: "core", done: 1, total: 1 });
    expect(module.weeks[0]).toMatchObject({
      questionScopeAmbiguous: undefined,
      questions: { total: 1, attempted: 1, firstTimeCorrect: 1, questionIds: ["core"] },
    });
    expect(JSON.stringify([tracker, answers])).toBe(before);
  });

  it("holds a legacy week's question counts when two courses in one term own its module", () => {
    const tracker = [row({ path: "Term 2/NB2/Week 3", passes: 1 })];
    const answers = [
      question({ id: "core", module: "NB2", week: 3, courseId: "core" }),
      question({ id: "elective", module: "NB2", week: 3, courseId: "elective" }),
    ];
    const [module] = buildModuleWeeks(tracker, answers, undefined, {
      terms: [{ id: "term2", name: "Term 2" }],
      courses: [
        { id: "core", termId: "term2", code: "BPM 501", name: "Core", files: 0,
          modules: [{ id: "nb2", name: "NB2" }] },
        { id: "elective", termId: "term2", code: "ELECTIVE", name: "Elective", files: 0,
          modules: [{ id: "nb2-alt", name: "NB Block 2" }] },
      ],
    });
    expect(module).toMatchObject({ courseId: undefined, done: 1, total: 1 });
    expect(module.weeks[0]).toMatchObject({
      questionScopeAmbiguous: true,
      questions: { total: 0, attempted: 0, questionIds: [] },
    });
  });

  it("does not credit an explicit-course tracker week without verified course ownership", () => {
    const tracker = [row({ path: "Term 2/BPM 501/NB2/Week 3" })];
    const answers = [
      question({ id: "core", module: "NB2", week: 3, courseId: "core" }),
      question({ id: "elective", module: "NB2", week: 3, courseId: "elective" }),
    ];
    const [unverified] = buildModuleWeeks(tracker, answers);
    expect(unverified.weeks[0]).toMatchObject({
      questionScopeAmbiguous: true,
      questions: { total: 0, attempted: 0, questionIds: [] },
    });
    const [verified] = buildModuleWeeks(tracker, answers, undefined, {
      terms: [{ id: "term2", name: "Term 2" }],
      courses: [{ id: "core", termId: "term2", code: "BPM 501", name: "Core", files: 0,
        modules: [{ id: "nb2", name: "NB2" }] }],
    });
    expect(verified).toMatchObject({ courseId: "core" });
    expect(verified.weeks[0].questions.questionIds).toEqual(["core"]);
  });

  it("does not report held primary-source attempts as eligible week progress", () => {
    const rows = [row({ path: "Term 2/BPM 501/NB2/Week 3" })];
    const at = "2026-11-06T00:00:00Z";
    const answers = [
      question({ id: "eligible", module: "NB2", week: 3, courseId: "core", setId: "core-source",
        status: "correct", attempts: [{ at, status: "correct" }] }),
      question({ id: "held", module: "NB2", week: 3, courseId: "core", setId: "other-source",
        status: "incorrect", attempts: [{ at, status: "incorrect" }] }),
      question({ id: "forged", module: "NB2", week: 3, courseId: "core", setId: "core-source",
        status: "correct", attempts: [{ at, status: "correct" }] }),
    ];
    const snapshot = JSON.stringify(answers);
    const sets = new Map([
      ["core-source", { scope: { module: "NB2", week: 3, courseId: "core" }, questionIds: ["eligible"] }],
      ["other-source", { scope: { module: "FTM 1", week: 4, courseId: "elective" }, questionIds: ["held"] }],
    ]);
    const [module] = buildModuleWeeks(rows, answers, sets, {
      terms: [{ id: "t2", name: "Term 2" }],
      courses: [{ id: "core", termId: "t2", code: "BPM 501", name: "Core", files: 0,
        modules: [{ id: "nb2", name: "NB2" }] }],
    });
    expect(module.weeks[0].questions).toEqual({
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0,
      questionIds: ["eligible"], sourceReviewHeld: 2,
    });
    expect(JSON.stringify(answers)).toBe(snapshot);
  });

  it("counts absences per category against the term's allowance, a flipped lecture as a lecture", () => {
    const tracker = [
      row({ activity: "lecture", attendance: "missed" }),
      row({ activity: "flipped-lecture", attendance: "missed" }),
      row({ activity: "small-group", attendance: "missed" }),
      row({ activity: "imcq" }),
      // Another term's absence is not this term's.
      row({ path: "Term 2/ER/Week 1", activity: "lecture", attendance: "missed" }),
    ];
    expect(absenceStanding(tracker, { name: "Term 1", absenceAllowances: { lecture: 31, "small-group": 1, esoft: 3 } })).toEqual([
      { category: "lecture", missed: 2, allowed: 31, remaining: 29 },
      { category: "small-group", missed: 1, allowed: 1, remaining: 0 },
      { category: "esoft", missed: 0, allowed: 3, remaining: 3 },
    ]);
    // With no allowance set, a miss is still listed, with nothing to compare it to.
    expect(absenceStanding(tracker, { name: "Term 2" })).toEqual([{ category: "lecture", missed: 1, allowed: undefined, remaining: undefined }]);
  });
});
