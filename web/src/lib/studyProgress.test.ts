import { describe, expect, it } from "vitest";
import { rankTrackerItems } from "./recommendationFactors";
import { scopeStudyProgress, trackerStudyProgress } from "./studyProgress";
import type { Course, TrackerItem, TrackerKind } from "./types";

const item: TrackerItem = { id: "lecture", path: "RENAL/Week 1", label: "Renal transport", kind: "Lecture", passes: 4, ankiPasses: 3, yield: "high", updated: "2026-08-01T00:00:00Z" };
const course: Course = { id: "renal", termId: "term", code: "RENAL", name: "Renal block", files: 0, modules: [], studyPlanOverride: { lecturePasses: 4 } };

describe("personalized study progress", () => {
  it("uses the same six-pass target as recommendations, without treating four passes as complete", () => {
    const options = { preferences: { configured: true, lecturePasses: 6 } };
    expect(trackerStudyProgress(item, options)).toMatchObject({ target: 6, fraction: 4 / 6, complete: false });
    expect(scopeStudyProgress([item], options)).toEqual({ percent: 67, complete: 0, inProgress: 1, notStarted: 0 });
    expect(rankTrackerItems([item], options)[0].target).toBe(6);
  });

  it("resolves learner, course, item-kind and item targets consistently", () => {
    const options = { courses: [course], preferences: { configured: true, lecturePasses: 2 } };
    expect(trackerStudyProgress({ ...item, path: "OTHER" }, options).target).toBe(2);
    expect(trackerStudyProgress(item, options).target).toBe(4);
    const withKind = { ...options, preferences: { ...options.preferences, itemKindDefaults: { Lecture: { lecturePasses: 5 } } } };
    expect(trackerStudyProgress(item, withKind).target).toBe(5);
    const override = { ...item, studyPlanOverride: { lecturePasses: 6 } };
    expect(trackerStudyProgress(override, withKind).target).toBe(rankTrackerItems([override], withKind)[0].target);
  });

  it.each<TrackerKind>(["PQ", "Question Block", "Assessment", "Requirement", "Milestone", "Evidence"])("keeps %s completion rules independent of lecture targets", (kind) => {
    const value = { ...item, kind, passes: 0 };
    const options = { preferences: { configured: true, lecturePasses: 6 } };
    const target = ["PQ", "Question Block", "Assessment"].includes(kind) ? 3 : 1;
    expect(trackerStudyProgress(value, options).target).toBe(target);
    expect(rankTrackerItems([value], options)[0].target).toBe(target);
  });

  it("averages each item's capped progress, with honest counts for mixed and snoozed work", () => {
    const items: TrackerItem[] = [
      { ...item, passes: 1, studyPlanOverride: { lecturePasses: 2 } },
      { ...item, id: "pq", kind: "PQ", passes: 3 },
      { ...item, id: "done", kind: "Requirement", passes: 1 },
      { ...item, id: "snoozed", passes: 0, recommendationSnoozedUntil: "2099-01-01T00:00:00Z" },
    ];
    expect(scopeStudyProgress(items)).toEqual({ percent: 63, complete: 2, inProgress: 1, notStarted: 1 });
  });

  it("recalculates changed targets without altering passes, Anki, yield or snooze history", () => {
    const value = { ...item, passes: 6, recommendationSnoozedUntil: "2099-01-01T00:00:00Z" };
    const before = structuredClone(value);
    expect(trackerStudyProgress(value, { preferences: { configured: true, lecturePasses: 2 } })).toMatchObject({ target: 2, fraction: 1, complete: true });
    expect(value).toEqual(before);
    expect(scopeStudyProgress([{ ...item, passes: 2 }])).toMatchObject({ percent: 100, complete: 1 });
  });

  it("reports an empty scope as zero without inventing completed items", () => {
    expect(scopeStudyProgress([])).toEqual({ percent: 0, complete: 0, inProgress: 0, notStarted: 0 });
  });
});
