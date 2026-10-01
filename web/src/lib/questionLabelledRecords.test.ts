import { describe, expect, it } from "vitest";
import { hasLabelledRecords, normalizeLabelledRecords } from "./questionLabelledRecords";
import { parseQuestionBlocks, parseQuestionText } from "./questionParse";

const record = (n: number) => `SOURCE: Sample Quiz 4
QUESTION_NUMBER: ${n}
STEM: A ${60 + n}-year-old man has finding number ${n}.
Which of the following is most likely?
CHOICES:
A. First option ${n}
B. Second option ${n}
C. Third option ${n}
D. Fourth option ${n}
E. Fifth option ${n}
CORRECT_ANSWER: ${"ABC"[n - 1]}
EXPLANATION: Because of reason ${n}.
It continues on a second line.
`;

describe("labelled question records", () => {
  it("splits a labelled file into one question per record, with answer, explanation and source", () => {
    const drafts = parseQuestionBlocks([1, 2, 3].map(record).join("\n"));
    expect(drafts).toHaveLength(3);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["A", "B", "C"]);
    expect(drafts[1]).toMatchObject({
      stem: "A 62-year-old man has finding number 2.\nWhich of the following is most likely?",
      explanation: "Because of reason 2.\nIt continues on a second line.",
      sourceLabel: "Sample Quiz 4",
    });
    expect(drafts.every((draft) => draft.options.length === 5)).toBe(true);
    expect(drafts.some((draft) => /QUESTION_NUMBER|STEM:|SOURCE:/.test(`${draft.stem}${draft.explanation}`))).toBe(false);
  });

  it("reads other spellings, an answer given as text, and records marked only by their stem", () => {
    const text = [1, 2].map((n) => `Stem: Which finding ${n} is most likely?
A) one
B) two
C) three
Correct Answer: B) two
Rationale: reason ${n}
Topic: Renal
`).join("\n");
    const drafts = parseQuestionBlocks(text);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ stem: "Which finding 1 is most likely?", correctKey: "B", explanation: "reason 1", topic: "Renal" });
    expect(drafts[1]).toMatchObject({ stem: "Which finding 2 is most likely?", topic: "Renal" });
  });

  it("reads one labelled record pasted on its own", () => {
    const draft = parseQuestionText(record(1));
    expect(draft.stem.startsWith("A 61-year-old man")).toBe(true);
    expect(draft).toMatchObject({ correctKey: "A", sourceLabel: "Sample Quiz 4" });
  });

  it("leaves ordinary question text exactly as it was", () => {
    const ordinary = `Question 1
A patient has a cough. Which drug is best?
A. One
B. Two
Answer: B
Explanation: Because.
Source: Lecture 4

2. Vitals: BP 120/80. Key: finding is normal?
A. Yes
B. No
Answer: A`;
    expect(hasLabelledRecords(ordinary)).toBe(false);
    expect(normalizeLabelledRecords(ordinary)).toBe(ordinary);
  });

  it("keeps each record's own source when one file holds two quizzes with numbering that starts over", () => {
    const quiz = (source: string, n: number) => record(n).replace("SOURCE: Sample Quiz 4", `SOURCE: ${source}`);
    const drafts = parseQuestionBlocks([quiz("Quiz 4", 1), quiz("Quiz 4", 2), quiz("Quiz 5", 1), quiz("Quiz 5", 2)].join("\n"));
    expect(drafts.map((draft) => `${draft.sourceLabel} #${draft.questionNumber}`)).toEqual(["Quiz 4 #1", "Quiz 4 #2", "Quiz 5 #1", "Quiz 5 #2"]);
    expect(drafts.some((draft) => draft.warnings.some((warning) => /Duplicate question numbers/.test(warning)))).toBe(false);
    expect(drafts.every((draft) => draft.explanation === draft.explanation?.replace(/Quiz \d/, ""))).toBe(true);
  });

  it("is idempotent", () => {
    const once = normalizeLabelledRecords([1, 2].map(record).join("\n"));
    expect(normalizeLabelledRecords(once)).toBe(once);
    expect(once).not.toMatch(/CHOICES:|QUESTION_NUMBER/);
  });
});
