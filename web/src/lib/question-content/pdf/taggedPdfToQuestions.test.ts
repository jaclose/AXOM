// Invented teaching content throughout. Pages are written as the tagged
// reader gives them, so each test starts from a known reading of a page.
import { describe, expect, it } from "vitest";
import type { DocxBodyElement } from "../docx/markers";
import { questionReadiness } from "../readiness";
import { isAssetVisible } from "../visibility";
import { figureTarget, type PageBody } from "./taggedPdf";
import { taggedPdfToQuestions } from "./taggedPdfToQuestions";

const DEFAULTS = { bankId: "invented-bank", sourceFilename: "invented.pdf", createdAt: "2026-10-08T00:00:00.000Z" };
const p = (text: string): DocxBodyElement => ({ kind: "paragraph", text });
const image = (page: number, index: number, alt?: string): DocxBodyElement => ({ kind: "image", target: figureTarget(page, index), ...(alt ? { alt } : {}) });

function page(number: number, elements: DocxBodyElement[], extra: Partial<PageBody> = {}): PageBody {
  let top = 40;
  return {
    page: number, height: 792, headings: [], figures: [], regions: [], coverage: { tagged: 100, all: 100 }, order: "tags",
    elements,
    lines: elements.flatMap((element) => (element.kind === "paragraph" ? [{ top: (top += 24), text: element.text }] : ((top += 120), []))),
    ...extra,
  };
}

const choices = (...texts: string[]): DocxBodyElement[] => texts.map((text, index) => p(`${"ABCDE"[index]}. ${text}`));
const texts = (blocks: readonly { type: string }[]): string[] => blocks.map((block) => block.type);

describe("a tagged document with two sets, a table and figures", () => {
  const first = page(1, [
    p("Cardiology"),
    p("1. A study compares two treatments for heart failure and reports the deaths in each group."),
    { kind: "table", rows: [["Group", "Deaths", "Survivors"], ["Drug", "10", "90"], ["Placebo", "20", "80"]], headerRows: 1, rowHeaders: true },
    p("What is the relative risk of death with the drug?"),
    ...choices("0.25", "0.5", "1.0", "2.0"),
    p("2. A 60-year-old man has the pressure tracing shown."),
    image(1, 0, "A pressure tracing with a slow upstroke"),
    p("Which valve lesion is most likely?"),
    ...choices("Mitral stenosis", "Aortic regurgitation", "Aortic stenosis", "Tricuspid regurgitation"),
    p("3. Which vessel returns blood from the lungs to the left atrium?"),
    ...choices("Pulmonary vein", "Pulmonary artery", "Aorta", "Coronary sinus"),
    image(1, 1),
  ], {
    headings: ["Cardiology"],
    figures: [{ left: 100, top: 300, width: 300, height: 150, alt: "A pressure tracing with a slow upstroke" }, { left: 100, top: 600, width: 200, height: 120 }],
  });
  const second = page(2, [
    p("Renal physiology"),
    p("1. Which part of the nephron filters the blood into the urinary space?"),
    ...choices("Glomerulus", "Loop of Henle", "Collecting duct", "Distal tubule"),
    p("Answer: A"),
    p("Explanation: Filtration happens across the glomerular capillaries."),
    // The empty paragraph an author leaves between two questions.
    p(""),
    p("2. Which hormone makes the collecting duct take up more water?"),
    ...choices("Aldosterone", "Renin", "Vasopressin", "Calcitriol"),
    p("Answer: C"),
    p("Explanation: Vasopressin inserts water channels into the collecting duct."),
    p(""),
    p("Answers and brief explanations:"),
    p("Cardiology"),
    p("1. Answer: B"),
    p("Ten of 100 against twenty of 100 is a relative risk of one half."),
    p("2. Answer: C"),
    p("A slow, late upstroke is the tracing of aortic stenosis."),
    p("3. Answer: A"),
    p("Four pulmonary veins enter the left atrium."),
  ], { headings: ["Renal physiology"] });
  const asGiven = structuredClone([first, second]);
  const result = taggedPdfToQuestions({ pages: [first, second] }, DEFAULTS);
  const [relativeRisk, tracing, vein, glomerulus, vasopressin] = result.questions;

  it("reads each set on its own, and tells them apart in the ids and the source", () => {
    expect(result.questions.map((question) => question.id)).toEqual(["invented-bank-s1-q01", "invented-bank-s1-q02", "invented-bank-s1-q03", "invented-bank-s2-q01", "invented-bank-s2-q02"]);
    expect(result.questions.map((question) => [question.source.set, question.source.questionNumber])).toEqual([[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]]);
    expect(result.questions.map((question) => question.source.setTitle)).toEqual(["Cardiology", "Cardiology", "Cardiology", "Renal physiology", "Renal physiology"]);
    expect(result.report.sets).toBe(2);
    expect(result.notes[0]).toMatch(/2 sets of questions/);
  });

  it("files each set under its own heading, because the tags call that line a heading", () => {
    expect(result.questions.map((question) => question.topic)).toEqual(["Cardiology", "Cardiology", "Cardiology", "Renal physiology", "Renal physiology"]);
  });

  it("gives each set its own answers: one from its own lines, one from the section printed after the other", () => {
    expect(result.questions.map((question) => question.correctAnswer?.labels)).toEqual([["B"], ["C"], ["A"], ["A"], ["C"]]);
    expect(result.questions.every((question) => question.explanation?.length)).toBe(true);
    expect(result.notes.join(" ")).toMatch(/only set it fits/);
  });

  it("puts a table back in the stem as a table, between the text around it", () => {
    expect(texts(relativeRisk.stem)).toEqual(["text", "table", "text"]);
    expect(relativeRisk.stem[1]).toEqual({ type: "table", headers: ["Group", "Deaths", "Survivors"], rowHeaders: true, rows: [["Drug", "10", "90"], ["Placebo", "20", "80"]] });
    expect(result.report).toMatchObject({ tables: 1, tablesPlaced: 1 });
  });

  it("puts a figure where the tags put it, and asks for that region of its page to be drawn", () => {
    expect(texts(tracing.stem)).toEqual(["text", "image", "text"]);
    const [asset] = tracing.assets;
    expect(asset).toMatchObject({ role: "stem", filename: "invented-p1-fig1.png", mimeType: "image/png", sourcePage: 1, derivation: "region-render", bounds: { x: 100, y: 300, width: 300, height: 150 } });
    expect(tracing.stem[1]).toMatchObject({ type: "image", assetId: asset.id, alt: "A pressure tracing with a slow upstroke" });
    expect(result.renders.get(asset.id)).toEqual({ page: 1, box: { left: 100, top: 300, width: 300, height: 150 } });
    expect(questionReadiness(tracing, result.issues).readiness).toBe("ready");
  });

  it("moves a figure printed after the last choice to the question and asks for it to be checked", () => {
    expect(vein.choices[3].blocks).toEqual([{ type: "text", text: "Coronary sinus" }]);
    expect(texts(vein.stem)).toEqual(["text", "image"]);
    expect(vein.assets[0].role).toBe("stem");
    expect(vein.flags?.map((flag) => flag.type)).toEqual(["media_association_uncertain"]);
    expect(questionReadiness(vein, result.issues).readiness).toBe("needs-review");
    expect(result.report).toMatchObject({ figures: 2, figuresPlaced: 2 });
  });

  it("leaves the other questions ready", () => {
    expect([relativeRisk, glomerulus, vasopressin].map((question) => questionReadiness(question, result.issues).readiness)).toEqual(["ready", "ready", "ready"]);
  });

  it("hands back the text of the file as a person would read it: a table as rows, and no stand-in for a picture", () => {
    expect(result.sourceText.pageTexts).toHaveLength(2);
    expect(result.sourceText.pageTexts[0]).toContain("Group\tDeaths\tSurvivors\nDrug\t10\t90\nPlacebo\t20\t80");
    expect(result.sourceText.rawText).toBe(result.sourceText.pageTexts.join("\n\n"));
    expect(result.sourceText.rawText).not.toMatch(/AXOMANCHOR/);
    expect(result.sourceText.rawText).toContain("Answers and brief explanations:");
  });

  it("does not change the pages it was given", () => {
    expect([first, second]).toEqual(asGiven);
  });
});

describe("a tagged document with one set", () => {
  it("reads an answer key set out as a table as the key, not as a table of a question", () => {
    const result = taggedPdfToQuestions({ pages: [
      page(1, [
        p("1. Which nerve supplies the diaphragm?"), ...choices("Vagus nerve", "Phrenic nerve", "Intercostal nerve"),
        p("2. Which muscle is the main muscle of quiet breathing in?"), ...choices("Diaphragm", "Rectus abdominis", "Trapezius"),
        p("3. Which pleura lines the inside of the chest wall?"), ...choices("Visceral pleura", "Parietal pleura", "Mediastinal fat"),
      ]),
      page(2, [p("Answer Key"), { kind: "table", rows: [["Question", "Answer"], ["1", "B"], ["2", "A"], ["3", "B"]], headerRows: 1 }]),
    ] }, DEFAULTS);
    expect(result.questions.map((question) => question.id)).toEqual(["invented-bank-q01", "invented-bank-q02", "invented-bank-q03"]);
    expect(result.questions.map((question) => question.correctAnswer?.labels[0])).toEqual(["B", "A", "B"]);
    expect(result.questions.every((question) => question.source.set === undefined)).toBe(true);
    expect(result.report).toMatchObject({ sets: 1, tables: 0, answerKeyTables: 1 });
  });

  it("leaves a question with no answer anywhere unresolved, without inventing a reason to review it", () => {
    const result = taggedPdfToQuestions({ pages: [page(1, [p("1. Which nerve supplies the diaphragm?"), ...choices("Vagus nerve", "Phrenic nerve", "Intercostal nerve")])] }, DEFAULTS);
    expect(result.questions[0].correctAnswer).toBeUndefined();
    expect(questionReadiness(result.questions[0], result.issues).readiness).toBe("unresolved");
  });

  it("drops a picture that sits in the same place on most pages, and lists one that belongs to no question", () => {
    const logo = { left: 500, top: 20, width: 80, height: 60 };
    const stems = ["Which nerve supplies the diaphragm?", "Which bone forms the forehead?", "Which valve guards the aorta?", "Which organ makes bile?"];
    const pages = [
      page(1, [p("Week 2 practice questions"), image(1, 0)], { figures: [{ left: 100, top: 200, width: 300, height: 300 }] }),
      ...stems.map((stem, index) => page(index + 2, [
        image(index + 2, 0),
        p(`${index + 1}. ${stem}`), ...choices("The first choice", "The second choice", "The third choice"), p("Answer: A"), p(""),
      ], { figures: [logo] })),
    ];
    const result = taggedPdfToQuestions({ pages }, DEFAULTS);
    expect(result.questions).toHaveLength(4);
    expect(result.questions.flatMap((question) => question.assets)).toEqual([]);
    expect(result.unplaced.map((entry) => entry.media.kind === "image" && entry.media.element.target)).toEqual(["page:1:figure:0"]);
    expect(result.issues.filter((issue) => issue.code === "media_association_uncertain" && !issue.questionId)).toHaveLength(1);
  });

  it("holds a question back when a picture on its page could not be tied to any question", () => {
    const result = taggedPdfToQuestions({ pages: [
      // A picture above the first question's number: its own exhibit, or a banner. Nothing says which.
      page(1, [image(1, 0), p("1. Which nerve supplies the diaphragm?"), ...choices("Vagus nerve", "Phrenic nerve", "Intercostal nerve"), p("Answer: B"), p("")], { figures: [{ left: 100, top: 60, width: 300, height: 200 }] }),
      page(2, [p("2. Which bone forms the forehead?"), ...choices("Frontal", "Parietal", "Occipital"), p("Answer: A"), p("")]),
    ] }, DEFAULTS);
    const [first, second] = result.questions;
    expect(result.unplaced).toHaveLength(1);
    expect(first.correctAnswer?.labels).toEqual(["B"]);
    expect(first.flags).toEqual([{ type: "media_association_uncertain", message: expect.stringContaining("A picture on page 1 could not be tied to a question") }]);
    expect(questionReadiness(first, result.issues).readiness).toBe("needs-review");
    // The question on the other page is not touched.
    expect(second.flags).toBeUndefined();
    expect(questionReadiness(second, result.issues).readiness).toBe("ready");
  });

  it("keeps the parser's doubt when a numbered question follows an explanation with nothing between them", () => {
    const result = taggedPdfToQuestions({ pages: [page(1, [
      p("1. Which nerve supplies the diaphragm?"), ...choices("Vagus nerve", "Phrenic nerve", "Intercostal nerve"),
      p("Answer: B"), p("Explanation: The phrenic nerve arises from the third to fifth cervical roots."),
      p("2. Which muscle is the main muscle of quiet breathing in?"), ...choices("Diaphragm", "Rectus abdominis", "Trapezius"),
      p("Answer: A"), p("Explanation: The diaphragm does most of the work of quiet breathing."),
    ])] }, DEFAULTS);
    // The tags say these are two blocks. They do not say the second is a question and not a numbered
    // point of the explanation, so the parser's caution is kept and no key is saved on its word.
    expect(result.questions.map((question) => question.correctAnswer)).toEqual([undefined, undefined]);
    expect(result.questions.map((question) => questionReadiness(question, result.issues).readiness)).not.toContain("ready");
  });
});

describe("a tagged slide deck whose answer slides only mark the answer", () => {
  const STEMS = [
    ["1. A drug is given by constant infusion and its plasma level is followed over time.", "Which value decides how long it takes to reach steady state?"],
    ["2. Two drugs act on the same receptor and reach the same maximal effect.", "Which word describes the drug that needs the lower dose?"],
    ["3. A drug is cleared only by the kidney in a patient whose filtration has halved.", "Which change to the regimen keeps the same average level?"],
  ];
  const OPTIONS = [
    ["A. Clearance alone", "B. Half-life", "C. Volume of distribution alone", "D. Bioavailability"],
    ["A. More efficacious", "B. More potent", "C. A partial agonist", "D. An inverse agonist"],
    ["A. Double the dose", "B. Halve the dosing interval", "C. Halve the dose", "D. No change"],
  ];
  const graph = { left: 380, top: 200, width: 280, height: 220 };
  const mark = { left: 40, top: 262, width: 16, height: 16 };
  const slide = (number: number, lines: string[], extra: Partial<PageBody> = {}): PageBody =>
    ({ ...page(number, lines.map(p), { order: "position", ...extra }), height: 540 });
  const pages = [
    slide(1, ["Pharmacokinetics review"]),
    slide(2, [...STEMS[0], ...OPTIONS[0]], { figures: [graph], regions: [{ ...graph, labels: ["0", "50", "100", "Time (h)"] }] }),
    slide(3, [...STEMS[0], ...OPTIONS[0]], { figures: [graph, mark], regions: [{ ...graph }] }),
    slide(4, [...STEMS[1], ...OPTIONS[1]]),
    slide(5, [...STEMS[1], ...OPTIONS[1]], { figures: [mark] }),
    slide(6, [...STEMS[2], ...OPTIONS[2]]),
    slide(7, [...STEMS[2], ...OPTIONS[2]]),
  ];
  const result = taggedPdfToQuestions({ pages }, DEFAULTS);

  it("reads one question from each question slide, and no key from a mark", () => {
    expect(result.report).toMatchObject({ deck: true, readByPosition: true, sets: 1, answerPages: 3, answerPagesWithMarks: 2 });
    expect(result.questions.map((question) => [question.source.page, question.choices.length, question.correctAnswer])).toEqual([[2, 4, undefined], [4, 4, undefined], [6, 4, undefined]]);
  });

  it("keeps each answer slide whole as a picture that is never shown while the question is open", () => {
    for (const [index, question] of result.questions.entries()) {
      const reveal = question.assets.filter((asset) => asset.role === "answer_reveal");
      expect(reveal).toHaveLength(1);
      expect(reveal[0]).toMatchObject({ derivation: "page-render", sourcePage: 3 + index * 2, filename: `invented-p${3 + index * 2}-answer.png` });
      expect(result.renders.get(reveal[0].id)).toEqual({ page: 3 + index * 2 });
      expect(isAssetVisible(reveal[0].role, "question")).toBe(false);
      expect(isAssetVisible(reveal[0].role, "review")).toBe(true);
      // The answer slide is not a block of the question: nothing in the stem or the choices points at it.
      expect(JSON.stringify([question.stem, question.choices])).not.toContain(reveal[0].id);
    }
  });

  it("says why each one needs review, and tells a drawn mark from no key at all", () => {
    const messages = result.questions.map((question) => question.flags?.find((flag) => flag.type === "answer_needs_review")?.message ?? "");
    expect(messages[0]).toMatch(/mark drawn beside a choice/);
    expect(messages[1]).toMatch(/mark drawn beside a choice/);
    expect(messages[2]).toMatch(/prints no key/);
    expect(result.questions.map((question) => questionReadiness(question, result.issues).readiness)).toEqual(["needs-review", "needs-review", "needs-review"]);
  });

  it("cuts the graph out once, from the question slide, with its labels as its description", () => {
    const [first] = result.questions;
    const stem = first.assets.filter((asset) => asset.role === "stem");
    expect(stem).toHaveLength(1);
    expect(stem[0]).toMatchObject({ sourcePage: 2, derivation: "region-render", bounds: { x: 380, y: 200, width: 280, height: 220 } });
    expect(first.stem.find((block) => block.type === "image")).toMatchObject({ assetId: stem[0].id, alt: "Labels in the figure: 0, 50, 100, Time (h)" });
    expect(first.assets.find((asset) => asset.role === "answer_reveal")?.revealOf).toBe(stem[0].id);
    expect(result.report.figureLabels).toBe(4);
    // Placed after a stem whose first line carries the question's number: no doubt to report.
    expect(first.flags?.map((flag) => flag.type)).toEqual(["answer_needs_review"]);
    // Nothing on a slide without a question holds a question back.
    expect(result.questions.flatMap((question) => question.flags ?? []).filter((flag) => flag.type === "media_association_uncertain")).toEqual([]);
  });

  it("keeps a key the answer slide prints in words", () => {
    const printed = pages.map((entry) => (entry.page === 7 ? slide(7, [...STEMS[2], ...OPTIONS[2], "Answer: C"]) : entry));
    const keyed = taggedPdfToQuestions({ pages: printed }, DEFAULTS);
    expect(keyed.questions.map((question) => question.correctAnswer?.labels[0])).toEqual([undefined, undefined, "C"]);
    expect(keyed.questions[2].flags?.some((flag) => flag.type === "answer_needs_review") ?? false).toBe(false);
  });
});
