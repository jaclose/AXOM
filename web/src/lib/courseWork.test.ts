import { describe, expect, it } from "vitest";
import type { Course, Term, TrackerItem } from "./types";
import {
  confirmCoursePass,
  courseModulePaths,
  isArchivedCourseItem,
  reviewTaskInputs,
  withCourseProgress,
} from "./courseWork";

const at = "2026-10-13T12:00:00.000Z";
const item = (patch: Partial<TrackerItem> = {}): TrackerItem => ({
  id: "tracker-1",
  path: "Term 4/NCRS/Neuro",
  label: "Cranial nerves",
  kind: "Lecture",
  passes: 0,
  ankiPasses: 0,
  yield: "none",
  updated: at,
  ...patch,
});

describe("course work lifecycle", () => {
  it("records one confirmed pass per completion event", () => {
    const first = confirmCoursePass(item(), "study", "pomodoro:1", at);
    const repeated = confirmCoursePass(first, "study", "pomodoro:1", "2026-10-13T12:05:00.000Z");
    expect(first).toMatchObject({ passes: 1, passEvents: [{ id: "pomodoro:1", method: "study", at }] });
    expect(repeated).toEqual(first);
  });

  it("archives generated review work after either a study or Anki completion", () => {
    const review = item({ kind: "Review Loop", reviewTask: { source: "digest", sourceId: "set-1" } });
    expect(withCourseProgress(review, { passes: 1 }, at).archivedAt).toBe(at);
    const anki = withCourseProgress(review, { ankiPasses: 1 }, at);
    expect(anki.archivedAt).toBe(at);
    expect(isArchivedCourseItem(anki)).toBe(true);
  });

  it("deduplicates only active review work and preserves its source", () => {
    const existing = item({
      path: "Question Bank/Review",
      label: "Review renal clearance",
      kind: "Review Loop",
      reviewTask: { source: "question-results" },
    });
    const inputs = reviewTaskInputs(
      ["Renal clearance", "renal clearance", "Physiology"],
      "Question Bank / Review",
      { source: "digest", sourceId: "set-1" },
      [existing],
    );
    expect(inputs).toEqual([expect.objectContaining({
      path: "Question Bank/Review",
      label: "Review Physiology",
      reviewTask: { source: "digest", sourceId: "set-1" },
    })]);
  });

  it("derives stable module destinations from course structure and tracker paths", () => {
    const terms: Term[] = [{ id: "t4", name: "Term 4" }];
    const courses: Course[] = [{ id: "ncrs", termId: "t4", code: "NCRS", name: "Neuroscience", files: 0, modules: [{ id: "m1", name: "Neuro" }] }];
    expect(courseModulePaths(terms, courses, [item({ path: "Term 4/NCRS/Neuro/Lectures" })])).toEqual(["Term 4/NCRS/Neuro"]);
  });
});
