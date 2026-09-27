import type { ParsedQuestionDraft } from "./questionParse";

export type DraftImportStatus = "ready" | "review-suggested" | "unresolved";
export type DraftReviewLevel = "High" | "Needs Review" | "Invalid";
export type DraftEvaluationSeverity = "review" | "invalid";

export type DraftEvaluationCode =
  | "draft-missing"
  | "missing-stem"
  | "too-few-usable-options"
  | "incomplete-option"
  | "duplicate-option-labels"
  | "inconsistent-option-labels"
  | "explanation-detected-as-option"
  | "missing-correct-answer"
  | "correct-answer-not-option"
  | "conflicting-answer-keys"
  | "unrecognized-answer-key"
  | "answer-mapping-needs-review"
  | "structurally-ambiguous-block"
  | "duplicate-question-number"
  | "invalid-question-number"
  | "unusual-question-numbering"
  | "explanation-boundary-ambiguous"
  | "source-text-edited"
  | "parser-review-required"
  | "parser-confidence-needs-review";

export interface DraftEvaluationReason {
  code: DraftEvaluationCode;
  message: string;
  severity: DraftEvaluationSeverity;
}

export interface DraftImportEvaluation {
  /** A plain-language projection of deterministic parser and current-field state. */
  level: DraftReviewLevel;
  /** `false` only for structural blockers that must be corrected or removed. */
  isValid: boolean;
  /** Alias for the finalization boundary used by import UIs. */
  canFinalize: boolean;
  reasons: DraftEvaluationReason[];
}

export interface DraftImportSummary {
  ready: number;
  reviewSuggested: number;
  unresolved: number;
  explanationsFound: number;
  explanationsMissing: number;
  sourceConfidence: Record<"high" | "medium" | "low", number>;
}

const EXPLANATION_OPTION_RE = /^(?:answer\s+explanation|explanation|rationale|reasoning|discussion|teaching\s+point|key\s+concept|why|(?:correct|incorrect)\s+feedback)\s*[:\-–]/i;

const ANSWER_CONFLICT_RULES = new Set([
  "conflict.answer-letter-vs-text",
  "conflict.explicit-answer",
  "conflict.answer-vs-explanation",
  "conflict.answer-vs-rationale",
  "conflict.inferred-answer",
  "conflict.answer-section-text",
  "conflict.answer-section-letter-text",
  "conflict.answer-section",
  "conflict.block-vs-answer-section",
  "conflict.user-confirmed-mapping-vs-reparse",
]);

const UNRECOGNIZED_ANSWER_RULES = new Set([
  "ambiguous.answer-text",
  "answer.text-no-option-match",
  "answer.section-text-unmatched",
  "answer.section-invalid-option",
  "answer.structured-unresolved",
  "answer.structured-invalid-key",
  "answer.structured-ambiguous-text",
]);

const INFERRED_OR_AMBIGUOUS_ANSWER_RULES = new Set([
  "answer.explicit-letter-text-drift",
  "answer.text-option-match",
  "answer.trailing-text-match",
  "answer.structured-unique-text",
  "answer.explanation-prose",
  "answer.explanation-text-match",
  "answer.choice-rationale",
  "ai.mapping-assist.reviewed-suggestion",
]);

function normalizedKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function addReason(
  reasons: DraftEvaluationReason[],
  code: DraftEvaluationCode,
  message: string,
  severity: DraftEvaluationSeverity,
): void {
  if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, message, severity });
}

/**
 * Evaluate the draft as it exists now, after any learner edits.
 *
 * Parser diagnostics remain evidence, but they never replace validation of the
 * live stem, options, and answer mapping. A learner-confirmed answer mapping
 * supersedes answer-only parser ambiguity; it cannot waive structural defects.
 */
interface DraftEvaluationContext {
  /** Present only when the caller can see the entire current review batch. */
  duplicateQuestionNumber?: boolean;
}

function evaluateImportDraftInContext(
  draft: ParsedQuestionDraft | undefined,
  context: DraftEvaluationContext = {},
): DraftImportEvaluation {
  const reasons: DraftEvaluationReason[] = [];
  if (!draft) {
    addReason(reasons, "draft-missing", "No parsed question is available for review.", "invalid");
    return { level: "Invalid", isValid: false, canFinalize: false, reasons };
  }

  const options = Array.isArray(draft.options) ? draft.options : [];
  const usableOptions = options.filter((option) => (
    normalizedKey(option?.key) && typeof option?.text === "string" && Boolean(option.text.trim())
  ));
  const optionKeys = usableOptions.map((option) => normalizedKey(option.key));
  const currentCorrectKey = normalizedKey(draft.correctKey);
  const parserRules = new Set(Array.isArray(draft.parserRuleIds) ? draft.parserRuleIds : []);
  const userReviewedAnswer = parserRules.has("answer.user-reviewed-mapping");

  if (!draft.stem?.trim()) {
    addReason(reasons, "missing-stem", "Add a question stem before finalizing.", "invalid");
  }
  if (usableOptions.length < 2) {
    addReason(
      reasons,
      "too-few-usable-options",
      "Add at least two answer choices with both a label and text.",
      "invalid",
    );
  }
  if (usableOptions.length !== options.length) {
    addReason(
      reasons,
      "incomplete-option",
      "Every answer choice must have both a label and text, or be removed.",
      "invalid",
    );
  }
  if (new Set(optionKeys).size !== optionKeys.length) {
    addReason(reasons, "duplicate-option-labels", "Answer choice labels must be unique.", "invalid");
  }

  const expectedKeys = optionKeys.map((_, index) => String.fromCharCode(65 + index));
  if (
    optionKeys.length > 0
    && new Set(optionKeys).size === optionKeys.length
    && optionKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    addReason(
      reasons,
      "inconsistent-option-labels",
      "Answer choice labels are out of sequence; confirm their order before finalizing.",
      "review",
    );
  }

  if (options.some((option) => EXPLANATION_OPTION_RE.test(option?.text?.trim() ?? ""))) {
    addReason(
      reasons,
      "explanation-detected-as-option",
      "A choice begins with an explanation or rationale label; verify that it is an authored option rather than misplaced explanation text.",
      "review",
    );
  }

  if (!currentCorrectKey) {
    addReason(reasons, "missing-correct-answer", "Select a correct answer before finalizing.", "invalid");
  } else if (!optionKeys.includes(currentCorrectKey)) {
    addReason(
      reasons,
      "correct-answer-not-option",
      `Correct answer "${currentCorrectKey}" does not match an existing answer choice.`,
      "invalid",
    );
  }

  const hasAnswerConflict = [...parserRules].some((rule) => ANSWER_CONFLICT_RULES.has(rule));
  if (hasAnswerConflict && !userReviewedAnswer) {
    addReason(
      reasons,
      "conflicting-answer-keys",
      "The source contains conflicting answer signals; select and confirm the intended answer.",
      "invalid",
    );
  }

  const hasUnrecognizedAnswer = [...parserRules].some((rule) => UNRECOGNIZED_ANSWER_RULES.has(rule));
  if (hasUnrecognizedAnswer && !userReviewedAnswer) {
    addReason(
      reasons,
      "unrecognized-answer-key",
      currentCorrectKey
        ? "The source answer format was not recognized reliably; confirm the selected answer."
        : "The source answer format was not recognized; select and confirm the intended answer.",
      currentCorrectKey ? "review" : "invalid",
    );
  }

  const explicitLetterAndTextAgree = parserRules.has("answer.explicit-letter-exact");
  const hasAmbiguousAnswer = [...parserRules].some((rule) => (
    INFERRED_OR_AMBIGUOUS_ANSWER_RULES.has(rule)
    && !(explicitLetterAndTextAgree && rule === "answer.text-option-match")
  ));
  if (hasAmbiguousAnswer && !userReviewedAnswer) {
    addReason(
      reasons,
      "answer-mapping-needs-review",
      "The answer was inferred or only partially matched; confirm it against the source.",
      "review",
    );
  }

  if (
    parserRules.has("question.malformed-boundary")
    || parserRules.has("question.ambiguous-explanation-boundary")
    || parserRules.has("question.ambiguous-numbered-stem-list")
  ) {
    addReason(
      reasons,
      "structurally-ambiguous-block",
      "The parser could not safely separate this block from a neighboring question.",
      "invalid",
    );
  }
  const staleDuplicateNumberResolved = (
    context.duplicateQuestionNumber === false
    && parserRules.has("conflict.duplicate-question-number")
  );
  const hasDuplicateQuestionNumber = context.duplicateQuestionNumber
    ?? parserRules.has("conflict.duplicate-question-number");
  if (hasDuplicateQuestionNumber) {
    addReason(
      reasons,
      "duplicate-question-number",
      "This source contains a duplicate question number; correct the numbering before finalizing.",
      "invalid",
    );
  }
  if (
    draft.questionNumber !== undefined
    && (!Number.isInteger(draft.questionNumber) || draft.questionNumber <= 0)
  ) {
    addReason(
      reasons,
      "invalid-question-number",
      "Question number must be a positive whole number or left blank.",
      "invalid",
    );
  }
  if (
    parserRules.has("question.unusual-numbering")
    || (draft.warnings ?? []).some((warning) => /unusual\s+(?:question\s+)?number/i.test(warning))
  ) {
    addReason(
      reasons,
      "unusual-question-numbering",
      "The source uses unusual question numbering; confirm this question belongs to the right block.",
      "review",
    );
  }

  const hasExplanationAmbiguity = (
    parserRules.has("explanation.ambiguous-boundary")
    || parserRules.has("ai.explanation-cleaner.review-required")
    || Boolean(
      draft.explanation?.trim()
      && draft.explanationDetectionConfidence !== undefined
      && draft.explanationDetectionConfidence < 0.75,
    )
  );
  if (hasExplanationAmbiguity) {
    addReason(
      reasons,
      "explanation-boundary-ambiguous",
      "The explanation boundary is uncertain; confirm that only the intended rationale is attached.",
      "review",
    );
  }

  if (parserRules.has("import.source-text-edited")) {
    addReason(
      reasons,
      "source-text-edited",
      "The extracted source text was edited; review every parsed field against the original source.",
      "review",
    );
  }

  if (
    draft.needsReview
    && !userReviewedAnswer
    && reasons.length === 0
    && !hasAnswerConflict
    && !hasUnrecognizedAnswer
    && !staleDuplicateNumberResolved
  ) {
    addReason(
      reasons,
      "parser-review-required",
      "The parser found an ambiguity that requires source review.",
      "review",
    );
  }
  const hasStageMetrics = draft.questionDetectionConfidence !== undefined
    || draft.answerDetectionConfidence !== undefined
    || draft.explanationDetectionConfidence !== undefined;
  const confidenceHasConsequentialAmbiguity = (
    (draft.questionDetectionConfidence !== undefined && draft.questionDetectionConfidence < 0.75)
    || (!userReviewedAnswer
      && Boolean(currentCorrectKey)
      && draft.answerDetectionConfidence !== undefined
      && draft.answerDetectionConfidence < 0.8)
    || (Boolean(draft.explanation?.trim())
      && draft.explanationDetectionConfidence !== undefined
      && draft.explanationDetectionConfidence < 0.75)
    || (!userReviewedAnswer && !hasStageMetrics && draft.confidence !== "high")
  );
  if (
    confidenceHasConsequentialAmbiguity
    && !staleDuplicateNumberResolved
    && reasons.length === 0
  ) {
    addReason(
      reasons,
      "parser-confidence-needs-review",
      "Parser confidence is below high; confirm the extracted fields against the source.",
      "review",
    );
  }

  const isValid = !reasons.some((reason) => reason.severity === "invalid");
  const level: DraftReviewLevel = !isValid
    ? "Invalid"
    : reasons.length > 0
      ? "Needs Review"
      : "High";
  return { level, isValid, canFinalize: isValid, reasons };
}

export function evaluateImportDraft(
  draft: ParsedQuestionDraft | undefined,
): DraftImportEvaluation {
  return evaluateImportDraftInContext(draft);
}

/**
 * Batch-aware evaluation for review screens. Current positive, whole-numbered
 * fields are authoritative, so edits can both introduce and resolve duplicate
 * question numbers without mutating the parser's audit trail.
 */
export function evaluateImportDrafts(
  drafts: readonly ParsedQuestionDraft[],
): DraftImportEvaluation[] {
  const numberCounts = new Map<number, number>();
  for (const draft of drafts) {
    const number = draft.questionNumber;
    if (number !== undefined && Number.isInteger(number) && number > 0) {
      numberCounts.set(number, (numberCounts.get(number) ?? 0) + 1);
    }
  }
  return drafts.map((draft) => {
    const number = draft.questionNumber;
    const duplicateQuestionNumber = number !== undefined
      && Number.isInteger(number)
      && number > 0
      && (numberCounts.get(number) ?? 0) > 1;
    return evaluateImportDraftInContext(draft, { duplicateQuestionNumber });
  });
}

function statusFromLevel(level: DraftReviewLevel): DraftImportStatus {
  if (level === "High") return "ready";
  if (level === "Needs Review") return "review-suggested";
  return "unresolved";
}

/** Canonical pre-save trust state used by import UI and acceptance tooling. */
export function draftImportStatus(draft: ParsedQuestionDraft | undefined): DraftImportStatus {
  return statusFromLevel(evaluateImportDraft(draft).level);
}

export function summarizeImportDrafts(drafts: readonly ParsedQuestionDraft[]): DraftImportSummary {
  const summary: DraftImportSummary = {
    ready: 0,
    reviewSuggested: 0,
    unresolved: 0,
    explanationsFound: 0,
    explanationsMissing: 0,
    sourceConfidence: { high: 0, medium: 0, low: 0 },
  };
  const evaluations = evaluateImportDrafts(drafts);
  drafts.forEach((draft, index) => {
    const status = statusFromLevel(evaluations[index].level);
    if (status === "ready") summary.ready += 1;
    else if (status === "review-suggested") summary.reviewSuggested += 1;
    else summary.unresolved += 1;
    if (draft.explanation?.trim()) summary.explanationsFound += 1;
    else summary.explanationsMissing += 1;
    summary.sourceConfidence[draft.confidence] += 1;
  });
  return summary;
}
