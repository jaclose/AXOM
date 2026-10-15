import { describe, expect, it } from "vitest";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { verifyCollectionForCourse } from "./verifiedPracticeLinks";

const stamp = "2026-10-14T12:00:00.000Z";
const q = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: "Test source question",
  options: [{ key: "A", text: "Correct" }, { key: "B", text: "Wrong" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [],
  createdAt: stamp, updatedAt: stamp, ...patch,
});
const bank = (id: string, ids: string[], scope?: QuestionSet["scope"]): QuestionSet => ({
  id, title: "Source set", questionIds: ids, scope, sourceDocumentIds: [],
  tags: [], createdAt: stamp, parserWarnings: [], aiEnhanced: false,
});
const verify = (
  readyIds: string[], questions: QuestionRecord[], sets: QuestionSet[],
  requested = { module: "NB2", week: 3, courseId: "core" },
  setId = "set", strict = true,
) => verifyCollectionForCourse({
  setId, readyQuestionIds: readyIds, questionIds: readyIds,
}, requested, new Map(questions.map((item) => [item.id, item])),
new Map(sets.map((item) => [item.id, item])), strict);

describe("review-gated Tracker-to-QBank links", () => {
  it("launches reviewed questions when immutable membership and course/week metadata agree", () => {
    const questions = [q("core", { module: "NB Block 2", week: 3, courseId: "core", setId: "set" })];
    const sets = [bank("set", ["core"], { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["core"], questions, sets)).toEqual({
      readyQuestionIds: ["core"], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });

  it("holds the entire set when a member explicitly belongs to a different course", () => {
    const questions = [
      q("good", { module: "NB2", week: 3, courseId: "core", setId: "set" }),
      q("conflict", { module: "NB2", week: 3, courseId: "elective", setId: "set" }),
    ];
    const sets = [bank("set", ["good", "conflict"], { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["good", "conflict"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 1,
    });
  });

  it("holds sets whose explicit week or module disagrees with the selected course scope", () => {
    const questions = [q("q", { module: "NB2", courseId: "core", week: 4, setId: "set" })];
    const sets = [bank("set", ["q"], { module: "NB2", courseId: "core", week: 4 })];
    expect(verify(["q"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
    expect(verify(["q"], questions, sets, { module: "ER", week: 4, courseId: "core" })).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
  });

  it("accepts older uniquely owned module/week evidence but demands course proof when names collide", () => {
    const questions = [q("legacy", { module: "NB2", week: 3, setId: "set" })];
    const sets = [bank("set", ["legacy"], { module: "NB2", week: 3 })];
    expect(verify(["legacy"], questions, sets, { module: "NB2", week: 3, courseId: "core" }, "set", false)).toMatchObject({
      readyQuestionIds: ["legacy"], sourceReviewRequired: false,
    });
    expect(verify(["legacy"], questions, sets, { module: "NB2", week: 3, courseId: "core" }, "set", true)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
  });

  it("keeps available reviewed members when a separately referenced record is absent", () => {
    const questions = [q("present", { module: "NB2", courseId: "core", week: 3, setId: "set" })];
    const sets = [bank("set", ["present", "missing"], { module: "NB2", courseId: "core", week: 3 })];
    expect(verify(["present"], questions, sets)).toMatchObject({
      readyQuestionIds: ["present"], sourceReviewRequired: false, unavailableQuestionCount: 1,
    });
  });

  it("rejects forged ready IDs not in an immutable set, and untrusted answer keys", () => {
    const questions = [
      q("in-set", { module: "NB2", courseId: "core", week: 3, setId: "set", correctKey: "Z" }),
      q("foreign", { module: "NB2", courseId: "core", week: 3, setId: "set" }),
    ];
    const sets = [bank("set", ["in-set"], { module: "NB2", courseId: "core", week: 3 })];
    expect(verify(["in-set", "foreign"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
    expect(verify(["in-set"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: false,
    });
  });
});
