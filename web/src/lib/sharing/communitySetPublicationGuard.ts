import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import { questionPracticeReadiness } from "../questionFilters";
import { enrichPublicQuestionSetVisualTags } from "../diagrams/communityVisualSnapshot";
import { createQuestionSetShare, type SharedQuestionSetSnapshot } from "./questionSetShare";

const CHANGED = "This Question Set or its source review changed while publishing. Reopen the set and reconfirm the current answers and sharing rights.";

function sourceReceipt(question: QuestionRecord): string {
  // Public snapshot v1 intentionally excludes the private source review. Compare
  // that evidence separately so a revoked source check cannot be published using
  // the answers-confirmed checkbox from an earlier revision.
  return JSON.stringify([
    question.updatedAt, question.source, question.sourceDocumentId,
    question.sourcePage, question.questionNumber, question.sourceFile,
    question.extraction, question.needsReview, question.ai,
  ]);
}

/**
 * Publish only the immutable public projection of the set the owner actually
 * reviewed in this dialog. Supabase checks account/rights/review separately;
 * a stale browser render must not silently submit a newer or older local set.
 *
 * Does not read source files, learner attempts, notes, attachments or media bytes
 * into the shared snapshot, and never performs the publish request itself.
 */
export function prepareCurrentCommunityQuestionSetSubmission(input: {
  openedSet: QuestionSet;
  openedQuestions: readonly QuestionRecord[];
  liveSets: readonly QuestionSet[];
  liveQuestions: readonly QuestionRecord[];
  now?: string;
}): SharedQuestionSetSnapshot {
  const { openedSet, openedQuestions, liveSets, liveQuestions, now = new Date().toISOString() } = input;
  const liveSet = liveSets.find(candidate => candidate.id === openedSet.id);
  if (!liveSet
    || liveSet.title !== openedSet.title || liveSet.kind !== openedSet.kind
    || JSON.stringify(liveSet.tags) !== JSON.stringify(openedSet.tags)
    || JSON.stringify(liveSet.questionIds) !== JSON.stringify(openedSet.questionIds)
    || JSON.stringify(liveSet.sourceDocumentIds) !== JSON.stringify(openedSet.sourceDocumentIds)
    || openedSet.questionIds.length === 0
    || new Set(openedSet.questionIds).size !== openedSet.questionIds.length) throw new Error(CHANGED);

  const openedById = new Map(openedQuestions.map(question => [question.id, question]));
  const liveById = new Map(liveQuestions.map(question => [question.id, question]));
  for (const id of openedSet.questionIds) {
    const opened = openedById.get(id);
    const live = liveById.get(id);
    if (!opened || !live || sourceReceipt(opened) !== sourceReceipt(live)
      || questionPracticeReadiness(live) !== "ready"
      || !live.explanation?.trim()
      || Boolean(live.attachments?.length || live.content?.assets.length)) throw new Error(CHANGED);
  }

  // Share v1 includes every field that can leave the private account. Comparing
  // exact projections catches answer, explanation, citation and tag changes even
  // when an import/reconciliation mistakenly preserves an old updatedAt.
  const expected = createQuestionSetShare(openedSet, openedQuestions, now);
  const current = createQuestionSetShare(liveSet, liveQuestions, now);
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error(CHANGED);
  // The public snapshot is now revision-checked; append only deterministic,
  // non-clinical visual search hints derived from its already-shared text.
  return enrichPublicQuestionSetVisualTags(current);
}
