// A .docx in, package questions out, on files that real producers wrote:
// AXOM's own template, the same template saved by Microsoft Word, a document
// built by pandoc, and one a converter flattened.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockShape } from "../blocks";
import type { ImportPackage, PackageManifest } from "../package";
import { parsePackage, serializeManifest, serializeQuestionsFile } from "../packageJson";
import { isRunnable, validatePackage } from "../validate";
import { visibleBlocks, effectiveRole } from "../visibility";
import { docxToQuestions } from "./docxToQuestions";

const repository = join(process.cwd(), "..");
const fixture = (name: string): Uint8Array => readFileSync(join(repository, "fixtures", "qbank", "synthetic", "docx", name));
const template = (): Uint8Array => readFileSync(join(repository, "docs", "templates", "AXOM_QBANK_IMPORT_TEMPLATE.docx"));
const defaults = { bankId: "example-bank", sourceFilename: "questions.docx" };
const manifest: PackageManifest = {
  schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 }, bank: { id: "example-bank", title: "Example bank", discipline: "Example discipline" },
  source: { filename: "questions.docx", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets/",
};
const codes = (issues: { severity: string; code: string }[]): string[] => issues.map((issue) => `${issue.severity}:${issue.code}`);
const CURVES = "sha256:60cd6d30cbaef26e653e2ae863ea345e804f69e6fe9cde60c85cbfce11a0e073";

describe("the import template, end to end", () => {
  it("becomes two questions with the table and the picture in place", async () => {
    const converted = await docxToQuestions(template(), defaults);
    expect(converted.readBy).toBe("markers");
    expect(converted.issues).toEqual([]);
    expect(converted.unplaced).toEqual([]);
    const [first, second] = converted.questions;
    expect(blockShape(first.stem)).toEqual(["text", "table", "text", "image", "text"]);
    expect(first).toMatchObject({
      id: "example-bank-q01", course: "GOER", term: 5, week: 2,
      source: { filename: "example-source.pdf", page: 3, questionNumber: 1 },
      correctAnswer: { labels: ["B"], evidence: "printed-key" },
      flags: [{ type: "source_inconsistency" }],
    });
    // The picture in the template is the invented graph, byte for byte.
    expect(first.assets).toEqual([{
      id: "example-bank-q01-img-1", filename: "example-bank-q01-img-1.png", mimeType: "image/png", width: 480, height: 320, byteSize: 2009,
      role: "stem", questionId: "example-bank-q01", derivation: "embedded", checksum: CURVES,
    }]);
    expect([...converted.files.keys()]).toEqual(["example-bank-q01-img-1.png"]);
    expect(second.choiceTable).toEqual({ type: "table", headers: ["Pituitary signal", "Gland hormone"], rowKeys: ["A", "B", "C", "D"], rows: [["↑", "↑"], ["↑", "↓"], ["↓", "↑"], ["↓", "↓"]] });
    expect(second.correctAnswer?.labels).toEqual(["B"]);
  });

  it("is the same package whether AXOM built the file or Word saved it", async () => {
    const built = await docxToQuestions(template(), defaults);
    const saved = await docxToQuestions(fixture("word-saved-template.docx"), defaults);
    expect(saved.issues).toEqual([]);
    expect(saved.questions).toEqual(built.questions);
  });

  it("survives export and re-import, and every question can be run", async () => {
    const { questions, files } = await docxToQuestions(template(), defaults);
    const pkg: ImportPackage = { manifest, questions };
    const back = parsePackage(serializeManifest(manifest), serializeQuestionsFile(pkg));
    expect(back.issues).toEqual([]);
    expect(back.package).toEqual(pkg);
    const issues = validatePackage(pkg, { assetFiles: new Set(files.keys()) });
    expect(codes(issues)).toEqual(["warning:source_inconsistency"]);
    expect(questions.every((question) => isRunnable(question.id, issues))).toBe(true);
  });
});

describe("a document pandoc wrote with the markers", () => {
  it("keeps rich text, a merged table, pictures, an equation and Word's own lettering", async () => {
    const converted = await docxToQuestions(fixture("pandoc-marked.docx"), defaults);
    const [first, second] = converted.questions;
    expect(blockShape(first.stem)).toEqual(["rich_text", "table", "image", "equation", "text"]);
    expect(first.stem[0]).toEqual({ type: "rich_text", html: "A volunteer’s Na<sup>+</sup> and HCO<sub>3</sub><sup>−</sup> are measured. The half-life is t_(1/2) and <b>not</b> the clearance." });
    expect(first.stem[1]).toEqual({
      type: "table", headers: ["Test", "Result", ""], rows: [["Marker A", "12.0", "mg/dL"], ["Marker B", "0.2 μU/mL", ""]],
      merges: [{ row: 0, column: 1, rowSpan: 1, columnSpan: 2 }, { row: 2, column: 1, rowSpan: 1, columnSpan: 2 }],
    });
    expect(first.stem[2]).toMatchObject({ type: "image", alt: "Two curves of level against time", caption: "Two curves of level against time" });
    expect(first.stem[3]).toEqual({ type: "equation", latex: "RR=\\frac{40/200}{30/300}=2.0", plainText: "RR=(40/200)/(30/300)=2.0" });
    expect(first.choices.map((choice) => [choice.label, choice.blocks])).toEqual([
      ["A", [{ type: "text", text: "0.5" }]],
      ["B", [{ type: "text", text: "2.0" }]],
      ["C", [{ type: "text", text: "4.0 ↑" }]],
    ]);
    expect(first.explanation).toEqual([{ type: "text", text: "The risk is 0.2 in one group and 0.1 in the other, so √(4)=2 times." }]);
    expect(first.source).toEqual({ filename: "invented.pdf", page: 2, pageEnd: 3, questionNumber: 1 });
    expect(second.choiceTable?.rowKeys).toEqual(["A", "B", "C"]);
  });

  it("holds the answer-marked picture back and never places it or its caption", async () => {
    const { questions } = await docxToQuestions(fixture("pandoc-marked.docx"), defaults);
    const [clean, marked] = questions[0].assets;
    expect(clean).toMatchObject({ role: "stem", checksum: CURVES });
    expect(marked).toMatchObject({ role: "answer_reveal", revealOf: clean.id, checksum: "sha256:18a9a2bc9f53b6883f68a8aa9c37335a6b6d6b6b836d843400d1a6f1b14c605c" });
    const placed = JSON.stringify([questions[0].stem, questions[0].choices, questions[0].explanation]);
    expect(placed).not.toContain(marked.id);
    expect(placed).not.toContain("The same curves with one marked");
    const roles = new Map(questions[0].assets.map((asset) => [asset.id, asset.role]));
    expect(visibleBlocks(questions[0].stem, "question", (block) => effectiveRole(block.role, roles.get(block.assetId), "stem"))).toEqual(questions[0].stem);
  });

  it("does not import the bold on one choice, does not use it as the key, and says so", async () => {
    const { questions, issues } = await docxToQuestions(fixture("pandoc-marked.docx"), defaults);
    expect(JSON.stringify(questions[0].choices)).not.toMatch(/<b>|bold/);
    expect(questions[0].correctAnswer).toEqual({ labels: ["B"], evidence: "printed-key" });
    expect(issues).toEqual([expect.objectContaining({
      severity: "warning", code: "possible_answer_marking", questionId: "example-bank-q01",
      message: "Choice B is formatted differently from the other choices (bold). That may mark the answer. The formatting was not imported and was not used as the key.",
    })]);
  });
});

describe("a document with no markers", () => {
  it("goes through AXOM's own text parser with its table and picture carried in place", async () => {
    const converted = await docxToQuestions(fixture("pandoc-unmarked.docx"), defaults);
    expect(converted.readBy).toBe("text-parser");
    expect(converted.issues).toEqual([]);
    expect(converted.unplaced).toEqual([]);
    const [first, second] = converted.questions;
    expect(first.stem).toEqual([
      { type: "text", text: "An infusion of an invented compound is stopped and its plasma level is measured." },
      { type: "table", headers: ["Time after infusion (h)", "Plasma level (μg/mL)"], rows: [["0", "16"], ["2", "8"], ["4", "4"]] },
      { type: "text", text: "What is the half-life of the compound?" },
    ]);
    expect(first.choices.map((choice) => choice.label)).toEqual(["A", "B", "C", "D"]);
    expect(first.correctAnswer).toEqual({ labels: ["B"], evidence: "printed-key" });
    expect(first.explanation).toEqual([{ type: "text", text: "The level halves every 2 h." }]);
    expect(first.provenance.method).toBe("docx-import");
    expect(blockShape(second.stem)).toEqual(["text", "image", "text"]);
    expect(second.stem[1]).toMatchObject({ caption: "Two curves of level against time" });
    expect(second.assets[0]).toMatchObject({ role: "stem", checksum: CURVES, width: 480, height: 320 });
  });
});

describe("a document a converter flattened", () => {
  it("is caught by its markers: the table and the picture they promise are not there", async () => {
    const { questions, issues } = await docxToQuestions(fixture("flattened-by-converter.docx"), defaults);
    expect(questions).toHaveLength(2);
    expect(codes(issues)).toEqual(expect.arrayContaining(["warning:table_parse_uncertain", "error:missing_required_media"]));
    expect(issues.find((issue) => issue.code === "missing_required_media")).toMatchObject({ questionId: "example-bank-q01", message: "An [IMAGE] marker is not followed by a picture." });
  });

  it("explains a file that is not a Word document instead of failing", async () => {
    const converted = await docxToQuestions(new TextEncoder().encode("plain words, not a document of any kind"), defaults);
    expect(converted).toMatchObject({ questions: [], readBy: "nothing" });
    expect(codes(converted.issues)).toEqual(["error:invalid_document"]);
  });
});
