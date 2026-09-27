import { describe, expect, it } from "vitest";
import { associateAnswerSource, parseQuestionBlocks } from "./questionParse";
import { draftImportStatus } from "./questionImportTrust";

describe("real-world question import corpus", () => {
  it("keeps numbered laboratory values inside a long vignette", () => {
    const [draft] = parseQuestionBlocks([
      "Question 1: A patient has a creatinine of 2.1 mg/dL and the following values:",
      "1. urine sodium 42 mEq/L", "2. fractional excretion 3%", "Which process is most likely?",
      "A) Prerenal retention", "B) Intrinsic tubular injury", "C) Postrenal obstruction", "D) Normal filtration",
      "Answer: B", "Explanation: The urine indices support intrinsic tubular injury.",
    ].join("\n"));
    expect(draft.questionNumber).toBe(1);
    expect(draft.options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(draft.correctKey).toBe("B");
    expect(draft.stem).toContain("1. urine sodium");
  });

  it("maps a trailing answer key and later numbered explanations without drift", () => {
    const drafts = parseQuestionBlocks([
      "HEADER · SANITIZED PACKET · Page 1",
      "1. Which receptor is activated?", "A. Alpha", "B. Beta", "C. Gamma", "D. Delta", "",
      "2. Which pathway is inhibited?", "A. One", "B. Two", "C. Three", "D. Four", "",
      "Answer Key", "1. C", "2. A", "",
      "Explanations", "1. Gamma explains the first finding.", "2. One explains the second finding.",
      "FOOTER · educational fixture",
    ].join("\n"));
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["C", "A"]);
    expect(drafts.map((draft) => draft.explanation)).toEqual([
      "Gamma explains the first finding.",
      "One explains the second finding.",
    ]);
    expect(drafts.every((draft) => draftImportStatus(draft) === "ready")).toBe(true);
  });

  it("uses question number and normalized option text for a separate answer source", () => {
    const questions = parseQuestionBlocks([
      "1. Which cell is most likely?", "A. B lymphocyte", "B. CD4 T lymphocyte", "C. Mast cell", "D. Neutrophil", "",
      "2. Which mediator is elevated?", "A. Histamine", "B. Bradykinin", "C. C3b", "D. IFN gamma",
    ].join("\n"));
    const result = associateAnswerSource(questions, [
      "Answers and explanations", "1. CD4 T lymphocyte", "Explanation: T-cell activation is expected.",
      "2. D", "Explanation: IFN gamma is the matching mediator.",
    ].join("\n"));
    expect(result.drafts.map((draft) => draft.correctKey)).toEqual(["B", "D"]);
    expect(result.drafts.map((draft) => draft.explanation)).toEqual([
      "T-cell activation is expected.",
      "IFN gamma is the matching mediator.",
    ]);
  });

  it("retains five options, multiline choices, footer noise, and a malformed middle question", () => {
    const drafts = parseQuestionBlocks([
      "Page 3 of 12",
      "10. Which option is supported?", "A. First answer that wraps", "onto a second line", "B. Second", "C. Third", "D. Fourth", "E. Fifth", "Correct: E", "",
      "11. A malformed record", "A. Duplicate label", "A. Another duplicate label", "B. Only valid label", "Answer: A", "",
      "12. Which option follows?", "A. First", "B. Second", "C. Third", "D. Fourth", "E. Fifth", "Answer: C",
      "Commercial-style footer · do not treat as a question",
    ].join("\n"));
    expect(drafts).toHaveLength(3);
    expect(drafts[0].options).toHaveLength(5);
    expect(drafts[0].options[0].text).toContain("second line");
    expect(drafts[0].correctKey).toBe("E");
    expect(draftImportStatus(drafts[1])).not.toBe("ready");
    expect(drafts[2].correctKey).toBe("C");
  });

  it("does not invent an answer for an unnumbered or conflicting source", () => {
    const drafts = parseQuestionBlocks([
      "Which response is safest?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "2. Which response is next?", "A. Alpha", "B. Beta", "C. Gamma", "Answer: A", "",
      "Answer key", "2. C",
    ].join("\n"));
    expect(drafts.some((draft) => draft.correctKey === undefined && draft.needsReview)).toBe(true);
    expect(drafts.find((draft) => draft.questionNumber === 2)?.correctKey).toBeUndefined();
  });
});
