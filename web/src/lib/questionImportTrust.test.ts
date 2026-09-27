import { describe, expect, it } from "vitest";
import type { ParsedQuestionDraft } from "./questionParse";
import {
  draftImportStatus,
  evaluateImportDraft,
  evaluateImportDrafts,
  summarizeImportDrafts,
} from "./questionImportTrust";

const draft = (patch: Partial<ParsedQuestionDraft> = {}): ParsedQuestionDraft => ({
  stem: "Sanitized question?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B",
  correctAnswerText: "Beta",
  confidence: "high",
  warnings: [],
  ...patch,
});

const reasonCodes = (value: ParsedQuestionDraft | undefined) => (
  evaluateImportDraft(value).reasons.map((reason) => reason.code)
);

describe("current-state question import evaluation", () => {
  it("reports a complete, unambiguous live draft as High", () => {
    expect(evaluateImportDraft(draft())).toEqual({
      level: "High",
      isValid: true,
      canFinalize: true,
      reasons: [],
    });
  });

  it.each([
    ["missing draft", undefined, "draft-missing"],
    ["missing stem", draft({ stem: "  " }), "missing-stem"],
    ["fewer than two usable choices", draft({ options: [{ key: "A", text: "Alpha" }], correctKey: "A" }), "too-few-usable-options"],
    ["a choice with blank text", draft({ options: [{ key: "A", text: "Alpha" }, { key: "B", text: " " }] }), "incomplete-option"],
    ["a choice with a blank label", draft({ options: [{ key: "A", text: "Alpha" }, { key: " ", text: "Beta" }] }), "incomplete-option"],
    ["duplicate labels", draft({ options: [{ key: "A", text: "Alpha" }, { key: "a", text: "Another" }] }), "duplicate-option-labels"],
    ["missing correct answer", draft({ correctKey: undefined, correctAnswerText: undefined }), "missing-correct-answer"],
    ["answer outside choices", draft({ correctKey: "C", correctAnswerText: undefined }), "correct-answer-not-option"],
    ["invalid question number", draft({ questionNumber: 1.5 }), "invalid-question-number"],
  ] as const)("blocks %s", (_label, value, expectedCode) => {
    const result = evaluateImportDraft(value);
    expect(result).toMatchObject({ level: "Invalid", isValid: false, canFinalize: false });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expectedCode, severity: "invalid" }),
    ]));
  });

  it("uses trimmed, case-insensitive labels when validating the live mapping", () => {
    expect(evaluateImportDraft(draft({
      options: [{ key: " a ", text: "Alpha" }, { key: "b", text: "Beta" }],
      correctKey: " b ",
    }))).toMatchObject({ level: "High", isValid: true });
  });

  it("marks live inconsistent option labels for review without making the draft structurally invalid", () => {
    const result = evaluateImportDraft(draft({
      options: [{ key: "A", text: "Alpha" }, { key: "C", text: "Gamma" }],
      correctKey: "C",
    }));
    expect(result).toMatchObject({ level: "Needs Review", isValid: true, canFinalize: true });
    expect(reasonCodes(draft({
      options: [{ key: "A", text: "Alpha" }, { key: "C", text: "Gamma" }],
      correctKey: "C",
    }))).toContain("inconsistent-option-labels");
  });

  it("does not preserve a stale nonsequential-label warning after the live labels are corrected", () => {
    expect(evaluateImportDraft(draft({ parserRuleIds: ["options.nonsequential"] }))).toMatchObject({
      level: "High",
      reasons: [],
    });
  });

  it("requires review without irreversibly blocking a marker-leading authored option", () => {
    const value = draft({
      options: [
        { key: "A", text: "Alpha" },
        { key: "B", text: "Beta" },
        { key: "C", text: "Why: impaired clearance increases the serum concentration" },
      ],
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Needs Review", isValid: true, canFinalize: true });
    expect(reasonCodes(value)).toContain("explanation-detected-as-option");
  });

  it("does not mistake a lettered teaching list inside the explanation for choices", () => {
    const value = draft({
      explanation: "The mechanism has two parts:\nA. receptor binding\nB. downstream signaling",
      explanationDetectionConfidence: 0.96,
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "High", reasons: [] });
  });

  it.each([
    "conflict.answer-letter-vs-text",
    "conflict.explicit-answer",
    "conflict.answer-vs-explanation",
    "conflict.answer-section-letter-text",
    "conflict.block-vs-answer-section",
  ])("blocks unresolved answer conflict %s", (ruleId) => {
    const value = draft({ parserRuleIds: [ruleId] });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(value)).toContain("conflicting-answer-keys");
  });

  it("lets a learner-confirmed live answer supersede answer-only conflict history", () => {
    const value = draft({
      correctKey: "A",
      correctAnswerText: "stale text is deliberately ignored",
      confidence: "low",
      needsReview: true,
      parserRuleIds: [
        "conflict.answer-letter-vs-text",
        "answer.user-reviewed-mapping",
      ],
    });
    expect(evaluateImportDraft(value)).toEqual({
      level: "High",
      isValid: true,
      canFinalize: true,
      reasons: [],
    });
  });

  it("never lets answer review waive a current answer mismatch", () => {
    const value = draft({
      correctKey: "C",
      parserRuleIds: ["conflict.answer-letter-vs-text", "answer.user-reviewed-mapping"],
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(value)).toContain("correct-answer-not-option");
  });

  it.each([
    "answer.explanation-prose",
    "answer.text-option-match",
    "answer.trailing-text-match",
    "answer.structured-unique-text",
    "answer.explicit-letter-text-drift",
  ])("routes inferred or drifting answer mapping %s to review until confirmed", (ruleId) => {
    const inferred = draft({ parserRuleIds: [ruleId], needsReview: true, confidence: "medium" });
    expect(evaluateImportDraft(inferred)).toMatchObject({ level: "Needs Review", canFinalize: true });
    expect(reasonCodes(inferred)).toContain("answer-mapping-needs-review");

    expect(evaluateImportDraft({
      ...inferred,
      parserRuleIds: [ruleId, "answer.user-reviewed-mapping"],
    })).toMatchObject({ level: "High", reasons: [] });
  });

  it("treats an explicit answer letter with exactly matching option text as High", () => {
    const value = draft({
      parserRuleIds: ["answer.explicit-letter-text", "answer.text-option-match", "answer.explicit-letter-exact"],
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "High", canFinalize: true, reasons: [] });
  });

  it("distinguishes an unrecognized answer format before and after a candidate key exists", () => {
    const unresolved = draft({
      correctKey: undefined,
      correctAnswerText: undefined,
      parserRuleIds: ["answer.structured-unresolved"],
    });
    expect(evaluateImportDraft(unresolved)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(unresolved)).toEqual(expect.arrayContaining([
      "missing-correct-answer",
      "unrecognized-answer-key",
    ]));

    const candidate = draft({ parserRuleIds: ["answer.structured-unresolved"] });
    expect(evaluateImportDraft(candidate)).toMatchObject({ level: "Needs Review", canFinalize: true });
    expect(reasonCodes(candidate)).toContain("unrecognized-answer-key");
  });

  it("keeps structural parser conflicts invalid after answer confirmation", () => {
    const malformed = draft({
      parserRuleIds: ["question.malformed-boundary", "answer.user-reviewed-mapping"],
    });
    expect(evaluateImportDraft(malformed)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(malformed)).toContain("structurally-ambiguous-block");

    const ambiguousNumberedStem = draft({
      parserRuleIds: ["question.numbered-stem-list", "question.ambiguous-numbered-stem-list"],
      needsReview: true,
    });
    expect(evaluateImportDraft(ambiguousNumberedStem)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(ambiguousNumberedStem)).toContain("structurally-ambiguous-block");

    const duplicateNumber = draft({
      parserRuleIds: ["conflict.duplicate-question-number", "answer.user-reviewed-mapping"],
    });
    expect(evaluateImportDraft(duplicateNumber)).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(reasonCodes(duplicateNumber)).toContain("duplicate-question-number");
  });

  it("uses live batch numbering to detect duplicates introduced by edits", () => {
    const values = [draft({ questionNumber: 7 }), draft({ questionNumber: 7 })];
    const before = structuredClone(values);
    const results = evaluateImportDrafts(values);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.level === "Invalid" && !result.canFinalize)).toBe(true);
    expect(results.every((result) => (
      result.reasons.some((reason) => reason.code === "duplicate-question-number")
    ))).toBe(true);
    expect(values).toEqual(before);
  });

  it("clears stale duplicate-number diagnostics when the live batch numbering is fixed", () => {
    const parserPatch: Partial<ParsedQuestionDraft> = {
      confidence: "low",
      needsReview: true,
      parserRuleIds: ["conflict.duplicate-question-number"],
    };
    const results = evaluateImportDrafts([
      draft({ ...parserPatch, questionNumber: 7 }),
      draft({ ...parserPatch, questionNumber: 8 }),
    ]);
    expect(results).toEqual([
      { level: "High", isValid: true, canFinalize: true, reasons: [] },
      { level: "High", isValid: true, canFinalize: true, reasons: [] },
    ]);
  });

  it("retains unrelated blockers after a stale duplicate number is fixed", () => {
    const [result] = evaluateImportDrafts([draft({
      stem: " ",
      questionNumber: 8,
      confidence: "low",
      needsReview: true,
      parserRuleIds: ["conflict.duplicate-question-number"],
    })]);
    expect(result).toMatchObject({ level: "Invalid", canFinalize: false });
    expect(result.reasons.map((reason) => reason.code)).toContain("missing-stem");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("duplicate-question-number");
  });

  it("exposes unusual numbering and uncertain explanation boundaries as explicit review reasons", () => {
    const value = draft({
      explanation: "Beta is supported.",
      explanationDetectionConfidence: 0.6,
      parserRuleIds: ["question.unusual-numbering"],
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Needs Review", isValid: true });
    expect(reasonCodes(value)).toEqual([
      "unusual-question-numbering",
      "explanation-boundary-ambiguous",
    ]);
  });

  it("falls back to explicit parser review and confidence reasons without duplicating them", () => {
    expect(reasonCodes(draft({ needsReview: true }))).toEqual(["parser-review-required"]);
    expect(reasonCodes(draft({ confidence: "medium" }))).toEqual(["parser-confidence-needs-review"]);
    expect(reasonCodes(draft({ needsReview: true, confidence: "low" }))).toEqual(["parser-review-required"]);
  });

  it("does not let a stale High category hide low stage confidence", () => {
    const value = draft({
      confidence: "high",
      questionDetectionConfidence: 0.1,
      answerDetectionConfidence: 1,
      explanationDetectionConfidence: 1,
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Needs Review", isValid: true });
    expect(reasonCodes(value)).toContain("parser-confidence-needs-review");
  });

  it("keeps edited-source review independent from answer confirmation", () => {
    const value = draft({
      needsReview: false,
      parserRuleIds: ["import.source-text-edited", "answer.user-reviewed-mapping"],
    });
    expect(evaluateImportDraft(value)).toMatchObject({ level: "Needs Review", isValid: true });
    expect(reasonCodes(value)).toContain("source-text-edited");
  });

  it("is pure and deterministic", () => {
    const value = draft({
      options: [{ key: "A", text: "Alpha" }, { key: "A", text: "Again" }],
      correctKey: undefined,
      needsReview: true,
    });
    const before = structuredClone(value);
    expect(evaluateImportDraft(value)).toEqual(evaluateImportDraft(value));
    expect(value).toEqual(before);
  });
});

describe("backwards-compatible import trust projections", () => {
  it("keeps unresolved, review-suggested, and ready states distinct", () => {
    const ready = draft({ explanation: "Because beta." });
    const suggested = draft({ confidence: "medium" });
    const unresolved = draft({ correctKey: undefined, needsReview: true, confidence: "low" });
    expect([ready, suggested, unresolved].map(draftImportStatus)).toEqual([
      "ready", "review-suggested", "unresolved",
    ]);
    expect(summarizeImportDrafts([ready, suggested, unresolved])).toEqual({
      ready: 1,
      reviewSuggested: 1,
      unresolved: 1,
      explanationsFound: 1,
      explanationsMissing: 2,
      sourceConfidence: { high: 1, medium: 1, low: 1 },
    });
  });
});
