import { describe, expect, it } from "vitest";
import { isRepeatedPrinting, resolveRepeatedNumbering } from "./questionNumbering";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "./questionParse";

const draft = (questionNumber: number, stem: string, extra: Partial<ParsedQuestionDraft> = {}): ParsedQuestionDraft => ({
  questionNumber,
  stem,
  options: [
    { key: "A", text: `${stem.slice(0, 6)} alpha` },
    { key: "B", text: `${stem.slice(0, 6)} beta` },
    { key: "C", text: `${stem.slice(0, 6)} gamma` },
  ],
  confidence: "medium",
  warnings: [],
  ...extra,
});

const STEM_1 = "A 36-year-old woman asks which structure the notochord most likely induces.";
const STEM_2 = "Which primary vesicle gives rise to the epithalamus in the developing brain?";
const STEM_3 = "A lesion of the meninges near the middle meningeal artery most likely causes which finding?";
const STEM_4 = "Cerebrospinal fluid is reabsorbed into the venous system mainly through which structure?";

describe("resolveRepeatedNumbering", () => {
  it("reads a restart at 1 that continues as a new section, not a conflict", () => {
    const result = resolveRepeatedNumbering([draft(1, STEM_1), draft(2, STEM_2), draft(1, STEM_3), draft(2, STEM_4)]);
    expect(result.drafts).toHaveLength(4);
    expect(result.conflicted).toHaveLength(0);
    expect(result.restarts).toBe(1);
    expect(result.drafts[2].parserRuleIds).toContain("question.section-restart");
  });

  it("flags a lone repeated number that does not start a continuing run", () => {
    const result = resolveRepeatedNumbering([draft(1, STEM_1), draft(1, STEM_3)]);
    expect(result.conflicted).toHaveLength(2);
    expect(result.drafts.every((d) => d.needsReview)).toBe(true);
  });

  it("folds the answered printing into the first printing with its printed key and explanation", () => {
    const unanswered = draft(1, STEM_1, { needsReview: true, confidence: "low", warnings: ["No correct answer was reliably detected — set it after checking the source."] });
    const answered = draft(1, STEM_1, { correctKey: "C", explanation: "The notochord induces the neural plate.", parserRuleIds: ["answer.explicit-letter"], needsReview: false, confidence: "high", sourcePage: 38 });
    const result = resolveRepeatedNumbering([unanswered, draft(2, STEM_2), answered]);
    expect(result.drafts).toHaveLength(2);
    expect(result.merged).toBe(1);
    const merged = result.drafts[0];
    expect(merged.correctKey).toBe("C");
    expect(merged.correctAnswerText).toBe(merged.options[2].text);
    expect(merged.explanation).toContain("neural plate");
    expect(merged.answerEvidencePage).toBe(38);
    expect(merged.needsReview).toBe(false);
    expect(merged.warnings).toHaveLength(0);
    expect(merged.parserRuleIds).toEqual(expect.arrayContaining(["answer.explicit-letter", "answer.repeat-copy", "question.repeat-copy-merged"]));
  });

  it("keeps the first printing's own structural doubt after merging a key", () => {
    const doubtful = draft(1, STEM_1, { needsReview: true, parserRuleIds: ["question.ambiguous-numbered-stem-list"] });
    const answered = draft(1, STEM_1, { correctKey: "B", needsReview: false });
    const [merged] = resolveRepeatedNumbering([doubtful, answered]).drafts;
    expect(merged.correctKey).toBe("B");
    expect(merged.needsReview).toBe(true);
  });

  it("keeps two printings that disagree on the key visible and flagged", () => {
    const result = resolveRepeatedNumbering([draft(1, STEM_1, { correctKey: "A" }), draft(1, STEM_1, { correctKey: "C" })]);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.correctKey)).toEqual(["A", "C"]);
    expect(result.drafts.every((d) => d.needsReview)).toBe(true);
  });

  it("never folds identical blocks that carry different numbers", () => {
    const result = resolveRepeatedNumbering([draft(1, STEM_1), draft(2, STEM_1, { correctKey: "B" })]);
    expect(result.drafts).toHaveLength(2);
    expect(result.merged).toBe(0);
  });

  it("flags only the drafts whose number repeats within one segment", () => {
    const result = resolveRepeatedNumbering([draft(1, STEM_1), draft(2, STEM_2), draft(3, STEM_3), draft(2, STEM_4)]);
    expect(result.conflicted.map((d) => d.questionNumber)).toEqual([2, 2]);
    expect(result.drafts[0].needsReview).toBeUndefined();
    expect(result.drafts[2].needsReview).toBeUndefined();
    expect(result.drafts[3].parserRuleIds).toContain("conflict.duplicate-question-number");
  });

  it("does not treat out-of-order numbering without a repeat as a duplicate", () => {
    const result = resolveRepeatedNumbering([draft(6, STEM_1), draft(24, STEM_2), draft(7, STEM_3), draft(8, STEM_4)]);
    expect(result.conflicted).toHaveLength(0);
  });

  it("does not merge different questions that share a number or differ in choices", () => {
    expect(isRepeatedPrinting(draft(1, STEM_1), draft(1, STEM_3))).toBe(false);
    const changed = draft(1, STEM_1);
    changed.options = [{ key: "A", text: "something else entirely" }, { key: "B", text: "another" }, { key: "C", text: "third" }];
    expect(isRepeatedPrinting(draft(1, STEM_1), changed)).toBe(false);
  });
});

describe("parseQuestionBlocks with repeated handouts", () => {
  const handout = [
    "Questions Only",
    "NB 01 – Neuroembryology",
    `1. ${STEM_1}`,
    "A. Neural tube", "B. Neural fold", "C. Neural plate", "D. Neural crest",
    `2. ${STEM_2}`,
    "A. Telencephalon", "B. Diencephalon", "C. Mesencephalon",
    "NB 02 – Meninges",
    `1. ${STEM_3}`,
    "A. Epidural hematoma", "B. Subdural hematoma", "C. Subarachnoid hemorrhage",
    `2. ${STEM_4}`,
    "A. Choroid plexus", "B. Arachnoid granulations", "C. Central canal",
    "Questions with Answers and Explanations",
    "NB 01 – Neuroembryology",
    `1. ${STEM_1}`,
    "A. Neural tube", "B. Neural fold", "C. Neural plate", "D. Neural crest",
    "Answer Key: C",
    "The notochord induces the overlying ectoderm to form the neural plate.",
    `2. ${STEM_2}`,
    "A. Telencephalon", "B. Diencephalon", "C. Mesencephalon",
    "Answer Key: B",
    "The diencephalon forms the epithalamus, thalamus and hypothalamus.",
    "NB 02 – Meninges",
    `1. ${STEM_3}`,
    "A. Epidural hematoma", "B. Subdural hematoma", "C. Subarachnoid hemorrhage",
    "Answer Key: A",
    "The middle meningeal artery bleeds into the epidural space.",
    `2. ${STEM_4}`,
    "A. Choroid plexus", "B. Arachnoid granulations", "C. Central canal",
    "Answer Key: B",
    "Arachnoid granulations return cerebrospinal fluid to the dural venous sinuses.",
  ].join("\n");

  it("returns each question once, keyed from its answered printing, with no duplicate-number flag", () => {
    const drafts = parseQuestionBlocks(handout);
    expect(drafts.map((d) => [d.questionNumber, d.correctKey])).toEqual([[1, "C"], [2, "B"], [1, "A"], [2, "B"]]);
    expect(drafts.every((d) => !(d.parserRuleIds ?? []).includes("conflict.duplicate-question-number"))).toBe(true);
    expect(drafts[0].explanation).toContain("neural plate");
  });
});
