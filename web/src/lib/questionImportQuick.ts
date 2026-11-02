import type { ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";
import type { DraftImportEvaluation } from "./questionImportTrust";
import { matchNamedImages, namedImages } from "./questionImportImages";
import { questionSignature } from "./questionDuplicates";

export interface QuickImportDraft extends ParsedQuestionDraft {
  include: boolean;
  aiGenerated?: boolean;
  reviewAcknowledged?: boolean;
}

export interface QuickImportPlan {
  readyIndexes: number[];
  alreadySaved: number;
  repeatedInFile: number;
  conflictingAnswers: number;
  missingImages: number;
  needsReview: number;
}

function answerIdentity(value: Pick<ParsedQuestionDraft, "options" | "correctKey">): string {
  const key = value.correctKey?.trim().toUpperCase() ?? "";
  const text = value.options.find(option => option.key.trim().toUpperCase() === key)?.text
    .toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim() ?? "";
  return `${key}|${text}`;
}

function answerKeysBySignature(values: readonly (Pick<ParsedQuestionDraft, "stem" | "options" | "correctKey">)[]): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  for (const value of values) {
    const signature = questionSignature(value);
    const group = keys.get(signature) ?? new Set<string>();
    group.add(answerIdentity(value));
    keys.set(signature, group);
  }
  return keys;
}

/** Only a printed source key with a matching choice may enter the one-click path. */
function hasPrintedKey(draft: ParsedQuestionDraft): boolean {
  const sourceLetter = draft.answerEvidence?.match(/(?:^|[^a-z])([a-h])(?=$|[^a-z])/i)?.[1]?.toUpperCase();
  return Boolean(sourceLetter === draft.correctKey?.trim().toUpperCase()
    && draft.options.some(option => option.key === draft.correctKey && option.text.trim())
    && (draft.parserRuleIds ?? []).some(rule => [
      "answer.explicit-letter", "answer.explicit-letter-rationale", "answer.explicit-letter-text",
      "answer.explicit-letter-exact", "answer.structured-explicit-letter",
      "answer.structured-explicit-letter-rationale", "answer.structured-explicit-letter-exact",
      "answer.trailing-section",
    ].includes(rule)));
}

/** A source stays available for the questions that cannot safely enter scored practice. */
export function planQuickImport(
  drafts: readonly QuickImportDraft[],
  evaluations: readonly DraftImportEvaluation[],
  existing: readonly QuestionRecord[],
  images: readonly File[],
): QuickImportPlan {
  const saved = answerKeysBySignature(existing);
  const sourceKeys = answerKeysBySignature(drafts);
  const signatures = drafts.map(questionSignature);
  const seen = new Set<string>();
  const plan: QuickImportPlan = { readyIndexes: [], alreadySaved: 0, repeatedInFile: 0, conflictingAnswers: 0, missingImages: 0, needsReview: 0 };

  drafts.forEach((draft, index) => {
    const signature = signatures[index];
    const savedKeys = saved.get(signature);
    if ((sourceKeys.get(signature)?.size ?? 0) > 1 || (savedKeys && [...savedKeys].some(key => key !== answerIdentity(draft)))) {
      plan.conflictingAnswers += 1;
      return;
    }
    if (savedKeys) { plan.alreadySaved += 1; return; }
    if (seen.has(signature)) { plan.repeatedInFile += 1; return; }
    seen.add(signature);
    const missing = matchNamedImages(namedImages([draft]), images).some(match => !match.file);
    if (missing) { plan.missingImages += 1; return; }
    if (!draft.include || draft.aiGenerated || draft.reviewAcknowledged || draft.needsReview
      || (draft.parserRuleIds ?? []).some(rule => rule.startsWith("conflict.") || rule.startsWith("ai.")
        || rule === "answer.user-reviewed-mapping" || rule === "answer.separate-source-needs-verification"
        || rule === "import.source-text-edited")
      || evaluations[index]?.level !== "High" || !evaluations[index]?.isValid || !hasPrintedKey(draft)) {
      plan.needsReview += 1;
      return;
    }
    plan.readyIndexes.push(index);
  });
  return plan;
}

/** De-select exact matches in the ordinary review too, while leaving the override visible. */
export function markExactImportMatches(
  drafts: readonly ParsedQuestionDraft[],
  selected: readonly boolean[],
  existing: readonly QuestionRecord[],
): { drafts: ParsedQuestionDraft[]; selected: boolean[]; exact: number; repeated: number; conflicting: number } {
  const saved = answerKeysBySignature(existing);
  const sourceKeys = answerKeysBySignature(drafts);
  const seen = new Set<string>();
  const selectedNext: boolean[] = [];
  let exact = 0;
  let repeated = 0;
  let conflicting = 0;
  const next = drafts.map((draft, index) => {
    const signature = questionSignature(draft);
    const savedKeys = saved.get(signature);
    const inBank = Boolean(savedKeys);
    const inFile = seen.has(signature);
    const answerConflict = (sourceKeys.get(signature)?.size ?? 0) > 1
      || Boolean(savedKeys && [...savedKeys].some(key => key !== answerIdentity(draft)));
    seen.add(signature);
    selectedNext[index] = Boolean(selected[index]) && !inBank && !inFile && !answerConflict;
    if (answerConflict) conflicting += 1;
    if (inBank && selected[index] && !answerConflict) exact += 1;
    if (inFile && !inBank && !answerConflict) repeated += 1;
    // An earlier source import already gave this row a specific explanation.
    if (inBank && !selected[index] && !answerConflict) return draft;
    if (!inBank && !inFile && !answerConflict) return draft;
    const note = answerConflict
      ? "Matching question wording has a different or unresolved answer key. Check the original source before keeping either copy."
      : inBank
      ? "This exact question is already in your Question Bank. It was left out to avoid another copy."
      : "This question repeats another in this file. It was left out to avoid another copy.";
    return { ...draft,
      needsReview: answerConflict || draft.needsReview,
      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), answerConflict ? "duplicate.answer-conflict" : inBank ? "duplicate.exact-existing" : "duplicate.exact-in-file"])],
      warnings: [...draft.warnings, note],
    };
  });
  return {
    drafts: next,
    selected: selectedNext,
    exact,
    repeated,
    conflicting,
  };
}
