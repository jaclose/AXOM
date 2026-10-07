import { describe, expect, it } from "vitest";
import { classifyDeckPages, readSlideDeck } from "./deckPages";

// Invented teaching content. No real course material is used in tests.
const slide = (...lines: string[]) => lines.join("\n");

const STEMS = [
  ["A 54-year-old man has crushing chest pain that spreads to his left arm.", "His electrocardiogram shows ST elevation in leads II, III and aVF.", "Which coronary artery is most likely blocked?"],
  ["A 23-year-old woman has a fever, a new murmur and painful spots on her fingertips.", "Blood cultures grow gram-positive cocci in clusters.", "Which valve is most likely infected?"],
  ["A 67-year-old man faints while climbing a flight of stairs.", "He has a harsh systolic murmur that spreads to the neck.", "What is the most likely diagnosis?"],
  ["A 9-year-old girl has joint pain two weeks after a sore throat.", "She has a new murmur and a pink rash with clear centres.", "Which organism caused the first infection?"],
];
const OPTIONS = [
  ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main", "E. Posterior descending"],
  ["A. Aortic valve", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve", "E. No valve at all"],
  ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Hypertrophic cardiomyopathy", "D. Atrial septal defect", "E. Pulmonary stenosis"],
  ["A. Staphylococcus aureus", "B. Group A streptococcus", "C. Coxsackie virus", "D. Enterococcus", "E. Candida albicans"],
];
const ADDED = [
  "Inferior infarcts usually come from the right coronary artery.",
  "Injection drug use seeds the tricuspid valve from the venous side.",
  "Exertional syncope with an ejection murmur points to aortic stenosis.",
  "Rheumatic fever follows pharyngitis with group A streptococcus.",
];

const question = (index: number, numbered = true) => slide(`${numbered ? `${index + 1}. ` : ""}${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]);
const answer = (index: number, numbered = true) => slide(question(index, numbered), ADDED[index]);
const kinds = (pages: string[]) => classifyDeckPages(pages).map((entry) => entry.kind);

describe("classifyDeckPages", () => {
  it("tells question slides from the answer slides that print them again", () => {
    const pages = ["Cardiology review", question(0), answer(0), question(1), answer(1), question(2), answer(2)];
    expect(kinds(pages)).toEqual(["other", "question", "answer", "question", "answer", "question", "answer"]);
    expect(classifyDeckPages(pages)[2]).toMatchObject({ kind: "answer", questionPage: 2 });
  });

  it("recognises an answer slide that breaks the stem in different places", () => {
    const words = STEMS[0].join(" ").split(" ");
    const reflowed = slide(`1. ${words.slice(0, 7).join(" ")}`, words.slice(7, 19).join(" "), words.slice(19).join(" "), ...OPTIONS[0], ADDED[0]);
    expect(kinds([question(0), reflowed])).toEqual(["question", "answer"]);
  });

  it("pairs answers that come in a later section, not on the next slide", () => {
    const pages = ["Cardiology review", question(0), question(1), question(2), "Answers", answer(0), answer(1), answer(2)];
    const classified = classifyDeckPages(pages);
    expect(classified.map((entry) => entry.kind)).toEqual(["other", "question", "question", "question", "other", "answer", "answer", "answer"]);
    expect(classified.slice(5).map((entry) => entry.questionPage)).toEqual([2, 3, 4]);
  });

  it("keeps two questions on one vignette apart", () => {
    const vignette = ["A 30-year-old woman has palpitations, weight loss and a fine tremor.", "Her thyroid is enlarged and smooth, and her eyes are prominent."];
    const first = slide(...vignette, "Which test should be ordered first?", "A. Thyroid stimulating hormone", "B. Free thyroxine", "C. Thyroid ultrasound");
    const second = slide(...vignette, "Which drug gives the fastest relief of her symptoms?", "A. Propranolol", "B. Methimazole", "C. Radioactive iodine");
    expect(kinds([first, second])).toEqual(["question", "question"]);
  });

  it("reads an explanation slide after its question, and not a bare section title", () => {
    const explanation = slide("Answer: C", "Explanation: inferior infarcts usually come from the right coronary artery.");
    expect(kinds([question(0), answer(0), explanation, "Answers", question(1)])).toEqual(["question", "answer", "explanation", "other", "question"]);
  });

  it("takes the slide after an answer slide as its explanation, unless the deck prints that slide over and over", () => {
    const teaching = "The right coronary artery supplies the inferior wall in most people, and the sinus node as well.";
    const stock = slide("Normal values", "Sodium 135 to 145 millimoles per litre", "Potassium 3.5 to 5.0 millimoles per litre");
    expect(kinds([question(0), answer(0), teaching])).toEqual(["question", "answer", "explanation"]);
    expect(kinds([question(0), answer(0), stock, question(1), answer(1), stock, question(2), answer(2), stock]))
      .toEqual(["question", "answer", "other", "question", "answer", "other", "question", "answer", "other"]);
  });

  it("carries a question onto the next slide when its options carry on there", () => {
    const start = slide(`1. ${STEMS[0][0]}`, ...STEMS[0].slice(1), ...OPTIONS[0].slice(0, 3));
    const rest = slide(...OPTIONS[0].slice(3));
    const classified = classifyDeckPages([start, rest]);
    expect(classified.map((entry) => entry.kind)).toEqual(["question", "continuation"]);
    expect(classified[1].questionPage).toBe(1);
  });

  it("joins a slide of question text to the slide of options that follows it", () => {
    const classified = classifyDeckPages([slide(...STEMS[2]), slide(...OPTIONS[2])]);
    expect(classified.map((entry) => entry.kind)).toEqual(["question", "continuation"]);
  });

  it("finds an answer key, and leaves a page with two questions as it is", () => {
    expect(kinds([question(0), slide("Answers", "1. C", "2. D", "3. A")])).toEqual(["question", "answer-key"]);
    expect(classifyDeckPages([slide(question(0), question(1))])[0].evidence).toMatch(/more than one question/);
  });
});

describe("readSlideDeck", () => {
  const paired = ["Cardiology review", question(0), answer(0), question(1), answer(1), question(2), answer(2)];

  it("rebuilds one block per question, with what the answer slide adds as its explanation", () => {
    const deck = readSlideDeck(paired)!;
    expect(deck.paired).toBe(true);
    expect(deck.questions.map((entry) => [entry.questionPage, entry.answerPages])).toEqual([[2, [3]], [4, [5]], [6, [7]]]);
    const blocks = deck.text.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].split("\n")).toEqual([`1. ${STEMS[0].join(" ")}`, ...OPTIONS[0], `Explanation: ${ADDED[0]}`]);
    expect(deck.questions[0].explanationPage).toBe(3);
  });

  it("numbers the questions in slide order when the deck starts its numbering again", () => {
    const restarted = [question(0), answer(0), question(1), answer(1), slide(`1. ${STEMS[2][0]}`, ...STEMS[2].slice(1), ...OPTIONS[2]), slide(`1. ${STEMS[2][0]}`, ...STEMS[2].slice(1), ...OPTIONS[2], ADDED[2])];
    const deck = readSlideDeck(restarted)!;
    expect(deck.ownNumbers).toBe(false);
    expect(deck.text.split("\n\n").map((block) => block.slice(0, 2))).toEqual(["1.", "2.", "3."]);
  });

  it("drops a running header, a numbered label and slide numbers before reading", () => {
    const dressed = paired.map((page, index) => slide("St Elsewhere cardiology", `Question ${index}`, page, String(index + 1)));
    const deck = readSlideDeck(dressed)!;
    expect(deck.runningLinesDropped).toBeGreaterThan(0);
    expect(deck.text).not.toMatch(/St Elsewhere|Question \d/);
    expect(deck.text.split("\n\n")[0].split("\n")[0]).toBe(`1. ${STEMS[0].join(" ")}`);
    expect(deck.questions).toHaveLength(3);
  });

  it("never drops answer options as a running line, even when every question shares them", () => {
    const shared = ["A. Increases", "B. Decreases", "C. Does not change"];
    const ask = (index: number) => slide(...STEMS[index], ...shared);
    const deck = readSlideDeck([ask(0), slide(ask(0), ADDED[0]), ask(1), slide(ask(1), ADDED[1]), ask(2), slide(ask(2), ADDED[2])])!;
    expect(deck.text.split("\n\n").every((block) => shared.every((option) => block.includes(option)))).toBe(true);
  });

  it("keeps a written answer line as the answer and the rest as explanation", () => {
    const explained = [question(0), answer(0), slide("Answer: C", "The right coronary artery supplies the inferior wall."), question(1), answer(1), question(2), answer(2)];
    const deck = readSlideDeck(explained)!;
    const block = deck.text.split("\n\n")[0].split("\n");
    expect(block).toContain("Answer: C");
    expect(block[block.length - 1]).toBe(`Explanation: ${ADDED[0]} The right coronary artery supplies the inferior wall.`);
    expect(deck.questions[0]).toMatchObject({ answerPages: [2], answerLinePage: 3, explanationPages: [3], explanationPage: 2 });
  });

  it("passes on an option the answer slide marks in its text", () => {
    const marked = slide(`1. ${STEMS[0][0]}`, ...STEMS[0].slice(1), ...OPTIONS[0].map((option, index) => (index === 2 ? `${option} ✓` : option)));
    const deck = readSlideDeck([question(0), marked, question(1), answer(1), question(2), answer(2)])!;
    expect(deck.text.split("\n\n")[0]).toContain("C. Right coronary ✓");
    expect(deck.questions[0].answerLinePage).toBe(2);
  });

  it("puts the options of a continued question back together", () => {
    const start = slide(`1. ${STEMS[0][0]}`, ...STEMS[0].slice(1), ...OPTIONS[0].slice(0, 3));
    const deck = readSlideDeck([start, slide(...OPTIONS[0].slice(3)), question(1), question(2), question(3)])!;
    expect(deck.questions[0].continuationPages).toEqual([2]);
    expect(deck.text.split("\n\n")[0].split("\n").slice(1)).toEqual(OPTIONS[0]);
  });

  it("removes a stem the slide prints twice, once wide and once wrapped", () => {
    const doubled = (index: number) => slide(`${index + 1}. ${STEMS[index].join(" ")}`, `${index + 1}. ${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]);
    const deck = readSlideDeck([doubled(0), doubled(1), doubled(2)])!;
    expect(deck.text.split("\n\n").map((block) => block.split("\n")[0])).toEqual(STEMS.slice(0, 3).map((stem, index) => `${index + 1}. ${stem.join(" ")}`));
  });

  it("reads a slide that draws its options before its question text, and says so", () => {
    const flipped = (index: number) => slide(...OPTIONS[index], ...STEMS[index]);
    const deck = readSlideDeck([flipped(0), flipped(1), flipped(2)])!;
    expect(deck.questions.every((entry) => entry.optionsFirst)).toBe(true);
    expect(deck.text.split("\n\n")[1].split("\n")).toEqual([`2. ${STEMS[1].join(" ")}`, ...OPTIONS[1]]);
  });

  it("puts options drawn out of order back in order, and leaves a stray F) in a stem alone", () => {
    const scattered = slide(...STEMS[0], ...OPTIONS[0].slice(3), ...OPTIONS[0].slice(0, 3));
    const fever = slide("A 40-year-old man has a temperature of 39.4 C (102.9", "F) and a productive cough for three days.", "Which organism is the most likely cause?", "A. Streptococcus pneumoniae", "B. Mycoplasma", "C. Legionella", "D. Klebsiella", "E. Influenza virus");
    const deck = readSlideDeck([scattered, fever, question(2)])!;
    expect(deck.questions[0].scattered).toBe(true);
    expect(deck.text.split("\n\n")[0].split("\n").slice(1)).toEqual(OPTIONS[0]);
    expect(deck.questions[1].scattered).toBe(false);
    expect(deck.text.split("\n\n")[1].split("\n")[0]).toContain("F) and a productive cough");
    expect(deck.text.split("\n\n")[1].split("\n")).toHaveLength(6);
  });

  it("adds loose text after the options to the question, and keeps a wrapped option whole", () => {
    const table = slide(...STEMS[0], ...OPTIONS[0], "Troponin 14 nanograms per millilitre", "Creatine kinase 480 units per litre");
    const wrapped = slide(...STEMS[1], "A. Aortic valve,", "on the left side", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve,", "on the right side");
    const deck = readSlideDeck([table, wrapped, question(2)])!;
    expect(deck.questions.map((entry) => entry.looseTail)).toEqual([true, false, false]);
    expect(deck.text.split("\n\n")[0].split("\n")[0]).toBe(`1. ${STEMS[0].join(" ")} Troponin 14 nanograms per millilitre Creatine kinase 480 units per litre`);
    expect(deck.text.split("\n\n")[1].split("\n").slice(-2)).toEqual(["D. Tricuspid valve,", "on the right side"]);
  });

  it("does not let a wrapped line that opens with a number start another question", () => {
    const dose = slide(...STEMS[1], "A. Gentamicin at a dose of", "5.0 milligrams per kilogram", "B. Vancomycin", "C. Ceftriaxone");
    const deck = readSlideDeck([dose, question(0), question(2)])!;
    expect(deck.text.split("\n\n")[0].split("\n")).toContain("A. Gentamicin at a dose of 5.0 milligrams per kilogram");
  });

  it("reads an option list drawn twice as one list", () => {
    const twice = slide(...STEMS[0], ...OPTIONS[0], ...OPTIONS[0]);
    const deck = readSlideDeck([twice, question(1), question(2)])!;
    expect(deck.text.split("\n\n")[0].split("\n").slice(1)).toEqual(OPTIONS[0]);
  });

  it("matches an answer key by the slides' own numbers, or in slide order when it lists exactly one answer each", () => {
    const key = slide("Answers", "1. C", "2. D", "3. A");
    const numbered = readSlideDeck([question(0), question(1), question(2), key])!;
    expect(numbered).toMatchObject({ keyMatch: "numbers", answerKeyPages: [4], keyText: "Answer key\n1. C\n2. D\n3. A" });
    expect(readSlideDeck([question(0, false), question(1, false), question(2, false), key])!.keyMatch).toBe("order");
    const short = readSlideDeck([question(0, false), question(1, false), question(2, false), question(3, false), key])!;
    expect(short.keyMatch).toBeUndefined();
    expect(short.keyText).toBeUndefined();
    expect(short.answerKeyPages).toEqual([5]);
  });

  it("is not a deck when a page holds several questions, or when few pages are questions", () => {
    expect(readSlideDeck([slide(question(0), question(1)), question(2), question(3)])).toBeUndefined();
    const notes = "Heart sounds are made by the valves closing. The first sound is the mitral and tricuspid valves.";
    expect(readSlideDeck([notes, notes.replace("first", "second"), question(0), `${notes} More.`, `${notes} Still more.`])).toBeUndefined();
  });
});
