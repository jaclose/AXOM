import type { ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";

export type DuplicateKind = "exact" | "likely" | "distinct";
export interface DuplicateMatch { kind: DuplicateKind; questionId?: string; similarity: number }

type Comparable = Pick<ParsedQuestionDraft, "stem" | "options"> | Pick<QuestionRecord, "stem" | "options">;

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}
/** A question's wording, whatever its case, spacing or punctuation: its stem and option texts. */
export function questionSignature(value: Comparable): string {
  return `${normalized(value.stem)}|${value.options.map((option) => normalized(option.text)).join("|")}`;
}
function tokens(value: string): Set<string> {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 2));
}
const questionTokens = (value: Comparable) => tokens(`${value.stem} ${value.options.map((option) => option.text).join(" ")}`);
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

/**
 * The bank, read once for many lookups: every question by its exact wording,
 * and the first few hundred tokenised for the near-match check. A queue of
 * files checks each of its questions against this instead of reading the whole
 * bank again for every one.
 */
export interface DuplicateIndex {
  exact: Map<string, string>;
  fuzzy: Array<{ id: string; tokens: Set<string> }>;
}

export function buildDuplicateIndex(existing: readonly QuestionRecord[], fuzzyLimit = 500): DuplicateIndex {
  const exact = new Map<string, string>();
  for (const question of existing) {
    const signature = questionSignature(question);
    if (!exact.has(signature)) exact.set(signature, question.id);
  }
  return { exact, fuzzy: existing.slice(0, fuzzyLimit).map((question) => ({ id: question.id, tokens: questionTokens(question) })) };
}

export function findDuplicateInIndex(draft: Comparable, index: DuplicateIndex): DuplicateMatch {
  const exact = index.exact.get(questionSignature(draft));
  if (exact) return { kind: "exact", questionId: exact, similarity: 1 };
  const draftTokens = questionTokens(draft);
  let best: DuplicateMatch = { kind: "distinct", similarity: 0 };
  for (const entry of index.fuzzy) {
    const score = jaccard(draftTokens, entry.tokens);
    if (score > best.similarity) best = { kind: score >= 0.82 ? "likely" : "distinct", questionId: entry.id, similarity: score };
  }
  return best.kind === "likely" ? best : { kind: "distinct", similarity: best.similarity };
}

/** Bounded deterministic duplicate check. Exact keys are indexed; fuzzy work
 * is capped so a large bank cannot turn import review into an O(n^2) freeze. */
export function findQuestionDuplicate(
  draft: Pick<ParsedQuestionDraft, "stem" | "options">,
  existing: readonly QuestionRecord[],
  fuzzyLimit = 500,
): DuplicateMatch {
  return findDuplicateInIndex(draft, buildDuplicateIndex(existing, fuzzyLimit));
}

export function flagImportDuplicates(drafts: readonly ParsedQuestionDraft[], existing: readonly QuestionRecord[]): ParsedQuestionDraft[] {
  const index = buildDuplicateIndex(existing);
  return drafts.map((draft) => {
    const match = findDuplicateInIndex(draft, index);
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
