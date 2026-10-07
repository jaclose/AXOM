// ===========================================================================
// May a queued file be accepted without opening it? Mass import's "Accept" and
// "Accept all valid" ask this of every file. The answer is yes only when there
// is nothing left for a person to decide: every question is whole and its
// answer is certain, no image could give an answer away or was left without a
// question, the file's place in the course is settled, and nothing in it is in
// the bank already. Anything else names what is in the way and goes to review.
//
// The save itself is not decided here. An accepted file is saved by
// lib/questionImportSave, which applies the review screen's own checks again.
// ===========================================================================
import { moduleKey } from "./course-engine/vocabulary";
import type { SourceMapping } from "./course-engine/sourceMapping";
import { findDuplicateInIndex, type DuplicateIndex } from "./questionDuplicates";
import { findPriorImport, type ImportLibrary, type PriorImport } from "./questionImportHistory";
import { evaluateImportDrafts, type DraftEvaluationCode } from "./questionImportTrust";
import type { ParsedQuestionDraft } from "./questionParse";

export type CandidateBlockCode =
  | "no-questions"
  | "question-incomplete"
  | "boundary-ambiguous"
  | "answer-uncertain"
  | "needs-check"
  | "answer-leak-possible"
  | "images-unplaced"
  | "mapping-unresolved"
  | "duplicate-question"
  | "already-imported"
  | "source-changed";

export interface CandidateBlock {
  code: CandidateBlockCode;
  /** In plain words, for the learner. */
  message: string;
  /** How many questions or images it concerns, where that applies. */
  count?: number;
}

export interface CandidateEvaluation {
  valid: boolean;
  blocks: CandidateBlock[];
  prior?: PriorImport;
  /** The scope an accepted file is saved with: only ever a settled one. */
  scope?: { module: string; week?: number };
}

/** A figure attached on this basis sits on the page after its question, where an answer's illustration also sits. */
export const FIGURE_AFTER_QUESTION_RULE = "figure.question-runs-onto-page";

const INCOMPLETE: ReadonlySet<DraftEvaluationCode> = new Set(["draft-missing", "missing-stem", "too-few-usable-options", "incomplete-option", "duplicate-option-labels"]);
const BOUNDARY: ReadonlySet<DraftEvaluationCode> = new Set([
  "structurally-ambiguous-block", "duplicate-question-number", "invalid-question-number", "unusual-question-numbering",
  "explanation-boundary-ambiguous", "explanation-detected-as-option", "inconsistent-option-labels",
]);
const ANSWER: ReadonlySet<DraftEvaluationCode> = new Set([
  "missing-correct-answer", "correct-answer-not-option", "conflicting-answer-keys", "unrecognized-answer-key", "answer-mapping-needs-review",
]);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The module and week a file's name proposes, as one of the learner's own
 * modules. The review screen offers this as a starting point for any status;
 * a file accepted without review only ever uses one that is "mapped".
 */
export function scopeFromMapping(mapping: SourceMapping | undefined, modules: readonly string[]): { module: string; week?: number } | undefined {
  if (!mapping?.module) return undefined;
  const module = modules.find((name) => moduleKey(name) === moduleKey(mapping.module!.value));
  if (!module) return undefined;
  const week = mapping.week?.value;
  return { module, ...(week !== undefined && Number.isInteger(week) && week > 0 && week < 100 ? { week } : {}) };
}

export function evaluateImportCandidate(input: {
  drafts: readonly ParsedQuestionDraft[];
  fileName: string;
  checksum?: string;
  /** How many images came out of the file. */
  imageCount?: number;
  mapping?: SourceMapping;
  /** The learner's module names. With none, there is nothing to file a set under and no mapping is asked for. */
  modules: readonly string[];
  library: ImportLibrary;
  /** The bank, indexed once for the whole queue. */
  duplicates: DuplicateIndex;
}): CandidateEvaluation {
  const { drafts } = input;
  const blocks: CandidateBlock[] = [];
  const add = (code: CandidateBlockCode, message: string, count?: number) => blocks.push({ code, message, count });

  const prior = findPriorImport({ checksum: input.checksum, fileName: input.fileName }, input.library);
  if (prior?.relation === "same-file") add("already-imported", "This file was imported before. Open it to see what is already in your bank.");
  if (prior?.relation === "other-version") add("source-changed", "A different version of this file was imported before. Open it to bring in only what is new.");

  if (drafts.length === 0) {
    add("no-questions", "No questions were found in this file.");
    return { valid: false, blocks, prior };
  }

  const evaluations = evaluateImportDrafts(drafts);
  const judged = drafts.map((draft, index) => {
    const has = (codes: ReadonlySet<DraftEvaluationCode>) => evaluations[index].reasons.some((reason) => codes.has(reason.code));
    const incomplete = has(INCOMPLETE);
    // The slide reader marks a question whose slide leaves its edges to judgement.
    const ambiguous = has(BOUNDARY) || (draft.parserRuleIds ?? []).some((rule) => rule.startsWith("deck."));
    const uncertain = has(ANSWER);
    return { incomplete, ambiguous, uncertain, other: evaluations[index].level !== "High" && !incomplete && !ambiguous && !uncertain };
  });
  const count = (kind: keyof (typeof judged)[number]) => judged.filter((entry) => entry[kind]).length;
  const incomplete = count("incomplete");
  const ambiguous = count("ambiguous");
  const uncertain = count("uncertain");
  const other = count("other");
  if (incomplete) add("question-incomplete", `${plural(incomplete, "question")} ${incomplete === 1 ? "is" : "are"} missing a stem or answer options.`, incomplete);
  if (ambiguous) add("boundary-ambiguous", `${plural(ambiguous, "question")} may start or end in the wrong place.`, ambiguous);
  if (uncertain) add("answer-uncertain", `${plural(uncertain, "question")} ${uncertain === 1 ? "has" : "have"} no certain answer.`, uncertain);
  if (other) add("needs-check", `${plural(other, "question")} ${other === 1 ? "needs" : "need"} a check against the source.`, other);

  const afterQuestion = drafts.filter((draft) => (draft.parserRuleIds ?? []).includes(FIGURE_AFTER_QUESTION_RULE)).length;
  if (afterQuestion) add("answer-leak-possible", `${plural(afterQuestion, "question")} ${afterQuestion === 1 ? "has" : "have"} an image from the page after it, which may show the answer.`, afterQuestion);
  const attached = new Set(drafts.flatMap((draft) => draft.attachmentNames ?? [])).size;
  const unplaced = Math.max(0, (input.imageCount ?? 0) - attached);
  if (unplaced) add("images-unplaced", `${plural(unplaced, "image")} could not be placed on a question, and would be left behind.`, unplaced);

  const scope = input.mapping?.status === "mapped" ? scopeFromMapping(input.mapping, input.modules) : undefined;
  if (input.modules.length > 0 && !scope) add("mapping-unresolved", "Its module and week are not settled from the file's name.");

  if (!prior) {
    const repeated = drafts.filter((draft) => findDuplicateInIndex(draft, input.duplicates).kind !== "distinct").length;
    if (repeated) add("duplicate-question", `${plural(repeated, "question")} ${repeated === 1 ? "is" : "are"} already in your bank, or close to one that is.`, repeated);
  }

  return { valid: blocks.length === 0, blocks, prior, scope };
}
