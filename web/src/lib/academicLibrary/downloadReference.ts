import type { SourceDocument } from "../library";
import type { NoctyriumState } from "../types";
import type { LibraryInstallation, LibraryInstallScope } from "../privateLibrary/install";
import type { AcademicBindings } from "./contentReferences";
import { downloadAcademicCourse, type AcademicCourse } from "./client";
import { academicAccountScope } from "./accountScope";
import { useStore } from "../store";
import { downloadAccountContent } from "../sync/contentDownloads";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";

export const ACADEMIC_REFERENCE_TYPE = "axom-academic-reference";
export interface DownloadReference extends LibraryInstallation {
  collectionId: string;
  revisionId: string;
  accountId: string;
  /** Catalog scope is retained so downloaded terms can be practiced offline. */
  term?: string;
  module?: string;
  pendingWeeks?: number[];
  bindings?: AcademicBindings;
}
export type DownloadWorkspace = Pick<NoctyriumState, "documents" | "questions" | "questionSets" | "deferredContent">;
type CourseIdentity = Pick<AcademicCourse, "id" | "current_revision_id">;
// A failed flush can leave an optimistic receipt in memory. It must not make
// a retry skip the course until the reference has actually been saved.
const unsettledReferences = new Set<string>();
const referenceKey = (accountId: string, revisionId: string) => `${accountId}:${revisionId}`;

export function readDownloadReference(documents: readonly SourceDocument[], course: CourseIdentity, accountId?: string): DownloadReference | undefined {
  if (!accountId) return;
  const matches = documents.filter(doc => doc.fileType === ACADEMIC_REFERENCE_TYPE && doc.id === `academic-${course.current_revision_id}`);
  if (matches.length !== 1) return;
  try {
    const value = JSON.parse(matches[0].rawText) as DownloadReference;
    if (!value || value.accountId !== accountId || value.revisionId !== course.current_revision_id || value.collectionId !== course.id
      || value.status !== "complete"
      || ![value.templateIds, value.documentIds, value.questionIds, value.setIds].every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string" && id.trim().length > 0))
      || [value.templateIds, value.documentIds, value.questionIds, value.setIds].some(ids => new Set(ids).size !== ids.length)
      || [value.term, value.module].some(label => label !== undefined && (typeof label !== "string" || !label.trim() || label.length > 180))
      || (value.pendingWeeks !== undefined && (!Array.isArray(value.pendingWeeks) || value.pendingWeeks.some(week => !Number.isInteger(week) || week < 1 || week > 60)))) return;
    return value;
  } catch { return; }
}

export async function saveDownloadReference(value: DownloadReference, assertCurrent: () => void): Promise<void> {
  assertCurrent();
  const checkpoint = getVaultWriteCheckpoint();
  const rawText = JSON.stringify(value);
  const key = referenceKey(value.accountId, value.revisionId);
  unsettledReferences.add(key);
  useStore.getState().addDocument({ id: `academic-${value.revisionId}`, fileType: ACADEMIC_REFERENCE_TYPE, title: "Downloaded course reference",
    fileName: "course-reference.json", uploadedAt: new Date().toISOString(), rawText, sizeBytes: new TextEncoder().encode(rawText).length,
    tags: [], linkedQuestionSetIds: value.setIds, libraryOnly: true });
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
  assertCurrent();
  unsettledReferences.delete(key);
}

/** Account metadata alone is not an installed course. Every receipt member must
 * be present locally; a deferred or partially removed copy remains retryable. */
export function isAcademicCourseDownloaded(course: CourseIdentity, accountId: string, workspace: DownloadWorkspace): boolean {
  const saved = readDownloadReference(workspace.documents, course, accountId);
  if (!saved || unsettledReferences.has(referenceKey(accountId, course.current_revision_id)) || !Array.isArray(saved.bindings?.originals)) return false;
  const exactMembers = (ids: readonly string[], records: readonly { id: string }[]) => {
    const counts = new Map<string, number>();
    for (const record of records) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
    return ids.every(id => counts.get(id) === 1);
  };
  const documentIds = [...new Set([...saved.documentIds, ...saved.templateIds])];
  if (!exactMembers(documentIds, workspace.documents) || !exactMembers(saved.questionIds, workspace.questions)
    || !exactMembers(saved.setIds, workspace.questionSets)) return false;
  return !workspace.deferredContent?.questions.some(question => saved.questionIds.includes(question.id))
    && !workspace.deferredContent?.documents.some(document => documentIds.includes(document.id));
}

/** The same install and durable account reference used by a single question
 * collection. Downloading a course never loads tracker rows or enrolls weeks. */
export async function downloadCourseQuestions(course: AcademicCourse, accountId: string,
  progress: (message: string) => void = () => {}, externalScope?: LibraryInstallScope): Promise<DownloadReference> {
  const ownedScope = externalScope ? undefined : academicAccountScope(accountId);
  const scope = externalScope ?? ownedScope!;
  try {
    scope.assertCurrent();
    if (!accountId || scope.key !== accountId) throw new Error("Sign in again before downloading these questions.");
    let saved = readDownloadReference(useStore.getState().documents, course, accountId);
    if (saved && useStore.getState().deferredContent) {
      progress("Downloading these questions and your saved progress…");
      await downloadAccountContent({ questionIds: saved.questionIds, documentIds: [...new Set([...saved.documentIds, ...saved.templateIds])] });
      scope.assertCurrent();
    }
    if (!isAcademicCourseDownloaded(course, accountId, useStore.getState())) {
      const ids = await downloadAcademicCourse(course.current_revision_id, progress, scope);
      scope.assertCurrent();
      saved = { ...ids, collectionId: course.id, revisionId: course.current_revision_id, accountId,
        ...(saved?.pendingWeeks ? { pendingWeeks: saved.pendingWeeks } : {}) };
    }
    if (!saved) throw new Error("The downloaded course reference could not be saved. Retry this course.");
    saved = { ...saved, term: course.term, module: course.module };
    await saveDownloadReference(saved, scope.assertCurrent);
    return saved;
  } finally { ownedScope?.dispose(); }
}
