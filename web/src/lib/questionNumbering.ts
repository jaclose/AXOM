// ===========================================================================
// Repeated question numbers, resolved from the document's own structure.
//
// Practice-question handouts reuse numbers for two ordinary reasons:
//   1. Each lecture section restarts at 1 ("NB 01 ... 1-11", "NB 02 ... 1-9").
//   2. The questions are printed twice: a "Questions Only" part followed by a
//      "Questions with Answers and Explanations" part that repeats every stem
//      and adds "Answer Key: C" plus the rationale.
// Flagging the whole document for either case discarded every printed key in
// it. This pass reads the numbering as runs, merges a repeated copy into the
// first printing (carrying the printed key and explanation across), and keeps
// a review flag only on drafts whose numbering is genuinely inconsistent.
// It never invents an answer: a key is only ever copied from the document's
// own repeated printing, and two printings that disagree are a conflict.
// ===========================================================================
import type { ParsedQuestionDraft } from "./questionParse";

export interface NumberingResolution {
  drafts: ParsedQuestionDraft[];
  /** Repeated printings folded into their first printing. */
  merged: number;
  /** Numbering runs after the first (restarts at a new section or copy). */
  restarts: number;
  /** Drafts whose numbering still cannot be explained by the document. */
  conflicted: ParsedQuestionDraft[];
}

const normalize = (text: string | undefined) =>
  (text ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const words = (text: string) => new Set(text.split(" ").filter((word) => word.length > 1));

function similarity(a: string, b: string): number {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Same choice text, allowing a heading line glued onto one printing's choice. */
function sameChoice(a: string, b: string): boolean {
  const left = normalize(a), right = normalize(b);
  if (left === right || similarity(left, right) >= 0.8) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 3 && long.startsWith(short + " ");
}

function optionsAgree(a: ParsedQuestionDraft, b: ParsedQuestionDraft): boolean {
  if (!a.options.length || !b.options.length) return true;
  if (a.options.length !== b.options.length) return false;
  return a.options.every((option, index) => option.key === b.options[index].key && sameChoice(option.text, b.options[index].text));
}

/** Where one printing's choice carries a glued heading, keep the clean text. */
function cleanChoices(first: ParsedQuestionDraft, copy: ParsedQuestionDraft): void {
  if (first.options.length !== copy.options.length) return;
  first.options = first.options.map((option, index) => {
    const other = copy.options[index].text.trim();
    const mine = option.text.trim();
    return other.length >= 3 && mine.length > other.length && normalize(mine).startsWith(normalize(other) + " ")
      ? { ...option, text: other } : option;
  });
}

/** True when `copy` is another printing of `first`: same number, wording and choices. */
export function isRepeatedPrinting(first: ParsedQuestionDraft, copy: ParsedQuestionDraft): boolean {
  if (first.questionNumber === undefined || first.questionNumber !== copy.questionNumber) return false;
  const a = normalize(first.stem), b = normalize(copy.stem);
  if (a.length < 25 || b.length < 25) return false;
  return (a === b || similarity(a, b) >= 0.9) && optionsAgree(first, copy);
}

/** A second printing is folded in only when it supplies what the first lacks. */
function supplies(first: ParsedQuestionDraft, copy: ParsedQuestionDraft): boolean {
  if (first.correctKey && copy.correctKey) return false;
  return Boolean((copy.correctKey && !first.correctKey) || (copy.explanation && !first.explanation));
}

const addRule = (draft: ParsedQuestionDraft, rule: string) => {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), rule])];
};

/** Fold `copy` into `first`, keeping the first printing's wording and position. */
function mergePrinting(first: ParsedQuestionDraft, copy: ParsedQuestionDraft): void {
  cleanChoices(first, copy);
  if (copy.correctKey && !first.correctKey) {
    // The unanswered printing is usually held only because it has no key. When
    // that was its sole doubt, it takes the answered printing's review state.
    const missingKey = (warning: string) => warning.startsWith("No correct answer was reliably detected");
    const ownDoubt = (first.parserRuleIds ?? []).some((rule) => rule.startsWith("conflict.") || rule.includes("ambiguous"))
      || first.warnings.some((warning) => !missingKey(warning));
    if (!ownDoubt) {
      first.needsReview = copy.needsReview;
      first.confidence = copy.confidence;
      first.overallImportConfidence = copy.overallImportConfidence;
    }
    first.correctKey = copy.correctKey;
    first.correctAnswerText = first.options.find((option) => option.key === copy.correctKey)?.text ?? copy.correctAnswerText;
    first.answerEvidence = copy.answerEvidence;
    first.answerEvidenceSnippet = copy.answerEvidenceSnippet;
    first.answerEvidencePage = copy.answerEvidencePage ?? copy.sourcePage;
    first.answerDetectionConfidence = copy.answerDetectionConfidence;
    first.warnings = first.warnings.filter((warning) => !warning.startsWith("No correct answer was reliably detected"));
    for (const rule of copy.parserRuleIds ?? []) if (rule.startsWith("answer.")) addRule(first, rule);
    addRule(first, "answer.repeat-copy");
  }
  if (copy.explanation && !first.explanation) {
    first.explanation = copy.explanation;
    first.explanationSource = copy.explanationSource;
    first.explanationSourceSnippet = copy.explanationSourceSnippet;
    first.explanationSourcePage = copy.explanationSourcePage ?? copy.sourcePage;
    first.explanationDetectionConfidence = copy.explanationDetectionConfidence;
    first.explanationRawCandidate = copy.explanationRawCandidate;
    first.explanationCleanupOperations = copy.explanationCleanupOperations;
  }
  if (copy.choiceRationales && !first.choiceRationales) first.choiceRationales = copy.choiceRationales;
  // A structural doubt about the answered printing is a doubt about the key it
  // carried. Matching the clean printing settles where that printing STARTS;
  // where its explanation ends only affects the explanation, never the key.
  const settledByMatch = new Set(["question.ambiguous-explanation-boundary", "explanation.ambiguous-boundary"]);
  const doubtful = (copy.parserRuleIds ?? []).filter((rule) => !settledByMatch.has(rule) && (rule.startsWith("conflict.") || rule.includes("ambiguous")));
  if (doubtful.length && copy.correctKey) {
    first.needsReview = true;
    for (const rule of doubtful) addRule(first, rule);
    first.warnings.push("The answered printing of this question had an uncertain boundary. Confirm the key against the source.");
  }
  if ((copy.parserRuleIds ?? []).includes("explanation.ambiguous-boundary") && copy.explanation && first.explanation === copy.explanation) {
    addRule(first, "explanation.ambiguous-boundary");
    first.warnings.push("Where this explanation ends could not be confirmed. Check that it does not run into the next question.");
  }
  addRule(first, "question.repeat-copy-merged");
}

const BOUNDARY_WARNINGS = [
  "This question began inside an explanation without a clear separator",
  "Numbered question-like content touched an explanation without a clear separator",
];
/** Confidence given to a boundary the document's own numbering and structure confirm. */
const CONFIRMED_BOUNDARY_CONFIDENCE = 0.8;

/** A whole question: a real stem and three or more choices lettered A, B, C... in order. */
function structurallyComplete(draft: ParsedQuestionDraft): boolean {
  return normalize(draft.stem).length >= 30
    && draft.options.length >= 3
    && draft.options.every((option, index) => option.key === String.fromCharCode(65 + index) && option.text.trim().length > 0);
}

function clearBoundaryDoubt(draft: ParsedQuestionDraft, rules: readonly string[]): void {
  draft.parserRuleIds = (draft.parserRuleIds ?? []).filter((rule) => !rules.includes(rule));
  draft.warnings = draft.warnings.filter((warning) => !BOUNDARY_WARNINGS.some((prefix) => warning.startsWith(prefix)));
  const remaining = (draft.parserRuleIds ?? []).some((rule) => rule.startsWith("conflict.") || rule.includes("ambiguous") || rule.includes("malformed"))
    || draft.warnings.some((warning) => !warning.startsWith("No correct answer was reliably detected"));
  for (const field of ["questionDetectionConfidence", "explanationDetectionConfidence", "overallImportConfidence"] as const) {
    const value = draft[field];
    if (value !== undefined && value < CONFIRMED_BOUNDARY_CONFIDENCE) draft[field] = CONFIRMED_BOUNDARY_CONFIDENCE;
  }
  if (draft.confidence === "low") draft.confidence = "medium";
  if (!remaining && draft.correctKey) draft.needsReview = false;
  addRule(draft, "question.boundary-confirmed-by-sequence");
}

/**
 * "2." straight after question 1's explanation, followed by choices A-E, is the
 * next question, not a numbered list inside the explanation. When the numbers
 * run consecutively and both questions are structurally whole, the boundary the
 * parser could not see is confirmed by the document itself.
 */
export function confirmSequentialBoundaries(drafts: readonly ParsedQuestionDraft[]): number {
  let confirmed = 0;
  for (let index = 1; index < drafts.length; index++) {
    const previous = drafts[index - 1], next = drafts[index];
    if (!(next.parserRuleIds ?? []).includes("question.ambiguous-explanation-boundary")) continue;
    // The later question must carry its own printed answer: an explanation's
    // numbered point is never followed by lettered choices and a key.
    if (!next.correctKey) continue;
    if (previous.questionNumber === undefined || next.questionNumber !== previous.questionNumber + 1) continue;
    if (!structurallyComplete(previous) || !structurallyComplete(next)) continue;
    clearBoundaryDoubt(next, ["question.ambiguous-explanation-boundary", "explanation.ambiguous-boundary"]);
    if ((previous.parserRuleIds ?? []).includes("explanation.ambiguous-boundary")
      && !(previous.parserRuleIds ?? []).includes("question.ambiguous-explanation-boundary")) {
      clearBoundaryDoubt(previous, ["explanation.ambiguous-boundary"]);
    }
    confirmed++;
  }
  return confirmed;
}

/**
 * Resolve repeated numbers. `sectionOf` returns the parser's declared section
 * for a draft (a "Source:" header group); a change of section also starts a run.
 */
export function resolveRepeatedNumbering(
  input: readonly ParsedQuestionDraft[],
  sectionOf: (draft: ParsedQuestionDraft) => string = () => "",
): NumberingResolution {
  // 0. Boundaries the numbering itself confirms are no longer doubts.
  confirmSequentialBoundaries(input);
  // 1. Fold repeated printings into the first printing.
  const kept: ParsedQuestionDraft[] = [];
  const byNumber = new Map<number, ParsedQuestionDraft[]>();
  let merged = 0;
  for (const draft of input) {
    const first = draft.questionNumber === undefined ? undefined : byNumber.get(draft.questionNumber)
      ?.find((candidate) => sectionOf(candidate) === sectionOf(draft) && isRepeatedPrinting(candidate, draft) && supplies(candidate, draft));
    if (first) {
      mergePrinting(first, draft);
      merged++;
      continue;
    }
    kept.push(draft);
    if (draft.questionNumber !== undefined) {
      byNumber.set(draft.questionNumber, [...(byNumber.get(draft.questionNumber) ?? []), draft]);
    }
  }

  // 2. Read the remaining numbering as runs. A run that restarts at 1 and
  //    continues (1, 2, ...) is a new section; so is a new declared section.
  //    Any other drop in numbering is unexplained.
  const runs: Array<{ drafts: ParsedQuestionDraft[]; newSection: boolean }> = [];
  let section: string | undefined;
  for (const draft of kept) {
    if (draft.questionNumber === undefined) continue;
    const draftSection = sectionOf(draft);
    const run = runs[runs.length - 1];
    const last = run?.drafts[run.drafts.length - 1];
    const newSection = section !== undefined && draftSection !== section;
    if (!run || newSection || draft.questionNumber <= (last?.questionNumber ?? 0)) runs.push({ drafts: [draft], newSection });
    else run.drafts.push(draft);
    section = draftSection;
  }
  // Runs between confirmed restarts form one segment. Out-of-order numbering
  // alone is not a duplicate; only a number printed twice in one segment is.
  const conflicted = new Set<ParsedQuestionDraft>();
  const segments: ParsedQuestionDraft[][] = [];
  for (const [index, { drafts, newSection }] of runs.entries()) {
    const restart = index > 0 && (newSection || (drafts[0].questionNumber === 1 && drafts.length >= 2));
    if (restart) addRule(drafts[0], "question.section-restart");
    if (index === 0 || restart) segments.push([...drafts]);
    else segments[segments.length - 1].push(...drafts);
  }
  for (const segment of segments) {
    const counts = new Map<number, number>();
    for (const draft of segment) counts.set(draft.questionNumber!, (counts.get(draft.questionNumber!) ?? 0) + 1);
    for (const draft of segment) if ((counts.get(draft.questionNumber!) ?? 0) > 1) conflicted.add(draft);
  }
  const restarts = Math.max(0, runs.length - 1);
  for (const draft of conflicted) {
    draft.warnings.push("Duplicate question numbers in this document — check the split.");
    draft.needsReview = true;
    draft.confidence = "low";
    draft.overallImportConfidence = Math.min(draft.overallImportConfidence ?? 0.45, 0.45);
    addRule(draft, "conflict.duplicate-question-number");
  }
  return { drafts: kept, merged, restarts, conflicted: [...conflicted] };
}
