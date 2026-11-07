import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./types";
import type { QuestionRecord } from "../questions";
import {
  draftQuestionExplanation, eligibleForExplanationDraft, questionExplanationFingerprint,
} from "./questionTeaching";

function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: "q1", source: "manual", stem: "Which layer contains smooth muscle in an artery?",
    options: [{ key: "A", text: "Tunica media" }, { key: "B", text: "Tunica intima" },
      { key: "C", text: "Tunica adventitia" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-11-06T12:00:00.000Z", updatedAt: "2026-11-06T12:00:00.000Z", ...patch,
  };
}
function provider(value: unknown): AIProvider {
  return {
    info: { kind: "openai-compat", label: "Test provider", local: false, requiresKey: false },
    available: vi.fn(async () => ({ ok: true, detail: "ready" })),
    completeJson: vi.fn(async () => value),
  };
}

describe("review-gated explanation drafting", () => {
  it("generates a draft and distractor rationales without editing the confirmed answer", async () => {
    const source = question({ citation: "Reviewed source, page 3" });
    const model = provider({
      explanation: "The tunica media contains layers of vascular smooth muscle that regulate vascular tone and resistance.",
      choiceRationales: {
        A: "The media contains the smooth muscle cells.",
        B: "The intima primarily contains endothelial lining.",
        C: "The adventitia is primarily connective tissue.",
      },
      keywords: ["Tunica media", "Vascular smooth muscle"],
    });
    const result = await draftQuestionExplanation(model, source);
    expect(result.questionId).toBe("q1");
    expect(result.explanation).toMatch(/vascular smooth muscle/);
    expect(result.choiceRationales.B).toMatch(/endothelial/);
    expect(result.sourceFingerprint).toBe(questionExplanationFingerprint(source));
    expect(result.keywords).toContain("tunica media");
    expect(model.completeJson).toHaveBeenCalledOnce();
    expect(source.explanation).toBeUndefined();
    expect(source.correctKey).toBe("A");
  });

  it("never sends unresolved answers or inaccessible image questions to a model", async () => {
    const model = provider({});
    await expect(draftQuestionExplanation(model, question({ correctKey: undefined }))).rejects.toThrow(/reviewed answer/i);
    await expect(draftQuestionExplanation(model, question({ attachments: [{ assetId: "image-1" }] as never }))).rejects.toThrow(/image|media/i);
    expect(model.completeJson).not.toHaveBeenCalled();
    expect(eligibleForExplanationDraft(question({ needsReview: true }))).toBe(false);
  });

  it("rejects fabricated keys, insufficient explanations and missing distractor rationales", async () => {
    const valid = question();
    await expect(draftQuestionExplanation(provider({
      explanation: "Very short", choiceRationales: { A: "Wrong" },
    }), valid)).rejects.toThrow(/explanation|rationale/i);
    await expect(draftQuestionExplanation(provider({
      explanation: "The arterial tunica media contains smooth muscle cells that adjust the vessel diameter and resistance.",
      choiceRationales: { A: "Correct", B: "Intima not media", C: "Adventitia not media", D: "Not a valid option" },
    }), valid)).rejects.toThrow(/choice|rationale/i);
  });

  it("does not draft over an existing author-written choice rationale", async () => {
    const source = question({ choiceRationales: { B: "The author has already written a distractor rationale." } });
    const model = provider({});
    expect(eligibleForExplanationDraft(source)).toBe(false);
    // Direct calls are still protected against overwriting authored work.
    await expect(draftQuestionExplanation(model, source)).rejects.toThrow(/existing|rationale/i);
    expect(model.completeJson).not.toHaveBeenCalled();
  });

  it("invalidates drafts when source evidence or provenance changes without a timestamp bump", () => {
    const original = question({
      sourceDocumentId: "source-pdf-1",
      sourcePage: 3,
      citation: "Source A, page 3",
      extraction: {
        confidence: "high", reviewed: true,
        answerEvidence: "Answer key A, page 3",
      },
    });
    const fingerprint = questionExplanationFingerprint(original);
    expect(questionExplanationFingerprint({ ...original, citation: "Unverified replacement citation" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, sourceDocumentId: "source-pdf-2" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, sourcePage: 4 })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, extraction: { ...original.extraction!, reviewed: false } })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, extraction: {
      ...original.extraction!, answerEvidence: "Conflicting answer marker, page 3",
    } })).not.toBe(fingerprint);
  });

  it("detects changed questions before accepting AI-generated explanations", () => {
    const original = question();
    const fingerprint = questionExplanationFingerprint(original);
    expect(questionExplanationFingerprint({ ...original, correctKey: "B" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, stem: "Changed stem" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, explanation: "User wrote a rationale" })).not.toBe(fingerprint);
  });
});
