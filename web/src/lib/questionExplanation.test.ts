import { describe, expect, it } from "vitest";
import { cleanExplanationText, sanitizeExplanationCandidate } from "./questionExplanation";

const ppdQuestion = {
  stem: "A 36-year-old man with tuberculosis exposure has a positive PPD skin test. Which cells mediate this reaction?",
  options: [
    { key: "A", text: "B lymphocytes" },
    { key: "B", text: "CD4+ T lymphocytes" },
    { key: "C", text: "Mast cells" },
    { key: "D", text: "Eosinophils" },
    { key: "E", text: "Neutrophils" },
  ],
  correctKey: "B",
};

describe("cleanExplanationText", () => {
  it("reduces the exact contaminated PPD block to its teaching explanation", () => {
    const raw = [
      ppdQuestion.stem,
      "A. B lymphocytes",
      "B. CD4+ T lymphocytes",
      "C. Mast cells",
      "D. Eosinophils",
      "E. Neutrophils",
      "Answer: B. CD4+ T lymphocytes",
      "Explanation: The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
    ].join("\n");

    expect(cleanExplanationText(raw, ppdQuestion)).toBe(
      "The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
    );
  });

  it("removes objective/source clutter but preserves rationale and teaching-point prose", () => {
    const raw = [
      "Explanation: Delayed hypersensitivity is T-cell mediated.",
      "Learning Objective: Recognize hypersensitivity mechanisms.",
      "Source: Week 4 practice set",
      "Teaching point: Macrophage activation follows Th1 signaling.",
    ].join("\n");
    expect(cleanExplanationText(raw, ppdQuestion)).toBe([
      "Delayed hypersensitivity is T-cell mediated.",
      "Macrophage activation follows Th1 signaling.",
    ].join("\n"));
  });

  it("returns empty when the raw value contains duplicated structure only", () => {
    const raw = [
      ppdQuestion.stem,
      "A. B lymphocytes",
      "B. CD4+ T lymphocytes",
      "C. Mast cells",
      "D. Eosinophils",
      "E. Neutrophils",
      "Answer: B. CD4+ T lymphocytes",
    ].join("\n");
    expect(cleanExplanationText(raw, ppdQuestion)).toBe("");
  });

  it("is idempotent on already-clean prose", () => {
    const clean = "The reaction is mediated by Th1 cells and macrophages.";
    expect(cleanExplanationText(clean, ppdQuestion)).toBe(clean);
    expect(cleanExplanationText(cleanExplanationText(clean, ppdQuestion), ppdQuestion)).toBe(clean);
  });

  it("emits the raw candidate, cleaned prose, operations, and bounded confidence", () => {
    const raw = [
      `1. ${ppdQuestion.stem}`,
      "A. B lymphocytes",
      "B. CD4+ T lymphocytes",
      "Correct answer: B. CD4+ T lymphocytes",
      "Rationale: Delayed hypersensitivity is driven by sensitized T cells.",
      "Learning Objective: Distinguish the four hypersensitivity types.",
      "Recognize the cellular mediators for each type.",
      "Teaching point: Th1 signals recruit and activate macrophages.",
    ].join("\n");

    const result = sanitizeExplanationCandidate(raw, ppdQuestion);
    expect(result.rawCandidate).toBe(raw);
    expect(result.cleanedText).toBe([
      "Delayed hypersensitivity is driven by sensitized T cells.",
      "Th1 signals recruit and activate macrophages.",
    ].join("\n"));
    expect(result.cleanupOperations).toEqual(expect.arrayContaining([
      "start-at-explanation-marker",
      "remove-explanation-label",
      "remove-objective-metadata",
    ]));
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("stops at a proven next-question boundary or trailing answer key", () => {
    const nextQuestion = sanitizeExplanationCandidate([
      "Explanation: This response depends on sensitized T cells.",
      "2. Which mediator is released next?",
      "A. Histamine",
      "B. Interferon gamma",
      "C. Interleukin 4",
    ].join("\n"), ppdQuestion);
    expect(nextQuestion.cleanedText).toBe("This response depends on sensitized T cells.");
    expect(nextQuestion.cleanupOperations).toContain("stop-at-next-question");

    const answerKey = sanitizeExplanationCandidate([
      "Why: Th1 cells coordinate the delayed response.",
      "Answer key:",
      "1. B",
      "2. C",
    ].join("\n"), ppdQuestion);
    expect(answerKey.cleanedText).toBe("Th1 cells coordinate the delayed response.");
    expect(answerKey.cleanupOperations).toContain("stop-at-answer-key");
  });

  it("removes repeated structure while preserving a correct-answer rationale", () => {
    const result = sanitizeExplanationCandidate([
      ppdQuestion.stem,
      "A. B lymphocytes",
      "B. CD4+ T lymphocytes",
      "Correct answer: B because the infiltrate is T-cell predominant.",
    ].join("\n"), ppdQuestion);
    expect(result.cleanedText).toBe("Because the infiltrate is T-cell predominant.");
    expect(result.cleanupOperations).toEqual(expect.arrayContaining([
      "remove-question-stem",
      "remove-option-duplication",
      "extract-answer-rationale",
    ]));
  });

  it("recognizes Reasoning as an explanation heading without flattening multiline prose", () => {
    const result = sanitizeExplanationCandidate([
      "Reasoning: Sensitized T cells coordinate the delayed response.",
      "Macrophage activation then produces the tissue reaction.",
    ].join("\n"), ppdQuestion);

    expect(result.cleanedText).toBe([
      "Sensitized T cells coordinate the delayed response.",
      "Macrophage activation then produces the tissue reaction.",
    ].join("\n"));
    expect(result.cleanupOperations).toContain("remove-explanation-label");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
