import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import type { QuestionRecord } from "../questions";
import {
  groupQuestionsByScope, parseWeek, questionScope, scopeProgress, trackerPathScope,
  type QuestionSetScope,
} from "./scope";

const sourceScope: QuestionSetScope = { module: "FTM 1", week: 3, courseId: "course-a" };
const sourceSets = (scope: QuestionSetScope = sourceScope) => new Map([["source", { scope }]]);
const legacyWeek = (value: unknown): number => value as number;
const question = (id: string, overrides: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "manual", stem: "Synthetic scope fixture", options: [], status: "unseen",
  tags: [], attempts: [], createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z",
  setId: "source", ...overrides,
});

describe("source-week integrity", () => {
  it("accepts only a complete single-week label or a bounded positive integer", () => {
    for (const [input, expected] of [
      [1, 1], [99, 99], ["2", 2], [" 09 ", 9], ["Week 12", 12],
      ["wk4", 4], ["W5", 5], ["Week: #6", 6], ["wK : 07", 7],
      ["\tWeek 8\n", 8], ["Week\u00a09", 9],
    ] as const) assert.equal(parseWeek(input), expected, String(input));
  });

  it("rejects dates, module labels, ranges, identifiers and invalid values", () => {
    for (const input of [
      undefined, null, true, false, {}, [], 0, -1, 100, 1.5, NaN, Infinity,
      "", " ", "2026-11-05", "FTM 2", "Lecture 3", "Week 2-3", "Week 2–3",
      "Week 10/11", "Week 2,3", "Week 2 & 3", "Week 5 Anatomy", "Weeks 4",
      "Week 0", "Week 100", "-2", "+2", "1.5", "1e1", "0x10", "009", "#2",
      "Week 2\nWeek 3", "Week 2\u0000", "Week ２", "2w",
    ]) assert.equal(parseWeek(input), undefined, String(input));
  });

  it("round-trips every supported week without accepting trailing source text", () => {
    for (let week = 1; week < 100; week += 1) {
      assert.equal(parseWeek(week), week);
      assert.equal(parseWeek(String(week)), week);
      assert.equal(parseWeek(`Week ${week}`), week);
      assert.equal(parseWeek(`wk${week}`), week);
      assert.equal(parseWeek(`W${week}`), week);
      assert.equal(parseWeek(`Week ${week}-100`), undefined);
      assert.equal(parseWeek(`Week ${week} lecture`), undefined);
      assert.equal(parseWeek(`FTM ${week}`), undefined);
    }
  });

  it("inherits a missing or empty legacy week from a compatible source set", () => {
    for (const value of [undefined, null, "", " \t "]) {
      assert.deepEqual(questionScope({ setId: "source", week: legacyWeek(value) }, sourceSets()), sourceScope);
    }
  });

  it("does not replace an explicit invalid question week with the source week", () => {
    for (const value of [0, -1, 100, NaN, "2026-11-05", "Week 3-4", "FTM 2"]) {
      assert.equal(questionScope({ setId: "source", week: legacyWeek(value) }, sourceSets()).week, undefined);
    }
  });

  it("keeps inheritance for canonical spellings of the same module and course", () => {
    for (const module of ["FTM 1", "ftm1", "FTM-1", " FTM 1 "]) {
      assert.equal(questionScope({ setId: "source", module, courseId: "course-a" }, sourceSets()).week, 3);
    }
    assert.equal(questionScope({ setId: "source", module: "NB2" },
      sourceSets({ module: "NB Block 2", week: 12 })).week, 12);
  });

  it("never carries an old source week across contradictory explicit filing", () => {
    for (const filing of [
      { module: "FTM 2" }, { courseId: "course-b" },
      { module: "FTM 2", courseId: "course-b" }, { module: "" }, { courseId: "" },
    ]) assert.equal(questionScope({ setId: "source", ...filing }, sourceSets()).week, undefined);
  });

  it("honors an explicit valid week after refiling without changing source metadata", () => {
    const sets = sourceSets(Object.freeze({ ...sourceScope }));
    const own = Object.freeze({ setId: "source", module: "FTM 2", courseId: "course-b", week: 7 });
    assert.deepEqual(questionScope(own, sets), { module: "FTM 2", courseId: "course-b", week: 7 });
    assert.deepEqual(sets.get("source")?.scope, sourceScope);
    assert.equal(own.week, 7);
  });

  it("validates inherited legacy weeks instead of trusting the TypeScript declaration", () => {
    for (const value of [0, -1, 100, 1.5, NaN, "2026-11-05", "Week 3-4"]) {
      const sets = sourceSets({ ...sourceScope, week: legacyWeek(value) });
      assert.equal(questionScope({ setId: "source" }, sets).week, undefined);
    }
    const sets = sourceSets({ ...sourceScope, week: legacyWeek("Week 4") });
    assert.equal(questionScope({ setId: "source" }, sets).week, 4);
  });

  it("handles absent source sets without inventing a week or losing own filing", () => {
    assert.deepEqual(questionScope({ setId: "missing", module: "FTM 2", courseId: "course-b" }, sourceSets()),
      { module: "FTM 2", courseId: "course-b", week: undefined });
    assert.deepEqual(questionScope({ module: "FTM 2", week: 8 }),
      { module: "FTM 2", week: 8, courseId: undefined });
  });

  it("preserves explicit tracker paths without interpreting ranges or dates as weeks", () => {
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / Week 12"), { module: "FTM 1", week: 12 });
    assert.deepEqual(trackerPathScope("T1/FTM1/wk2"), { module: "FTM1", week: 2 });
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / Week 12-13"), {});
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / 2026-11-05"), {});
  });

  it("keeps held and refiled questions out of week progress without erasing them", () => {
    const at = "2026-11-05T00:00:00Z";
    const questions = [
      question("valid", { status: "correct", attempts: [{ at, status: "correct" }] }),
      question("ambiguous", { week: legacyWeek("Week 3-4"), status: "incorrect", attempts: [{ at, status: "incorrect" }] }),
      question("other-module", { module: "FTM 2" }),
      question("other-course", { courseId: "course-b" }),
    ];
    const snapshot = JSON.stringify(questions);
    assert.deepEqual(scopeProgress(questions, sourceScope, sourceSets()), {
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0, questionIds: ["valid"],
    });
    assert.deepEqual(scopeProgress(questions, { module: "FTM 2", week: 3, courseId: "course-a" }, sourceSets()).questionIds, []);
    assert.deepEqual(scopeProgress(questions, { module: "FTM 1", week: 3, courseId: "course-b" }, sourceSets()).questionIds, []);
    assert.deepEqual(scopeProgress(questions, { module: "FTM 1", courseId: "course-a" }, sourceSets()).questionIds, ["valid", "ambiguous"]);
    const groups = groupQuestionsByScope(questions, sourceSets());
    assert.deepEqual(groups.find(group => group.key === "ftm1|w3")?.questionIds, ["valid"]);
    assert.deepEqual(groups.flatMap(group => group.questionIds).sort(), questions.map(q => q.id).sort());
    assert.equal(JSON.stringify(questions), snapshot);
  });
});
