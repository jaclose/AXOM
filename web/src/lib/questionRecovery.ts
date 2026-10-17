import type { QuestionSet } from "./library";
import { questionPracticeReadiness } from "./questionFilters";
import type { QuestionRecord } from "./questions";

/** Transient intent, not a second collection or an instruction to rewrite IDs. */
export interface MissingQuestionRecovery {
  setId: string;
  setTitle: string;
  createdAt: string;
  expectedQuestionIds: readonly string[];
  missingQuestionIds: readonly string[];
  sourceDocumentIds: readonly string[];
  scope?: Readonly<NonNullable<QuestionSet["scope"]>>;
}

export function captureMissingQuestionRecovery(
  set: QuestionSet,
  questionsById: ReadonlyMap<string, QuestionRecord>,
): MissingQuestionRecovery {
  return {
    setId: set.id,
    setTitle: set.title,
    createdAt: set.createdAt,
    expectedQuestionIds: [...set.questionIds],
    missingQuestionIds: [...new Set(set.questionIds)].filter((id) => !questionsById.has(id)),
    sourceDocumentIds: [...set.sourceDocumentIds],
    ...(set.scope ? { scope: { ...set.scope } } : {}),
  };
}

type RecoveryState =
  | { state: "removed" | "changed" | "ambiguous" }
  | { state: "pending" | "complete"; restoredIds: string[]; remainingIds: string[]; ready: number; review: number; ambiguousIds: string[] };

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length
  && a.every((id, index) => id === b[index]);

/** Only canonical records with the exact original identities can satisfy recovery.
 * Re-imports with new IDs remain separate, even when their text or titles match. */
export function inspectMissingQuestionRecovery(
  request: MissingQuestionRecovery,
  sets: readonly QuestionSet[],
  questions: readonly QuestionRecord[],
): RecoveryState {
  const matches = sets.filter((set) => set.id === request.setId);
  if (!matches.length) return { state: "removed" };
  if (matches.length !== 1) return { state: "ambiguous" };
  const set = matches[0];
  if (set.createdAt !== request.createdAt
    || !sameIds(set.questionIds, request.expectedQuestionIds)
    || !sameIds(set.sourceDocumentIds, request.sourceDocumentIds)
    || set.scope?.courseId !== request.scope?.courseId
    || set.scope?.module !== request.scope?.module
    || set.scope?.week !== request.scope?.week) return { state: "changed" };

  const requested = new Set(request.missingQuestionIds);
  const byId = new Map<string, QuestionRecord[]>();
  for (const question of questions) {
    if (requested.has(question.id)) byId.set(question.id, [...(byId.get(question.id) ?? []), question]);
  }
  const restoredIds: string[] = [];
  const remainingIds: string[] = [];
  const ambiguousIds: string[] = [];
  let ready = 0;
  for (const id of requested) {
    const records = byId.get(id) ?? [];
    if (records.length !== 1) {
      remainingIds.push(id);
      if (records.length > 1) ambiguousIds.push(id);
      continue;
    }
    restoredIds.push(id);
    if (questionPracticeReadiness(records[0]) === "ready") ready += 1;
  }
  return {
    state: remainingIds.length ? "pending" : "complete",
    restoredIds, remainingIds, ready, review: restoredIds.length - ready, ambiguousIds,
  };
}
