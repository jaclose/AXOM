import { academicAccountScope } from "./accountScope";
import { getAcademicCourse, listAcademicCourses, reviewAcademicCourse, type AcademicCourse } from "./client";
import type { ExplanationReviewReceipt } from "./explanationReview";

/** academic_catalog returns at most 24 courses per page. */
const PAGE_SIZE = 24;
/** 4,800 courses; far beyond the curriculum, so a cursor that never ends is caught. */
const MAX_PAGES = 200;

export type OwnedCourseStatus = "private" | "awaiting-review" | "shared" | "not-approved" | "group";

/** What other accounts can see of a course its owner published. */
export function ownedCourseStatus(course: Pick<AcademicCourse, "visibility" | "review_status">): OwnedCourseStatus {
  if (course.visibility === "private") return "private";
  if (course.visibility === "group") return "group";
  return course.review_status === "approved" ? "shared" : course.review_status === "rejected" ? "not-approved" : "awaiting-review";
}

/** Every course the signed-in account owns, read page by page from the catalog. */
export async function listOwnedAcademicCourses(accountId: string, signal?: AbortSignal): Promise<AcademicCourse[]> {
  const scope = academicAccountScope(accountId);
  const check = () => {
    scope.assertCurrent();
    if (signal?.aborted) throw new DOMException("Loading your courses was cancelled.", "AbortError");
  };
  try {
    const owned: AcademicCourse[] = [];
    const seenIds = new Set<string>();
    const seenRevisions = new Set<string>();
    let after: string | undefined;
    let previousCursor: AcademicCourse | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      check();
      const courses = await listAcademicCourses("", "", after);
      check();
      // A withdrawn cursor makes academic_catalog return [], indistinguishable
      // from the true end. Never treat that as a complete owned-course list.
      if (previousCursor) {
        let current: AcademicCourse;
        try {
          current = await getAcademicCourse(previousCursor.id, accountId);
        } catch {
          check();
          throw new Error("The owned course catalog could not be verified. Refresh before sharing or approving courses.");
        }
        check();
        if (current.id !== previousCursor.id
          || current.current_revision_id !== previousCursor.current_revision_id
          || current.term !== previousCursor.term || current.module !== previousCursor.module
          || current.title !== previousCursor.title || current.owned !== previousCursor.owned
          || current.visibility !== previousCursor.visibility
          || current.review_status !== previousCursor.review_status
          || current.ready_questions !== previousCursor.ready_questions
          || current.review_questions !== previousCursor.review_questions) {
          throw new Error("The owned course catalog changed while loading. Refresh to view a complete list.");
        }
      }
      if (!Array.isArray(courses) || courses.length > PAGE_SIZE
        || courses.some(course => !course || typeof course.id !== "string"
          || typeof course.current_revision_id !== "string"
          || seenIds.has(course.id) || seenRevisions.has(course.current_revision_id))
        || new Set(courses.map(course => course.id)).size !== courses.length
        || new Set(courses.map(course => course.current_revision_id)).size !== courses.length) {
        throw new Error("The owned course catalog changed while loading. Refresh to view a complete list.");
      }
      for (const course of courses) {
        seenIds.add(course.id);
        seenRevisions.add(course.current_revision_id);
        if (course.owned) owned.push(course);
      }
      if (courses.length < PAGE_SIZE) return owned;
      previousCursor = courses[courses.length - 1];
      after = previousCursor.id;
    }
    throw new Error("Your library has more courses than this list can read. Search the catalog for a course instead.");
  } finally { scope.dispose(); }
}

export interface AcademicApprovalOutcome { collectionId: string; approved: boolean; error?: string }

/** Approve each course's current revision in turn. One failure stops none; a changed account stops all. */
export async function approveAcademicCourses(collectionIds: readonly string[], accountId: string,
  options: { receipts?: ReadonlyMap<string, ExplanationReviewReceipt>; rationaleReviewed?: boolean;
    assertCurrent?: () => void; signal?: AbortSignal; onProgress?: (done: number) => void } = {}): Promise<AcademicApprovalOutcome[]> {
  const outcomes: AcademicApprovalOutcome[] = [];
  for (const collectionId of collectionIds) {
    if (options.signal?.aborted) break;
    options.assertCurrent?.();
    try {
      await reviewAcademicCourse(collectionId, true, accountId, options.receipts?.get(collectionId), options.rationaleReviewed);
      outcomes.push({ collectionId, approved: true });
    } catch (cause) {
      outcomes.push({ collectionId, approved: false, error: cause instanceof Error ? cause.message : "The approval was not saved." });
    }
    options.onProgress?.(outcomes.length);
  }
  return outcomes;
}
