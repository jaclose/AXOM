import { describe, expect, it } from "vitest";
import { parsePdfQuestions } from "./pdfQuestionImport";
import { parseQuestionBlocks } from "./questionParse";

// Invented teaching content. No real course material is used in tests.
const slide = (...lines: string[]) => lines.join("\n");

const STEMS = [
  ["A 54-year-old man has crushing chest pain that spreads to his left arm.", "His electrocardiogram shows ST elevation in leads II, III and aVF.", "Which coronary artery is most likely blocked?"],
  ["A 23-year-old woman has a fever, a new murmur and painful spots on her fingertips.", "Blood cultures grow gram-positive cocci in clusters.", "Which valve is most likely infected?"],
  ["A 67-year-old man faints while climbing a flight of stairs.", "He has a harsh systolic murmur that spreads to the neck.", "What is the most likely diagnosis?"],
];
const OPTIONS = [
  ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main", "E. Posterior descending"],
  ["A. Aortic valve", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve", "E. No valve at all"],
  ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Hypertrophic cardiomyopathy", "D. Atrial septal defect", "E. Pulmonary stenosis"],
];
const ADDED = [
  "Inferior infarcts usually come from the right coronary artery.",
  "Injection drug use seeds the tricuspid valve from the venous side.",
  "Exertional syncope with an ejection murmur points to aortic stenosis.",
];
const question = (index: number, numbered = true) => slide(`${numbered ? `${index + 1}. ` : ""}${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]);
const answer = (index: number, numbered = true) => slide(question(index, numbered), ADDED[index]);
const read = (pages: string[]) => parsePdfQuestions(pages.join("\n\n"), pages);

describe("parsePdfQuestions", () => {
  it("reads a deck that prints each question twice as one question each, on its own page", () => {
    const pages = ["Cardiology review", question(0), answer(0), question(1), answer(1), question(2), answer(2)];
    // Running text reads the same deck as six questions with clashing numbers.
    expect(parseQuestionBlocks(pages.join("\n\n"))).toHaveLength(6);

    const result = read(pages);
    expect(result.deck).toMatchObject({ questions: 3, repeated: 3, paired: true, otherSlides: 1 });
    expect(result.drafts.map((draft) => [draft.sourcePage, draft.options.length, draft.explanationSourcePage])).toEqual([[2, 5, 3], [4, 5, 5], [6, 5, 7]]);
    expect(result.drafts[0].stem).toBe(STEMS[0].join(" "));
    expect(result.drafts[0].explanation).toBe(ADDED[0]);
    expect(result.deckPages?.map((entry) => entry.kind)).toEqual(["other", "question", "answer", "question", "answer", "question", "answer"]);
    expect(result.notes[0]).toBe("Read slide by slide: 3 questions, one to a slide, 3 printed again on an answer slide. 1 slide with no question was left out (page 1).");
  });

  it("leaves the answer unresolved when the deck gives none in its text", () => {
    const result = read([question(0), answer(0), question(1), answer(1), question(2), answer(2)]);
    expect(result.drafts.every((draft) => draft.correctKey === undefined)).toBe(true);
    expect(result.notes.join(" ")).toMatch(/3 questions have no answer in the text\. A deck that marks the answer only by colour or bold cannot be read for it/);
  });

  it("reads an answer the deck writes out, and says which page it is on", () => {
    const pages = [question(0), answer(0), slide("Answer: C", "The right coronary artery supplies the inferior wall."), question(1), answer(1), question(2), answer(2)];
    const [first, second] = read(pages).drafts;
    expect(first).toMatchObject({ correctKey: "C", answerEvidencePage: 3, sourcePage: 1 });
    expect(first.explanation).toContain("supplies the inferior wall");
    expect(second.correctKey).toBeUndefined();
  });

  it("reads a tick on the answer slide as the answer, and takes it off the option", () => {
    const ticked = slide(`1. ${STEMS[0][0]}`, ...STEMS[0].slice(1), ...OPTIONS[0].map((option, index) => (index === 2 ? `${option} ✓` : option)));
    const [first] = read([question(0), ticked, question(1), answer(1), question(2), answer(2)]).drafts;
    expect(first).toMatchObject({ correctKey: "C", answerEvidencePage: 2 });
    expect(first.options.map((option) => option.text)).toEqual(OPTIONS[0].map((option) => option.slice(3)));
  });

  it("reads an unnumbered deck slide by slide, where running text finds one question", () => {
    const pages = ["Cardiology review", question(0, false), question(1, false), question(2, false)];
    expect(parseQuestionBlocks(pages.join("\n\n")).filter((draft) => draft.options.length >= 2)).toHaveLength(1);
    const result = read(pages);
    expect(result.deck).toMatchObject({ questions: 3, repeated: 0, paired: false });
    expect(result.drafts.map((draft) => draft.sourcePage)).toEqual([2, 3, 4]);
    expect(result.notes).toContain("Questions are numbered in slide order: the deck does not number every question, or starts its numbering again.");
  });

  it("applies an answer key in slide order only when it lists one answer for each question", () => {
    const key = slide("Answers", "1. C", "2. D", "3. A");
    const matched = read([question(0, false), question(1, false), question(2, false), key]);
    expect(matched.drafts.map((draft) => [draft.correctKey, draft.answerEvidencePage])).toEqual([["C", 4], ["D", 4], ["A", 4]]);
    expect(matched.notes.join(" ")).toMatch(/matched to the questions in slide order, because the slides are not numbered/);

    const short = read([question(0, false), question(1, false), question(2, false), slide("Answers", "1. C", "2. D", "4. A")]);
    expect(short.drafts.every((draft) => draft.correctKey === undefined)).toBe(true);
    expect(short.notes.join(" ")).toMatch(/An answer key was found on page 4, but it could not be matched/);
  });

  it("lets running text stand for a numbered document with one question to a page, and fills in its pages", () => {
    const pages = [question(0), question(1), question(2), slide("Answers", "1. C", "2. D", "3. A")];
    const result = read(pages);
    expect(result.deck).toBeUndefined();
    expect(result.notes).toEqual([]);
    expect(result.drafts.map((draft) => [draft.correctKey, draft.sourcePage])).toEqual([["C", 1], ["D", 2], ["A", 3]]);
    expect(result.deckPages?.map((entry) => entry.kind)).toEqual(["question", "question", "question", "answer-key"]);
  });

  it("reads a page of several questions as running text", () => {
    const pages = [slide(question(0), question(1)), question(2)];
    const result = read(pages);
    expect(result.deck).toBeUndefined();
    expect(result.deckPages).toBeUndefined();
    expect(result.drafts).toHaveLength(3);
  });

  it("flags a question whose slide leaves its boundaries to judgement", () => {
    const flipped = (index: number) => slide(...OPTIONS[index], ...STEMS[index]);
    const result = read([flipped(0), flipped(1), flipped(2)]);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts.every((draft) => draft.needsReview)).toBe(true);
    expect(result.drafts[0].warnings.join(" ")).toMatch(/On page 1 the answer options are drawn before the question text/);
    expect(result.drafts[0].stem).toBe(STEMS[0].join(" "));
  });

  it("reads the same file the same way every time", () => {
    const pages = ["Cardiology review", question(0), answer(0), question(1), answer(1), question(2), answer(2)];
    expect(read(pages)).toEqual(read(pages));
  });
});
