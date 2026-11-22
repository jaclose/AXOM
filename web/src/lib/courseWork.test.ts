import { describe, expect, it } from "vitest";
import type { TrackerItem } from "./types";
import {
  confirmCoursePass,
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
  it("preserves separate review work for distinct source IDs even when topic and destination match", () => {
    const existing = item({
      path: "Question Bank/Review",
      label: "Review renal clearance",
      kind: "Review Loop",
      reviewTask: { source: "digest", sourceId: "set-A" },
    });
    const newSet = reviewTaskInputs(["Renal clearance"], "Question Bank/Review",
      { source: "digest", sourceId: "set-B" }, [existing]);
    expect(newSet).toEqual([expect.objectContaining({
      label: "Review Renal clearance", reviewTask: { source: "digest", sourceId: "set-B" },
    })]);
    const newSession = reviewTaskInputs(["Renal clearance"], "Question Bank/Review",
      { source: "question-results", sourceId: "session-1" }, [existing]);
    expect(newSession).toHaveLength(1);
    expect(newSession[0].reviewTask).toEqual({ source: "question-results", sourceId: "session-1" });
    expect(reviewTaskInputs(["Renal clearance"], "Question Bank/Review",
      { source: "digest", sourceId: "set-A" }, [existing])).toEqual([]);
  });

  it("remains idempotent within each source and preserves conservative legacy deduplication", () => {
    const existing = item({
      path: "Question Bank/Review",
      label: "Review renal clearance",
      kind: "Review Loop",
      reviewTask: { source: "question-results" },
    });
    expect(reviewTaskInputs(["renal clearance"], "Question Bank/Review",
      { source: "digest", sourceId: "set-B" }, [existing])).toEqual([]);
    const created = reviewTaskInputs(["Renal clearance", "renal clearance", " Review renal clearance "],
      "Question Bank/Review", { source: "digest", sourceId: "set-B" }, []);
    expect(created).toHaveLength(1);
    expect(created[0].reviewTask).toEqual({ source: "digest", sourceId: "set-B" });
  });

});
