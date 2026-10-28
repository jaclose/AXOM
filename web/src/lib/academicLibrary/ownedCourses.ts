import { academicAccountScope } from "./accountScope";
import { listAcademicCourses, reviewAcademicCourse, type AcademicCourse } from "./client";

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
  try {
    const owned: AcademicCourse[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (signal?.aborted) throw new DOMException("Loading your courses was cancelled.", "AbortError");
      const courses = await listAcademicCourses("", "", after);
      scope.assertCurrent();
      owned.push(...courses.filter(course => course.owned));
      if (courses.length < PAGE_SIZE) return owned;
      after = courses[courses.length - 1].id;
    }
    throw new Error("Your library has more courses than this list can read. Search the catalog for a course instead.");
  } finally { scope.dispose(); }
}

export interface AcademicApprovalOutcome { collectionId: string; approved: boolean; error?: string }

/** Approve each course's current revision in turn. One failure stops none; a changed account stops all. */
export async function approveAcademicCourses(collectionIds: readonly string[], accountId: string,
  options: { assertCurrent?: () => void; signal?: AbortSignal; onProgress?: (done: number) => void } = {}): Promise<AcademicApprovalOutcome[]> {
  const outcomes: AcademicApprovalOutcome[] = [];
  for (const collectionId of collectionIds) {
    if (options.signal?.aborted) break;
    options.assertCurrent?.();
    try {
      await reviewAcademicCourse(collectionId, true, accountId);
      outcomes.push({ collectionId, approved: true });
    } catch (cause) {
      outcomes.push({ collectionId, approved: false, error: cause instanceof Error ? cause.message : "The approval was not saved." });
    }
    options.onProgress?.(outcomes.length);
  }
  return outcomes;
}
