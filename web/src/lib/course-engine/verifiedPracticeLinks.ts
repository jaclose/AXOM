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
    const disagreesWithSource = Boolean(sourceScope
      && (!equivalent(own.module, sourceScope.module)
        || (own.week !== undefined && sourceWeek !== undefined && own.week !== sourceWeek)
        || (own.courseId && sourceScope.courseId && own.courseId !== sourceScope.courseId)));
    // Parsing maps malformed numbers/ranges to undefined; without this guard,
    // module-wide requests would mistake invalid evidence for an absent week.
    if (invalidExplicitWeek(question.week) || invalidExplicitWeek(primary?.scope?.week)
      || !scopeMatches(own, requested, requireCourseProof) || disagreesWithSource) {
      conflictingQuestionCount += 1;
      continue;
    }
    validMembers.add(id);
  }

  const sourceReviewRequired = declaredConflict || malformedReadyMembership || conflictingQuestionCount > 0;
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
