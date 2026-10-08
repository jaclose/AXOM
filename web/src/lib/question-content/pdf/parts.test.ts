// Invented teaching content throughout.
import { describe, expect, it } from "vitest";
import { parsePdfQuestions } from "../../pdfQuestionImport";
import { parseAnswerSections } from "../../questionParse";
import { ANSWER_SECTION_HEADING, splitParts } from "./parts";

const question = (number: number, stem: string, choices: string[], answer?: string): string[] => [
  `${number}. ${stem}`,
  ...choices.map((choice, index) => `${"ABCDE"[index]}. ${choice}`),
  ...(answer ? [`Answer: ${answer}`, "Explanation: This is the reason given in the source."] : []),
];

const CARDIO = [
  ...question(1, "Which chamber pumps blood into the pulmonary trunk?", ["Left atrium", "Right ventricle", "Left ventricle", "Right atrium"]),
  ...question(2, "Which valve lies between the left atrium and the left ventricle?", ["Tricuspid valve", "Pulmonary valve", "Mitral valve", "Aortic valve"]),
  ...question(3, "Which vessel returns blood from the lungs to the heart?", ["Pulmonary vein", "Pulmonary artery", "Aorta", "Coronary sinus"]),
];
const RENAL = [
  ...question(1, "Which part of the nephron filters the blood?", ["Glomerulus", "Loop of Henle", "Collecting duct", "Distal tubule"], "A"),
  ...question(2, "Which hormone makes the collecting duct take up water?", ["Aldosterone", "Renin", "Vasopressin", "Calcitriol"], "C"),
];
const KEY = ["1. Answer: B", "The right ventricle fills the pulmonary trunk.", "2. Answer: C", "The mitral valve has two leaflets.", "3. Answer: A", "Four pulmonary veins enter the left atrium."];

const keysOf = (pages: string[]): (string | undefined)[] => parsePdfQuestions(pages.join("\n\n"), pages).drafts.map((draft) => draft.correctKey);

describe("a file with more than one set of questions", () => {
  it("leaves a file with one set exactly as it came", () => {
    const pages = [CARDIO.slice(0, 10).join("\n"), CARDIO.slice(10).join("\n")];
    expect(splitParts(pages)).toEqual([{ pages }]);
  });

  it("splits where the numbering goes back to 1, and puts each set's heading with its own set", () => {
    const pages = [["Cardiology", ...CARDIO].join("\n"), ["Renal physiology", ...RENAL].join("\n")];
    const parts = splitParts(pages);
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.title)).toEqual(["Cardiology", "Renal physiology"]);
    expect(parts[0].pages).toEqual([["Cardiology", ...CARDIO].join("\n"), ""]);
    expect(parts[1].pages).toEqual(["", ["Renal physiology", ...RENAL].join("\n")]);
  });

  it("keeps a heading printed on the page before with the set it heads, not as the tail of the last choice", () => {
    const pages = [[...CARDIO, "Renal physiology"].join("\n"), RENAL.join("\n")];
    const parts = splitParts(pages);
    expect(parts[0].pages[0].endsWith("D. Coronary sinus")).toBe(true);
    expect(parts[1].pages).toEqual(["Renal physiology", RENAL.join("\n")]);
  });

  it("does not split on a numbered list inside a stem, which has no choices of its own", () => {
    const pages = [[
      "1. A study follows these steps:", "1. Recruit the cohort", "2. Measure exposure", "Which design is this?", "A. Cohort study", "B. Case series", "C. Trial",
      ...question(2, "Which measure compares two risks?", ["Odds", "Relative risk", "Prevalence"]),
    ].join("\n")];
    expect(splitParts(pages)).toHaveLength(1);
  });

  it("gives a separate answer section to the one set it fits, and the parser then reads each set's own answers", () => {
    const pages = [CARDIO.join("\n"), [...RENAL, "Answers and brief explanations:", "Cardiology", ...KEY].join("\n")];
    const parts = splitParts(pages);
    expect(parts).toHaveLength(2);
    // The section left the set it is printed after, and nothing of it stays behind.
    expect(parts[1].pages[1]).toBe(RENAL.join("\n"));
    expect(parts[0].pages[1].split("\n")[2]).toBe(ANSWER_SECTION_HEADING);
    expect(parts[0].pages[1]).toContain(KEY.join("\n"));
    expect(parts[0].answerSectionNote).toMatch(/only set it fits/);
    expect(keysOf(parts[0].pages)).toEqual(["B", "C", "A"]);
    expect(keysOf(parts[1].pages)).toEqual(["A", "C"]);
  });

  it("read as one stream, the same file gives the first set no answers: the reason the split exists", () => {
    const pages = [CARDIO.join("\n"), [...RENAL, "Answers and brief explanations:", "Cardiology", ...KEY].join("\n")];
    const whole = parsePdfQuestions(pages.join("\n\n"), pages).drafts;
    expect(whole.filter((draft) => draft.questionNumber !== undefined && draft.correctKey === undefined).length).toBeGreaterThan(0);
  });

  it("applies a section to neither set when it could belong to both", () => {
    const other = [
      ...question(1, "Which bone forms the forehead?", ["Frontal", "Parietal", "Occipital", "Temporal"]),
      ...question(2, "Which bone holds the lower teeth?", ["Maxilla", "Mandible", "Vomer", "Zygomatic"]),
      ...question(3, "Which bone forms the back of the skull?", ["Frontal", "Parietal", "Occipital", "Sphenoid"]),
    ];
    const parts = splitParts([CARDIO.join("\n"), [...other, "Answers", ...KEY].join("\n")]);
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.pages.join("\n")).join("\n")).not.toContain("Answer: B");
    expect(parts[1].answerSectionNote).toMatch(/more than one set/);
    expect(keysOf(parts[0].pages)).toEqual([undefined, undefined, undefined]);
    expect(keysOf(parts[1].pages)).toEqual([undefined, undefined, undefined]);
  });

  it("applies a section to no set when its numbers match none", () => {
    const parts = splitParts([CARDIO.join("\n"), [...RENAL, "Answers", ...KEY, "4. Answer: D", "A fourth entry no set has a question for."].join("\n")]);
    expect(parts.map((part) => part.pages.join("\n")).join("\n")).not.toContain("4. Answer: D");
    expect(parts[1].answerSectionNote).toMatch(/matches no set/);
    expect(keysOf(parts[0].pages)).toEqual([undefined, undefined, undefined]);
    expect(keysOf(parts[1].pages)).toEqual(["A", "C"]);
  });

  it("cuts out a key in any other shape that is printed after the last set while an earlier set has no answers", () => {
    const later = [
      ...question(1, "Which bone forms the forehead?", ["Frontal", "Parietal", "Occipital", "Temporal"]),
      ...question(2, "Which bone holds the lower teeth?", ["Maxilla", "Mandible", "Vomer", "Zygomatic"]),
    ];
    // The parser would read this as the last set's key. Nothing says whose it is.
    const pages = [CARDIO.join("\n"), [...later, "Answer Key", "1. B", "2. C"].join("\n")];
    expect(keysOf([later.join("\n"), ["Answer Key", "1. B", "2. C"].join("\n")])).toEqual(["B", "C"]);
    const parts = splitParts(pages);
    expect(parts[1].pages[1]).toBe(later.join("\n"));
    expect(parts[1].answerSectionNote).toMatch(/could belong to more than one set/);
    expect(keysOf(parts[1].pages)).toEqual([undefined, undefined]);
  });

  it("leaves such a key with the last set when every earlier set has answers of its own", () => {
    const first = [
      ...question(1, "Which chamber pumps blood into the aorta?", ["Left atrium", "Right ventricle", "Left ventricle"], "C"),
      ...question(2, "Which valve guards the pulmonary trunk?", ["Tricuspid valve", "Pulmonary valve", "Mitral valve"], "B"),
    ];
    const later = [
      ...question(1, "Which bone forms the forehead?", ["Frontal", "Parietal", "Occipital", "Temporal"]),
      ...question(2, "Which bone holds the lower teeth?", ["Maxilla", "Mandible", "Vomer", "Zygomatic"]),
    ];
    const parts = splitParts([first.join("\n"), [...later, "Answer Key", "1. A", "2. B"].join("\n")]);
    expect(keysOf(parts[0].pages)).toEqual(["C", "B"]);
    expect(keysOf(parts[1].pages)).toEqual(["A", "B"]);
  });

  it("in a file with one set, rewords a heading the parser does not know and changes nothing else", () => {
    const pages = [CARDIO.join("\n"), ["Answers with short notes", ...KEY].join("\n")];
    expect(keysOf(pages)).toEqual([undefined, undefined, undefined]);
    const parts = splitParts(pages);
    expect(parts).toHaveLength(1);
    expect(parts[0].pages[0]).toBe(pages[0]);
    expect(parts[0].pages[1]).toBe(["", ANSWER_SECTION_HEADING, ...KEY].join("\n"));
    expect(keysOf(parts[0].pages)).toEqual(["B", "C", "A"]);
  });

  it("uses a heading the parser itself reads as an answer section", () => {
    expect(parseAnswerSections(`\n${ANSWER_SECTION_HEADING}\n${KEY.join("\n")}`).entries.size).toBe(3);
  });
});
