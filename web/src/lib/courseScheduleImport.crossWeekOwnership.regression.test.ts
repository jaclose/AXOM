import { describe, expect, it } from "vitest";
import { parseCourseSchedule, scheduleCandidatesToTracker } from "./courseScheduleImport";
import type { TrackerItem } from "./types";

// Real learner progress must remain owned by the original tracker row even
// when the learner refiles its week before re-importing the same course feed.
// Synthetic names/dates; never load a private timetable or account workspace.
const completed: TrackerItem = {
  id: "synthetic-er-imcq-2",
  path: "Term 2/ER/Week 3",
  label: "IMCQ 2",
  kind: "Assessment",
  assessmentDate: "2026-11-09",
  passes: 4,
  ankiPasses: 2,
  yield: "review",
  updated: "2026-11-10T08:00:00.000Z",
  note: "Learner note and progress must not be replaced.",
};

const schedule = "2026-11-09,IMCQ 2,Assessment";
const parseInto = (path: string) =>
  parseCourseSchedule(schedule, [completed], "synthetic-official-course.csv", {}, path);

describe("calendar import exact-course ownership across learner week moves", () => {
  it.each([
    ["new Week 4 placement", "Term 2/ER/Week 4"],
    ["course-root placement", "Term 2/ER"],
    ["unscheduled placement", "Term 2/ER/Unscheduled"],
  ])("does not duplicate the identical dated ER assessment after %s", (_name, target) => {
    const [candidate] = parseInto(target);
    expect(candidate).toMatchObject({
      label: "IMCQ 2",
      kind: "Assessment",
      date: "2026-11-09",
      duplicate: "exact",
      selected: false,
    });
    expect(scheduleCandidatesToTracker([candidate], target)).toEqual([]);
    expect(completed).toMatchObject({
      path: "Term 2/ER/Week 3",
      passes: 4,
      ankiPasses: 2,
      note: "Learner note and progress must not be replaced.",
    });
  });

  it("does not misidentify the same dated assessment in a different course", () => {
    const target = "Term 4/NCRS/Week 4";
    const [candidate] = parseInto(target);
    expect(candidate).toMatchObject({ duplicate: "none", selected: true });
    expect(scheduleCandidatesToTracker([candidate], target)).toMatchObject([
      { path: target, label: "IMCQ 2", assessmentDate: "2026-11-09", passes: 0 },
    ]);
  });

  it("retains existing exact-path duplicate refusal", () => {
    const target = "Term 2/ER/Week 3";
    const [candidate] = parseInto(target);
    expect(candidate).toMatchObject({ duplicate: "exact", selected: false });
    expect(scheduleCandidatesToTracker([candidate], target)).toEqual([]);
  });

  it("does not collapse different dated assessments within the same course", () => {
    const target = "Term 2/ER/Week 4";
    const [candidate] = parseCourseSchedule(
      "2026-11-16,IMCQ 2,Assessment", [completed],
      "synthetic-official-course.csv", {}, target,
    );
    // A repeated label one week later may warrant review, but is not the
    // same dated assessment and must not be silently discarded as exact.
    expect(candidate.duplicate).not.toBe("exact");
  });
});
