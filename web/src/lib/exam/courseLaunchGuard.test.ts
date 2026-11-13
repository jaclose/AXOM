// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import { inspectCourseLaunch } from "./courseLaunchGuard";

const KEY = "axom.courseQuizLaunch.v1";
function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id, source: "manual", stem: `Medical question ${id}`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", ...patch,
  };
}
function store(ids: string[]) {
  sessionStorage.setItem(KEY, JSON.stringify({
    term: "Term 4", module: "FTCM", week: 2, questionIds: ids,
    setIds: ["imcq-week2"],
  }));
}
beforeEach(() => sessionStorage.clear());

describe("exact Course Tracker practice handoff", () => {
  it("reports missing records and retains all original IDs without consuming the request", () => {
    store(["q1", "q2", "q3"]);
    expect(inspectCourseLaunch([question("q2")])).toEqual({
      state: "pending", term: "Term 4", module: "FTCM", week: 2,
      total: 3, ready: 1, missing: 2, review: 0, reviewIds: [],
    });
    expect(JSON.parse(sessionStorage.getItem(KEY)! ).questionIds).toEqual(["q1", "q2", "q3"]);
  });
  it("keeps review-required questions separate from missing questions", () => {
    store(["q1", "q2", "q3"]);
    expect(inspectCourseLaunch([
      question("q1", { needsReview: true }), question("q2"),
    ])).toMatchObject({
      state: "pending", total: 3, ready: 1, missing: 1, review: 1, reviewIds: ["q1"],
    });
  });
  it("starts only if every requested question is ready, preserving exact order", () => {
    store(["q2", "q1"]);
    expect(inspectCourseLaunch([question("q1")]).state).toBe("pending");
    const full = inspectCourseLaunch([question("q1"), question("q2")]);
    expect(full).toEqual({
      state: "ready",
      launch: {
        term: "Term 4", module: "FTCM", week: 2,
        questionIds: ["q2", "q1"], setIds: ["imcq-week2"],
      },
    });
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });
  it("rejects duplicate, oversized, malformed or otherwise invalid selections", () => {
    store(["q1", "q1"]);
    expect(inspectCourseLaunch([question("q1")]).state).toBe("invalid");
    store([]);
    expect(inspectCourseLaunch([]).state).toBe("invalid");
    store(Array.from({ length: 2001 }, (_, i) => `q${i}`));
    expect(inspectCourseLaunch([]).state).toBe("invalid");
    sessionStorage.setItem(KEY, "{broken");
    expect(inspectCourseLaunch([]).state).toBe("invalid");
    expect(sessionStorage.getItem(KEY)).toBe("{broken");
  });
  it("holds disputed on-device identities for review rather than reporting a runnable quiz", () => {
    store(["q1", "q2"]);
    const pending = sessionStorage.getItem(KEY);
    const original = question("q1");
    const conflicting = question("q1", { stem: "Contradictory stem on the same original ID" });
    for (const local of [[original, conflicting], [conflicting, original]]) {
      expect(inspectCourseLaunch([...local, question("q2")])).toEqual({
        state: "pending", term: "Term 4", module: "FTCM", week: 2,
        total: 2, ready: 1, missing: 0, review: 1, reviewIds: ["q1"],
      });
      expect(sessionStorage.getItem(KEY)).toBe(pending);
    }
    // Duplicate local records outside the fixed selection do not block it.
    expect(inspectCourseLaunch([
      question("q1"), question("q2"), question("other"), question("other", { stem: "Conflicting outside selection" }),
    ]).state).toBe("ready");
  });

  it("reports contradicted original module/week/course filing as review-held rather than ready", () => {
    store(["q1", "q2"]);
    const value = JSON.parse(sessionStorage.getItem(KEY)!);
    value.courseId = "course-a";
    sessionStorage.setItem(KEY, JSON.stringify(value));
    const pending = sessionStorage.getItem(KEY);
    for (const conflicting of [
      question("q1", { module: "DIFFERENT", week: 2, courseId: "course-a" }),
      question("q1", { module: "FTCM", week: 3, courseId: "course-a" }),
      question("q1", { module: "FTCM", week: 0, courseId: "course-a" }),
      question("q1", { module: "FTCM", week: 2, courseId: "other-course" }),
    ]) {
      expect(inspectCourseLaunch([conflicting, question("q2")])).toEqual({
        state: "pending", term: "Term 4", module: "FTCM", week: 2,
        total: 2, ready: 1, missing: 0, review: 1, reviewIds: ["q1"],
      });
      expect(sessionStorage.getItem(KEY)).toBe(pending);
    }
    expect(inspectCourseLaunch([
      question("q1", { module: "ftcm", week: 2, courseId: "course-a" }), question("q2"),
    ]).state).toBe("ready");
  });

  it("has no pending state when no handoff exists", () => {
    expect(inspectCourseLaunch([])).toEqual({ state: "none" });
  });
});
