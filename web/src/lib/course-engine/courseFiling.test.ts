import { describe, expect, it } from "vitest";
import type { Course, Term, TrackerItem } from "../types";
import { legacyCourseFilingProposals, moveTrackerCourseFiling } from "./courseFiling";

const terms: Term[] = [{ id: "t1", name: "Term 1" }, { id: "t2", name: "Term 2" }];
const courses: Course[] = [
  { id: "c1", termId: "t1", code: "BPM 500", name: "Medicine I", files: 0, modules: [{ id: "ftm", name: "FTM 1" }] },
  { id: "c2", termId: "t2", code: "BPM 501", name: "Medicine II", files: 0, modules: [{ id: "nb", name: "NB2" }] },
];
function row(id: string, path: string): TrackerItem {
  return {
    id, path, label: "Lecture 01 Histology", kind: "Lecture", activity: "lecture",
    templateKey: "nbblock2|lecture|1", weekSource: "learner", passes: 3, ankiPasses: 2,
    yield: "review", updated: "2026-07-18T14:00:00.000Z", attendance: "attended",
    note: "Protected student note",
    passEvents: [{ id: "study-1", method: "study", at: "2026-07-18T14:00:00.000Z" }],
  };
}
describe("legacy course filing without progress loss", () => {
  it("offers the unique supported course and migrates all week rows without touching history", () => {
    const original = [
      row("a", "Term 2/NB Block 2/Week 2"),
      row("b", "Term 2/NB Block 2/Week 3"),
      row("other", "Term 1/FTM 1/Week 1"),
    ];
    const plan = legacyCourseFilingProposals(original, terms, courses);
    expect(plan).toContainEqual({
      from: "Term 2/NB Block 2", to: "Term 2/BPM 501/NB2", module: "NB Block 2",
      courseCode: "BPM 501", itemCount: 2,
    });
    const chosen = plan.find((entry) => entry.from === "Term 2/NB Block 2")!;
    const moved = moveTrackerCourseFiling(original, chosen);
    expect(moved[0]).toEqual({ ...original[0], path: "Term 2/BPM 501/NB2/Week 2" });
    expect(moved[1]).toEqual({ ...original[1], path: "Term 2/BPM 501/NB2/Week 3" });
    expect(moved[2]).toEqual(original[2]);
    expect(original[0].path).toBe("Term 2/NB Block 2/Week 2");
    expect(legacyCourseFilingProposals(moved, terms, courses).some((entry) => entry.from === chosen.from)).toBe(false);
  });

  it("maps an older T2 path onto the user's actual Term 2 course shell", () => {
    const [proposal] = legacyCourseFilingProposals([row("a", "T2/NB2/Unscheduled")], terms, courses);
    expect(proposal).toMatchObject({ from: "T2/NB2", to: "Term 2/BPM 501/NB2", itemCount: 1 });
    expect(moveTrackerCourseFiling([row("a", "T2/NB2/Unscheduled")], proposal)[0].path)
      .toBe("Term 2/BPM 501/NB2/Unscheduled");
  });

  it("blocks collisions and refuses to silently merge destination tasks", () => {
    const existing = [
      row("a", "Term 2/NB2/Week 1"),
      row("b", "Term 2/BPM 501/NB2/Week 1"),
    ];
    const [proposal] = legacyCourseFilingProposals(existing, terms, courses);
    expect(proposal).toMatchObject({ blocked: "destination-has-items" });
    expect(() => moveTrackerCourseFiling(existing, proposal)).toThrow(/Resolve course filing conflicts/);
    const proposalFromEarlier = legacyCourseFilingProposals([existing[0]], terms, courses)[0];
    expect(() => moveTrackerCourseFiling(existing, proposalFromEarlier)).toThrow(/destination now has activities/);
  });

  it("rejects ambiguous module ownership across two courses rather than guessing", () => {
    const extra: Course = { id: "other", termId: "t2", code: "ELECTIVE", name: "Elective",
      files: 0, modules: [{ id: "nb-copy", name: "NB Block 2" }] };
    const original = [row("a", "Term 2/NB2/Week 1")];
    const [proposal] = legacyCourseFilingProposals(original, terms, [...courses, extra]);
    expect(proposal).toMatchObject({ blocked: "ambiguous-course", itemCount: 1 });
    expect(() => moveTrackerCourseFiling(original, proposal)).toThrow();
  });

  it("fails closed if the module row count changed after the student's preview", () => {
    const initial = [row("a", "Term 2/NB2/Week 1")];
    const [proposal] = legacyCourseFilingProposals(initial, terms, courses);
    expect(() => moveTrackerCourseFiling([...initial, row("late", "Term 2/NB2/Week 2")], proposal))
      .toThrow(/Tracker changed since/);
  });
});
