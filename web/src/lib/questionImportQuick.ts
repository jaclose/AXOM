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
  missingImages: number;
  needsReview: number;
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
  const saved = new Set(existing.map(questionSignature));
  const signatures = drafts.map(questionSignature);
  const seen = new Set<string>();
  const plan: QuickImportPlan = { readyIndexes: [], alreadySaved: 0, repeatedInFile: 0, missingImages: 0, needsReview: 0 };

  drafts.forEach((draft, index) => {
    const signature = signatures[index];
    if (saved.has(signature)) { plan.alreadySaved += 1; return; }
    if (seen.has(signature)) { plan.repeatedInFile += 1; return; }
    seen.add(signature);
    const missing = matchNamedImages(namedImages([draft]), images).some(match => !match.file);
    if (missing) { plan.missingImages += 1; return; }
    if (!draft.include || draft.aiGenerated || draft.reviewAcknowledged || draft.needsReview
      || evaluations[index]?.level !== "High" || !evaluations[index]?.isValid || !hasPrintedKey(draft)) {
      plan.needsReview += 1;
      return;
    }
    plan.readyIndexes.push(index);
  });
  return plan;
}

/** De-select exact matches in the ordinary review too, while leaving the override visible. */
export function markExactImportMatches<T extends ParsedQuestionDraft>(
  drafts: readonly T[],
  selected: readonly boolean[],
  existing: readonly QuestionRecord[],
): { drafts: T[]; selected: boolean[]; exact: number; repeated: number } {
  const saved = new Set(existing.map(questionSignature));
  const seen = new Set<string>();
  const selectedNext: boolean[] = [];
  let exact = 0;
  let repeated = 0;
  const next = drafts.map((draft, index) => {
    const signature = questionSignature(draft);
    const inBank = saved.has(signature);
    const inFile = seen.has(signature);
    seen.add(signature);
    selectedNext[index] = Boolean(selected[index]) && !inBank && !inFile;
    if (inBank && selected[index]) exact += 1;
    if (inFile && !inBank) repeated += 1;
    // An earlier source import already gave this row a specific explanation.
    if (inBank && !selected[index]) return draft;
    if (!inBank && !inFile) return draft;
    const note = inBank
      ? "This exact question is already in your Question Bank. It was left out to avoid another copy."
      : "This question repeats another in this file. It was left out to avoid another copy.";
    return { ...draft,
      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), inBank ? "duplicate.exact-existing" : "duplicate.exact-in-file"])],
      warnings: [...draft.warnings, note],
    };
  });
  return {
    drafts: next,
    selected: selectedNext,
    exact,
    repeated,
  };
}
