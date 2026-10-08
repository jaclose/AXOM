import { describe, expect, it } from "vitest";
import { blockShape } from "../blocks";
import type { ImportPackage, PackageManifest } from "../package";
import { parsePackage, serializeManifest, serializeQuestionsFile } from "../packageJson";
import { validatePackage } from "../validate";
import { looksLikeMarker, readMarker, type DocxBodyElement } from "./markers";
import { DOCX_MARKER_PARSER, parseMarkedBody } from "./parseMarkedBody";

const p = (text: string): DocxBodyElement => ({ kind: "paragraph", text });
const table = (...rows: string[][]): DocxBodyElement => ({ kind: "table", rows });
const image = (name: string, alt?: string): DocxBodyElement => ({ kind: "image", target: `media/${name}`, ...(alt ? { alt } : {}) });
const defaults = { bankId: "example-bank", sourceFilename: "questions.docx" };
const codes = (issues: { severity: string; code: string }[]) => issues.map((issue) => `${issue.severity}:${issue.code}`);
const manifest: PackageManifest = {
  schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 }, bank: { id: "example-bank", title: "Example bank", discipline: "Example discipline" },
  source: { filename: "example-source.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/",
};

/** The first example of docs/templates/AXOM_QBANK_IMPORT_TEMPLATE.docx, as its body reads top to bottom. */
const exampleOne: DocxBodyElement[] = [
  p("AXOM question bank import template"),
  p("7. Anything outside a question, such as this page, is ignored."),
  p("QUESTION 1"),
  p("[AXOM META]"),
  p("Course: GOER"), p("Term: 5"), p("Week: 2"), p("Bank: Example bank"), p("Discipline: Example discipline"), p("Topic: Example topic"), p("Source: example-source.pdf"),
  p("[STEM]"),
  p("A research team gives a new compound to 6 healthy volunteers and measures its level in plasma at set times."),
  p("[TABLE]"),
  table(["Time after dose (h)", "Plasma level (mg/L)"], ["1", "8.0"], ["2", "4.0"], ["3", "2.0"]),
  p("[STEM CONTINUED]"),
  p("The curves below show the level over time for this compound and for a second one."),
  p("[IMAGE]"),
  image("image1.png", "Two curves of plasma level against time"),
  p("[STEM CONTINUED]"),
  p("Which of the following is the half-life of the compound in the table?"),
  p("[CHOICES]"),
  p("A. 0.5 h"), p("B. 1 h"), p("C. 2 h"), p("D. 4 h"), p("E. 8 h"),
  p("[ANSWER]"),
  p("B"),
  p("[EXPLANATION]"),
  p("The level halves every hour: 8.0, then 4.0, then 2.0 mg/L."),
  p("[SOURCE]"),
  p("File: example-source.pdf"), p("Page: 3"),
  p("[FLAGS]"),
  p("source_inconsistency: The stem says 6 volunteers and the answer page of the source says 8. Left as written."),
  p("[END QUESTION]"),
];

describe("markers", () => {
  it("are whole lines in brackets, in any case, with an optional argument", () => {
    expect(readMarker("[STEM]")).toEqual({ marker: "STEM" });
    expect(readMarker("  [ stem   continued ]  ")).toEqual({ marker: "STEM CONTINUED" });
    expect(readMarker("[IMAGE: Answer Reveal]")).toEqual({ marker: "IMAGE", argument: "answer reveal" });
    expect(readMarker("See the [TABLE] below")).toBeUndefined();
    expect(readMarker("[STEMS]")).toBeUndefined();
    expect(looksLikeMarker("[STEMS]")).toBe(true);
    expect(looksLikeMarker("[STEM]")).toBe(false);
  });
});

describe("reading a marked document body", () => {
  it("keeps text, table, text, picture and prompt in the order of the document", () => {
    const { questions, issues } = parseMarkedBody(exampleOne, defaults);
    expect(issues).toEqual([]);
    expect(questions).toHaveLength(1);
    const [question] = questions;
    expect(blockShape(question.stem)).toEqual(["text", "table", "text", "image", "text"]);
    expect(question.stem[1]).toEqual({ type: "table", headers: ["Time after dose (h)", "Plasma level (mg/L)"], rows: [["1", "8.0"], ["2", "4.0"], ["3", "2.0"]] });
    expect(question.stem[3]).toEqual({ type: "image", assetId: "example-bank-q01-img-1", alt: "Two curves of plasma level against time" });
    expect(question).toMatchObject({
      id: "example-bank-q01",
      course: "GOER", term: 5, week: 2, discipline: "Example discipline", topic: "Example topic",
      source: { filename: "example-source.pdf", page: 3, questionNumber: 1 },
      correctAnswer: { labels: ["B"], evidence: "printed-key" },
      explanation: [{ type: "text", text: "The level halves every hour: 8.0, then 4.0, then 2.0 mg/L." }],
      assets: [{ id: "example-bank-q01-img-1", filename: "image1.png", mimeType: "image/png", role: "stem", questionId: "example-bank-q01", derivation: "embedded" }],
      flags: [{ type: "source_inconsistency", message: "The stem says 6 volunteers and the answer page of the source says 8. Left as written." }],
      provenance: { method: "docx-template", tool: DOCX_MARKER_PARSER },
    });
    expect(question.choices.map((choice) => [choice.id, choice.label, choice.blocks])).toEqual([
      ["example-bank-q01-a", "A", [{ type: "text", text: "0.5 h" }]],
      ["example-bank-q01-b", "B", [{ type: "text", text: "1 h" }]],
      ["example-bank-q01-c", "C", [{ type: "text", text: "2 h" }]],
      ["example-bank-q01-d", "D", [{ type: "text", text: "4 h" }]],
      ["example-bank-q01-e", "E", [{ type: "text", text: "8 h" }]],
    ]);
  });

  it("survives export and re-import as a package with the same structure", () => {
    const { questions } = parseMarkedBody(exampleOne, defaults);
    const pkg: ImportPackage = { manifest, questions };
    const back = parsePackage(serializeManifest(manifest), serializeQuestionsFile(pkg));
    expect(back.issues).toEqual([]);
    expect(back.package).toEqual(pkg);
    expect(codes(validatePackage(pkg, { assetFiles: new Set(["image1.png"]) }))).toEqual(["warning:source_inconsistency"]);
  });

  it("reads a table in [CHOICES] lettered A, B, C as the choices themselves", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("Which row shows the pattern that follows?"),
      p("[CHOICES]"), p("[TABLE]"),
      table(["", "Pituitary signal", "Gland hormone"], ["A", "↑", "↑"], ["B", "↑", "↓"], ["C", "↓", "↑"], ["D", "↓", "↓"]),
      p("[ANSWER]"), p("Answer: B"),
      p("[END QUESTION]"),
    ], defaults);
    expect(issues).toEqual([]);
    expect(questions[0].choiceTable).toEqual({ type: "table", headers: ["Pituitary signal", "Gland hormone"], rowKeys: ["A", "B", "C", "D"], rows: [["↑", "↑"], ["↑", "↓"], ["↓", "↑"], ["↓", "↓"]] });
    expect(questions[0].choices.map((choice) => choice.label)).toEqual(["A", "B", "C", "D"]);
    expect(validatePackage({ manifest, questions }).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("gives a table or a picture inside a choice to that choice, and only the next letter starts a new one", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("Which sample is normal?"),
      p("[CHOICES]"),
      p("A."), table(["Na", "K"], ["128", "4.0"]),
      p("B. The organism"), p("E. coli grows on the plate."), image("plate.jpeg"),
      p("C) None of these"),
      p("[END QUESTION]"),
    ], defaults);
    expect(issues).toEqual([]);
    const [a, b, c] = questions[0].choices;
    expect(a.blocks).toEqual([{ type: "table", headers: ["Na", "K"], rows: [["128", "4.0"]] }]);
    expect(b.blocks).toEqual([{ type: "text", text: "The organism\nE. coli grows on the plate." }, { type: "image", assetId: "example-bank-q01-img-1" }]);
    expect(c).toMatchObject({ label: "C", blocks: [{ type: "text", text: "None of these" }] });
    expect(questions[0].assets[0]).toMatchObject({ role: "choice", mimeType: "image/jpeg" });
  });

  it("keeps an answer-marked copy as an asset of the question and never places it", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("The graph shows two compounds."),
      p("[IMAGE]"), image("clean.png"),
      p("[IMAGE: answer reveal]"), image("marked.png"),
      p("[STEM CONTINUED]"), p("Which is more potent?"),
      p("[CHOICES]"), p("A. X"), p("B. Y"),
      p("[END QUESTION]"),
    ], defaults);
    expect(issues).toEqual([]);
    expect(blockShape(questions[0].stem)).toEqual(["text", "image", "text"]);
    expect(questions[0].assets).toMatchObject([
      { id: "example-bank-q01-img-1", role: "stem" },
      { id: "example-bank-q01-img-2", role: "answer_reveal", revealOf: "example-bank-q01-img-1" },
    ]);
    expect(JSON.stringify([questions[0].stem, questions[0].choices])).not.toContain("img-2");
  });

  it("says so when a [TABLE] or [IMAGE] marker is not followed by one", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("Read the table."), p("[TABLE]"), p("Dose 1 2 3"),
      p("[IMAGE]"),
      p("[CHOICES]"), p("A. one"), p("B. two"),
      p("[END QUESTION]"),
    ], defaults);
    expect(codes(issues)).toEqual(["warning:table_parse_uncertain", "error:missing_required_media"]);
    expect(issues.every((issue) => issue.questionId === "example-bank-q01")).toBe(true);
    expect(questions[0].stem).toEqual([{ type: "text", text: "Read the table." }, { type: "text", text: "Dose 1 2 3" }]);
  });

  it("honours [TABLE: no header] and [TABLE: row headers]", () => {
    const { questions } = parseMarkedBody([
      p("[STEM]"),
      p("[TABLE: no header]"), table(["1", "8.0"], ["2", "4.0"]),
      p("[TABLE: row headers]"), table(["", "Ill", "Well"], ["Exposed", "40", "160"]),
      p("[END QUESTION]"),
    ], defaults);
    expect(questions[0].stem).toEqual([
      { type: "table", rows: [["1", "8.0"], ["2", "4.0"]] },
      { type: "table", headers: ["", "Ill", "Well"], rows: [["Exposed", "40", "160"]], rowHeaders: true },
    ]);
  });

  it("closes a question that has no [END QUESTION] where the next one starts, and reads both", () => {
    const { questions, issues } = parseMarkedBody([
      p("QUESTION 4"), p("[STEM]"), p("First."), p("[CHOICES]"), p("A. a"), p("B. b"),
      p("QUESTION 5"), p("[STEM]"), p("Second."), p("[CHOICES]"), p("A. a"), p("B. b"), p("[END QUESTION]"),
    ], defaults);
    expect(questions.map((question) => [question.id, question.source.questionNumber])).toEqual([["example-bank-q04", 4], ["example-bank-q05", 5]]);
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", code: "invalid_question", questionId: "example-bank-q04" })]);
  });

  it("does not guess an answer it cannot read, and reports a marker it does not know", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("Stem."), p("[STEMS]"),
      p("[CHOICES]"), p("A. a"), p("B. b"),
      p("[ANSWER]"), p("Probably the second one"),
      p("[FLAGS]"), p("looks odd"),
      p("[END QUESTION]"),
    ], defaults);
    expect(questions[0].correctAnswer).toBeUndefined();
    expect(questions[0].stem).toEqual([{ type: "text", text: "Stem.\n[STEMS]" }]);
    expect(codes(issues)).toEqual(["warning:invalid_question", "warning:unknown_flag", "warning:missing_answer_key"]);
  });

  it("asks where a picture belongs when it sits where no part of the question can take it", () => {
    const { questions, issues } = parseMarkedBody([
      p("[STEM]"), p("Stem."),
      p("[CHOICES]"), image("stray.png"), p("A. a"), p("B. b"),
      p("[END QUESTION]"),
    ], defaults);
    expect(codes(issues)).toEqual(["warning:media_association_uncertain"]);
    expect(questions[0].assets).toHaveLength(1);
    expect(questions[0].choices.every((choice) => choice.blocks.every((block) => block.type === "text"))).toBe(true);
  });

  it("uses Word's own lettering, and letters numbered or bulleted choices in order and says so", () => {
    const item = (text: string, listLabel: string, listKind: "ordered" | "bullet" = "ordered"): DocxBodyElement => ({ kind: "paragraph", text, listLabel, listKind });
    const lettered = parseMarkedBody([p("[STEM]"), p("Stem."), p("[CHOICES]"), item("one", "A."), item("two", "B."), p("(c) three"), p("[END QUESTION]")], defaults);
    expect(lettered.issues).toEqual([]);
    expect(lettered.questions[0].choices.map((choice) => [choice.label, choice.blocks])).toEqual([
      ["A", [{ type: "text", text: "one" }]], ["B", [{ type: "text", text: "two" }]], ["C", [{ type: "text", text: "three" }]],
    ]);
    const numbered = parseMarkedBody([p("[STEM]"), p("Stem."), p("[CHOICES]"), item("one", "1."), item("two", "•", "bullet"), p("[END QUESTION]")], defaults);
    expect(numbered.questions[0].choices.map((choice) => choice.label)).toEqual(["A", "B"]);
    expect(codes(numbered.issues)).toEqual(["info:needs_review"]);
  });

  it("never imports formatting that covers one whole choice, and reports it without using it as the key", () => {
    const choice = (text: string, emphasis?: { bold?: boolean; highlight?: boolean }): DocxBodyElement => ({ kind: "paragraph", text, ...(emphasis ? { emphasis } : {}) });
    const marked = parseMarkedBody([p("[STEM]"), p("Stem."), p("[CHOICES]"), choice("A. one"), choice("B. two", { bold: true, highlight: true }), choice("C. three"), p("[END QUESTION]")], defaults);
    expect(marked.questions[0].correctAnswer).toBeUndefined();
    expect(JSON.stringify(marked.questions[0].choices)).not.toMatch(/bold|highlight|<b>/);
    expect(marked.issues).toEqual([expect.objectContaining({ severity: "warning", code: "possible_answer_marking", message: expect.stringContaining("Choice B is formatted differently from the other choices (bold, highlighted)") })]);
    // The same formatting on every choice is a style, not a mark.
    const styled = parseMarkedBody([p("[STEM]"), p("Stem."), p("[CHOICES]"), choice("A. one", { bold: true }), choice("B. two", { bold: true }), p("[END QUESTION]")], defaults);
    expect(styled.issues).toEqual([]);
  });

  it("takes a tick out of a choice so it cannot give the answer away, and says so", () => {
    const { questions, issues } = parseMarkedBody([p("[STEM]"), p("Stem."), p("[CHOICES]"), p("A. one"), p("B. two ✓"), p("[END QUESTION]")], defaults);
    expect(questions[0].choices[1].blocks).toEqual([{ type: "text", text: "two" }]);
    expect(questions[0].correctAnswer).toBeUndefined();
    expect(codes(issues)).toEqual(["warning:possible_answer_marking"]);
  });

  it("places an equation, a caption, merged cells and rich cells where the document has them", () => {
    const { questions, issues, assetTargets } = parseMarkedBody([
      p("[STEM]"), p("Before."),
      { kind: "equation", plainText: "x^2", latex: "{x}^{2}" },
      { kind: "table", rich: true, headerRows: 1, rows: [["Hormone", "Serum", ""], ["TSH", "0.2 <sup>2</sup>", "4.1"]], merges: [{ row: 0, column: 1, rowSpan: 1, columnSpan: 2 }] },
      { kind: "paragraph", text: "Table 1. Invented values", caption: true },
      { kind: "image", target: "word/media/image2.png", crop: { left: 0.25, top: 0, right: 0, bottom: 0 } },
      { kind: "paragraph", text: "Figure 1", caption: true },
      p("[IMAGE: answer reveal]"), image("marked.png"), { kind: "paragraph", text: "The answer is circled", caption: true },
      p("After."),
      p("[CHOICES]"), p("A. a"), p("B. b"), p("[END QUESTION]"),
    ], defaults);
    expect(issues).toEqual([]);
    expect(questions[0].stem).toEqual([
      { type: "text", text: "Before." },
      { type: "equation", latex: "{x}^{2}", plainText: "x^2" },
      { type: "table", headers: ["Hormone", "Serum", ""], rich: true, merges: [{ row: 0, column: 1, rowSpan: 1, columnSpan: 2 }], rows: [["TSH", "0.2 <sup>2</sup>", "4.1"]], caption: "Table 1. Invented values" },
      { type: "image", assetId: "example-bank-q01-img-1", caption: "Figure 1" },
      { type: "text", text: "After." },
    ]);
    expect(questions[0].assets[0]).toMatchObject({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } });
    expect(JSON.stringify(questions[0].stem)).not.toContain("circled");
    expect([...assetTargets]).toEqual([["example-bank-q01-img-1", "word/media/image2.png"], ["example-bank-q01-img-2", "media/marked.png"]]);
  });

  it("keeps a paragraph with subscripts as rich text, and ignores a bare heading with nothing under it", () => {
    const { questions, issues } = parseMarkedBody([
      p("QUESTION"),
      p("QUESTION 2"), p("[STEM]"), { kind: "paragraph", text: "t½ of Na+", html: "t<sub>½</sub> of Na<sup>+</sup>" },
      p("[CHOICES]"), { kind: "paragraph", text: "A. HCO3−", html: "A. HCO<sub>3</sub><sup>−</sup>" }, p("B. Cl"),
      p("[END QUESTION]"),
    ], defaults);
    expect(issues).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0].stem).toEqual([{ type: "rich_text", html: "t<sub>½</sub> of Na<sup>+</sup>" }]);
    expect(questions[0].choices.map((choice) => choice.blocks)).toEqual([
      [{ type: "rich_text", html: "HCO<sub>3</sub><sup>−</sup>" }],
      [{ type: "text", text: "Cl" }],
    ]);
  });
});
