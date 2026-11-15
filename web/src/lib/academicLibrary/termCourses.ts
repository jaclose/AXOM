import { getAcademicCourse, listAcademicCourses, type AcademicCourse } from "./client";
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
  let previousPageCursor: AcademicCourse | undefined;
  try {
    // Bound a malformed cursor stream; never return a partial term catalog.
    for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
      check();
      const page = await listAcademicCourses("", term, cursor);
      check();
      // Keyset pagination uses the prior page's collection row to locate the
      // next page. If that row is withdrawn/deleted between RPCs, SQL returns
      // an empty page, indistinguishable from the real end of the catalog.
      // Recheck the cursor through the existing account-authorized detail RPC
      // before treating ANY subsequent page (including []) as complete.
      if (previousPageCursor) {
        let liveCursor: AcademicCourse;
        try {
          liveCursor = await getAcademicCourse(previousPageCursor.id, accountId);
        } catch {
          check();
          throw new Error("The term catalog could not be verified. Retry to read the complete term.");
        }
        check();
        if (liveCursor.id !== previousPageCursor.id
          || liveCursor.current_revision_id !== previousPageCursor.current_revision_id
          || liveCursor.term !== previousPageCursor.term
          || liveCursor.module !== previousPageCursor.module
          || liveCursor.title !== previousPageCursor.title
          || liveCursor.visibility !== previousPageCursor.visibility
          || liveCursor.review_status !== previousPageCursor.review_status) {
          throw new Error("The term catalog changed while loading. Retry to read the complete term.");
        }
      }
      if (!Array.isArray(page) || page.length > 24
        || page.some(course => !course || typeof course.id !== "string" || !course.id.trim()
          || typeof course.current_revision_id !== "string" || !course.current_revision_id.trim()
          || typeof course.term !== "string" || termIdentity(course.term) !== termIdentity(term)
          || seen.has(course.id) || seenRevisions.has(course.current_revision_id))
        || new Set(page.map(course => course.id)).size !== page.length
        || new Set(page.map(course => course.current_revision_id)).size !== page.length) {
        throw new Error("The term catalog changed while loading. Retry to read the complete term.");
      }
      for (const course of page) { seen.add(course.id); seenRevisions.add(course.current_revision_id); courses.push(course); }
      if (page.length < 24) return courses;
      previousPageCursor = page.at(-1)!;
      cursor = previousPageCursor.id;
    }
    throw new Error("The term catalog exceeded the safe page limit. Retry later; no partial course list was returned.");
  } finally { scope.dispose(); }
}

type TermWorkspace = DownloadWorkspace & Pick<NoctyriumState, "terms" | "courses">;

function hasForeignDeferredHydration(accountId: string, workspace: TermWorkspace): boolean {
  return !!workspace.deferredContent && workspace.deferredContent.accountId !== accountId;
}

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
  if (owners.length !== 1) return undefined;
  // A legacy receipt without a saved source term requires a unique local
  // owner AND a unique curriculum term row. A duplicated term ID must not
  // assign its questions to whichever conflicting row happens to come first.
  const matchingTerms = workspace.terms.filter(entry => entry.id === owners[0].termId);
  if (matchingTerms.length !== 1) return undefined;
  const name: unknown = matchingTerms[0].name;
  return typeof name === "string" ? name.trim() || undefined : undefined;
}

/** Old question-only receipts may have no local term identity. Check every
 * receipt, not only those represented in the visible catalog page. */
export function termQuizNeedsCatalog(accountId: string, workspace: TermWorkspace): boolean {
  if (hasForeignDeferredHydration(accountId, workspace)) return false;
  return workspaceReferences(accountId, workspace).some(saved => !saved.term && !installedReferenceTerm(saved, workspace));
}

/** Receipt identity, rather than module titles or the current catalog page,
 * selects downloaded questions. New receipts retain their reviewed term;
 * older receipts use an exact catalog or installed hosted-course identity. */
export function termQuizSelection(term: string, accountId: string, workspace: TermWorkspace,
  courses: readonly AcademicCourse[] = []): CourseQuizLaunch {
  // A foreign deferred payload is not proof that the currently visible rows
  // belong to this account; wait for reconciliation before offering a quiz.
  if (hasForeignDeferredHydration(accountId, workspace)) {
    return { scopeKind: "term", module: term, term, setIds: [], questionIds: [] };
  }
  const ids = new Set<string>();
  // Bind original sets to the receipt that actually authorizes each question.
  // A unique set in a different downloaded collection is not source proof.
  const receiptSetsByQuestion = new Map<string, Set<string>>();
  const setIds = new Set<string>();
  const setCounts = new Map<string, number>();
  const explicitSetMembers = new Map<string, Set<string> | null>();
  for (const set of workspace.questionSets) {
    setCounts.set(set.id, (setCounts.get(set.id) ?? 0) + 1);
    // Legacy local sets may omit membership. An explicit list is authoritative;
    // malformed or repeated IDs are never proof of an original question link.
    if (Object.prototype.hasOwnProperty.call(set, "questionIds")) {
      explicitSetMembers.set(set.id, Array.isArray(set.questionIds)
        && set.questionIds.every(id => typeof id === "string" && id.trim().length > 0)
        && new Set(set.questionIds).size === set.questionIds.length
        ? new Set(set.questionIds) : null);
    }
  }
  const references = workspaceReferences(accountId, workspace);
  const questionTerms = new Map<string, string>();
  const setTerms = new Map<string, string>();
  const conflictingQuestions = new Set<string>();
  const conflictingSets = new Set<string>();
  // An unplaced legacy receipt is unresolved source ownership, not a
  // separate proven term. Hold any original ID it shares with a known term.
  const unplacedQuestions = new Set<string>();
  const unplacedSets = new Set<string>();
  // A saved term contradicted by the exact catalog is unresolved provenance.
  // Hold its original IDs even if another receipt also claims them.
  const contradictedQuestions = new Set<string>();
  const contradictedSets = new Set<string>();
  const recordTerm = (id: string, owner: string, owners: Map<string, string>, conflicts: Set<string>) => {
    const previous = owners.get(id);
    if (previous !== undefined && previous !== owner) conflicts.add(id);
    else owners.set(id, owner);
  };
  for (const saved of references) {
    const catalog = courses.find(course => course.id === saved.collectionId && course.current_revision_id === saved.revisionId);
    if (saved.term && catalog && termIdentity(saved.term) !== termIdentity(catalog.term)) {
      for (const id of saved.questionIds) contradictedQuestions.add(id);
      for (const id of saved.setIds) contradictedSets.add(id);
      continue;
    }
    const savedTerm = saved.term ?? catalog?.term ?? installedReferenceTerm(saved, workspace);
    if (!savedTerm) {
      for (const id of saved.questionIds) unplacedQuestions.add(id);
      for (const id of saved.setIds) unplacedSets.add(id);
      continue;
    }
    const owner = termIdentity(savedTerm);
    for (const id of saved.questionIds) recordTerm(id, owner, questionTerms, conflictingQuestions);
    for (const id of saved.setIds) recordTerm(id, owner, setTerms, conflictingSets);
  }
  for (const saved of references) {
    const catalog = courses.find(course => course.id === saved.collectionId && course.current_revision_id === saved.revisionId);
    if (saved.term && catalog && termIdentity(saved.term) !== termIdentity(catalog.term)) continue;
    const savedTerm = saved.term ?? catalog?.term ?? installedReferenceTerm(saved, workspace);
    if (!savedTerm || termIdentity(savedTerm) !== termIdentity(term)) continue;
    // An original set ID must resolve to exactly one local set. An ambiguous
    // or absent original is not evidence that its questions can be practiced.
    for (const id of saved.questionIds) {
      if (conflictingQuestions.has(id) || unplacedQuestions.has(id) || contradictedQuestions.has(id)) continue;
      ids.add(id);
      const owningSets = receiptSetsByQuestion.get(id) ?? new Set<string>();
      for (const originalSetId of saved.setIds) owningSets.add(originalSetId);
      receiptSetsByQuestion.set(id, owningSets);
    }
    for (const id of saved.setIds) if (!conflictingSets.has(id) && !unplacedSets.has(id) && !contradictedSets.has(id)
      && setCounts.get(id) === 1 && explicitSetMembers.get(id) !== null) setIds.add(id);
  }
  const counts = new Map<string, number>();
  for (const question of workspace.questions) counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  // A deferred buffer is account-scoped. Foreign-account recovery data must
  // not hide already installed, receipt-authorized questions for this account.
  // Missing owner metadata stays conservatively deferred until recovered.
  const deferred = new Set(workspace.deferredContent &&
    (!workspace.deferredContent.accountId || workspace.deferredContent.accountId === accountId)
    ? workspace.deferredContent.questions.map(question => question.id) : []);
  const readyQuestions = workspace.questions.filter(question => ids.has(question.id)
    && counts.get(question.id) === 1 && !deferred.has(question.id)
    && (!question.setId || (!conflictingSets.has(question.setId) && !unplacedSets.has(question.setId)
      && !contradictedSets.has(question.setId)))
    && (!question.setId || (setCounts.get(question.setId) === 1
      && receiptSetsByQuestion.get(question.id)?.has(question.setId)
      && (!explicitSetMembers.has(question.setId) || explicitSetMembers.get(question.setId)?.has(question.id) === true)))
    && questionMappingStatus(question) === "ready" && question.options.length >= 2);
  // A receipt may name a source set whose only questions were held, removed or
  // refilled. Only advertise sets represented by the actual runnable question
  // pool; the runner uses setIds as provenance and a source filter.
  const runnableIds = new Set(readyQuestions.map(question => question.id));
  const linkedSetIds = new Set(readyQuestions.map(question => question.setId).filter((id): id is string => typeof id === "string" && !!id.trim()));
  const runnableSetIds = [...setIds].filter(id => {
    if (conflictingSets.has(id) || unplacedSets.has(id) || contradictedSets.has(id)) return false;
    if (linkedSetIds.has(id)) return true;
    const declaredMembers = explicitSetMembers.get(id);
    // A valid explicit membership can establish a cross-listed source even
    // when the QuestionRecord lacks the original primary setId.
    return declaredMembers instanceof Set && [...declaredMembers].some(questionId =>
      runnableIds.has(questionId) && receiptSetsByQuestion.get(questionId)?.has(id));
  });
  return { scopeKind: "term", module: term, term, setIds: runnableSetIds,
    questionIds: readyQuestions.map(question => question.id) };
}
