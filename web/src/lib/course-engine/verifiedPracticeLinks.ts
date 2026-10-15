import type { BankCollection } from "../bookshelf/questionBankBooks";
import type { QuestionSet } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { questionScope, type CourseScope } from "./scope";
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
  // A set that explicitly belongs elsewhere cannot be shown as ready here.
  const declaredConflict = Boolean(sourceScope && (
    !equivalent(sourceScope.module, requested.module)
    || (sourceScope.week !== undefined && requested.week !== undefined && sourceScope.week !== requested.week)
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
    const own = questionScope(question, setsById);
    // A primary set and a review set may disagree: never silently overwrite
    // the question's primary documented owner with this collection's label.
    const effective: CourseScope = {
      module: own.module ?? sourceScope?.module,
      week: own.week ?? sourceScope?.week,
      courseId: own.courseId ?? sourceScope?.courseId,
    };
    const disagreesWithSource = Boolean(sourceScope
      && (!equivalent(own.module, sourceScope.module)
        || (own.week !== undefined && sourceScope.week !== undefined && own.week !== sourceScope.week)
        || (own.courseId && sourceScope.courseId && own.courseId !== sourceScope.courseId)));
    if (!scopeMatches(effective, requested, requireCourseProof) || disagreesWithSource) {
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
