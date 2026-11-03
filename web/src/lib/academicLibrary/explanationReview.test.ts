import { describe, expect, it } from "vitest";
import { countReadyExplanations, hasQuestionExplanation } from "./explanationReview";

describe("ready question explanation observations", () => {
  it("counts ready questions with source prose and keeps missing or image-only rationales visible", () => {
    const questions = [
      { id: "ready-explained", explanation: [{ type: "text" as const, text: "The observed mechanism explains the key." }] },
      { id: "ready-missing", explanation: [] },
      { id: "ready-image-only", explanation: [{ type: "image" as const, assetId: "figure" }] },
      { id: "held", explanation: [] },
    ];
    const verdicts = new Map([
      ["ready-explained", { readiness: "ready" as const }],
      ["ready-missing", { readiness: "ready" as const }],
      ["ready-image-only", { readiness: "ready" as const }],
      ["held", { readiness: "needs-review" as const }],
    ]);
    expect(countReadyExplanations(questions, { verdicts })).toEqual({
      readyQuestions: 3, explainedReadyQuestions: 1, missingExplanations: 2,
    });
  });

  it("accepts reviewer-approved teaching text but not an unreviewed draft", () => {
    const teaching = { whyCorrect: "The source supports this answer.", factCheck: {
      status: "SOURCE_CHECKED", humanReviewerApproved: false, answerChanged: false,
    } };
    expect(hasQuestionExplanation({ teaching: teaching as never })).toBe(false);
    expect(hasQuestionExplanation({ teaching: { ...teaching, factCheck: { ...teaching.factCheck, humanReviewerApproved: true } } as never })).toBe(true);
    expect(hasQuestionExplanation({ teaching: { ...teaching, factCheck: { ...teaching.factCheck,
      status: "INDEPENDENTLY_CHECKED", humanReviewerApproved: true } } as never })).toBe(true);
    for (const status of ["UNVERIFIED", "REVIEW_REQUIRED", "CONFLICT"]) {
      expect(hasQuestionExplanation({ teaching: { ...teaching, factCheck: { ...teaching.factCheck,
        status, humanReviewerApproved: true } } as never })).toBe(false);
    }
  });
});
