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
  let cursor: string | undefined;
  try {
    for (;;) {
      check();
      const page = await listAcademicCourses("", term, cursor);
      check();
      if (page.some(course => termIdentity(course.term) !== termIdentity(term) || seen.has(course.id))
        || new Set(page.map(course => course.id)).size !== page.length) {
        throw new Error("The term catalog changed while loading. Retry to read the complete term.");
      }
      for (const course of page) { seen.add(course.id); courses.push(course); }
      if (page.length < 24) return courses;
      cursor = page.at(-1)!.id;
    }
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
  const ids = new Set<string>();
  // Bind original sets to the receipt that actually authorizes each question.
  // A unique set in a different downloaded collection is not source proof.
  const receiptSetsByQuestion = new Map<string, Set<string>>();
  const setIds = new Set<string>();
  const setCounts = new Map<string, number>();
  const explicitSetMembers = new Map<string, Set<string> | null>();
  for (const set of workspace.questionSets) {
    setCounts.set(set.id, (setCounts.get(set.id) ?? 0) + 1);
    // Legacy local sets may omit membership. A declared list is authoritative;
    // malformed declarations never become proof of an original question link.
    if (Object.prototype.hasOwnProperty.call(set, "questionIds")) {
      explicitSetMembers.set(set.id, Array.isArray(set.questionIds)
        && set.questionIds.every(id => typeof id === "string" && id.trim().length > 0)
        ? new Set(set.questionIds) : null);
    }
  }
  for (const saved of workspaceReferences(accountId, workspace)) {
    const catalog = courses.find(course => course.id === saved.collectionId && course.current_revision_id === saved.revisionId);
    if (saved.term && catalog && termIdentity(saved.term) !== termIdentity(catalog.term)) continue;
    const savedTerm = saved.term ?? catalog?.term ?? installedReferenceTerm(saved, workspace);
    if (!savedTerm || termIdentity(savedTerm) !== termIdentity(term)) continue;
    // An original set ID must resolve to exactly one local set. An ambiguous
    // or absent original is not evidence that its questions can be practiced.
    for (const id of saved.questionIds) {
      ids.add(id);
      const owningSets = receiptSetsByQuestion.get(id) ?? new Set<string>();
      for (const originalSetId of saved.setIds) owningSets.add(originalSetId);
      receiptSetsByQuestion.set(id, owningSets);
    }
    for (const id of saved.setIds) if (setCounts.get(id) === 1) setIds.add(id);
  }
  const counts = new Map<string, number>();
  for (const question of workspace.questions) counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  // A deferred buffer is account-scoped. Foreign-account recovery data must
  // not hide already installed, receipt-authorized questions for this account.
  // Missing owner metadata stays conservatively deferred until recovered.
  const deferred = new Set(workspace.deferredContent &&
    (!workspace.deferredContent.accountId || workspace.deferredContent.accountId === accountId)
    ? workspace.deferredContent.questions.map(question => question.id) : []);
  return { scopeKind: "term", module: term, term, setIds: [...setIds], questionIds: workspace.questions.filter(question => ids.has(question.id)
    && counts.get(question.id) === 1 && !deferred.has(question.id)
    && (!question.setId || (setCounts.get(question.setId) === 1
      && receiptSetsByQuestion.get(question.id)?.has(question.setId)
      && (!explicitSetMembers.has(question.setId) || explicitSetMembers.get(question.setId)?.has(question.id) === true)))
    && questionMappingStatus(question) === "ready" && question.options.length >= 2).map(question => question.id) };
}
