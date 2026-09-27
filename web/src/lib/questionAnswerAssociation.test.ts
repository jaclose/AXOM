import { describe, expect, it } from "vitest";
import { associateAnswerSource, parseQuestionBlocks } from "./questionParse";

describe("separate answer source association", () => {
  it("matches numbered answers and explanations without guessing unmatched rows", () => {
    const questions = parseQuestionBlocks(`1. A patient has hyperkalemia. Which hormone is deficient?\nA. Aldosterone\nB. Cortisol\nC. Insulin\n\n2. Which nerve supplies the diaphragm?\nA. Vagus\nB. Phrenic\nC. Radial`);
    const result = associateAnswerSource(questions, `Answer key\n1. A\n2. B\n3. C\n\nExplanations\n1. Aldosterone increases sodium reabsorption.\n2. The phrenic nerve arises from C3-C5.`);
    expect(result.drafts.map((draft) => draft.correctKey)).toEqual(["A", "B"]);
    expect(result.drafts[0].explanation).toMatch(/sodium reabsorption/i);
    expect(result.unmatchedNumbers).toEqual([3]);
  });
  it("leaves a conflicting inline answer unresolved", () => {
    const questions = parseQuestionBlocks(`1. Stem\nA. Alpha\nB. Beta\nC. Gamma\nAnswer: A`);
    const result = associateAnswerSource(questions, `Answers\n1. B`);
    expect(result.drafts[0].correctKey).toBeUndefined();
    expect(result.drafts[0].needsReview).toBe(true);
  });
});
