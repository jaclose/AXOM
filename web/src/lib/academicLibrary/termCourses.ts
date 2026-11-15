import { listAcademicCourses, type AcademicCourse } from "./client";
import { academicAccountScope } from "./accountScope";
import { ACADEMIC_REFERENCE_TYPE, readDownloadReference, type DownloadReference, type DownloadWorkspace } from "./downloadReference";
import { questionMappingStatus } from "../questions";
import type { CourseQuizLaunch } from "../course-engine/quizLaunch";
import type { NoctyriumState } from "../types";

const termIdentity = (value: string): string => {
  const numbered = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return numbered ? `term${Number(numbered[1])}` : value.trim().toLocaleLowerCase();
};

/** The visible catalog is just one page and may be searched. Term operations
 * always read the whole unsearched term, keeping its server cursor order. */
export async function listTermCourses(term: string, accountId: string,
  options: { shouldStop?: () => boolean; assertCurrent?: () => void } = {}): Promise<AcademicCourse[]> {
  const scope = academicAccountScope(accountId);
  const check = () => {
    scope.assertCurrent(); options.assertCurrent?.();
    if (options.shouldStop?.()) throw new DOMException("Term download stopped.", "AbortError");
  };
  const courses: AcademicCourse[] = [];
  const seen = new Set<string>();
  const seenRevisions = new Set<string>();
  let cursor: string | undefined;
  try {
    // A malformed cursor must not keep a whole-term download looping forever.
    for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
      check();
      const page = await listAcademicCourses("", term, cursor);
      check();
      if (!Array.isArray(page) || page.length > 24
        || page.some(course => !course || typeof course.id !== "string" || !course.id.trim()
          || typeof course.current_revision_id !== "string" || !course.current_revision_id.trim()
          || typeof course.term !== "string" || termIdentity(course.term) !== termIdentity(term)
          || seen.has(course.id) || seenRevisions.has(course.current_revision_id))
        || new Set(page.map(course => course.id)).size !== page.length
        || new Set(page.map(course => course.current_revision_id)).size !== page.length) {
        throw new Error("The term catalog changed while loading. Retry to read the complete term.");
      }
      for (const course of page) {
        seen.add(course.id);
        seenRevisions.add(course.current_revision_id);
        courses.push(course);
      }
      if (page.length < 24) return courses;
      cursor = page.at(-1)!.id;
    }
    throw new Error("The term catalog exceeded the safe page limit. Retry later; no partial course list was returned.");
  } finally { scope.dispose(); }
}

type TermWorkspace = DownloadWorkspace & Pick<NoctyriumState, "terms" | "courses">;

function workspaceReferences(accountId: string, workspace: TermWorkspace): DownloadReference[] {
  const references: DownloadReference[] = [];
  for (const document of workspace.documents) {
    if (document.fileType !== ACADEMIC_REFERENCE_TYPE) continue;
    let identity: { collectionId?: unknown; revisionId?: unknown };
    try { identity = JSON.parse(document.rawText) as typeof identity; } catch { continue; }
    if (!identity || typeof identity.collectionId !== "string" || typeof identity.revisionId !== "string") continue;
    const saved = readDownloadReference(workspace.documents, { id: identity.collectionId, current_revision_id: identity.revisionId }, accountId);
    if (saved) references.push(saved);
  }
  return references;
}

function installedReferenceTerm(saved: DownloadReference, workspace: TermWorkspace): string | undefined {
  const owners = workspace.courses.filter(course => course.code === `academic:${saved.collectionId}`);
  const term = owners.length === 1 ? workspace.terms.find(entry => entry.id === owners[0].termId)?.name : undefined;
  return term?.trim() || undefined;
}

/** Old question-only receipts may have no local term identity. Check every
 * receipt, not only those represented in the visible catalog page. */
export function termQuizNeedsCatalog(accountId: string, workspace: TermWorkspace): boolean {
  return workspaceReferences(accountId, workspace).some(saved => !saved.term && !installedReferenceTerm(saved, workspace));
}

/** Receipt identity, rather than module titles or the current catalog page,
 * selects downloaded questions. New receipts retain their reviewed term;
 * older receipts use an exact catalog or installed hosted-course identity. */
export function termQuizSelection(term: string, accountId: string, workspace: TermWorkspace,
  courses: readonly AcademicCourse[] = []): CourseQuizLaunch {
  // Deferred hydration is account-bound. Never derive saved quiz membership
  // from a workspace mixing this account with another account's pending data.
  if (workspace.deferredContent && workspace.deferredContent.accountId !== accountId) {
    return { module: term, term, setIds: [], questionIds: [] };
  }
  const ids = new Set<string>();
  const setIds = new Set<string>();
  // A receipt may identify a set, but ambiguous duplicate local rows cannot establish one canonical set.
  const localSetCounts = new Map<string, number>();
  for (const set of workspace.questionSets) localSetCounts.set(set.id, (localSetCounts.get(set.id) ?? 0) + 1);
  const questionTerms = new Map<string, string>();
  const setTerms = new Map<string, string>();
  const conflictingQuestions = new Set<string>();
  const conflictingSets = new Set<string>();
  const requestedTerm = termIdentity(term);
  const recordTerm = (id: string, owner: string, owners: Map<string, string>, conflicts: Set<string>) => {
    const previous = owners.get(id);
    if (previous !== undefined && previous !== owner) conflicts.add(id);
    else owners.set(id, owner);
  };
  // A local ID claimed by two *different* source terms is not safe to quiz
  // under either term. Same-term receipt duplicates are still deduplicated.
  for (const saved of workspaceReferences(accountId, workspace)) {
    const catalog = courses.find(course => course.id === saved.collectionId && course.current_revision_id === saved.revisionId);
    if (saved.term && catalog && termIdentity(saved.term) !== termIdentity(catalog.term)) continue;
    const savedTerm = saved.term ?? catalog?.term ?? installedReferenceTerm(saved, workspace);
    if (!savedTerm) continue;
    const ownerTerm = termIdentity(savedTerm);
    for (const id of saved.questionIds) {
      recordTerm(id, ownerTerm, questionTerms, conflictingQuestions);
      if (ownerTerm === requestedTerm) ids.add(id);
    }
    for (const id of saved.setIds) {
      recordTerm(id, ownerTerm, setTerms, conflictingSets);
      if (ownerTerm === requestedTerm && localSetCounts.get(id) === 1) setIds.add(id);
    }
  }
  for (const id of conflictingQuestions) ids.delete(id);
  for (const id of conflictingSets) setIds.delete(id);
  const counts = new Map<string, number>();
  for (const question of workspace.questions) counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  const deferred = new Set(workspace.deferredContent?.questions.map(question => question.id) ?? []);
  return { module: term, term, setIds: [...setIds], questionIds: workspace.questions.filter(question => ids.has(question.id)
    && counts.get(question.id) === 1 && !deferred.has(question.id)
    && questionMappingStatus(question) === "ready" && question.options.length >= 2).map(question => question.id) };
}
