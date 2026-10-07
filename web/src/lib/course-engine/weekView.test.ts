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
