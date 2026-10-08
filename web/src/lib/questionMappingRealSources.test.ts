import { describe, expect, it } from "vitest";
import { importFromJson } from "./questionImport";
import { parseQuestionBlocks } from "./questionParse";

function fiveQuestions(answerSection: string): string {
  return [
    "1. First?", "A. a1", "B. b1", "C. c1", "D. d1", "E. e1", "",
    "2. Second?", "A. a2", "B. b2", "C. c2", "D. d2", "E. e2", "",
    "3. Third?", "A. a3", "B. b3", "C. c3", "D. d3", "E. e3", "",
    "4. Fourth?", "A. a4", "B. b4", "C. c4", "D. d4", "E. e4", "",
    "5. Fifth?", "A. a5", "B. b5", "C. c5", "D. d5", "E. e5", "",
    answerSection,
  ].join("\n");
}

describe("real-source answer mapping hardening", () => {
  it("reads an inline Answer Key label without treating Key as answer text", () => {
    const [draft] = parseQuestionBlocks("1. Which sample?\nA. Alpha\nB. Beta\nC. Gamma\nAnswer Key: B\nRationale: Beta is the supplied answer.");
    expect(draft.correctKey).toBe("B");
    expect(draft.parserRuleIds).not.toContain("answer.unrecognized-key");
  });
  it("maps a PDF table whose question numbers and answer letters occupy aligned rows", () => {
    const drafts = parseQuestionBlocks(fiveQuestions([
      "Answer Key", "1   2   3   4   5", "B   D   A   C   E",
    ].join("\n")));
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "D", "A", "C", "E"]);
  });

  it("normalizes an OCR-spaced answer-key header and parenthesized letters", () => {
    const drafts = parseQuestionBlocks([
      "1. First?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "2. Second?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "A N S W E R   K E Y", "1 . ( B )", "2 . ( C )",
    ].join("\n"));
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
  });

  it("does not trust a trailing letter when its attached answer text supports another option", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which cell?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells", "",
      "Answers:", "1. A. Mast cells",
    ].join("\n"));
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).not.toBe("high");
    expect(draft.warnings.join(" ")).toMatch(/conflict/i);
  });

  it("maps answer text across OCR spacing and line wrapping", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which cell?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells", "",
      "Answers:", "1. CD4 + T", "lymphocytes",
    ].join("\n"));
    expect(draft.correctKey).toBe("B");
  });

  it("parses OCR-spaced option labels while retaining wrapped option text", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which option is supported?",
      "A . Alpha begins here", "and wraps to this line",
      "B . Beta", "C . Gamma", "D . Delta",
      "Answer: A",
    ].join("\n"));
    expect(draft.options).toEqual([
      { key: "A", text: "Alpha begins here and wraps to this line" },
      { key: "B", text: "Beta" },
      { key: "C", text: "Gamma" },
      { key: "D", text: "Delta" },
    ]);
    expect(draft.correctKey).toBe("A");
  });

  it("keeps a bare trailing key when its explanation wraps onto following lines", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which option?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "Answers:", "1. B", "Because beta follows from the finding.",
    ].join("\n"));
    expect(draft.correctKey).toBe("B");
  });

  it("never marks a non-sequential option extraction ready", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which option?", "A. Alpha", "C. Gamma", "D. Delta", "E. Epsilon", "",
      "Answer Key:", "1. C", "",
      "Explanations:", "1. Gamma follows from the finding.",
    ].join("\n"));
    expect(draft.correctKey).toBe("C");
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).not.toBe("high");
  });

  it("rejects duplicate structured option keys instead of producing a false-ready A", () => {
    const [draft] = importFromJson(JSON.stringify([{
      question: "Which option?",
      options: [
        { key: "A", text: "Alpha" },
        { key: "A", text: "Beta" },
        { key: "C", text: "Gamma" },
      ],
      answer: "A",
      explanation: "A structured explanation.",
    }])).drafts;
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).not.toBe("high");
  });

  it("accepts OCR spacing around a structured parenthesized key", () => {
    const [draft] = importFromJson(JSON.stringify([{
      question: "Which option?",
      options: ["Alpha", "Beta", "Gamma"],
      answer: "( B )",
    }])).drafts;
    expect(draft.correctKey).toBe("B");
  });

  it("leaves structured letter/text conflicts unresolved instead of silently remapping", () => {
    const [draft] = importFromJson(JSON.stringify([{
      question: "Which cell?",
      options: ["B lymphocytes", "CD4+ T lymphocytes", "Mast cells"],
      answer: "A. Mast cells",
      explanation: "The source supplied contradictory answer evidence.",
    }])).drafts;
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).not.toBe("high");
  });
});
