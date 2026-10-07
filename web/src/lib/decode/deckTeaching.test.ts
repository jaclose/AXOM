import { describe, expect, it } from "vitest";
import { classifyDeckPages } from "../deckPages";
import type { SourceDocument } from "../library";
import { parsePdfQuestions } from "../pdfQuestionImport";
import type { QuestionRecord } from "../questions";
import { normalizeQuestionAnalyses } from "./normalize";
import { analysisIsCurrent, questionSourceFingerprint } from "./analysis";
import { readSlideTeaching, sourceTeachingProposals } from "./deckTeaching";

// Invented teaching content. No real course material is used in tests.
const slide = (...lines: string[]) => lines.join("\n");
const NOW = "2026-10-07T12:00:00.000Z";

const STEMS = [
  ["A 54-year-old man has crushing chest pain that spreads to his left arm.", "His electrocardiogram shows ST elevation in leads II, III and aVF.", "Which coronary artery is most likely blocked?"],
  ["A 23-year-old woman has a fever, a new murmur and painful spots on her fingertips.", "Blood cultures grow gram-positive cocci in clusters.", "Which valve is most likely infected?"],
  ["A 67-year-old man faints while climbing a flight of stairs.", "He has a harsh systolic murmur that spreads to the neck.", "What is the most likely diagnosis?"],
];
const OPTIONS = [
  ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main"],
  ["A. Aortic valve", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve"],
  ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Hypertrophic cardiomyopathy", "D. Atrial septal defect"],
];
const KEYS = ["C", "D", "A"];
const questionSlide = (index: number) => slide(`${index + 1}. ${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]);
const answerSlide = (index: number, ...added: string[]) => slide(questionSlide(index), ...added);

const TEACHING = [
  slide("Inferior wall infarction", "WHY IT'S RIGHT", "Leads II, III and aVF look at the inferior wall,", "which the right coronary artery supplies in most people.",
    "WHY NOT THE OTHERS", "A. The left anterior descending supplies the anterior wall:", "expect changes in V1 to V4.", "B. The circumflex supplies the lateral wall.", "D. Left main disease gives widespread changes.",
    "HIGH-YIELD", "Match the leads to the wall, then the wall to the artery.", "LECTURE 12 · Coronary circulation"),
  slide("Right-sided endocarditis", "W H Y  I T ’ S  R I G H T", "Injected organisms reach the tricuspid valve first.",
    "W H Y  N O T  T H E  O T H E R S", "A Aortic disease is left sided and embolises to the body.", "B Mitral disease follows rheumatic damage.",
    "C A R R Y  T H I S", "Venous entry, right-sided valve."),
  slide("Exertional syncope with an ejection murmur points to aortic stenosis.", "The murmur spreads to the neck because the jet is aimed at the aorta."),
];

const pages = ["Cardiology review", questionSlide(0), answerSlide(0), TEACHING[0], questionSlide(1), answerSlide(1), TEACHING[1], questionSlide(2), answerSlide(2), TEACHING[2]];
const document: SourceDocument = {
  id: "doc-1", title: "Cardiology review", fileName: "cardiology-review.pdf", fileType: "pdf", uploadedAt: "2026-10-01T09:00:00.000Z",
  rawText: pages.join("\n\n"), pageTexts: pages, sizeBytes: 1000, checksum: "checksum-1", tags: [], linkedQuestionSetIds: [], libraryOnly: false,
};
const questionPage = [2, 5, 8];
const imported = (index: number, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: `q-${index + 1}`, source: "pdf", stem: STEMS[index].join(" "),
  options: OPTIONS[index].map((line) => ({ key: line[0], text: line.slice(3) })),
  correctKey: KEYS[index], status: "unseen", tags: [], attempts: [],
  sourceDocumentId: "doc-1", sourcePage: questionPage[index], questionNumber: index + 1,
  createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...patch,
});
const questions = [imported(0), imported(1), imported(2)];

describe("the fixture is a deck the slide reader recognises", () => {
  it("has a question, an answer and an explanation slide for each question", () => {
    expect(classifyDeckPages(pages).map((entry) => entry.kind)).toEqual([
      "other", "question", "answer", "explanation", "question", "answer", "explanation", "question", "answer", "explanation",
    ]);
  });
});

describe("teaching read from a deck's own slides", () => {
  it("reads why the answer is right, why each other option is not, the rule and the lecture", () => {
    const [first] = sourceTeachingProposals(document, questions, NOW);
    expect(first).toMatchObject({
      id: "source-q-1", questionId: "q-1", origin: "source", status: "proposed", version: 1,
      concept: "Inferior wall infarction",
      explanation: "Leads II, III and aVF look at the inferior wall, which the right coronary artery supplies in most people.",
      rule: "Match the leads to the wall, then the wall to the artery.",
      lecture: "LECTURE 12 · Coronary circulation",
      generatedAt: NOW,
    });
    expect(first.distractors).toEqual([
      { key: "A", whyWrong: "The left anterior descending supplies the anterior wall: expect changes in V1 to V4." },
      { key: "B", whyWrong: "The circumflex supplies the lateral wall." },
      { key: "D", whyWrong: "Left main disease gives widespread changes." },
    ]);
    expect(first.references).toEqual([
      { documentId: "doc-1", page: 2, role: "question" }, { documentId: "doc-1", page: 3, role: "answer" }, { documentId: "doc-1", page: 4, role: "teaching" },
    ]);
  });

  it("reads titles set in spaced capitals, and option notes without a full stop after the letter", () => {
    const second = sourceTeachingProposals(document, questions, NOW)[1];
    expect(second).toMatchObject({ questionId: "q-2", concept: "Right-sided endocarditis", rule: "Venous entry, right-sided valve." });
    expect(second.distractors.map((note) => note.key)).toEqual(["A", "B"]);
  });

  it("offers nothing where the slides only add prose: that is already the question's explanation", () => {
    expect(sourceTeachingProposals(document, questions, NOW).map((analysis) => analysis.questionId)).toEqual(["q-1", "q-2"]);
  });

  it("makes proposals that fit their question, pass storage, and are not yet teaching", () => {
    const proposals = sourceTeachingProposals(document, questions, NOW);
    expect(normalizeQuestionAnalyses(proposals)).toHaveLength(2);
    expect(analysisIsCurrent(proposals[0], questions[0], document)).toBe(true);
    expect(proposals[0].sourceFingerprint).toBe(questionSourceFingerprint(questions[0], document));
    expect(proposals.every((analysis) => analysis.status === "proposed")).toBe(true);
  });

  it("leaves alone a question whose source analysis the learner already has in hand", () => {
    const [first] = sourceTeachingProposals(document, questions, NOW);
    for (const status of ["reviewed", "rejected", "proposed"] as const) {
      const held = [{ ...questions[0], analyses: [{ ...first, status }] }, questions[1]];
      expect(sourceTeachingProposals(document, held, NOW).map((analysis) => analysis.questionId)).toEqual(["q-2"]);
    }
    // Once the question changes, the old analysis no longer fits and the deck is read again.
    const corrected = { ...questions[0], correctKey: "A", analyses: [{ ...first, status: "reviewed" as const }] };
    expect(sourceTeachingProposals(document, [corrected], NOW).map((analysis) => analysis.questionId)).toEqual(["q-1"]);
  });

  it("offers nothing for a question it cannot place: another source, no page, or two on one page", () => {
    expect(sourceTeachingProposals(document, [imported(0, { sourceDocumentId: "doc-2" })], NOW)).toEqual([]);
    expect(sourceTeachingProposals(document, [imported(0, { sourcePage: undefined })], NOW)).toEqual([]);
    expect(sourceTeachingProposals(document, [imported(0), imported(1, { sourcePage: 2 })], NOW)).toEqual([]);
    expect(sourceTeachingProposals({ ...document, pageTexts: undefined }, questions, NOW)).toEqual([]);
    expect(sourceTeachingProposals({ ...document, pageTexts: ["One page of running text with no questions on it."] }, questions, NOW)).toEqual([]);
  });
});

describe("a deck that is imported and then read for its teaching", () => {
  it("gives each imported question its page and key, and its teaching by that page", () => {
    // The same deck with a written answer line on each answer slide, as the PDF importer would see it.
    const answered = [pages[0], questionSlide(0), answerSlide(0, "Answer: C"), TEACHING[0], questionSlide(1), answerSlide(1, "Answer: D"), TEACHING[1], questionSlide(2), answerSlide(2, "Answer: A"), TEACHING[2]];
    const read = parsePdfQuestions(answered.join("\n\n"), answered);
    expect(read.deck).toMatchObject({ questions: 3, paired: true });
    expect(read.drafts.map((draft) => [draft.sourcePage, draft.correctKey])).toEqual([[2, "C"], [5, "D"], [8, "A"]]);

    const stored = { ...document, pageTexts: answered };
    const saved = read.drafts.map((draft, index): QuestionRecord => ({
      id: `q-${index + 1}`, source: "pdf", stem: draft.stem, options: draft.options, correctKey: draft.correctKey, explanation: draft.explanation,
      status: "unseen", tags: [], attempts: [], sourceDocumentId: "doc-1", sourcePage: draft.sourcePage,
      createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
    }));
    const proposals = sourceTeachingProposals(stored, saved, NOW);
    expect(proposals.map((analysis) => [analysis.questionId, analysis.rule])).toEqual([
      ["q-1", "Match the leads to the wall, then the wall to the artery."],
      ["q-2", "Venous entry, right-sided valve."],
    ]);
    // The importer's explanation for the first question came from the same slide: it is not stored twice.
    expect(proposals[0].distractors.map((note) => note.key)).toEqual(["A", "B", "D"]);
  });
});

describe("reading the sections of a teaching slide", () => {
  const question = { options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }], correctKey: "B" };
  const read = (kind: "answer" | "explanation", ...lines: string[]) => readSlideTeaching([{ page: 1, kind, lines }], question);

  it("never takes the answer, or a letter the question does not have, as a distractor", () => {
    const teaching = read("explanation", "WHY NOT THE OTHERS", "A. Alpha is the precursor.", "B. Beta is in fact the answer.", "E. There is no option E.", "C. Gamma is the antagonist.");
    expect(teaching.distractors).toEqual([{ key: "A", whyWrong: "Alpha is the precursor." }, { key: "C", whyWrong: "Gamma is the antagonist." }]);
  });

  it("reads two columns under one line of titles", () => {
    const teaching = read("explanation", "Beta blockade", "WHY IT'S RIGHT WHY NOT THE OTHERS", "Beta slows the heart.", "A Alpha constricts vessels.", "C Gamma has no cardiac effect.", "HOOK: Beta for the beat.");
    expect(teaching).toMatchObject({ concept: "Beta blockade", explanation: "Beta slows the heart.", rule: "Beta for the beat." });
    expect(teaching.distractors.map((note) => note.key)).toEqual(["A", "C"]);
  });

  it("does not mistake a sentence that opens with a common word for a section title", () => {
    const teaching = read("explanation", "Why does the rate fall? Because the node is slowed.", "Answer the question that was asked.", "The others would agree.");
    expect(teaching).toEqual({ distractors: [] });
  });

  it("takes a single common word as a title when it stands alone, has a colon, or is in capitals", () => {
    expect(read("explanation", "Why", "The node is slowed.").explanation).toBe("The node is slowed.");
    expect(read("explanation", "Explanation: the node is slowed.").explanation).toBe("the node is slowed.");
    expect(read("explanation", "HOOK Beta for the beat.").rule).toBe("Beta for the beat.");
  });

  it("reads nothing above the first title of an answer slide, where the question is printed again", () => {
    const teaching = read("answer", "Which drug slows the heart?", "A. Alpha", "B. Beta", "C. Gamma", "HIGH-YIELD", "Beta for the beat.");
    expect(teaching).toEqual({ rule: "Beta for the beat.", distractors: [] });
  });

  it("drops a question label, skips sections it does not teach from, and reads no answer", () => {
    const teaching = read("explanation", "Q12 · Rate control", "ANSWER", "B · Beta", "IF THE STEM CHANGES", "With asthma, choose another drug.", "CARRY THIS", "Beta for the beat.", "DLA 3 Cardiac pharmacology");
    expect(teaching).toEqual({ concept: "Rate control", rule: "Beta for the beat.", distractors: [], lecture: "DLA 3 Cardiac pharmacology" });
  });
});
