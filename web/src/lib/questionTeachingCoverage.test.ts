import { describe, expect, it } from "vitest";
import { questionSourceFingerprint } from "./decode";
import type { QuestionRecord } from "./questions";
import { summarizeQuestionTeachingCoverage } from "./questionTeachingCoverage";

const base = (patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: "q1", source: "pdf", stem: "Stem", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "A", correctAnswerText: "Alpha", extraction: { confidence: "high", reviewed: true },
  status: "unseen", tags: [], attempts: [], createdAt: "2026-10-23", updatedAt: "2026-10-23", ...patch,
});
describe("summarizeQuestionTeachingCoverage", () => {
  it("counts only ready questions and prioritizes missing source-grounded layers", () => {
    const complete = base({
      id: "complete", explanation: "Reviewed explanation", choiceRationales: { B: "Reviewed distractor note" },
      content: {
        id: "complete", source: { filename: "source.pdf" }, stem: [{ type: "text", text: "Stem" }],
        choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
        assets: [{ id: "visual", filename: "visual.png", mimeType: "image/png", role: "explanation", questionId: "complete", derivation: "authored" }],
        provenance: { method: "pdf-import" },
      },
    });
    complete.analyses = [{
      id: "analysis", questionId: complete.id, sourceFingerprint: questionSourceFingerprint(complete), version: 1,
      origin: "source", status: "reviewed", concept: "Concept", decisiveClues: [], mechanism: [], distractors: [], references: [], generatedAt: "2026-10-23",
    }];
    const missing = base({ id: "missing" });
    const held = base({ id: "held", needsReview: true, explanation: "Not eligible" });
    const summary = summarizeQuestionTeachingCoverage([complete, missing, held]);
    expect(summary).toEqual({
      ready: 2,
      withExplanation: 1,
      withCompleteChoiceTeaching: 1,
      withReviewedDepth: 1,
      withTeachingVisuals: 1,
      proposalsToReview: 0,
      improvementQueueIds: ["missing"],
    });
  });

  it("counts current proposals without treating them as reviewed teaching", () => {
    const question = base({ explanation: "Source explanation" });
    question.analyses = [{
      id: "proposal", questionId: question.id, sourceFingerprint: questionSourceFingerprint(question), version: 1,
      origin: "ai", status: "proposed", concept: "Concept", decisiveClues: [], mechanism: [], distractors: [], references: [], generatedAt: "2026-10-23",
    }];
    const summary = summarizeQuestionTeachingCoverage([question]);
    expect(summary.proposalsToReview).toBe(1);
    expect(summary.withReviewedDepth).toBe(0);
    expect(summary.improvementQueueIds).toEqual([question.id]);
  });

  it("counts complete source-checked package teaching while keeping it review-gated", () => {
    const question = base({ sourceDocumentId: "doc-1" });
    question.analyses = [{
      id: "package-proposal", questionId: question.id, sourceFingerprint: questionSourceFingerprint(question), version: 1,
      origin: "source", status: "proposed", concept: "Concept", explanation: "A is correct because the source supports it.",
      decisiveClues: [], mechanism: ["Source-grounded mechanism"],
      distractors: [{ key: "B", whyWrong: "B conflicts with the described mechanism." }], references: [],
      promptVersion: "package-teaching-v1:SOURCE_CHECKED", generatedAt: "2026-10-23",
    }];
    const document = { id: "doc-1", checksum: "sha256:source", pageTexts: ["Source page"] };

    const summary = summarizeQuestionTeachingCoverage([question], [document]);

    expect(summary).toMatchObject({
      ready: 1,
      withExplanation: 1,
      withCompleteChoiceTeaching: 1,
      withReviewedDepth: 0,
      proposalsToReview: 1,
      improvementQueueIds: [question.id],
    });
  });

  it("does not treat unreviewed generic or incomplete proposals as complete choice teaching", () => {
    const generic = base({ id: "generic" });
    generic.analyses = [{
      id: "generic-proposal", questionId: generic.id, sourceFingerprint: questionSourceFingerprint(generic), version: 1,
      origin: "ai", status: "proposed", concept: "Concept", explanation: "Proposed answer explanation",
      decisiveClues: [], mechanism: [], distractors: [{ key: "B", whyWrong: "Proposed distractor note" }], references: [],
      generatedAt: "2026-10-23",
    }];
    const incomplete = base({ id: "incomplete" });
    incomplete.analyses = [{
      id: "package-proposal", questionId: incomplete.id, sourceFingerprint: questionSourceFingerprint(incomplete), version: 1,
      origin: "source", status: "proposed", concept: "Concept", explanation: "Source-checked answer explanation",
      decisiveClues: [], mechanism: [], distractors: [], references: [],
      promptVersion: "package-teaching-v1:SOURCE_CHECKED", generatedAt: "2026-10-23",
    }];

    const summary = summarizeQuestionTeachingCoverage([generic, incomplete]);

    expect(summary.withExplanation).toBe(1);
    expect(summary.withCompleteChoiceTeaching).toBe(0);
    expect(summary.withReviewedDepth).toBe(0);
    expect(summary.proposalsToReview).toBe(2);
  });
});
