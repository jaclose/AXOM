import type { BankCollection } from "../bookshelf/questionBankBooks";
import type { QuestionSet } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { parseWeek, questionScope, type CourseScope } from "./scope";
import { canonicalModuleKey } from "./vocabulary";

/** Tracker-side read-only guard; it does not change imported source metadata. */
export interface VerifiedCourseCollection {
  readyQuestionIds: string[];
  /** A contradictory set/question association must be corrected before launch. */
  sourceReviewRequired: boolean;
  conflictingQuestionCount: number;
  unavailableQuestionCount: number;
}

const equivalent = (left?: string, right?: string): boolean =>
  !left || !right || canonicalModuleKey(left) === canonicalModuleKey(right);

const invalidExplicitWeek = (value: unknown): boolean =>
  value != null && (typeof value !== "string" || value.trim() !== "")
    && parseWeek(value) === undefined;

/** Keep raw record identity collisions visible before Map construction loses them. */
export function duplicateQuestionRecordIds(records: readonly Pick<QuestionRecord, "id">[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) duplicates.add(record.id);
    seen.add(record.id);
  }
  return duplicates;
}

/** Repeated immutable membership IDs are ambiguous, not extra practice rows. */
const repeatedMembers = (ids?: readonly string[]): boolean =>
  Boolean(ids && new Set(ids).size !== ids.length);

const scopeMatches = (
  actual: CourseScope, requested: CourseScope, requireCourseProof: boolean,
): boolean => {
  if (!requested.module || !actual.module || !equivalent(actual.module, requested.module)) return false;
  if (requested.week !== undefined && actual.week !== requested.week) return false;
  if (requested.courseId) {
    if (actual.courseId && actual.courseId !== requested.courseId) return false;
    if (requireCourseProof && actual.courseId !== requested.courseId) return false;
  }
  return true;
};

/**
 * A collection's source metadata does not override contradictory metadata on
 * its members. One conflict blocks the collection, not merely that one answer,
 * because the set's academic identity is then untrustworthy.
 *
 * Legacy uniquely owned modules may work without a courseId. If several
 * courses own the same module in the term, require explicit course proof.
 */
export function verifyCollectionForCourse(
  collection: Pick<BankCollection, "setId" | "questionIds" | "readyQuestionIds">,
  requested: CourseScope,
  questionsById: ReadonlyMap<string, QuestionRecord>,
  setsById: ReadonlyMap<string, QuestionSet>,
  requireCourseProof = false,
  duplicateRecordIds: ReadonlySet<string> = new Set(),
): VerifiedCourseCollection {
  const sourceSet = collection.setId ? setsById.get(collection.setId) : undefined;
  if (collection.setId && !sourceSet) {
    return {
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    };
  }
  const sourceScope = sourceSet?.scope;
  const sourceWeek = parseWeek(sourceScope?.week);
  // Invalid *declared* weeks are not the same as genuinely unscheduled
  // material, even when the requested practice scope spans a whole module.
  const declaredConflict = invalidExplicitWeek(sourceScope?.week) || Boolean(sourceScope && (
    !equivalent(sourceScope.module, requested.module)
    || (sourceWeek !== undefined && requested.week !== undefined && sourceWeek !== requested.week)
    || (sourceScope.courseId && requested.courseId && sourceScope.courseId !== requested.courseId)
  ));
  const setIds = sourceSet ? sourceSet.questionIds : collection.questionIds ?? collection.readyQuestionIds ?? [];
  const memberIds = [...new Set(setIds)];
  const allowedMembers = new Set(memberIds);
  const malformedReadyMembership = Boolean(sourceSet &&
    collection.readyQuestionIds?.some((id) => !allowedMembers.has(id)));
  // A set, its derived collection or its ready subset may carry repeated
  // source IDs. Deduplicating those without a review silently changes exact
  // membership, so hold the link while retaining the original records.
  const repeatedMembership = repeatedMembers(sourceSet?.questionIds)
    || repeatedMembers(collection.questionIds)
    || repeatedMembers(collection.readyQuestionIds);
  let conflictingQuestionCount = 0;
  let unavailableQuestionCount = 0;
  const validMembers = new Set<string>();

  for (const id of memberIds) {
    const question = questionsById.get(id);
    if (!question) { unavailableQuestionCount += 1; continue; }
    // A legacy member may inherit this collection only when it declares no
    // primary source set. Resolve once: a second fallback would refill invalid
    // weeks or borrow missing source evidence from a review collection.
    const own = questionScope({
      module: question.module,
      week: question.week,
      courseId: question.courseId,
      setId: question.setId ?? sourceSet?.id,
    }, setsById);
    const primary = question.setId != null ? setsById.get(question.setId) : sourceSet;
    const primaryScope = primary?.scope;
    const primaryWeek = parseWeek(primaryScope?.week);
    // An explicitly declared primary association is a provenance claim, not
    // permission to refile the question through an agreeing review collection.
    // Until a verified refile receipt exists, contradictory or missing primary
    // evidence must hold fresh practice even if the question's own fields agree.
    const disagreesWithPrimary = question.setId != null && (
      !primary || !primary.questionIds.includes(id)
      || invalidExplicitWeek(primaryScope?.week)
      || Boolean(primaryScope && (
        !equivalent(own.module, primaryScope.module)
        || (own.week !== undefined && primaryWeek !== undefined && own.week !== primaryWeek)
        || (own.courseId && primaryScope.courseId && own.courseId !== primaryScope.courseId)
      ))
    );
    const disagreesWithSource = Boolean(sourceScope
      && (!equivalent(own.module, sourceScope.module)
        || (own.week !== undefined && sourceWeek !== undefined && own.week !== sourceWeek)
        || (own.courseId && sourceScope.courseId && own.courseId !== sourceScope.courseId)));
    // Parsing maps malformed numbers/ranges to undefined; without this guard,
    // module-wide requests would mistake invalid evidence for an absent week.
    if (invalidExplicitWeek(question.week) || disagreesWithPrimary
      || !scopeMatches(own, requested, requireCourseProof) || disagreesWithSource) {
      conflictingQuestionCount += 1;
      continue;
    }
    validMembers.add(id);
  }

  // The QBank/Tracker books index records in a Map. A duplicate raw record ID
  // can be hidden there even when each source-set membership array is unique.
  // Treat that association as ambiguous before offering any Practice action.
  const duplicateRecordMembership = memberIds.some((id) => duplicateRecordIds.has(id));
  const sourceReviewRequired = declaredConflict || malformedReadyMembership
    || repeatedMembership || duplicateRecordMembership || conflictingQuestionCount > 0;
  const readyQuestionIds = sourceReviewRequired ? [] : [...new Set(collection.readyQuestionIds ?? [])]
    .filter((id) => {
      const question = questionsById.get(id);
      return validMembers.has(id) && question
        && questionMappingStatus(question) === "ready" && question.options.length >= 2;
    });
  return {
    readyQuestionIds,
    sourceReviewRequired,
    conflictingQuestionCount,
    unavailableQuestionCount,
  };
}
