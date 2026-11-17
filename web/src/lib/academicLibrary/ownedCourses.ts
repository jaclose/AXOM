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

/** Compare every field rendered/used by bulk sharing. An unchanged keyset cursor
 * alone cannot detect another course moving to an already-read page. */
function sameCatalogCourse(a: AcademicCourse, b: AcademicCourse): boolean {
  return a.id === b.id
    && a.current_revision_id === b.current_revision_id
    && a.term === b.term && a.module === b.module && a.title === b.title
    && a.academic_term === b.academic_term && a.cohort === b.cohort
    && a.owned === b.owned && a.visibility === b.visibility
    && a.review_status === b.review_status
    && a.ready_questions === b.ready_questions
    && a.review_questions === b.review_questions;
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
    const pages: AcademicCourse[][] = [];
    const verifyCursor = async (expected: AcademicCourse) => {
      let current: AcademicCourse;
      try {
        current = await getAcademicCourse(expected.id, accountId);
      } catch {
        check();
        throw new Error("The owned course catalog could not be verified. Refresh before sharing or approving courses.");
      }
      check();
      if (!sameCatalogCourse(current, expected)) {
        throw new Error("The owned course catalog changed while loading. Refresh to view a complete list.");
      }
    };
    for (let page = 0; page < MAX_PAGES; page++) {
      check();
      const courses = await listAcademicCourses("", "", after);
      check();
      // A withdrawn or changed cursor must not appear to end pagination.
      if (previousCursor) await verifyCursor(previousCursor);
      if (!Array.isArray(courses) || courses.length > PAGE_SIZE
        || courses.some(course => !course || typeof course.id !== "string"
          || typeof course.current_revision_id !== "string"
          || seenIds.has(course.id) || seenRevisions.has(course.current_revision_id))
        || new Set(courses.map(course => course.id)).size !== courses.length
        || new Set(courses.map(course => course.current_revision_id)).size !== courses.length) {
        throw new Error("The owned course catalog changed while loading. Refresh to view a complete list.");
      }
      pages.push(courses);
      for (const course of courses) {
        seenIds.add(course.id);
        seenRevisions.add(course.current_revision_id);
        if (course.owned) owned.push(course);
      }
      if (courses.length < PAGE_SIZE) {
        if (pages.length > 1) {
          // Quiescent two-pass consistency check. A noncursor row can move from
          // a future page to an earlier SQL keyset page, leaving the cursor
          // unchanged and silently disappearing. Re-read every original page,
          // not merely the cursor, before displaying complete bulk inventory.
          // This is NOT an atomic snapshot; simultaneous repeated edits still
          // require a future server-side snapshot/epoch contract.
          for (let index = 0; index < pages.length; index++) {
            check();
            const cursor = index > 0 ? pages[index - 1].at(-1)! : undefined;
            if (cursor) await verifyCursor(cursor);
            const replay = await listAcademicCourses("", "", cursor?.id);
            check();
            const original = pages[index];
            if (!Array.isArray(replay) || replay.length !== original.length
              || replay.some((row, offset) => !sameCatalogCourse(row, original[offset]))) {
              throw new Error("The owned course catalog changed while loading. Refresh to view a complete list.");
            }
          }
        }
        return owned;
      }
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
