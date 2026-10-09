import { describe, expect, it } from "vitest";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "../questionParse";
import { blockShape } from "./blocks";
import type { DocxBodyElement } from "./docx/markers";
import { anchorToken, answerKeyLines, bodyToAnchoredText, draftsToQuestions, type AnchoredText } from "./fromDrafts";

const p = (text: string, more: Partial<Extract<DocxBodyElement, { kind: "paragraph" }>> = {}): DocxBodyElement => ({ kind: "paragraph", text, ...more });
const defaults = { bankId: "example-bank", sourceFilename: "invented.docx", method: "docx-import" as const };
const codes = (issues: { severity: string; code: string }[]): string[] => issues.map((issue) => `${issue.severity}:${issue.code}`);

const body: DocxBodyElement[] = [
  { kind: "image", target: "word/media/logo.png" },
  p("Invented practice questions"),
  p("A volunteer has the invented panel below.", { listLabel: "1.", listKind: "ordered" }),
  { kind: "table", rows: [["Test", "Result"], ["Marker B", "0.2 μU/mL"]] },
  p("Table 1", { caption: true }),
  p("Which marker is low?"),
  p("Marker A", { listLabel: "A.", listKind: "ordered" }),
  p("Marker B", { listLabel: "B.", listKind: "ordered" }),
  p("Answer: B"),
  p("Explanation: Only Marker B is under its range, as the figure shows."),
  { kind: "image", target: "word/media/image2.png", alt: "A figure", crop: { left: 0.1, top: 0, right: 0, bottom: 0 } },
  p(""),
  p("The half-life is found from the curve.", { listLabel: "2.", listKind: "ordered", html: "The half-life t<sub>½</sub> is found from the curve." }),
  { kind: "equation", plainText: "t½ = 0.693/k", latex: "t_{1/2} = 0.693/k" },
  p("Which is it?"),
  p("1 h", { listLabel: "A.", listKind: "ordered" }),
  p("2 h", { listLabel: "B.", listKind: "ordered" }),
  p("Answer: A"),
];

describe("carrying tables and pictures through the text parser", () => {
  it("writes the body as the text the parser reads, one anchor for each table, picture and set-off equation", () => {
    const anchored = bodyToAnchoredText(body);
    expect(anchored.media.map((entry) => entry.kind)).toEqual(["image", "table", "image", "equation"]);
    expect(anchored.flattened).toBe(true);
    expect(anchored.text.split("\n\n").slice(0, 5)).toEqual([anchorToken(0), "Invented practice questions", "1. A volunteer has the invented panel below.", anchorToken(1), "Which marker is low?"]);
    // The caption went to its table, not into the running text.
    expect(anchored.text).not.toContain("Table 1");
    expect(anchored.media[1]).toMatchObject({ block: { caption: "Table 1" } });
  });

  it("puts each one back where the parser kept its line: stem, explanation or nowhere", () => {
    const anchored = bodyToAnchoredText(body);
    const { questions, issues, unplaced, assetTargets } = draftsToQuestions(parseQuestionBlocks(anchored.text), anchored, defaults);
    expect(questions).toHaveLength(2);
    const [first, second] = questions;
    expect(first.stem).toEqual([
      { type: "text", text: "A volunteer has the invented panel below." },
      { type: "table", headers: ["Test", "Result"], rows: [["Marker B", "0.2 μU/mL"]], caption: "Table 1" },
      { type: "text", text: "Which marker is low?" },
    ]);
    expect(first.correctAnswer).toEqual({ labels: ["B"], evidence: "printed-key" });
    expect(blockShape(first.explanation ?? [])).toEqual(["text", "image"]);
    expect(first.assets).toEqual([{ id: "example-bank-q01-img-1", filename: "image2.png", mimeType: "image/png", role: "explanation", questionId: "example-bank-q01", derivation: "embedded", crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }]);
    expect(blockShape(second.stem)).toEqual(["text", "equation", "text"]);
    expect([...assetTargets]).toEqual([["example-bank-q01-img-1", "word/media/image2.png"]]);
    // The logo above the first question belongs to no question: listed, not guessed onto one.
    expect(unplaced).toEqual([{ media: { kind: "image", element: { kind: "image", target: "word/media/logo.png" } }, reason: "It sits outside every question the parser found." }]);
    expect(codes(issues)).toEqual(["warning:media_association_uncertain"]);
    expect(questions.every((question) => question.provenance.method === "docx-import")).toBe(true);
  });
});

describe("answers the parser is unsure of", () => {
  const draft = (over: Partial<ParsedQuestionDraft>): ParsedQuestionDraft => ({
    stem: "Which one?", options: [{ key: "A", text: "one" }, { key: "B", text: "two" }], correctKey: "B", correctAnswerText: "two",
    questionNumber: 4, confidence: "high", warnings: [], ...over,
  });

  it("are never saved as the key: the candidate goes into a flag for review", () => {
    const { questions } = draftsToQuestions([draft({}), draft({ questionNumber: 5, needsReview: true }), draft({ questionNumber: 6, correctKey: "E" })], { media: [] }, defaults);
    expect(questions[0].correctAnswer).toEqual({ labels: ["B"], evidence: "printed-key" });
    expect(questions[0].flags).toBeUndefined();
    expect(questions[1].correctAnswer).toBeUndefined();
    expect(questions[1].flags).toEqual([{ type: "answer_needs_review", message: expect.stringContaining("The parser's candidate was B. It was not saved as the key.") }]);
    expect(questions[2].correctAnswer).toBeUndefined();
    expect(questions[2].flags?.[0].type).toBe("answer_needs_review");
  });

  it("keeps the source's per-choice reasons, its page and its number", () => {
    const { questions } = draftsToQuestions([draft({ explanation: "Because.", choiceRationales: { A: "Too low." }, sourcePage: 7 }), draft({})], { media: [] }, defaults);
    expect(questions[0].explanation).toEqual([{ type: "text", text: "Because." }, { type: "text", text: "A. Too low." }]);
    expect(questions[0].source).toEqual({ filename: "invented.docx", page: 7, questionNumber: 4 });
    // Two questions with the same number still get two ids.
    expect(questions.map((question) => question.id)).toEqual(["example-bank-q04", "example-bank-q04-2"]);
  });
});

describe("an answer key set out as a table", () => {
  it("is read as key lines when it runs question number then choice letter", () => {
    expect(answerKeyLines([["Question", "Answer"], ["1", "B"], ["2", "D"], ["3", "A"]])).toEqual(["1. B", "2. D", "3. A"]);
    expect(answerKeyLines([["Q1", "(C)", "The third choice is the largest."], ["Q2", "(A)", ""], ["Q3", "(B)", "Only this one falls."]], 0))
      .toEqual(["1. (C) The third choice is the largest.", "2. (A)", "3. (B) Only this one falls."]);
  });

  it("is left a table when the numbers skip, the rows are few, or the second column is not letters", () => {
    expect(answerKeyLines([["Question", "Answer"], ["1", "B"], ["3", "D"], ["4", "A"]])).toBeUndefined();
    expect(answerKeyLines([["Question", "Answer"], ["1", "B"], ["2", "D"]])).toBeUndefined();
    expect(answerKeyLines([["Dose", "Level"], ["1", "12 mg/L"], ["2", "24 mg/L"], ["3", "36 mg/L"]])).toBeUndefined();
    expect(answerKeyLines([["Group", "Deaths", "Survivors"], ["Drug", "10", "90"], ["Placebo", "20", "80"], ["None", "30", "70"]])).toBeUndefined();
  });

  it("goes to the parser as its answer section, and never becomes a table of a question", () => {
    const anchored = bodyToAnchoredText([
      p("Which marker is low?", { listLabel: "1.", listKind: "ordered" }), p("Marker A", { listLabel: "A.", listKind: "ordered" }), p("Marker B", { listLabel: "B.", listKind: "ordered" }),
      p(""),
      p("Which marker is high?", { listLabel: "2.", listKind: "ordered" }), p("Marker A", { listLabel: "A.", listKind: "ordered" }), p("Marker B", { listLabel: "B.", listKind: "ordered" }),
      p(""),
      p("Which marker is normal?", { listLabel: "3.", listKind: "ordered" }), p("Marker A", { listLabel: "A.", listKind: "ordered" }), p("Marker C", { listLabel: "B.", listKind: "ordered" }),
      p(""),
      p("Answer Key"),
      { kind: "table", rows: [["Question", "Answer"], ["1", "B"], ["2", "A"], ["3", "B"]], headerRows: 1 },
    ]);
    expect(anchored.media).toEqual([]);
    const converted = draftsToQuestions(parseQuestionBlocks(anchored.text), anchored, defaults);
    expect(converted.questions.map((question) => question.correctAnswer?.labels[0])).toEqual(["B", "A", "B"]);
  });
});

describe("anchors across the pages of one file", () => {
  it("gives the same table printed on two pages one anchor, and a different table its own", () => {
    const table = (rows: string[][]): DocxBodyElement => ({ kind: "table", rows });
    const into: AnchoredText = { text: "", media: [], flattened: false };
    const first = bodyToAnchoredText([p("Question slide"), table([["Dose", "Level"], ["1", "12"]])], { paragraphBreak: "\n", into }).text;
    const second = bodyToAnchoredText([p("Answer slide"), table([["Dose", "Level"], ["1", "12"]]), table([["Dose", "Level"], ["2", "24"]])], { paragraphBreak: "\n", into }).text;
    expect(first).toBe(`Question slide\n${anchorToken(0)}`);
    expect(second).toBe(`Answer slide\n${anchorToken(0)}\n${anchorToken(1)}`);
    expect(into.media).toHaveLength(2);
  });
});

describe("what the caller knows better than the parser", () => {
  const text = ["1. Which marker is low?", "A. Marker A", "B. Marker B", "Answer: B", "", "1. Which marker is high?", "A. Marker A", "B. Marker B", "Answer: A"].join("\n");

  it("takes an id for each question when it is given one, and still never repeats an id", () => {
    const drafts = parseQuestionBlocks(text);
    expect(draftsToQuestions(drafts, { media: [] }, defaults).questions.map((question) => question.id)).toEqual(["example-bank-q01", "example-bank-q01-2"]);
    expect(draftsToQuestions(drafts, { media: [] }, { ...defaults, ids: ["example-bank-s1-q01", "example-bank-s2-q01"] }).questions.map((question) => question.id))
      .toEqual(["example-bank-s1-q01", "example-bank-s2-q01"]);
    expect(draftsToQuestions(drafts, { media: [] }, { ...defaults, ids: ["same", "same"] }).questions.map((question) => question.id)).toEqual(["same", "same-2"]);
  });

  it("moves a table printed after the last choice out of that choice and into the question, with a flag", () => {
    const anchored = bodyToAnchoredText([
      p("Which group has the higher risk?", { listLabel: "1.", listKind: "ordered" }),
      p("The exposed group", { listLabel: "A.", listKind: "ordered" }),
      p("The unexposed group", { listLabel: "B.", listKind: "ordered" }),
      { kind: "table", rows: [["Group", "Cases"], ["Exposed", "30"], ["Unexposed", "10"]] },
    ]);
    const [question] = draftsToQuestions(parseQuestionBlocks(anchored.text), anchored, defaults).questions;
    expect(question.choices.map((choice) => blockShape(choice.blocks))).toEqual([["text"], ["text"]]);
    expect(blockShape(question.stem)).toEqual(["text", "table"]);
    expect(question.flags).toEqual([{ type: "media_association_uncertain", message: expect.stringContaining("printed after the answer choices") }]);
  });
});
