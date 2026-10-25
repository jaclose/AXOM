import { describe, expect, it } from "vitest";
import { applyEmphasisAnswers, conventionHolds, proposePdfEmphasisAnswers, readPrintedChoiceSets, type PrintedChoiceSet } from "./pdfEmphasisAnswers";
import { parsePdfQuestions } from "./pdfQuestionImport";
import { parseQuestionBlocks } from "./questionParse";

const legacy = async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
const WORKER = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

interface Line { text: string; bold?: boolean; color?: [number, number, number] }

/** Uncompressed PDF whose lines may use Helvetica-Bold and a fill colour. */
function makePdf(pages: Line[][]): ArrayBuffer {
  const objects: string[] = [];
  const regular = 3 + pages.length * 2, bold = regular + 1;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((lines, index) => {
    const page = 3 + index * 2;
    const stream = lines.map((line, at) => {
      const [r, g, b] = line.color ?? [0, 0, 0];
      return `${r} ${g} ${b} rg BT /${line.bold ? "F2" : "F1"} 11 Tf 72 ${740 - at * 16} Td (${line.text.replace(/[()\\]/g, (char) => `\\${char}`)}) Tj ET`;
    }).join("\n");
    objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${page + 1} 0 R >>`;
    objects[page + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[regular] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[bold] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let number = 1; number < objects.length; number++) {
    offsets[number] = pdf.length;
    pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number++) pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf).buffer;
}

const QUESTIONS = [
  { stem: "Which nerve supplies the diaphragm in most adults?", choices: ["Vagus nerve", "Phrenic nerve", "Intercostal nerve", "Accessory nerve"], key: 1 },
  { stem: "Which bone forms most of the forehead in an adult skull?", choices: ["Frontal bone", "Parietal bone", "Occipital bone", "Temporal bone"], key: 0 },
  { stem: "Which vessel drains the left ventricle into the systemic circulation?", choices: ["Pulmonary trunk", "Superior vena cava", "Aorta", "Coronary sinus"], key: 2 },
];
const letter = (index: number) => String.fromCharCode(65 + index);

function boldHandout(markAll = false): Line[][] {
  return [QUESTIONS.flatMap((question, number) => [
    { text: `${number + 1}. ${question.stem}` },
    ...question.choices.map((choice, index) => ({ text: `${letter(index)}. ${choice}`, bold: index === question.key || (markAll && index === 3) })),
  ])];
}

function set(page: number, lead: string, choices: Array<[string, { bold?: boolean; color?: string }?]>): PrintedChoiceSet {
  return { page, lead: lead.toLowerCase().replace(/[^a-z0-9]+/g, ""), choices: choices.map(([text, style], index) => ({
    key: letter(index), text, bold: style?.bold ?? false, color: style?.color ?? "#000000" })) };
}

const draftsFor = (questions = QUESTIONS, answers?: string[]) => parseQuestionBlocks(questions.map((question, number) => [
  `${number + 1}. ${question.stem}`, ...question.choices.map((choice, index) => `${letter(index)}. ${choice}`),
  ...(answers ? [`Answer: ${answers[number]}`] : []),
].join("\n")).join("\n\n"));

describe("reading typographic answer marks from a PDF", () => {
  it("reads each printed choice's weight and colour", async () => {
    const sets = await readPrintedChoiceSets(makePdf([[
      { text: "1. Which nerve supplies the diaphragm in most adults?" },
      { text: "A. Vagus nerve" }, { text: "B. Phrenic nerve", bold: true }, { text: "C. Intercostal nerve" },
      { text: "2. Which bone forms most of the forehead?" },
      { text: "A. Frontal bone", color: [0, 1, 0] }, { text: "B. Parietal bone", color: [0.5, 0.5, 0.5] }, { text: "C. Occipital bone", color: [0.5, 0.5, 0.5] },
    ]]), await legacy(), WORKER);
    expect(sets).toHaveLength(2);
    expect(sets[0].choices.map((choice) => [choice.key, choice.text, choice.bold])).toEqual([["A", "Vagus nerve", false], ["B", "Phrenic nerve", true], ["C", "Intercostal nerve", false]]);
    expect(sets[1].choices.map((choice) => choice.color)).toEqual(["#00ff00", "#808080", "#808080"]);
    expect(sets[1].lead).toContain("whichboneformsmostoftheforehead");
  });

  it("keys a document that bolds exactly one choice in every question", async () => {
    const pdf = makePdf(boldHandout());
    const pages = (await import("./extractText")).extractPdfText(pdf.slice(0), await legacy(), WORKER);
    const read = await pages;
    const { drafts } = parsePdfQuestions(read.text, read.pages);
    expect(drafts.every((draft) => !draft.correctKey)).toBe(true);
    const notes = await proposePdfEmphasisAnswers(pdf, drafts, await legacy(), WORKER);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "A", "C"]);
    expect(drafts.every((draft) => draft.parserRuleIds?.includes("answer.pdf-emphasis-bold") && draft.needsReview === false)).toBe(true);
    expect(drafts[0].answerEvidenceSnippet).toContain("only bold choice on page 1");
    expect(drafts[0].warnings).toEqual([]);
    expect(notes[0]).toContain("3 answer keys were read from bold choices");
  });

  it("leaves every question unkeyed when the document bolds several choices", async () => {
    const pdf = makePdf(boldHandout(true));
    const read = await (await import("./extractText")).extractPdfText(pdf.slice(0), await legacy(), WORKER);
    const { drafts } = parsePdfQuestions(read.text, read.pages);
    expect(await proposePdfEmphasisAnswers(pdf, drafts, await legacy(), WORKER)).toEqual([]);
    expect(drafts.every((draft) => !draft.correctKey)).toBe(true);
  });
});

describe("trusting a document's emphasis convention", () => {
  const bolded = QUESTIONS.map((question) => set(1, question.stem, question.choices.map((choice, index) => [choice, { bold: index === question.key }])));

  it("needs at least three sets that each mark one choice", () => {
    const drafts = draftsFor(QUESTIONS.slice(0, 2));
    expect(applyEmphasisAnswers(drafts, bolded.slice(0, 2)).keyed).toBe(0);
    expect(drafts.every((draft) => !draft.correctKey)).toBe(true);
  });

  it("keys the unanswered printing from the printing that marks the answer", () => {
    const plain = QUESTIONS.map((question) => set(1, question.stem, question.choices.map((choice) => [choice])));
    const drafts = draftsFor();
    expect(applyEmphasisAnswers(drafts, [...plain, ...bolded]).keyed).toBe(3);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "A", "C"]);
  });

  it("requires one consistent highlight colour", () => {
    const colours = ["#00ff00", "#ff0000", "#0000ff"];
    const recoloured = QUESTIONS.map((question, number) => set(2, question.stem, question.choices.map((choice, index) => [choice, { color: index === question.key ? colours[number] : "#adadad" }])));
    expect(applyEmphasisAnswers(draftsFor(), recoloured).keyed).toBe(0);
    const consistent = QUESTIONS.map((question) => set(2, question.stem, question.choices.map((choice, index) => [choice, { color: index === question.key ? "#00ff00" : "#adadad" }])));
    const drafts = draftsFor();
    const result = applyEmphasisAnswers(drafts, consistent);
    expect(result.accepted).toEqual(["color"]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "A", "C"]);
    expect(drafts[0].answerEvidenceSnippet).toContain("only differently coloured choice on page 2");
  });

  it("does not trust marks that contradict the keys the document prints", () => {
    const drafts = draftsFor(QUESTIONS, ["D", "D", "D"]);
    const result = applyEmphasisAnswers(drafts, bolded);
    expect(result.accepted).toEqual([]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["D", "D", "D"]);
    expect(drafts.some((draft) => draft.parserRuleIds?.includes("conflict.pdf-emphasis"))).toBe(false);
  });

  it("does not let keys inferred from explanation prose veto the marks, but flags them", () => {
    const drafts = draftsFor(QUESTIONS, ["D", "A", "D"]);
    drafts[0].parserRuleIds = ["answer.explanation-text-match"];
    drafts[2].parserRuleIds = ["answer.explanation-text-match"];
    const result = applyEmphasisAnswers(drafts, bolded);
    expect(result.accepted).toEqual(["bold"]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["D", "A", "D"]);
    expect(drafts.map((draft) => draft.parserRuleIds?.includes("conflict.pdf-emphasis") ?? false)).toEqual([true, false, true]);
  });

  it("flags the one printed key that disputes an otherwise consistent convention", () => {
    const many = Array.from({ length: 24 }, (_, number) => ({
      stem: `Question stem number ${number} asks which listed structure is involved here?`,
      choices: [`Structure ${number} alpha`, `Structure ${number} beta`, `Structure ${number} gamma`], key: number % 3,
    }));
    const drafts = draftsFor(many, many.map((question, number) => number === 4 ? "C" : letter(question.key)));
    const marks = many.map((question) => set(1, question.stem, question.choices.map((choice, index) => [choice, { bold: index === question.key }])));
    const result = applyEmphasisAnswers(drafts, marks);
    expect(conventionHolds(result.tallies[0])).toBe(true);
    expect(result.conflicts).toBe(1);
    expect(drafts[4].parserRuleIds).toContain("conflict.pdf-emphasis");
    expect(drafts[4].needsReview).toBe(true);
    expect(drafts[5].parserRuleIds).not.toContain("conflict.pdf-emphasis");
  });

  it("tells identical choice lists apart by the words printed above them", () => {
    const generic = ["Increased", "Decreased", "Unchanged"];
    const questions = [
      { stem: "What happens to preload when venous return rises sharply?", choices: generic, key: 0 },
      { stem: "What happens to afterload when systemic resistance falls?", choices: generic, key: 1 },
      { stem: "What happens to stroke volume in a well trained athlete at rest?", choices: generic, key: 0 },
      { stem: "What happens to heart rate with vagal stimulation at the SA node?", choices: generic, key: 1 },
    ];
    const marks = questions.map((question) => set(1, question.stem, question.choices.map((choice, index) => [choice, { bold: index === question.key }])));
    const drafts = draftsFor(questions);
    applyEmphasisAnswers(drafts, marks);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["A", "B", "A", "B"]);
  });
});
