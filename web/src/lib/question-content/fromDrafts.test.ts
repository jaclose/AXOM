import { describe, expect, it } from "vitest";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "../questionParse";
import { blockShape } from "./blocks";
import type { DocxBodyElement } from "./docx/markers";
import { anchorToken, bodyToAnchoredText, draftsToQuestions } from "./fromDrafts";

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
