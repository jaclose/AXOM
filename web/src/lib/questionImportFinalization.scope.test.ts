import { describe, expect, it } from "vitest";
import { findEquivalentReviewedSet, reviewedImportFingerprint, type ReviewedQuestionInput } from "./questionImportFinalization";
import type { QuestionSet } from "./library";
import type { QuestionRecord } from "./questions";

const question = (courseId: string, module: string, week: number, id = "new-question"): ReviewedQuestionInput => ({
  id,
  source: "imported",
  stem: "Which finding supports the diagnosis?",
  options: [
    { key: "A", text: "Characteristic finding" },
    { key: "B", text: "Unrelated finding" },
  ],
  correctKey: "A",
  explanation: "Synthetic explanation for scope-identity regression.",
  tags: [],
  courseId,
  module,
  week,
});

const fingerprint = (candidate: ReviewedQuestionInput) => reviewedImportFingerprint({
  title: "Same source questions",
  destination: "set",
  sourceIdentity: "checksum:synthetic-source",
  candidates: [candidate],
});

describe("reviewed import source filing identity", () => {
  it("does not join an otherwise identical import into a different source-supported week, module or course", () => {
    const original = question("course-a", "Module A", 15);
    const originalKey = fingerprint(original);
    // IDs are transient, and should not alter exact same-scope idempotency.
    expect(fingerprint(question("course-a", "Module A", 15, "new-question-2"))).toBe(originalKey);
    expect(fingerprint(question("course-a", "Module A", 16))).not.toBe(originalKey);
    expect(fingerprint(question("course-a", "Module B", 15))).not.toBe(originalKey);
    expect(fingerprint(question("course-b", "Module A", 15))).not.toBe(originalKey);
  });

  it("does not reuse a different filing's saved question set as an equivalent import", () => {
    const storedQuestion = question("course-a", "Module A", 15, "stored-question") as unknown as QuestionRecord;
    const storedSet = {
      id: "stored-set",
      title: "Same source questions",
      questionIds: ["stored-question"],
      sourceDocumentIds: [],
      kind: "source",
      tags: [],
      scope: { courseId: "course-a", module: "Module A", week: 15 },
    } as QuestionSet;
    const find = (candidate: ReviewedQuestionInput) => findEquivalentReviewedSet({
      sets: [storedSet],
      questions: [storedQuestion],
      title: "Same source questions",
      candidates: [candidate],
    });

    expect(find(question("course-a", "Module A", 15))).toEqual({
      set: storedSet,
      questionIds: ["stored-question"],
    });
    expect(find(question("course-a", "Module A", 16))).toBeUndefined();
    expect(find(question("course-a", "Module B", 15))).toBeUndefined();
    expect(find(question("course-b", "Module A", 15))).toBeUndefined();
  });
});
