import { describe, expect, it } from "vitest";
import { associateAnswerSource, parseQuestionBlocks } from "./questionParse";
import { draftImportStatus } from "./questionImportTrust";

type Oracle = {
  name: string;
  source: string;
  questionCount: number;
  optionCounts: number[];
  answerKeys: Array<string | undefined>;
  reviewCount: number;
};

function question(marker: string, separator = ".", answer = "B", options = 4) {
  const labels = ["A", "B", "C", "D", "E"].slice(0, options);
  const prefix = /^\d+$/.test(marker) ? `${marker}.` : marker;
  return [
    `${prefix} A synthetic medical vignette asks which mechanism best explains the finding?`,
    ...labels.map((label) => `${label}${separator} ${label === "A" ? "Alpha" : label === "B" ? "Beta" : label === "C" ? "Gamma" : label === "D" ? "Delta" : "Epsilon"} mechanism`),
    `Answer: ${answer}`,
    "Explanation: The selected mechanism is supported by the synthetic finding.",
  ].join("\n");
}

const cases: Oracle[] = [
  { name: "clean structured text", source: question("1"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "A. choices", source: question("1", "."), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "A) choices", source: question("1", ")"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "A: choices", source: question("1", ":"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "A - choices", source: question("1", " -"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "A–E choices", source: question("1", "–" , "E", 5), questionCount: 1, optionCounts: [5], answerKeys: ["E"], reviewCount: 0 },
  { name: "multiline stem", source: `${question("1").replace("A synthetic medical vignette", "A synthetic medical vignette\nwith a second sentence and laboratory values 1.2 mmol/L")}`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "multiline answer choice", source: question("1").replace("B. Beta mechanism", "B. Beta mechanism that continues\non a second line"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "answer at bottom", source: question("1").replace("Answer: B\nExplanation: The selected mechanism is supported by the synthetic finding.", "Explanation: The selected mechanism is supported by the synthetic finding.\nAnswer: B"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "answer key at document end", source: `${question("1").replace("Answer: B\nExplanation: The selected mechanism is supported by the synthetic finding.", "")}\n\n${question("2", ".", "C").replace("Answer: C\nExplanation: The selected mechanism is supported by the synthetic finding.", "")}\n\nAnswer Key\n1. B\n2. C`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "C"], reviewCount: 0 },
  { name: "explanation after each question", source: `${question("1")}\n\n${question("2", ".", "A")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "A"], reviewCount: 0 },
  { name: "combined answer and explanation", source: question("1").replace("Answer: B", "Correct Answer: B"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "Answers and Explanations heading", source: `${question("1").replace("Answer: B\nExplanation: The selected mechanism is supported by the synthetic finding.", "")}\n\nAnswers and Explanations\n1. B\nExplanation: Beta mechanism is supported.`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "numbered question marker", source: question("Question 1:"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "Q1 marker", source: question("Q1"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "textual answer remains reviewable", source: question("1").replace("Answer: B", "Answer: Beta mechanism"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 1 },
  { name: "numeric answer remains reviewable", source: question("1").replace("Answer: B", "Answer: 2"), questionCount: 1, optionCounts: [4], answerKeys: [undefined], reviewCount: 1 },
  { name: "repeated question number", source: `${question("1")}\n\n${question("1", ".", "C")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "C"], reviewCount: 2 },
  { name: "missing question number", source: question("Stem"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "numbering inside vignette", source: question("1").replace("asks which", "asks which\n1. first lab value\n2. second lab value\nwhich"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 1 },
  { name: "numbered mechanisms in explanation", source: question("1").replace("The selected mechanism", "1. The selected mechanism\n2. The supporting mechanism"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "lettered explanation list", source: question("1").replace("The selected mechanism", "A. The selected mechanism\nB. The supporting mechanism"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "Answer prose inside explanation", source: question("1").replace("The selected mechanism", "Answer: B is supported because the selected mechanism"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "page header", source: `HEADER · COURSE PACKET · Page 1\n${question("1")}`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "page footer", source: `${question("1")}\nFOOTER · educational fixture · Page 1 of 2`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "standalone page number", source: `1\n${question("1")}\n2`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "copyright notice", source: `Copyright 2026 Synthetic Education\n${question("1")}`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "malformed middle question", source: `${question("1")}\n\n2. Broken record\nA. Duplicate\nA. Duplicate again\nB. Only valid\n\n${question("3", ".", "D")}`, questionCount: 3, optionCounts: [4, 3, 4], answerKeys: ["B", undefined, "D"], reviewCount: 1 },
  { name: "duplicate choice label", source: question("1").replace("C. Gamma mechanism", "A. Duplicate gamma mechanism"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 1 },
  { name: "missing answer", source: question("1").replace("Answer: B\n", ""), questionCount: 1, optionCounts: [4], answerKeys: [undefined], reviewCount: 1 },
  { name: "conflicting answer keys", source: `${question("1")}\nAnswer Key\n1. C`, questionCount: 1, optionCounts: [4], answerKeys: [undefined], reviewCount: 1 },
  { name: "exact duplicate blocks remain visible", source: `${question("1")}\n\n${question("2")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "B"], reviewCount: 0 },
  { name: "similar-but-not-identical blocks remain visible", source: `${question("1")}\n\n${question("2").replace("synthetic medical", "similar synthetic medical")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "B"], reviewCount: 0 },
  { name: "long medical stem", source: question("1").replace("asks which", `${"A patient with a long synthetic history and vital signs presents after several days of symptoms. ".repeat(8)}asks which`), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "unicode bullets in stem", source: question("1").replace("asks which", "asks which\n• fever\n• tachycardia"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "smart quotes", source: question("1").replace("mechanism", "‘mechanism’"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "CRLF input", source: question("1").replaceAll("\n", "\r\n"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "trailing whitespace", source: `${question("1").split("\n").map((line) => `${line}   `).join("\n")}   `, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "blank pages and separators", source: `--- PAGE 1 ---\n\n${question("1")}\n\n--- PAGE 2 ---\n`, questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "multiple sources one answer source", source: `${question("1")}\n\n${question("2", ".", "A")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["B", "A"], reviewCount: 0 },
  { name: "malformed option separator", source: question("1").replace("C. Gamma mechanism", "C Gamma mechanism"), questionCount: 1, optionCounts: [3], answerKeys: ["B"], reviewCount: 1 },
  { name: "answer label with colon", source: question("1").replace("Answer: B", "Correct: B"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "rationale heading", source: question("1").replace("Explanation:", "Rationale:"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "discussion heading", source: question("1").replace("Explanation:", "Discussion:"), questionCount: 1, optionCounts: [4], answerKeys: ["B"], reviewCount: 0 },
  { name: "source order preserved", source: `${question("10", ".", "A")}\n\n${question("11", ".", "D")}`, questionCount: 2, optionCounts: [4, 4], answerKeys: ["A", "D"], reviewCount: 0 },
];

describe("formal Question Import adversarial corpus", () => {
  it.each(cases)("$name", ({ source, questionCount, optionCounts, answerKeys, reviewCount }) => {
    const drafts = parseQuestionBlocks(source);
    expect(drafts).toHaveLength(questionCount);
    expect(drafts.map((draft) => draft.options.length)).toEqual(optionCounts);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(answerKeys);
    expect(drafts.filter((draft) => draftImportStatus(draft) !== "ready")).toHaveLength(reviewCount);
  });

  it("deterministically associates a separate answer/explanation source", () => {
    const questions = parseQuestionBlocks(`${question("1").replace("Answer: B\nExplanation: The selected mechanism is supported by the synthetic finding.", "")}\n\n${question("2").replace("Answer: B\nExplanation: The selected mechanism is supported by the synthetic finding.", "")}`);
    const associated = associateAnswerSource(questions, "Answers and Explanations\n1. Beta mechanism\nExplanation: First rationale.\n2. D\nExplanation: Second rationale.");
    expect(associated.drafts.map((draft) => draft.correctKey)).toEqual(["B", "D"]);
    expect(associated.drafts.map((draft) => draft.explanation)).toEqual(["First rationale.", "Second rationale."]);
    expect(associated.drafts.map((draft) => draftImportStatus(draft))).toEqual(["review-suggested", "ready"]);
  });
});
