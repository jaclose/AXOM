import type { ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";

export type DuplicateKind = "exact" | "likely" | "distinct";
export interface DuplicateMatch { kind: DuplicateKind; questionId?: string; similarity: number }

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}
function signature(value: Pick<ParsedQuestionDraft, "stem" | "options"> | Pick<QuestionRecord, "stem" | "options">): string {
  return `${normalized(value.stem)}|${value.options.map((option) => normalized(option.text)).join("|")}`;
}
function tokens(value: string): Set<string> {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

/** Bounded deterministic duplicate check. Exact keys are indexed; fuzzy work
 * is capped so a large bank cannot turn import review into an O(n^2) freeze. */
export function findQuestionDuplicate(
  draft: Pick<ParsedQuestionDraft, "stem" | "options">,
  existing: readonly QuestionRecord[],
  fuzzyLimit = 500,
): DuplicateMatch {
  const key = signature(draft);
  const exact = existing.find((question) => signature(question) === key);
  if (exact) return { kind: "exact", questionId: exact.id, similarity: 1 };
  const draftTokens = tokens(`${draft.stem} ${draft.options.map((option) => option.text).join(" ")}`);
  let best: DuplicateMatch = { kind: "distinct", similarity: 0 };
  for (const question of existing.slice(0, fuzzyLimit)) {
    const score = jaccard(draftTokens, tokens(`${question.stem} ${question.options.map((option) => option.text).join(" ")}`));
    if (score > best.similarity) best = { kind: score >= 0.82 ? "likely" : "distinct", questionId: question.id, similarity: score };
  }
  return best.kind === "likely" ? best : { kind: "distinct", similarity: best.similarity };
}

export function flagImportDuplicates(drafts: readonly ParsedQuestionDraft[], existing: readonly QuestionRecord[]): ParsedQuestionDraft[] {
  return drafts.map((draft) => {
    const match = findQuestionDuplicate(draft, existing);
    // Exact retries are handled idempotently by finalization; blocking them
    // here would prevent the established safe-retry path from reusing records.
    if (match.kind === "distinct" || match.kind === "exact") return draft;
    return {
      ...draft,
      needsReview: true,
      parserRuleIds: [...new Set([...(draft.parserRuleIds ?? []), "duplicate.likely-existing"])],
      warnings: [...draft.warnings, `This looks similar to an existing question (${Math.round(match.similarity * 100)}% token overlap). Compare it before keeping both.`],
    };
  });
}
