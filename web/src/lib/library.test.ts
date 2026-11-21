import { describe, expect, it } from "vitest";
import { accuracyTone, questionSetMetrics, sortQuestionSetsByRecency, type QuestionSet } from "./library";
import type { QuestionRecord } from "./questions";

function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id, source: "imported", stem: `Stem ${id}`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "A", correctAnswerText: "Alpha", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

const set: QuestionSet = {
  id: "set", title: "Immunology set", sourceDocumentIds: ["doc"],
  createdAt: "2026-07-01T00:00:00.000Z", questionIds: ["q1", "q2", "q3"],
  tags: [], aiEnhanced: false, parserWarnings: [],
};

describe("question-set progress, current mastery, and historical accuracy", () => {
  it("uses the exact product accuracy color thresholds", () => {
    expect(accuracyTone(null)).toBe("neutral");
    expect(accuracyTone(100)).toBe("green");
    expect(accuracyTone(90)).toBe("green");
    expect(accuracyTone(89)).toBe("gold");
    expect(accuracyTone(80)).toBe("gold");
    expect(accuracyTone(79)).toBe("orange");
    expect(accuracyTone(70)).toBe("orange");
    expect(accuracyTone(69)).toBe("red");
    expect(accuracyTone(0)).toBe("red");
  });

  it("separates completion from accuracy and surfaces review/source metadata", () => {
    const questions = [
      question("q1", {
        category: "Immunology", status: "correct", attemptedAt: "2026-07-08T10:00:00.000Z",
        attempts: [{ at: "2026-07-08T10:00:00.000Z", answerKey: "A", status: "correct" }],
        extraction: { confidence: "high", reviewed: true, overallImportConfidence: 0.96 },
      }),
      question("q2", {
        category: "Immunology", status: "incorrect", needsReview: true,
        attempts: [{ at: "2026-07-09T10:00:00.000Z", answerKey: "B", status: "incorrect" }],
        extraction: { confidence: "medium", reviewed: false, overallImportConfidence: 0.74 },
      }),
      question("q3", { category: "Pathology" }),
    ];
    const metrics = questionSetMetrics(set, questions, [{
      id: "doc", title: "Week 4 source", fileName: "week4.pdf", fileType: "pdf",
      uploadedAt: "2026-07-01T00:00:00.000Z", rawText: "", sizeBytes: 1,
      tags: [], linkedQuestionSetIds: ["set"], libraryOnly: false,
    }]);
    expect(metrics).toMatchObject({
      total: 3,
      completed: 2,
      remaining: 1,
      completionPct: 67,
      currentMasteryCorrect: 1,
      currentMasteryQuestions: 2,
      currentMasteryPct: 50,
      currentMasteryTone: "red",
      historicalCorrectAttempts: 1,
      historicalAttemptCount: 2,
      historicalAccuracyPct: 50,
      needsReview: 1,
      mapping: {
        ready: 2,
        reviewSuggested: 0,
        unresolved: 1,
        issueCount: 1,
        issueQuestionIds: ["q2"],
        reviewSuggestedQuestionIds: [],
        unresolvedQuestionIds: ["q2"],
      },
      importConfidence: 85,
      category: "Immunology",
      sourceTitle: "Week 4 source",
      lastStudiedAt: "2026-07-09T10:00:00.000Z",
      missedQuestionIds: ["q2"],
    });
  });

  it("uses a neutral bar when no attempts exist", () => {
    const metrics = questionSetMetrics(set, set.questionIds.map((id) => question(id)));
    expect(metrics.completed).toBe(0);
    expect(metrics.currentMasteryPct).toBeNull();
    expect(metrics.currentMasteryTone).toBe("neutral");
    expect(metrics.historicalAccuracyPct).toBeNull();
  });

  it("uses each active question's latest attempt for mastery while retaining all-attempt history", () => {
    const retried = question("q1", {
      attempts: [
        { at: "2026-07-08T10:00:00.000Z", answerKey: "B", status: "incorrect" },
        { at: "2026-07-08T10:05:00.000Z", answerKey: "B", status: "incorrect" },
        { at: "2026-07-08T10:10:00.000Z", answerKey: "A", status: "correct" },
      ],
    });
    const metrics = questionSetMetrics({ ...set, questionIds: [retried.id] }, [retried]);

    expect(metrics).toMatchObject({
      currentMasteryCorrect: 1,
      currentMasteryQuestions: 1,
      currentMasteryPct: 100,
      currentMasteryTone: "green",
      historicalCorrectAttempts: 1,
      historicalAttemptCount: 3,
      historicalAccuracyPct: 33,
    });
  });

  it("selects the chronologically latest attempt even when imported history is out of order", () => {
    const imported = question("q1", {
      attempts: [
        { at: "2026-07-08T10:10:00.000Z", answerKey: "B", status: "incorrect" },
        { at: "2026-07-08T10:00:00.000Z", answerKey: "A", status: "correct" },
      ],
    });
    const metrics = questionSetMetrics({ ...set, questionIds: [imported.id] }, [imported]);

    expect(metrics.currentMasteryPct).toBe(0);
    expect(metrics.historicalAccuracyPct).toBe(50);
    expect(metrics.missedQuestionIds).toEqual([imported.id]);
  });

  it("compares offset-bearing ISO timestamps by instant rather than text order", () => {
    const imported = question("q1", {
      attempts: [
        { at: "2026-07-08T09:30:00Z", answerKey: "A", status: "correct" },
        { at: "2026-07-08T10:00:00+02:00", answerKey: "B", status: "incorrect" },
      ],
    });
    const metrics = questionSetMetrics({ ...set, questionIds: [imported.id] }, [imported]);

    expect(metrics.currentMasteryPct).toBe(100);
    expect(metrics.missedQuestionIds).toEqual([]);
  });

  it("counts mapping categories only for active questions linked to the set", () => {
    const linkedUnresolved = question("q1", { correctKey: undefined });
    const linkedSuggested = question("q2", {
      extraction: { confidence: "medium", reviewed: false, overallImportConfidence: 0.7 },
    });
    const linkedReady = question("q3", {
      extraction: { confidence: "high", reviewed: true, overallImportConfidence: 0.95 },
    });
    const unlinkedIssue = question("outside", { correctKey: undefined, needsReview: true });

    const metrics = questionSetMetrics(set, [linkedUnresolved, linkedSuggested, linkedReady, unlinkedIssue]);

    expect(metrics.needsReview).toBe(2);
    expect(metrics.mapping).toEqual({
      ready: 1,
      reviewSuggested: 1,
      unresolved: 1,
      issueCount: 2,
      issueQuestionIds: ["q1", "q2"],
      reviewSuggestedQuestionIds: ["q2"],
      unresolvedQuestionIds: ["q1"],
    });
  });
});


describe("question-set summaries hold ambiguous canonical source identity", () => {
  const attempt = (answerKey: string, status: "correct" | "incorrect") => ({
    at: "2026-07-09T10:00:00.000Z", answerKey, status,
  });

  it("cannot report 200% completion for two distinct imported records sharing one set ID, in either source order", () => {
    const sourceA = question("collided", {
      category: "Renal", attempts: [attempt("A", "correct")],
    });
    const sourceB = question("collided", {
      category: "Cardiac", options: [{ key: "A", text: "Beta" }, { key: "B", text: "Gamma" }],
      attempts: [attempt("B", "incorrect")],
    });
    const reviewSet = { ...set, questionIds: ["collided"] };
    for (const records of [[sourceA, sourceB], [sourceB, sourceA]]) {
      const metrics = questionSetMetrics(reviewSet, records);
      expect(metrics).toMatchObject({
        total: 1, completed: 0, remaining: 1, completionPct: 0,
        currentMasteryCorrect: 0, currentMasteryQuestions: 0,
        currentMasteryPct: null, historicalCorrectAttempts: 0,
        historicalAttemptCount: 0, historicalAccuracyPct: null,
        needsReview: 1,
        mapping: { ready: 0, reviewSuggested: 0, unresolved: 1,
          issueCount: 1, issueQuestionIds: ["collided"], unresolvedQuestionIds: ["collided"] },
      });
      expect(metrics.lastStudiedAt).toBeUndefined();
      expect(metrics.missedQuestionIds).toEqual([]);
      expect(metrics.category).toBeUndefined();
      expect(metrics.importConfidence).toBeNull();
    }
  });

  it("keeps unique source progress, accuracy, category, and confidence while quarantining only collided records", () => {
    const collidedA = question("collided", {
      category: "Renal", extraction: { confidence: "high", reviewed: true, overallImportConfidence: 0.99 },
      attempts: [attempt("A", "correct")],
    });
    const collidedB = question("collided", {
      category: "Cardiac", extraction: { confidence: "high", reviewed: true, overallImportConfidence: 0.98 },
      attempts: [attempt("B", "incorrect")],
    });
    const valid = question("valid", {
      category: "Pathology", extraction: { confidence: "high", reviewed: true, overallImportConfidence: 0.8 },
      attempts: [attempt("A", "correct")],
    });
    const reviewSet = { ...set, questionIds: ["collided", "valid"] };
    const originalSet = structuredClone(reviewSet);
    const originalQuestions = structuredClone([collidedA, collidedB, valid]);
    for (const records of [[collidedA, valid, collidedB], [collidedB, collidedA, valid]]) {
      const metrics = questionSetMetrics(reviewSet, records);
      expect(metrics).toMatchObject({
        total: 2, completed: 1, remaining: 1, completionPct: 50,
        currentMasteryCorrect: 1, currentMasteryQuestions: 1, currentMasteryPct: 100,
        historicalCorrectAttempts: 1, historicalAttemptCount: 1, historicalAccuracyPct: 100,
        category: "Pathology", importConfidence: 80, needsReview: 1,
        mapping: { ready: 1, unresolved: 1, issueCount: 1, issueQuestionIds: ["collided"] },
      });
      expect(metrics.missedQuestionIds).toEqual([]);
    }
    expect(reviewSet).toEqual(originalSet);
    expect([collidedA, collidedB, valid]).toEqual(originalQuestions);
  });

  it("counts repeated legacy membership IDs once without changing the saved membership", () => {
    const legacySet = { ...set, questionIds: ["valid", "valid", "unseen"] };
    const valid = question("valid", { attempts: [attempt("A", "correct")] });
    const metrics = questionSetMetrics(legacySet, [valid, question("unseen")]);
    expect(metrics).toMatchObject({
      total: 2, completed: 1, remaining: 1, completionPct: 50,
      historicalAttemptCount: 1, currentMasteryQuestions: 1,
    });
    expect(legacySet.questionIds).toEqual(["valid", "valid", "unseen"]);
  });

  it("marks even unattempted duplicate source rows as one unresolved set membership, not two ready questions", () => {
    const metrics = questionSetMetrics({ ...set, questionIds: ["unattempted"] },
      [question("unattempted"), question("unattempted")]);
    expect(metrics.mapping).toMatchObject({
      ready: 0, unresolved: 1, issueCount: 1,
      issueQuestionIds: ["unattempted"], unresolvedQuestionIds: ["unattempted"],
    });
    expect(metrics).toMatchObject({ total: 1, completed: 0, remaining: 1, completionPct: 0 });
  });
});

describe("recent question-set ordering", () => {
  function qset(id: string, createdAt: string, questionId: string): QuestionSet {
    return {
      id,
      title: id,
      sourceDocumentIds: [],
      createdAt,
      questionIds: [questionId],
      tags: [],
      aiEnhanced: false,
      parserWarnings: [],
    };
  }

  it("sorts by numeric activity instant with creation fallback", () => {
    const sets = [
      qset("offset-earlier", "2026-07-01T00:00:00.000Z", "q-offset"),
      qset("created-fallback", "2026-07-11T09:00:00.000Z", "q-created"),
      qset("studied-later", "2026-07-01T00:00:00.000Z", "q-later"),
      qset("invalid-study", "2026-07-11T09:15:00.000Z", "q-invalid"),
    ];
    const questions = [
      question("q-offset", {
        attempts: [{ at: "2026-07-11T10:00:00+02:00", answerKey: "A", status: "correct" }],
      }),
      question("q-created"),
      question("q-later", {
        attempts: [{ at: "2026-07-11T09:30:00Z", answerKey: "A", status: "correct" }],
      }),
      question("q-invalid", {
        attemptedAt: "not-a-date",
        attempts: [{ at: "also-not-a-date", answerKey: "A", status: "correct" }],
      }),
    ];

    expect(sortQuestionSetsByRecency(sets, questions).map((item) => item.id)).toEqual([
      "studied-later",
      "invalid-study",
      "created-fallback",
      "offset-earlier",
    ]);
  });

  it("preserves stable input order for equal or missing dates and mutates neither input", () => {
    const sets = [
      qset("equal-a", "2026-07-11T09:00:00.000Z", "a"),
      qset("missing-a", "invalid", "missing-a"),
      qset("equal-b", "2026-07-11T05:00:00-04:00", "b"),
      qset("missing-b", "also-invalid", "missing-b"),
    ];
    const questions = [question("a"), question("b"), question("missing-a"), question("missing-b")];
    const setsBefore = structuredClone(sets);
    const questionsBefore = structuredClone(questions);

    expect(sortQuestionSetsByRecency(sets, questions).map((item) => item.id)).toEqual([
      "equal-a",
      "equal-b",
      "missing-a",
      "missing-b",
    ]);
    expect(sets).toEqual(setsBefore);
    expect(questions).toEqual(questionsBefore);
  });
});
