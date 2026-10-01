import { describe, expect, it } from "vitest";
import { parseQuestionBlocks } from "./questionParse";

/** The plain "mapped paste" layout: Question N, choices, then labelled fields. */
const item = (n: number, extra = "") => `Question ${n}
A ${40 + n}-year-old patient has finding ${n}. Which of the following is the most likely cause?

A. Cause one ${n}
B. Cause two ${n}
C. Cause three ${n}
D. Cause four ${n}
E. Cause five ${n}

Answer: ${"ABCDE"[n % 5]}
Explanation: Mechanism ${n} explains the finding.
Review: Renal; Diuretics; Acid base
Attachment: ${n === 2 ? "figure-2.png" : "None"}
${extra}`;

describe("mapped paste: review labels, attachments and source-key warnings", () => {
  it("reads Review as tags and Attachment as the question's image file", () => {
    const drafts = parseQuestionBlocks([1, 2, 3].map((n) => item(n)).join("\n"));
    expect(drafts).toHaveLength(3);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C", "D"]);
    expect(drafts[0]).toMatchObject({ tags: ["Renal", "Diuretics", "Acid base"], explanation: "Mechanism 1 explains the finding." });
    expect(drafts[0].attachmentNames).toBeUndefined();
    expect(drafts[1].attachmentNames).toEqual(["figure-2.png"]);
    expect(drafts.every((draft) => !/Review:|Attachment:/.test(`${draft.stem}${draft.explanation}`))).toBe(true);
    expect(drafts.every((draft) => !draft.needsReview)).toBe(true);
  });

  it("keeps a long review note with the explanation instead of making tags of it", () => {
    const [draft] = parseQuestionBlocks(item(1).replace("Review: Renal; Diuretics; Acid base", "Review: Compare this with the loop diuretic question and make sure the difference in potassium handling is clear before the exam."));
    expect(draft.tags).toBeUndefined();
    expect(draft.explanation).toContain("Review: Compare this with the loop diuretic question");
  });

  it("keeps a flagged key but sends it to review", () => {
    const [draft] = parseQuestionBlocks(item(3).replace("Answer: D", "Correct Answer from source: D\nStatus: SOURCE-KEY FLAG"));
    expect(draft.correctKey).toBe("D");
    expect(draft.needsReview).toBe(true);
    expect(draft.warnings.join(" ")).toMatch(/flags this answer key \(SOURCE-KEY FLAG\)\. Confirm answer D/);
  });

  it("never picks an answer when the source marks two", () => {
    const [draft] = parseQuestionBlocks(item(2).replace("Answer: C", "Correct Answer: UNRESOLVED\nSource marks: A and D\nStatus: SOURCE-KEY CONFLICT"));
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.warnings.join(" ")).toMatch(/The source marks A and D\. No answer was set/);
    expect(draft.explanation).toBe("Mechanism 2 explains the finding.");
  });

  it("treats several quizzes in one paste as sections, each with its own source and numbering", () => {
    const quiz = (name: string, count: number) => `${name}
Source: Course ${name}
Questions: 1–${count}

${Array.from({ length: count }, (_, index) => item(index + 1)).join("\n")}`;
    const drafts = parseQuestionBlocks(`${quiz("Quiz 4", 3)}\n\n${quiz("Quiz 5", 2)}`);
    expect(drafts).toHaveLength(5);
    expect(drafts.map((draft) => `${draft.sourceLabel} #${draft.questionNumber}`)).toEqual([
      "Course Quiz 4 #1", "Course Quiz 4 #2", "Course Quiz 4 #3", "Course Quiz 5 #1", "Course Quiz 5 #2",
    ]);
    expect(drafts.some((draft) => draft.warnings.some((warning) => /Duplicate question numbers/.test(warning)))).toBe(false);
    expect(drafts[2].explanation).toBe("Mechanism 3 explains the finding.");
    expect(drafts[2].tags).toEqual(["Renal", "Diuretics", "Acid base"]);
  });

  it("still flags a number repeated inside one quiz", () => {
    const drafts = parseQuestionBlocks(`${item(1)}\n${item(1)}`);
    expect(drafts.every((draft) => draft.warnings.some((warning) => /Duplicate question numbers/.test(warning)))).toBe(true);
  });

  it("reads the confirmation layout, with each label on its own line", () => {
    const record = (n: number) => `SOURCE
Course Quiz 7

QUESTION NUMBER
${n}

QUESTION
A ${20 + n}-year-old patient has finding ${n}.
Which mechanism explains it?

ANSWER CHOICES
A  First mechanism ${n}
B  Second mechanism ${n}
C  Third mechanism ${n}
D  Fourth mechanism ${n}
E  Fifth mechanism ${n}

CORRECT ANSWER
C

EXPLANATION
The third mechanism is the one at work.

TAGS / REVIEW
Hallucinogens
Receptor pharmacology

ATTACHMENT
${n === 30 ? "ecg-30.png" : "None"}
`;
    const drafts = parseQuestionBlocks(`${record(29)}\n${record(30)}`);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      questionNumber: 29,
      stem: "A 49-year-old patient has finding 29.\nWhich mechanism explains it?",
      correctKey: "C",
      explanation: "The third mechanism is the one at work.",
      sourceLabel: "Course Quiz 7",
      tags: ["Hallucinogens", "Receptor pharmacology"],
    });
    expect(drafts[0].options.map((option) => `${option.key}:${option.text}`)).toEqual([
      "A:First mechanism 29", "B:Second mechanism 29", "C:Third mechanism 29", "D:Fourth mechanism 29", "E:Fifth mechanism 29",
    ]);
    expect(drafts[0].attachmentNames).toBeUndefined();
    expect(drafts[1].attachmentNames).toEqual(["ecg-30.png"]);
  });
});
