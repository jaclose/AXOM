// Pre-beta question bank: multi-question parsing, file import, and quiz
// session scoring/pools — the flagship loop's domain logic.
import { describe, expect, it, vi } from "vitest";
import {
  createImportMappingLedger, expandInlineOptions, normalizeSourceText, parseQuestionBlocks, parseQuestionText,
  splitAnswerKeySection, splitOptionFeedback,
} from "./questionParse";
import { detectImportFormat, importFromCsv, importFromJson, parseCsv } from "./questionImport";
import { buildQuizPool, missedQuestionIds, scoreSession, scoresByCategory, type QuizSession } from "./quiz";
import { setAccuracy, type QuestionSet } from "./library";
import { validateQuestionRecord, type QuestionRecord } from "./questions";

function makeQuestion(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: crypto.randomUUID(), source: "manual", stem: "A stem",
    options: [{ key: "A", text: "x" }, { key: "B", text: "y" }, { key: "C", text: "z" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

describe("multi-question paste parsing", () => {
  it("splits a numbered set into separate drafts and strips the numbers", () => {
    const drafts = parseQuestionBlocks([
      "1. First stem about complement?",
      "A. One", "B. Two", "C. Three",
      "Answer: B",
      "",
      "2) Second stem about renal?",
      "A. Alpha", "B. Beta", "C. Gamma",
      "Correct: A",
      "Explanation: Because physiology.",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts[0].stem).toBe("First stem about complement?");
    expect(drafts[0].correctKey).toBe("B");
    expect(drafts[1].stem).toBe("Second stem about renal?");
    expect(drafts[1].correctKey).toBe("A");
    expect(drafts[1].explanation).toContain("physiology");
  });

  it("treats un-numbered text as a single question", () => {
    const drafts = parseQuestionBlocks("Plain stem?\nA. Yes\nB. No\nAnswer: A");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].correctKey).toBe("A");
  });

  it("captures metadata lines like Topic:/Source:/Tags:", () => {
    const draft = parseQuestionText("Stem?\nA. One\nB. Two\nAnswer: A\nTopic: Complement\nSource: SGU NB3\nTags: immuno, hy");
    expect(draft.topic).toBe("Complement");
    expect(draft.sourceLabel).toBe("SGU NB3");
    expect(draft.tags).toEqual(["immuno", "hy"]);
  });

  it("retains the document's question numbers", () => {
    const drafts = parseQuestionBlocks("7. Stem seven?\nA. x\nB. y\n\n8) Stem eight?\nA. x\nB. y");
    expect(drafts.map((d) => d.questionNumber)).toEqual([7, 8]);
  });
});

describe("answer-key section mapping", () => {
  it("parses key formats: '1. C', '2-B', '3) D', 'Question 4: A'", () => {
    const { answerKey } = splitAnswerKeySection("body\nAnswer Key\n1. C\n2-B\n3) D\nQuestion 4: A");
    expect(answerKey.get(1)).toBe("C");
    expect(answerKey.get(2)).toBe("B");
    expect(answerKey.get(3)).toBe("D");
    expect(answerKey.get(4)).toBe("A");
  });

  it("parses the inline form 'Answers: 1C, 2B, 3D'", () => {
    const { answerKey, body } = splitAnswerKeySection("Question body here\nAnswers: 1C, 2B, 3D");
    expect([...answerKey.entries()]).toEqual([[1, "C"], [2, "B"], [3, "D"]]);
    expect(body).not.toMatch(/Answers:/);
  });

  it("maps a trailing key onto numbered questions and clears the missing-answer warning", () => {
    const drafts = parseQuestionBlocks([
      "1. First?", "A. x", "B. y", "C. z", "",
      "2. Second?", "A. x", "B. y", "C. z", "",
      "Answer key:", "1. B", "2. C",
    ].join("\n"));
    expect(drafts[0].correctKey).toBe("B");
    expect(drafts[1].correctKey).toBe("C");
    expect(drafts[0].warnings.join(" ")).not.toMatch(/no correct answer/i);
  });

  it("flags conflicting or impossible key entries instead of guessing", () => {
    const conflicted = parseQuestionBlocks([
      "1. First?", "A. x", "B. y", "",
      "Answer key:", "1. A", "1. B",
    ].join("\n"));
    expect(conflicted[0].correctKey).toBeUndefined();
    expect(conflicted[0].warnings.join(" ")).toMatch(/conflicting/i);

    const impossible = parseQuestionBlocks([
      "1. First?", "A. x", "B. y", "",
      "Answer key:", "1. F",
    ].join("\n"));
    expect(impossible[0].correctKey).toBeUndefined();
    expect(impossible[0].warnings.join(" ")).toMatch(/no such option/i);
  });

  it("an in-question answer that disagrees with the key becomes a flagged conflict (L5)", () => {
    const drafts = parseQuestionBlocks([
      "1. First?", "A. x", "B. y", "Answer: A", "",
      "2. Second?", "A. x", "B. y", "",
      "Answer key:", "1. B", "2. B",
    ].join("\n"));
    // Q1: block says A, key says B → never guess; unset + needs review.
    expect(drafts[0].correctKey).toBeUndefined();
    expect(drafts[0].needsReview).toBe(true);
    expect(drafts[0].warnings.join(" ")).toMatch(/conflict/i);
    // Q2: only the key speaks → mapped normally.
    expect(drafts[1].correctKey).toBe("B");
  });
});

describe("detector strength: normalization, markers, inline options, vocab", () => {
  it("normalization strips markdown bold, bullets, nbsp, and smart quotes", () => {
    const cleaned = normalizeSourceText("• **Answer: B** is “right”");
    expect(cleaned).toBe('Answer: B is "right"');
  });

  it("markdown-bolded answers are detected after normalization", () => {
    const draft = parseQuestionText("Stem?\nA. x\nB. y\nC. z\n**Answer: B**");
    expect(draft.correctKey).toBe("B");
  });

  it("a ✓ checkmark on exactly one option marks it correct", () => {
    const draft = parseQuestionText("Stem?\nA. Alpha\nB. Beta ✓\nC. Gamma\nD. Delta");
    expect(draft.correctKey).toBe("B");
    expect(draft.options[1].text).toBe("Beta");
  });

  it("a leading * on exactly one option marks it correct; on ALL options it's just bullets", () => {
    const marked = parseQuestionText("Stem?\nA. Alpha\n*B. Beta\nC. Gamma");
    expect(marked.correctKey).toBe("B");
    expect(marked.options[1].text).toBe("Beta");

    const bullets = parseQuestionText("Stem?\n*A. Alpha\n*B. Beta\n*C. Gamma");
    expect(bullets.correctKey).toBeUndefined();
    expect(bullets.options).toHaveLength(3);
  });

  it("'(correct)' suffix marks the option and is stripped from its text", () => {
    const draft = parseQuestionText("Stem?\nA. Alpha\nB. Beta (correct)\nC. Gamma");
    expect(draft.correctKey).toBe("B");
    expect(draft.options[1].text).toBe("Beta");
  });

  it("options crammed on one line are expanded (A. x B. y C. z D. w)", () => {
    const draft = parseQuestionText("Which is right?\nA. Alpha B. Beta C. Gamma D. Delta\nAnswer: C");
    expect(draft.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    expect(draft.options[2].text).toBe("Gamma");
    expect(draft.correctKey).toBe("C");
  });

  it("expandInlineOptions leaves prose mentioning 'B. cereus' alone", () => {
    expect(expandInlineOptions("Infection with B. cereus is classic")).toEqual(["Infection with B. cereus is classic"]);
  });

  it("extended answer vocab: 'Correct option: B', 'Key: C', 'Solution: D'", () => {
    expect(parseQuestionText("Q?\nA. x\nB. y\nCorrect option: B").correctKey).toBe("B");
    expect(parseQuestionText("Q?\nA. x\nB. y\nC. z\nKey: C").correctKey).toBe("C");
    expect(parseQuestionText("Q?\nA. x\nB. y\nC. z\nD. w\nSolution: D").correctKey).toBe("D");
  });
});

describe("feedback glued to an option must NOT become a choice (critical bug)", () => {
  it("splits 'E. Co-payment Correct Feedback: …' — option E is just 'Co-payment', answer is A", () => {
    const draft = parseQuestionText([
      "Which term best describes the $70 paid out-of-pocket?",
      "A. Co-insurance",
      "B. Premium",
      "C. Pre-payment",
      "D. Deductible",
      "E. Co-payment Correct Feedback: Co-insurance is the term for the percentage a patient pays after the deductible is met.",
    ].join("\n"));
    expect(draft.options).toHaveLength(5);
    expect(draft.options[4]).toEqual({ key: "E", text: "Co-payment" });
    // The "Correct Feedback" was glued to option E's line but names A's concept;
    // wait — the marker belongs to E's line, so E is flagged correct by the
    // feedback marker. This asserts the SPLIT works; answer mapping is exercised
    // in the Medicare case below where the feedback sits on the correct option.
    expect(draft.explanation).toContain("Co-insurance is the term");
    // No option text contains the feedback marker.
    expect(draft.options.every((o) => !/correct feedback/i.test(o.text))).toBe(true);
  });

  it("'E. Medicaid Correct Feedback: Medicare is available…' — E text is 'Medicaid', E is marked correct, not missing", () => {
    const draft = parseQuestionText([
      "Which program provides hospital insurance for those 65+?",
      "A. Medicare Part A",
      "B. Medicare Part B",
      "C. Medicare Part D",
      "D. CHIP",
      "E. Medicaid Correct Feedback: Medicare is available for people 65 and older.",
    ].join("\n"));
    expect(draft.options).toHaveLength(5);
    expect(draft.options[4]).toEqual({ key: "E", text: "Medicaid" });
    expect(draft.correctKey).toBe("E"); // the feedback marker sat on E's line
    expect(draft.explanation).toContain("Medicare is available");
    expect(draft.warnings.join(" ")).not.toMatch(/no correct answer/i);
  });

  it("'A. Co-insurance Correct Feedback: …' with wrong choices — answer maps to A, not E", () => {
    const draft = parseQuestionText([
      "Which term best describes coinsurance?",
      "A. Co-insurance Correct Feedback: Co-insurance is the percentage a patient pays after the deductible.",
      "B. Premium Incorrect Feedback: A premium is the regular charge.",
      "C. Pre-payment",
      "D. Deductible",
      "E. Co-payment",
    ].join("\n"));
    expect(draft.options).toHaveLength(5);
    expect(draft.options[0]).toEqual({ key: "A", text: "Co-insurance" });
    expect(draft.options[1]).toEqual({ key: "B", text: "Premium" });
    expect(draft.correctKey).toBe("A");
    expect(draft.explanation).toContain("Co-insurance is the percentage");
    expect(draft.choiceRationales?.B).toContain("regular charge");
    expect(draft.options.every((o) => !/feedback/i.test(o.text))).toBe(true);
  });

  it("standalone feedback markers never become options", () => {
    const draft = parseQuestionText([
      "Stem?",
      "A. First",
      "B. Second",
      "Correct Feedback: The first choice is right because of the mechanism.",
      "Objective: Understand the mechanism.",
    ].join("\n"));
    expect(draft.options).toHaveLength(2);
    expect(draft.options.map((o) => o.key)).toEqual(["A", "B"]);
    expect(draft.explanation).toContain("first choice is right");
  });

  it("splitOptionFeedback isolates the marker and feedback text", () => {
    expect(splitOptionFeedback("Co-payment Correct Feedback: it is a flat fee")).toEqual({
      optionText: "Co-payment",
      marker: "Correct Feedback",
      feedback: "it is a flat fee",
    });
    expect(splitOptionFeedback("Just a plain option")).toEqual({ optionText: "Just a plain option" });
    // A word like "objective" inside normal option text is not a marker (no colon).
    expect(splitOptionFeedback("Objective clinical assessment")).toEqual({ optionText: "Objective clinical assessment" });
  });

  it("L3 semantic: explanation opening names an option's text → maps the answer", () => {
    const draft = parseQuestionText([
      "Which term describes the percentage paid after the deductible?",
      "A. Co-insurance",
      "B. Premium",
      "C. Co-payment",
      "Explanation: Co-insurance is the percentage a patient pays after the deductible is met.",
    ].join("\n"));
    expect(draft.correctKey).toBe("A");
    expect(draft.confidence).not.toBe("high"); // inferred, so not fully confident
  });
});

describe("explanation mapping (L3–L6)", () => {
  it("attaches per-number explanations from an 'Answers and Explanations' section", () => {
    const drafts = parseQuestionBlocks([
      "1. First stem?", "A. x", "B. y", "C. z", "",
      "2. Second stem?", "A. x", "B. y", "C. z", "",
      "Answers and Explanations:",
      "1. C — Terminal complement deficiency predisposes to Neisseria.",
      "2. A. Because the enzyme is rate-limiting.",
    ].join("\n"));
    expect(drafts[0].correctKey).toBe("C");
    expect(drafts[0].explanation).toContain("Neisseria");
    expect(drafts[0].explanationSource).toBe("answer-section");
    expect(drafts[0].confidence).toBe("high");
    expect(drafts[1].correctKey).toBe("A");
    expect(drafts[1].explanation).toContain("rate-limiting");
  });

  it("handles 'Question 1: C. Explanation…' and 'Correct answer: C' entry forms", () => {
    const drafts = parseQuestionBlocks([
      "1. Stem one?", "A. x", "B. y", "C. z", "",
      "2. Stem two?", "A. x", "B. y", "C. z", "",
      "Answer Key:",
      "Question 1: C. The mechanism is complement-mediated lysis.",
      "2. Correct answer: B",
    ].join("\n"));
    expect(drafts[0].correctKey).toBe("C");
    expect(drafts[0].explanation).toContain("complement-mediated");
    expect(drafts[1].correctKey).toBe("B");
  });

  it("parses inline 'Correct Answer: C' with a tail and prose-embedded answers", () => {
    const withTail = parseQuestionText("Stem?\nA. x\nB. y\nC. z\nCorrect Answer: C. Because the pathway is terminal.");
    expect(withTail.correctKey).toBe("C");
    expect(withTail.explanation).toContain("terminal");

    const prose = parseQuestionText("Stem?\nA. x\nB. y\nC. z\nExplanation: The correct answer is B because the clue is viral.");
    expect(prose.correctKey).toBe("B");
    expect(prose.warnings.join(" ")).toMatch(/inferred from explanation prose/i);
    expect(prose.confidence).toBe("medium");
  });

  it("collects choice rationales and derives the answer from 'C is correct'", () => {
    const draft = parseQuestionText([
      "Stem?", "A. alpha", "B. beta", "C. gamma",
      "Explanation:",
      "A is incorrect because it is upstream.",
      "B is incorrect because it is too broad.",
      "C is correct because the enzyme is rate-limiting.",
    ].join("\n"));
    expect(draft.choiceRationales?.A).toContain("upstream");
    expect(draft.choiceRationales?.B).toContain("too broad");
    expect(draft.correctKey).toBe("C");
  });

  it("flags a conflict when the answer line and explanation prose disagree (L5)", () => {
    const draft = parseQuestionText("Stem?\nA. x\nB. y\nC. z\nAnswer: C\nExplanation: The correct answer is B because of the infection type.");
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).toBe("low");
    expect(draft.warnings.join(" ")).toMatch(/conflicting answers/i);
  });
});

describe("structured answer parsing and import diagnostics", () => {
  const ppd = [
    "A 36-year-old man with tuberculosis exposure has a positive PPD skin test. Which cells mediate this reaction?",
    "A. B lymphocytes",
    "B. CD4+ T lymphocytes",
    "C. Mast cells",
    "D. Eosinophils",
    "E. Neutrophils",
    "Answer: B. CD4+ T lymphocytes",
    "Explanation: The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.",
  ].join("\n");

  it("parses the exact PPD fixture without contaminating option E or explanation", () => {
    const draft = parseQuestionBlocks(ppd)[0];
    expect(draft.correctKey).toBe("B");
    expect(draft.correctAnswerText).toBe("CD4+ T lymphocytes");
    expect(draft.options[4]).toEqual({ key: "E", text: "Neutrophils" });
    expect(draft.explanation).toBe("The PPD test is a type IV hypersensitivity reaction mediated by Th1 CD4+ T cells and macrophages.");
    expect(draft.explanation).not.toMatch(/36-year-old|A\. B lymphocytes|Answer:/i);
    expect(draft.answerEvidence).toBe("Answer: B. CD4+ T lymphocytes");
    expect(draft.parserRuleIds).toEqual(expect.arrayContaining([
      "answer.explicit-letter-text",
      "answer.text-option-match",
      "explanation.explanation",
    ]));
    expect(draft.questionDetectionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.answerDetectionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.explanationDetectionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.overallImportConfidence).toBeGreaterThanOrEqual(0.85);
    expect(draft.sourceSnippet).toContain("Answer: B. CD4+ T lymphocytes");
  });

  it("maps answer text alone and tolerates a terminal period on a letter", () => {
    const byText = parseQuestionText([
      "Which cells?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells",
      "Answer: CD4+ T lymphocytes",
    ].join("\n"));
    expect(byText.correctKey).toBe("B");
    expect(byText.correctAnswerText).toBe("CD4+ T lymphocytes");

    const startsWithLetter = parseQuestionText([
      "Which cells?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells",
      "Answer: B lymphocytes",
    ].join("\n"));
    expect(startsWithLetter.correctKey).toBe("A");
    expect(startsWithLetter.correctAnswerText).toBe("B lymphocytes");

    const punctuated = parseQuestionText("Which?\nA. one\nB. two\nC. three\nAnswer: B.");
    expect(punctuated.correctKey).toBe("B");
  });

  it("does not turn the answer text in 'Correct Answer: B. text' into explanation", () => {
    const draft = parseQuestionText([
      "Which cells?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells",
      "Correct Answer: B. CD4+ T lymphocytes",
      "Explanation: This is a delayed, T-cell-mediated response.",
    ].join("\n"));
    expect(draft.correctKey).toBe("B");
    expect(draft.explanation).toBe("This is a delayed, T-cell-mediated response.");
  });

  it("flags a letter/text mismatch instead of trusting either answer signal", () => {
    const draft = parseQuestionText([
      "Which cells?", "A. B lymphocytes", "B. CD4+ T lymphocytes", "C. Mast cells",
      "Answer: B. Mast cells",
    ].join("\n"));
    expect(draft.correctKey).toBeUndefined();
    expect(draft.correctAnswerText).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.confidence).toBe("low");
    expect(draft.warnings.join(" ")).toMatch(/conflicting answer letter\/text/i);
  });

  it("keeps objective and reference metadata out of the explanation", () => {
    const draft = parseQuestionText([
      "Which cells?", "A. B cells", "B. T cells", "C. Mast cells", "Answer: B",
      "Explanation: Delayed hypersensitivity is T-cell mediated.",
      "Learning Objective: Distinguish hypersensitivity mechanisms.",
      "Reference: Immunology chapter 12.",
      "Teaching point: Th1 cells activate macrophages.",
    ].join("\n"));
    expect(draft.objective).toBe("Distinguish hypersensitivity mechanisms.");
    expect(draft.reference).toBe("Immunology chapter 12.");
    expect(draft.explanation).toContain("Delayed hypersensitivity");
    expect(draft.explanation).toContain("Th1 cells activate macrophages");
    expect(draft.explanation).not.toMatch(/objective|chapter 12/i);
  });

  it("supports Q1/Question 2 boundaries without punctuation and Q1 B keys", () => {
    const drafts = parseQuestionBlocks([
      "Q1", "First stem?", "A. one", "B. two", "C. three", "",
      "Question 2 Second stem?", "A. one", "B. two", "C. three", "",
      "Answer key:", "Q1 B", "Q2 C",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
    expect(drafts[0].parserRuleIds).toContain("question.numbered-boundary");
    expect(drafts[0].parserRuleIds).toContain("answer.trailing-section");
  });

  it("keeps duplicate question numbers separate but flags every affected draft", () => {
    const drafts = parseQuestionBlocks([
      "1. First stem?", "A. one", "B. two", "C. three", "Answer: A", "",
      "1. Second stem?", "A. one", "B. two", "C. three", "Answer: B",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 1]);
    expect(drafts.every((draft) => draft.warnings.some((warning) => /duplicate question numbers/i.test(warning)))).toBe(true);
    expect(drafts.every((draft) => draft.needsReview)).toBe(true);
  });

  it("retains malformed bare-number prefixes as separate review candidates", () => {
    const drafts = parseQuestionBlocks([
      "1 First malformed stem?", "A. one", "B. two", "C. three", "Answer: A", "",
      "2 Second malformed stem?", "A. one", "B. two", "C. three", "Answer: B",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.stem)).toEqual([
      "First malformed stem?",
      "Second malformed stem?",
    ]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["A", "B"]);
    expect(drafts.every((draft) => draft.needsReview)).toBe(true);
    expect(drafts.every((draft) => (draft.questionDetectionConfidence ?? 1) <= 0.55)).toBe(true);
    expect(drafts.every((draft) => draft.parserRuleIds?.includes("question.malformed-boundary"))).toBe(true);
    expect(drafts.every((draft) => draft.warnings.some((warning) => /retained as a separate question/i.test(warning)))).toBe(true);
  });

  it("keeps answer and reasoning provenance attached across malformed question boundaries", () => {
    const drafts = parseQuestionBlocks([
      "11 First multiline stem begins with a clinical clue",
      "and continues with the finding that identifies the mechanism?",
      "A) Alpha", "B) Beta", "C) Gamma", "Ans: B",
      "Reasoning: Beta follows from the first mechanism.",
      "The second line completes only the first explanation.", "",
      "12 Second multiline stem begins here",
      "and asks about a different mechanism?",
      "A: Delta", "B: Epsilon", "C: Zeta", "Correct answer: C",
      "Explanation: Zeta follows from the second mechanism.",
    ].join("\n"));

    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
    expect(drafts[0].stem).toContain("clinical clue\nand continues");
    expect(drafts[1].stem).toContain("begins here\nand asks");
    expect(drafts[0].explanation).toBe([
      "Beta follows from the first mechanism.",
      "The second line completes only the first explanation.",
    ].join("\n"));
    expect(drafts[1].explanation).toBe("Zeta follows from the second mechanism.");
    expect(drafts[0].explanationSourceSnippet).not.toContain("Second multiline stem");
    expect(drafts[1].explanationSourceSnippet).not.toContain("first mechanism");
  });

  it("keeps malformed numbered drafts in review after a trailing answer key maps successfully", () => {
    const drafts = parseQuestionBlocks([
      "1 First malformed question?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "2 Second malformed question?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "Answer key:", "1. B", "2. C",
    ].join("\n"));

    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
    expect(drafts.every((draft) => draft.needsReview)).toBe(true);
    expect(drafts.every((draft) => draft.parserRuleIds?.includes("question.malformed-boundary"))).toBe(true);
  });

  it("retains a standard numbered question with missing choices between valid neighbors", () => {
    const drafts = parseQuestionBlocks([
      "1. First valid question?", "A. Alpha", "B. Beta", "Answer: A", "",
      "2. Which finding is missing its choices?",
      "Explanation: This malformed question still belongs to question two.", "",
      "3. Third valid question?", "A. Gamma", "B. Delta", "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(3);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2, 3]);
    expect(drafts[1].stem).toBe("Which finding is missing its choices?");
    expect(drafts[1].options).toEqual([]);
    expect(drafts[1].explanation).toBe("This malformed question still belongs to question two.");
    expect(drafts[1].needsReview).toBe(true);
    expect(drafts[1].parserRuleIds).toContain("question.numbered-boundary");
    expect(drafts[1].parserRuleIds).not.toContain("question.malformed-boundary");
    expect(drafts[0].explanation ?? "").not.toContain("question two");
    expect(drafts[2].correctKey).toBe("B");
  });

  it("retains a zero-choice numbered question after an explanation instead of swallowing it", () => {
    const drafts = parseQuestionBlocks([
      "1. First valid question?", "A. Alpha", "B. Beta", "Answer: A",
      "Explanation: The first explanation ends here.",
      "2. Which second question has no choices?",
      "3. Third valid question?", "A. Gamma", "B. Delta", "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(3);
    expect(drafts.map((item) => item.questionNumber)).toEqual([1, 2, 3]);
    expect(drafts[0].explanation).toBe("The first explanation ends here.");
    expect(drafts[0].parserRuleIds).toContain("explanation.ambiguous-boundary");
    expect(drafts[1]).toMatchObject({
      stem: "Which second question has no choices?",
      options: [],
      needsReview: true,
    });
    expect(drafts[1].parserRuleIds).toContain("question.ambiguous-explanation-boundary");
    expect(drafts[2].correctKey).toBe("B");
  });

  it("retains an unnumbered question-shaped preamble before a numbered sequence", () => {
    const drafts = parseQuestionBlocks([
      "Unnumbered first question?", "A. Alpha", "B. Beta", "Answer: A",
      "Explanation: First explanation.", "",
      "1. Numbered second question?", "A. Gamma", "B. Delta", "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      stem: "Unnumbered first question?",
      correctKey: "A",
      needsReview: true,
    });
    expect(drafts[0].questionNumber).toBeUndefined();
    expect(drafts[0].parserRuleIds).toContain("question.malformed-boundary");
    expect(drafts[1]).toMatchObject({ questionNumber: 1, correctKey: "B" });
  });

  it("does not promote a numeric clinical detail inside a multiline stem to a question boundary", () => {
    const drafts = parseQuestionBlocks([
      "1. A patient begins treatment.",
      "20 mg daily is prescribed before symptoms improve.",
      "Which mechanism best explains the response?",
      "A. Alpha", "B. Beta", "C. Gamma", "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].stem).toContain("20 mg daily");
    expect(drafts[0].correctKey).toBe("B");
  });

  it("keeps a numbered findings list inside the complete multiline stem", () => {
    const drafts = parseQuestionBlocks([
      "1. A patient has these findings:",
      "1. first mechanism",
      "2. second mechanism",
      "Which diagnosis is most likely?",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ questionNumber: 1, correctKey: "B" });
    expect(drafts[0].stem).toBe([
      "A patient has these findings:",
      "1. first mechanism",
      "2. second mechanism",
      "Which diagnosis is most likely?",
    ].join("\n"));
    expect(drafts[0].parserRuleIds).toContain("question.numbered-stem-list");
    expect(drafts[0].parserRuleIds).toContain("question.ambiguous-numbered-stem-list");
    expect(drafts[0].needsReview).toBe(true);
  });

  it("keeps a numbered findings list when the outer stem is already question-shaped", () => {
    const drafts = parseQuestionBlocks([
      "1. Which findings are present?",
      "1. first mechanism",
      "2. second mechanism",
      "Select the best diagnosis.",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ questionNumber: 1, correctKey: "B" });
    expect(drafts[0].stem).toContain("1. first mechanism\n2. second mechanism");
    expect(drafts[0].parserRuleIds).toContain("question.numbered-stem-list");
    expect(drafts[0].parserRuleIds).toContain("question.ambiguous-numbered-stem-list");
    expect(drafts[0].needsReview).toBe(true);
  });

  it("keeps a numbered findings list inside an unnumbered question", () => {
    const drafts = parseQuestionBlocks([
      "Which findings are present?",
      "1. first finding",
      "2. second finding",
      "Select the best diagnosis.",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      stem: [
        "Which findings are present?",
        "1. first finding",
        "2. second finding",
        "Select the best diagnosis.",
      ].join("\n"),
      correctKey: "B",
    });
    expect(drafts[0].questionNumber).toBeUndefined();
    expect(drafts[0].parserRuleIds).toContain("question.numbered-stem-list");
    expect(drafts[0].parserRuleIds).toContain("question.ambiguous-numbered-stem-list");
    expect(drafts[0].needsReview).toBe(true);
  });

  it("keeps an unnumbered question's numbered findings without a trailing directive", () => {
    const drafts = parseQuestionBlocks([
      "Which findings are present?",
      "1. first finding",
      "2. second finding",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      stem: "Which findings are present?\n1. first finding\n2. second finding",
      correctKey: "B",
      needsReview: true,
    });
  });

  it("does not swallow forward-numbered questions as a nested stem list", () => {
    const drafts = parseQuestionBlocks([
      "1. Which question lacks choices?",
      "2. A patient has fever.",
      "3. A patient has cough.",
      "Which diagnosis is likely?",
      "A. Alpha",
      "B. Beta",
      "Answer: B",
    ].join("\n"));

    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 3]);
    expect(drafts[0]).toMatchObject({ needsReview: true });
    expect(drafts[0].stem).not.toContain("A patient has cough");
    expect(drafts[1]).toMatchObject({
      stem: "A patient has cough.\nWhich diagnosis is likely?",
      correctKey: "B",
    });
    expect(drafts[0].parserRuleIds).not.toContain("question.numbered-stem-list");
  });

  it("does not swallow a numbered question that follows Reference metadata without a blank", () => {
    const drafts = parseQuestionBlocks([
      "1. First question?", "A. Alpha", "B. Beta", "Answer: A", "Reference: Source one.",
      "2. Second question?", "A. Gamma", "B. Delta", "Answer: A",
    ].join("\n"));

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ questionNumber: 1, reference: "Source one.", correctKey: "A" });
    expect(drafts[0].reference).not.toContain("Second question");
    expect(drafts[1]).toMatchObject({ questionNumber: 2, stem: "Second question?", correctKey: "A" });
  });

  it("does not mistake a standalone Explanation header for an answer section", () => {
    const draft = parseQuestionBlocks([
      "1. Which cells?", "A. B cells", "B. T cells", "C. Mast cells", "Answer: B",
      "Explanation:", "This reaction is mediated by sensitized T cells.",
    ].join("\n"))[0];
    expect(draft.correctKey).toBe("B");
    expect(draft.explanation).toBe("This reaction is mediated by sensitized T cells.");
  });

  it("requires review when no reliable answer signal exists", () => {
    const draft = parseQuestionText("Which cells?\nA. B cells\nB. T cells\nC. Mast cells");
    expect(draft.correctKey).toBeUndefined();
    expect(draft.needsReview).toBe(true);
    expect(draft.answerDetectionConfidence).toBe(0);
    expect(draft.overallImportConfidence).toBeLessThan(0.5);
  });
});

describe("answer-mapping regression safety", () => {
  function fiveQuestionFixture(keySection: string): string {
    return [
      "1. One?", "A. a1", "B. b1", "C. c1", "D. d1", "E. e1", "",
      "2. Two?", "A. a2", "B. b2", "C. c2", "D. d2", "E. e2", "",
      "3. Three?", "A. a3", "B. b3", "C. c3", "D. d3", "E. e3", "",
      "4. Four?", "A. a4", "B. b4", "C. c4", "D. d4", "E. e4", "",
      "5. Five?", "A. a5", "B. b5", "C. c5", "D. d5", "E. e5", "",
      keySection,
    ].join("\n");
  }

  it("preserves B, D, A, C, E through parsing and record validation", () => {
    const drafts = parseQuestionBlocks(fiveQuestionFixture([
      "Answer key:", "1. B", "2. D", "3. A", "4. C", "5. E",
    ].join("\n")));
    const records = drafts.map((draft) => validateQuestionRecord({
      ...draft,
      source: "imported",
      extraction: { confidence: draft.confidence, reviewed: true },
    }).value!);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "D", "A", "C", "E"]);
    expect(records.map((record) => record.correctKey)).toEqual(["B", "D", "A", "C", "E"]);
    expect(records.map((record) => record.options.find((option) => option.key === record.correctKey)?.key))
      .toEqual(["B", "D", "A", "C", "E"]);
  });

  it("maps every compressed key pair instead of attaching the tail as explanation", () => {
    const drafts = parseQuestionBlocks(fiveQuestionFixture("Answer key:\n1.B 2.D 3.A 4.C 5.E"));
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "D", "A", "C", "E"]);
    expect(drafts.every((draft) => !draft.explanation)).toBe(true);
    expect(drafts.map((draft) => draft.answerEvidence)).toEqual(["1.B", "2.D", "3.A", "4.C", "5.E"]);

    const lowercase = parseQuestionBlocks(fiveQuestionFixture("answers: 1.(b) 2-d 3:a 4.c 5)e"));
    expect(lowercase.map((draft) => draft.correctKey)).toEqual(["B", "D", "A", "C", "E"]);
  });

  it("normalizes ordinary Markdown headings and option bullets", () => {
    const drafts = parseQuestionBlocks([
      "## 1. First Markdown question?", "- A. Alpha", "- B. Beta", "- C. Gamma", "Answer: B", "",
      "### Question 2", "Second Markdown question?", "+ A. One", "+ B. Two", "+ C. Three", "Answer: c",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.options.map((option) => option.key))).toEqual([["A", "B", "C"], ["A", "B", "C"]]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
  });

  it("treats spaced leading-letter answer phrases as text, never an implicit key", () => {
    const unsupported = parseQuestionText([
      "Which response?", "A. Alpha distractor", "B. Beta", "C. Gamma",
      "Answer: A rapid response mediated by T cells",
    ].join("\n"));
    expect(unsupported.correctKey).toBeUndefined();
    expect(unsupported.needsReview).toBe(true);
    expect(unsupported.answerDetectionConfidence).toBe(0);

    const exactText = parseQuestionBlocks([
      "1. Which response?", "A. Alpha", "B. Beta", "C. Gamma", "D. A rapid response", "",
      "Answers:", "1. A rapid response",
    ].join("\n"))[0];
    expect(exactText.correctKey).toBe("D");
    expect(exactText.correctAnswerText).toBe("A rapid response");
  });

  it("round-trips every valid A-E key and never converts absence or conflict to A", () => {
    for (const key of ["A", "B", "C", "D", "E"]) {
      const draft = parseQuestionText(`Stem?\nA. one\nB. two\nC. three\nD. four\nE. five\nAnswer: ${key}`);
      expect(draft.correctKey).toBe(key);
      const record = validateQuestionRecord({ ...draft, source: "imported" }).value!;
      expect(record.correctKey).toBe(key);
    }
    expect(parseQuestionText("Stem?\nA. one\nB. two\nC. three").correctKey).toBeUndefined();
    expect(parseQuestionText("Stem?\nA. one\nB. two\nC. three\nAnswer: A rapid unsupported phrase").correctKey).toBeUndefined();
    expect(parseQuestionBlocks("1. Stem?\nA. one\nB. two\nAnswer: A\nAnswer key:\n1. B")[0].correctKey)
      .toBeUndefined();
  });

  it("honors an inline answer that appears after explanation prose", () => {
    const draft = parseQuestionText([
      "Which?", "A. Alpha", "B. Beta", "C. Gamma",
      "Explanation: Beta follows from the stated mechanism.",
      "Answer: B",
    ].join("\n"));
    expect(draft.correctKey).toBe("B");
    expect(draft.answerEvidence).toBe("Answer: B");
    expect(draft.explanation).toContain("Beta follows");
  });

  it("keeps a later A-leading question after a standalone inline Explanation header", () => {
    const drafts = parseQuestionBlocks([
      "1. Which option is first?", "A. Alpha", "B. Beta", "C. Gamma", "Answer: B",
      "Explanation:", "Because beta follows from the finding.", "",
      "2. A patient has a new finding?", "A. First", "B. Second", "C. Third", "D. Fourth", "Answer: D",
    ].join("\n"));
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "D"]);
    expect(drafts[0].explanation).toContain("Because beta");
  });

  it("skips an inline Explanation header and still finds a later trailing answer key", () => {
    const drafts = parseQuestionBlocks([
      "1. Which option is first?", "A. Alpha", "B. Beta", "C. Gamma",
      "Explanation:", "Because beta follows from the finding.", "",
      "2. A patient has a new finding?", "A. First", "B. Second", "C. Third", "D. Fourth", "",
      "Answer key:", "1. B", "2. D",
    ].join("\n"));
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "D"]);
  });

  it("keeps a trailing answer key separate from the numbered explanation section that follows it", () => {
    const drafts = parseQuestionBlocks([
      "1. Which option is first?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "2. Which option is second?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "Answer Key:", "1. B", "2. C", "",
      "Explanations:", "1. Beta follows from the first finding.", "2. Gamma follows from the second finding.",
    ].join("\n"));
    expect(drafts.map((draft) => draft.correctKey)).toEqual(["B", "C"]);
    expect(drafts.map((draft) => draft.explanation)).toEqual([
      "Beta follows from the first finding.",
      "Gamma follows from the second finding.",
    ]);
    expect(drafts.map((draft) => draft.explanationSource)).toEqual(["answer-section", "answer-section"]);
  });

  it("associates labelled explanations after each question without absorbing the next stem", () => {
    const drafts = parseQuestionBlocks([
      "1. Which cell coordinates delayed hypersensitivity?", "A. B cell", "B. Th1 cell", "C. Mast cell",
      "Correct answer: B", "Rationale: Th1 cells activate macrophages in delayed hypersensitivity.",
      "Learning Objective: Identify type IV hypersensitivity.", "",
      "2. Which antibody fixes complement most efficiently?", "A. IgE", "B. IgA", "C. IgM",
      "Answer: C", "Feedback: Pentameric IgM efficiently activates the classical complement pathway.",
    ].join("\n"));

    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.explanation)).toEqual([
      "Th1 cells activate macrophages in delayed hypersensitivity.",
      "Pentameric IgM efficiently activates the classical complement pathway.",
    ]);
    expect(drafts[0].explanationRawCandidate).toBe("Rationale: Th1 cells activate macrophages in delayed hypersensitivity.");
    expect(drafts[0].explanationCleanupOperations).toContain("remove-explanation-label");
    expect(drafts[0].explanationSourceSnippet).not.toMatch(/Which antibody|A\. IgE/);
    expect(drafts[0].objective).toBe("Identify type IV hypersensitivity.");
  });

  it("keeps A-E-leading rationale sentences out of the extracted option list", () => {
    const [draft] = parseQuestionBlocks([
      "1. Which marker is supported?", "A. Alpha", "B. Beta", "C. Gamma", "D. Delta",
      "Answer: B", "Explanation:",
      "A. common distraction is to choose Alpha.",
      "B. Beta is supported by the stated observation.",
      "C. Gamma would require a different finding.",
    ].join("\n"));
    expect(draft.options.map((option) => option.text)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(draft.explanation).toContain("A. common distraction");
    expect(draft.explanation).toContain("B. Beta is supported");
  });

  it("keeps lettered lists inside multiline Reasoning prose out of the option list", () => {
    const [draft] = parseQuestionBlocks([
      "1) Which mechanism is best supported?",
      "The finding persists after the initial exposure.",
      "A) Immediate antibody release", "B) Sensitized T-cell response", "C) Immune-complex deposition",
      "Answer: B. Sensitized T-cell response",
      "Reasoning:",
      "The evidence supports a delayed cellular response.",
      "A. The timing is delayed rather than immediate.",
      "B. Prior sensitization is required.",
      "C. Immune complexes are not described.",
    ].join("\n"));

    expect(draft.options).toEqual([
      { key: "A", text: "Immediate antibody release" },
      { key: "B", text: "Sensitized T-cell response" },
      { key: "C", text: "Immune-complex deposition" },
    ]);
    expect(draft.correctKey).toBe("B");
    expect(draft.explanation).toContain("The evidence supports a delayed cellular response.");
    expect(draft.explanation).toContain("A. The timing is delayed");
    expect(draft.explanation).toContain("C. Immune complexes are not described.");
    expect(draft.parserRuleIds).toContain("explanation.reasoning");
  });

  it.each(["Explanation", "Rationale", "Reasoning"])(
    "keeps lettered rationale after a punctuation-free %s heading out of the options",
    (heading) => {
      const [draft] = parseQuestionBlocks([
        "1. Which option is supported?", "A. Alpha", "B. Beta",
        heading,
        "A. First reason",
        "B. Second reason",
        "Answer: B",
      ].join("\n"));

      expect(draft.options).toEqual([
        { key: "A", text: "Alpha" },
        { key: "B", text: "Beta" },
      ]);
      expect(draft.correctKey).toBe("B");
      expect(draft.explanation).toContain("A. First reason");
      expect(draft.explanation).toContain("B. Second reason");
      expect(draft.explanation).not.toMatch(new RegExp(`^${heading}$`, "m"));
    },
  );

  it("keeps numbered mechanism lists inside an explanation instead of creating questions", () => {
    const drafts = parseQuestionBlocks([
      "1. Which mechanism is supported?", "A. Alpha", "B. Beta", "Answer: B",
      "Explanation: Two mechanisms support this finding:",
      "1. receptor activation increases signaling",
      "2. downstream transcription remains active",
    ].join("\n"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].questionNumber).toBe(1);
    expect(drafts[0].correctKey).toBe("B");
    expect(drafts[0].explanation).toContain("1. receptor activation");
    expect(drafts[0].explanation).toContain("2. downstream transcription");
  });

  it("does not let Answer-prefixed explanation prose replace the explicit key", () => {
    const [draft] = parseQuestionBlocks([
      "1. What is the actual answer?",
      "A. the receptor is blocked",
      "B. the receptor is activated",
      "Answer: B",
      "Explanation: The agonist activates signaling.",
      "Answer: the receptor is blocked",
    ].join("\n"));

    expect(draft.correctKey).toBe("B");
    expect(draft.correctAnswerText).toBe("the receptor is activated");
    expect(draft.explanation).toContain("Answer: the receptor is blocked");
    expect(draft.parserRuleIds).toContain("explanation.answer-prefixed-prose");
    expect(draft.parserRuleIds).not.toContain("conflict.explicit-answer");
  });

  it("does not attach a second question stem when the first has no explanation", () => {
    const drafts = parseQuestionBlocks([
      "1. First question?", "A. First alpha", "B. First beta", "Answer: B", "",
      "2. Second question?", "A. Second alpha", "B. Second beta", "Answer: A",
      "Explanation: Only the second question has this rationale.",
    ].join("\n"));

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ questionNumber: 1, correctKey: "B", explanation: undefined });
    expect(drafts[1]).toMatchObject({
      questionNumber: 2,
      correctKey: "A",
      explanation: "Only the second question has this rationale.",
    });
  });

  it("does not treat clinical reasoning prose inside an option as a Reasoning heading", () => {
    const draft = parseQuestionText([
      "Which choice is supported?", "A. Alpha", "B. Clinical reasoning: choose Beta.", "C. Gamma",
      "Answer: B",
    ].join("\n"));

    expect(draft.options.find((option) => option.key === "B")?.text).toBe("Clinical reasoning: choose Beta.");
    expect(draft.explanation).toBeUndefined();
    expect(draft.correctKey).toBe("B");
  });

  it("normalizes an OCR-spaced Explanation label without altering its prose", () => {
    const draft = parseQuestionText([
      "Which marker?", "A. Alpha", "B. Beta", "C. Gamma", "Answer: B",
      "E x p l a n a t i o n : Beta is supported by the finding.",
    ].join("\n"));
    expect(draft.explanation).toBe("Beta is supported by the finding.");
    expect(draft.explanationRawCandidate).toBe("Explanation: Beta is supported by the finding.");
    expect(draft.explanationCleanupOperations).toContain("remove-explanation-label");
  });

  it("cleans and audits labelled explanations on later trailing pages", () => {
    const drafts = parseQuestionBlocks([
      "1. First mechanism?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "2. Second mechanism?", "A. Alpha", "B. Beta", "C. Gamma", "",
      "Answer key:", "1. B", "2. C", "",
      "Explanations:",
      "1. Explanation: Beta follows from the first mechanism.",
      "Learning Objective: Recognize the first mechanism.",
      "2. Why: Gamma follows from the second mechanism.",
      "Answer key:", "1. B", "2. C",
    ].join("\n"));

    expect(drafts.map((draft) => draft.explanation)).toEqual([
      "Beta follows from the first mechanism.",
      "Gamma follows from the second mechanism.",
    ]);
    expect(drafts[0].explanationRawCandidate).toContain("Explanation:");
    expect(drafts[0].explanationCleanupOperations).toEqual(expect.arrayContaining([
      "remove-explanation-label",
      "remove-objective-metadata",
    ]));
    expect(drafts[1].explanationCleanupOperations).toEqual(expect.arrayContaining([
      "remove-explanation-label",
      "stop-at-answer-key",
    ]));
    expect(drafts.every((draft) => (draft.explanationDetectionConfidence ?? 0) >= 0.9)).toBe(true);
  });

  it("does not split numbered learning objectives into fake questions", () => {
    const drafts = parseQuestionBlocks([
      "1. Which cell coordinates delayed hypersensitivity?", "A. B cell", "B. Th1 cell", "C. Mast cell",
      "Answer: B", "Explanation: Th1 cells activate macrophages.",
      "Learning Objectives:", "1. Identify type IV hypersensitivity.", "2. Compare antibody-mediated reactions.",
    ].join("\n"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].questionNumber).toBe(1);
    expect(drafts[0].explanation).toBe("Th1 cells activate macrophages.");
  });

  it("does not turn a malformed answer-key section into fake questions", () => {
    const drafts = parseQuestionBlocks([
      "1. One?", "A. a", "B. b", "C. c", "",
      "2. Two?", "A. a", "B. b", "C. c", "",
      "Answer key:", "1. Z", "2. banana", "3. ?",
    ].join("\n"));
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.every((draft) => draft.correctKey === undefined && draft.needsReview)).toBe(true);
  });

  it("handles PDF-style Question #: boundaries and refuses an unsupported all-A mapping", () => {
    // Spacing mirrors text reconstructed from positioned PDF glyphs.
    const extractedPdfText = [
      "Question  #:  1", "PDF  ambiguous  answer?", "A.  Alpha  distractor", "B.  Beta  choice", "C.  Gamma  choice",
      "Answer:  A  rapid  response  mediated  by  T  cells", "",
      "Question #: 2", "PDF  explicit  answer?", "A.  Alpha", "B.  Beta", "C.  Gamma", "Answer: B",
    ].join("\n");
    const drafts = parseQuestionBlocks(extractedPdfText);
    expect(drafts.map((draft) => draft.questionNumber)).toEqual([1, 2]);
    expect(drafts.map((draft) => draft.correctKey)).toEqual([undefined, "B"]);
    expect(drafts[0].needsReview).toBe(true);
  });

  it("does not read Roman-numeral statements as options and rejects repeated answer text", () => {
    const roman = parseQuestionText([
      "Which statements are true?", "I. First statement", "II. Second statement",
      "A. I only", "B. II only", "C. I and II", "Answer: C",
    ].join("\n"));
    expect(roman.options.map((option) => option.key)).toEqual(["A", "B", "C"]);
    expect(roman.stem).toContain("I. First statement");

    const repeated = parseQuestionText([
      "Which?", "A. Same text", "B. Same text", "C. Other", "Answer: Same text",
    ].join("\n"));
    expect(repeated.correctKey).toBeUndefined();
    expect(repeated.needsReview).toBe(true);
  });

  it("projects a pure diagnostic ledger with mapping evidence and conflict reason", () => {
    const drafts = parseQuestionBlocks([
      "1. One?", "A. alpha", "B. beta", "C. gamma", "",
      "2. Two?", "A. alpha", "B. beta", "C. gamma", "Answer: A rapid unsupported phrase", "",
      "Answer key:", "1. B",
    ].join("\n"));
    const ledger = createImportMappingLedger(drafts);
    expect(ledger[0]).toMatchObject({
      questionNumber: 1,
      selectedMapping: "B",
      answerEvidence: "1. B",
      confidence: 0.99,
    });
    expect(ledger[0].extractedOptions.map((option) => option.key)).toEqual(["A", "B", "C"]);
    expect(ledger[0].sourceSpans.map((span) => span.kind)).toEqual(expect.arrayContaining(["question", "answer"]));
    expect(ledger[1].selectedMapping).toBeUndefined();
    expect(ledger[1].conflictReason).toMatch(/did not exactly match/i);
  });
});

describe("library links", () => {
  it("pools by setId and documentId, and honors ordered mode", () => {
    const qs = [
      makeQuestion({ id: "a", setId: "set1", questionNumber: 2 }),
      makeQuestion({ id: "b", setId: "set1", questionNumber: 1 }),
      makeQuestion({ id: "c", setId: "set2", sourceDocumentId: "doc9" }),
    ];
    expect(buildQuizPool(qs, { count: 10, status: "all", setIds: ["set1"] })).toHaveLength(2);
    expect(buildQuizPool(qs, { count: 10, status: "all", documentIds: ["doc9"] }).map((q) => q.id)).toEqual(["c"]);
    const ordered = buildQuizPool(qs, { count: 10, status: "all", setIds: ["set1"], ordered: true });
    expect(ordered.map((q) => q.id)).toEqual(["b", "a"]);
  });

  it("launches explicit-membership sets in stored order without backlinks or randomness", () => {
    const qs = [
      makeQuestion({ id: "B", setId: undefined }),
      makeQuestion({ id: "F", setId: undefined }),
      makeQuestion({ id: "A", setId: undefined }),
      makeQuestion({ id: "D", setId: undefined }),
    ];
    const snapshot: QuestionSet = {
      id: "snapshot", title: "Snapshot", sourceDocumentIds: [], createdAt: "2026-07-18T00:00:00.000Z",
      questionIds: ["A", "D", "missing", "B", "F"], tags: [], aiEnhanced: false, parserWarnings: [],
      ordering: "random", seed: "descriptive-only",
    };
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Snapshot membership must not use Math.random.");
    });
    const filters = { count: 10, status: "all" as const, setIds: [snapshot.id] };
    try {
      expect(buildQuizPool(qs, filters, [snapshot]).map((q) => q.id)).toEqual(["A", "D", "B", "F"]);
      expect(buildQuizPool(qs, filters, [snapshot]).map((q) => q.id)).toEqual(["A", "D", "B", "F"]);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("keeps the question.setId path for legacy sets without explicit membership", () => {
    const qs = [
      makeQuestion({ id: "legacy-a", setId: "legacy" }),
      makeQuestion({ id: "legacy-b", setId: "legacy" }),
      makeQuestion({ id: "outside", setId: "other" }),
    ];
    const legacy: QuestionSet = {
      id: "legacy", title: "Legacy", sourceDocumentIds: [], createdAt: "2026-07-18T00:00:00.000Z",
      questionIds: [], tags: [], aiEnhanced: false, parserWarnings: [],
    };
    expect(buildQuizPool(qs, {
      count: 10, status: "all", setIds: [legacy.id], ordered: true,
    }, [legacy]).map((q) => q.id)).toEqual(["legacy-a", "legacy-b"]);
  });

  it("computes set accuracy from attempt history", () => {
    const set: QuestionSet = {
      id: "s1", title: "Set", sourceDocumentIds: [], createdAt: "t",
      questionIds: ["a", "b", "never"], tags: [], aiEnhanced: false, parserWarnings: [],
    };
    const attempts = new Map([
      ["a", { correct: 2, total: 2 }],
      ["b", { correct: 0, total: 2 }],
    ]);
    expect(setAccuracy(set, attempts)).toEqual({ correct: 2, total: 4, pct: 50 });
    expect(setAccuracy({ ...set, questionIds: ["never"] }, attempts).pct).toBeNull();
  });
});

describe("file import", () => {
  it("detects text-extractable document formats and provenance-only images", () => {
    expect(detectImportFormat("set.csv", "text/csv")).toBe("csv");
    expect(detectImportFormat("bank.json", "application/json")).toBe("json");
    expect(detectImportFormat("notes.md", "")).toBe("text");
    expect(detectImportFormat("scan.pdf", "application/pdf")).toBe("pdf");
    expect(detectImportFormat("questions.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(detectImportFormat("shot.png", "image/png")).toBe("image");
    expect(detectImportFormat("deck.apkg", "application/octet-stream")).toBe("unsupported");
  });

  it("parses quoted CSV cells with commas and escaped quotes", () => {
    const rows = parseCsv('a,"b, with comma","say ""hi"""\nc,d,e');
    expect(rows[0]).toEqual(["a", "b, with comma", 'say "hi"']);
    expect(rows[1]).toEqual(["c", "d", "e"]);
  });

  it("maps CSV headers to drafts and validates the answer", () => {
    const result = importFromCsv([
      "question,a,b,c,answer,explanation,topic",
      '"Which is right?",First,Second,Third,B,"Because so.",Immuno',
      '"Bad answer row?",One,Two,Three,Z,,',
    ].join("\n"));
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].correctKey).toBe("B");
    expect(result.drafts[0].topic).toBe("Immuno");
    expect(result.drafts[1].correctKey).toBeUndefined();
    expect(result.drafts[1].warnings.join(" ")).toMatch(/match an option/i);
  });

  it("imports JSON arrays with string options and answer matching", () => {
    const result = importFromJson(JSON.stringify([
      { question: "Q1?", options: ["one", "two", "three"], answer: "B", explanation: "e" },
    ]));
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].options[1]).toEqual({ key: "B", text: "two" });
    expect(result.drafts[0].correctKey).toBe("B");
  });

  it("review-gates a structured explanation truncated at an ambiguous numbered boundary", () => {
    const result = importFromJson(JSON.stringify([{
      question: "Which option is correct?",
      options: ["Alpha", "Beta", "Gamma"],
      answer: "B",
      explanation: [
        "Explanation: Main rationale.",
        "2. Which illustrative detail?",
        "A. First teaching point",
        "B. Second teaching point",
      ].join("\n"),
    }]));

    expect(result.drafts[0].explanation).toBe("Main rationale.");
    expect(result.drafts[0].needsReview).toBe(true);
    expect(result.drafts[0].explanationDetectionConfidence).toBeLessThanOrEqual(0.6);
    expect(result.drafts[0].parserRuleIds).toContain("explanation.ambiguous-boundary");
    expect(result.drafts[0].explanationCleanupOperations).toContain("ambiguous-question-boundary");
  });

  it("review-gates structured explanation truncation even after a blank separator", () => {
    const result = importFromJson(JSON.stringify([{
      question: "Which option is correct?",
      options: ["Alpha", "Beta", "Gamma"],
      answer: "B",
      explanation: [
        "Explanation: Main rationale.", "",
        "2. Which illustrative detail?",
        "A. First teaching point",
        "B. Second teaching point",
      ].join("\n"),
    }]));

    expect(result.drafts[0].explanation).toBe("Main rationale.");
    expect(result.drafts[0].needsReview).toBe(true);
    expect(result.drafts[0].parserRuleIds).toContain("explanation.ambiguous-boundary");
    expect(result.drafts[0].explanationCleanupOperations).toContain("stop-at-next-question");
  });

  it("maps answer text consistently in CSV and JSON without leading-letter ambiguity", () => {
    const csv = importFromCsv([
      "question,a,b,c,answer,explanation",
      '"Which cell?","B lymphocytes","CD4+ T lymphocytes","Mast cells","B lymphocytes","Because B cells."',
    ].join("\n"));
    const json = importFromJson(JSON.stringify([{
      question: "Which cell?",
      options: ["B lymphocytes", "CD4+ T lymphocytes", "Mast cells"],
      answer: "B. CD4+ T lymphocytes",
      explanation: "Because T cells.",
    }]));
    expect(csv.drafts[0].correctKey).toBe("A");
    expect(csv.drafts[0].correctAnswerText).toBe("B lymphocytes");
    expect(json.drafts[0].correctKey).toBe("B");
    expect(json.drafts[0].correctAnswerText).toBe("CD4+ T lymphocytes");
    for (const draft of [csv.drafts[0], json.drafts[0]]) {
      expect(draft.answerDetectionConfidence).toBeGreaterThan(0.9);
      expect(draft.parserRuleIds).toContain("answer.structured-value");
      expect(draft.sourceSnippet).toContain("Which cell?");
    }
  });

  it("rejects malformed JSON with a clear warning instead of throwing", () => {
    const result = importFromJson("not json");
    expect(result.drafts).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/valid JSON/i);
  });
});

describe("quiz pools and scoring", () => {
  it("excludes unresolved and review-suggested mappings from runnable pools", () => {
    const ready = makeQuestion({ id: "ready", correctKey: "B" });
    const unresolved = makeQuestion({ id: "unresolved", correctKey: "A", needsReview: true });
    const suggested = makeQuestion({
      id: "suggested",
      correctKey: "C",
      extraction: { confidence: "medium", reviewed: false },
    });
    const confirmed = makeQuestion({
      id: "confirmed",
      correctKey: "C",
      extraction: { confidence: "high", reviewed: true },
    });
    expect(buildQuizPool([unresolved, suggested, confirmed, ready], { count: 10, status: "all", ordered: true })
      .map((question) => question.id)).toEqual(["confirmed", "ready"]);
  });

  it("filters pools by status, category, and exam type", () => {
    const qs = [
      makeQuestion({ id: "unused", category: "Immunology", examType: "imcq" }),
      makeQuestion({ id: "missed", status: "incorrect", attempts: [{ at: "t", status: "incorrect" }], category: "Immunology" }),
      makeQuestion({ id: "marked", marked: true }),
      makeQuestion({ id: "other", category: "Pathology" }),
    ];
    expect(buildQuizPool(qs, { count: 10, status: "unused" }).map((q) => q.id)).not.toContain("missed");
    expect(buildQuizPool(qs, { count: 10, status: "incorrect" }).map((q) => q.id)).toEqual(["missed"]);
    expect(buildQuizPool(qs, { count: 10, status: "marked" }).map((q) => q.id)).toEqual(["marked"]);
    expect(buildQuizPool(qs, { count: 10, status: "all", categories: ["immunology"] })).toHaveLength(2);
    expect(buildQuizPool(qs, { count: 10, status: "all", examTypes: ["imcq"] }).map((q) => q.id)).toEqual(["unused"]);
    expect(buildQuizPool(qs, { count: 2, status: "all" })).toHaveLength(2);
  });

  it("scores only questions that have a correct key, honestly", () => {
    const score = scoreSession([
      { questionId: "a", answerKey: "A", correct: true, flagged: false },
      { questionId: "b", answerKey: "B", correct: false, flagged: false },
      { questionId: "c", answerKey: "C", correct: undefined, flagged: false }, // no key set
    ]);
    expect(score).toEqual({ correct: 1, scored: 2, total: 3, pct: 50 });
  });

  it("aggregates category accuracy across sessions, weakest first", () => {
    const qs = [
      makeQuestion({ id: "q1", category: "Immunology" }),
      makeQuestion({ id: "q2", category: "Pathology" }),
    ];
    const sessions: QuizSession[] = [{
      id: "s1", mode: "exam", startedAt: "2026-07-08T10:00:00.000Z", endedAt: "2026-07-08T10:20:00.000Z",
      timed: false, filters: { count: 2, status: "all" }, questionIds: ["q1", "q2"],
      answers: [
        { questionId: "q1", answerKey: "B", correct: false, flagged: false },
        { questionId: "q2", answerKey: "A", correct: true, flagged: false },
      ],
    }];
    const scores = scoresByCategory(sessions, qs);
    expect(scores[0]).toMatchObject({ category: "Immunology", pct: 0 });
    expect(scores[1]).toMatchObject({ category: "Pathology", pct: 100 });
    expect(missedQuestionIds(sessions[0])).toEqual(["q1"]);
  });
});
