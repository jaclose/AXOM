import { describe, expect, it } from "vitest";
import type { FigurePlacement, PageLine, QuestionPage } from "../../pdfFigures";
import type { ParsedQuestionDraft } from "../../questionParse";
import { validatePackage } from "../validate";
import { effectiveRole, visibleBlocks } from "../visibility";
import { pdfDraftsToQuestions, splitPointAbove, type PdfFigureBox } from "./pdfToQuestions";

const defaults = { bankId: "example-bank", sourceFilename: "invented.pdf" };
const draft = (questionNumber: number, stem: string, over: Partial<ParsedQuestionDraft> = {}): ParsedQuestionDraft => ({
  stem, options: [{ key: "A", text: "one" }, { key: "B", text: "two" }], correctKey: "B", correctAnswerText: "two", questionNumber, confidence: "high", warnings: [], ...over,
});
const figure = (name: string, page: number, top: number): PdfFigureBox => ({ name, page, left: 60, top, width: 300, height: 200 });
const lines = (...entries: [number, string][]): PageLine[] => entries.map(([top, text]) => ({ top, text }));

describe("where a figure sits in a stem", () => {
  const stem = "The graph shows two invented compounds after one dose. Which statement about the red one is supported?";
  const page = lines([100, "3. The graph shows two invented"], [118, "compounds after one dose."], [400, "Which statement about the red one is supported?"], [430, "A. one"]);

  it("is where the last line printed above it ends", () => {
    const at = splitPointAbove(stem, page, 150)!;
    expect([stem.slice(0, at), stem.slice(at)]).toEqual(["The graph shows two invented compounds after one dose.", " Which statement about the red one is supported?"]);
  });

  it("is the end of the stem when the whole stem is one line that opens with the question's number", () => {
    const whole = lines([60, `12. ${stem}`], [300, "A. one"]);
    expect(splitPointAbove(stem, whole, 200)).toBe(stem.length);
  });

  it("is unknown when no line of the stem is above the figure", () => {
    expect(splitPointAbove(stem, page, 50)).toBeUndefined();
    expect(splitPointAbove(stem, lines([10, "Fall term"], [20, "p. 3"]), 150)).toBeUndefined();
  });
});

describe("the existing PDF import, written as package questions", () => {
  const drafts = [
    draft(3, "The graph shows two invented compounds after one dose. Which statement about the red one is supported?", { sourcePage: 4 }),
    draft(4, "A second question with a picture whose place is unknown.", { sourcePage: 6 }),
  ];
  const figures = [figure("invented-p4-fig1.png", 4, 150), figure("invented-p5-fig1.png", 5, 150), figure("invented-p6-fig1.png", 6, 20), figure("invented-p7-fig1.png", 7, 300), figure("invented-p1-fig1.png", 1, 40)];
  const placements: FigurePlacement[] = [
    { name: "invented-p4-fig1.png", page: 4, draftIndex: 0, basis: "below-question-start" },
    { name: "invented-p5-fig1.png", page: 5, held: "answer-slide", reason: "It is on an answer slide." },
    { name: "invented-p6-fig1.png", page: 6, draftIndex: 1, basis: "only-question-on-page" },
    { name: "invented-p7-fig1.png", page: 7, held: "below-answer", reason: "It sits below an answer." },
    { name: "invented-p1-fig1.png", page: 1, held: "no-question", reason: "It is on a slide with no question." },
  ];
  const questionPages: QuestionPage[] = [{ page: 4, byFirstAppearance: false, repeatsOn: [5] }, { page: 6, byFirstAppearance: false, repeatsOn: [7] }];
  const linesByPage = new Map<number, PageLine[]>([[4, lines([100, "3. The graph shows two invented"], [118, "compounds after one dose."], [400, "Which statement about the red one is supported?"])]]);
  const converted = pdfDraftsToQuestions({ drafts, figures, placements, questionPages, linesByPage }, defaults);
  const [first, second] = converted.questions;

  it("puts a figure between the lines it sits between", () => {
    expect(first.stem).toEqual([
      { type: "text", text: "The graph shows two invented compounds after one dose." },
      { type: "image", assetId: "example-bank-q03-img-1" },
      { type: "text", text: "Which statement about the red one is supported?" },
    ]);
    expect(first.assets[0]).toEqual({
      id: "example-bank-q03-img-1", filename: "invented-p4-fig1.png", mimeType: "image/png", sourceFile: "invented.pdf", sourcePage: 4, role: "stem",
      questionId: "example-bank-q03", derivation: "region-render", bounds: { x: 60, y: 150, width: 300, height: 200 },
    });
    expect(first.provenance.method).toBe("pdf-import");
  });

  it("turns the copy on the answer page into an answer-reveal asset that question mode never shows", () => {
    expect(first.assets[1]).toMatchObject({ role: "answer_reveal", revealOf: "example-bank-q03-img-1", sourcePage: 5 });
    expect(JSON.stringify([first.stem, first.choices])).not.toContain(first.assets[1].id);
    const roles = new Map(first.assets.map((asset) => [asset.id, asset.role]));
    expect(visibleBlocks(first.stem, "question", (block) => effectiveRole(block.role, roles.get(block.assetId), "stem"))).toEqual(first.stem);
  });

  it("places a figure after the text and flags it when its place in the stem cannot be worked out", () => {
    expect(second.stem.map((block) => block.type)).toEqual(["text", "image"]);
    expect(second.flags).toEqual([{ type: "media_association_uncertain", message: expect.stringContaining("where it sits in the stem could not be worked out") }]);
  });

  it("gives a figure below an answer to the explanation, and lists one with no question for placing by hand", () => {
    expect(second.explanation).toEqual([{ type: "image", assetId: "example-bank-q04-img-2" }]);
    expect(second.assets[1]).toMatchObject({ role: "explanation", sourcePage: 7 });
    expect(converted.unplaced).toEqual([{ media: { kind: "image", element: { kind: "image", target: "invented-p1-fig1.png" } }, reason: "It is on a slide with no question." }]);
    expect(converted.issues.map((issue) => `${issue.severity}:${issue.code}`)).toEqual(["warning:media_association_uncertain"]);
    expect([...converted.figureOfAsset.values()]).toEqual(["invented-p4-fig1.png", "invented-p5-fig1.png", "invented-p6-fig1.png", "invented-p7-fig1.png"]);
  });

  it("gives questions the package checks accept", () => {
    const manifest = { schemaVersion: 1, course: { name: "EXAMPLE", term: 1, week: 1 }, bank: { id: "example-bank", title: "Example", discipline: "Example" }, source: { filename: "invented.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/" };
    const errors = validatePackage({ manifest, questions: converted.questions }).filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);
  });
});
