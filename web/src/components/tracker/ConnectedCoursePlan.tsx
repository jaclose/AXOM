import type { AcademicBindings } from "../../lib/academicLibrary/contentReferences";
import { downloadAccountContent } from "../../lib/sync/contentDownloads";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { useAccount } from "../../lib/account/accountStore";
import { academicPreview, downloadAcademicCourse, enrollAcademicCourse, type AcademicCourse } from "../../lib/academicLibrary/client";
import { prepareCourseTemplate } from "../../lib/course-engine/templateLibrary";
import { parseCourseTemplate } from "../../lib/course-engine/templateParse";
import { canonicalModuleKey, moduleKey } from "../../lib/course-engine/vocabulary";
import { canonicalCourseOwnerUniverse, withPreparedCourses, loadPreparedCourse } from "../../lib/bookshelf/preparedCourses";
import { buildQuestionBankBooks } from "../../lib/bookshelf/questionBankBooks";
import { courseBookId, type CourseBook } from "../../lib/bookshelf/courseBooks";
import type { SourceDocument } from "../../lib/library";
import type { LibraryInstallation } from "../../lib/privateLibrary/install";
import type { Course, Term, TrackerItem } from "../../lib/types";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../../lib/localVault";
import { CoursePlan } from "./CoursePlan";
import { GButton } from "../ui/primitives";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { AcademicSharing } from "./AcademicSharing";

const REFERENCE_TYPE = "axom-academic-reference";
interface DownloadReference extends LibraryInstallation {
  collectionId: string;
  revisionId: string;
  accountId: string;
  pendingWeeks?: number[];
  bindings?: AcademicBindings;
}
function reference(documents: SourceDocument[], course: AcademicCourse, accountId?: string): DownloadReference | undefined {
  const revision = course.current_revision_id;
  const doc = documents.find(doc => doc.fileType === REFERENCE_TYPE && doc.id === `academic-${revision}`);
  if (!doc) return;
  try {
    const value = JSON.parse(doc.rawText) as DownloadReference;
    if (!value || value.accountId !== accountId || value.revisionId !== revision || value.collectionId !== course.id
      || ![value.templateIds, value.documentIds, value.questionIds, value.setIds].every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string" && id.length > 0))
      || (value.pendingWeeks && (!Array.isArray(value.pendingWeeks) || value.pendingWeeks.some(week => !Number.isInteger(week) || week < 1 || week > 60)))) return;
    return value;
  } catch { return; }
}
async function saveReference(value: DownloadReference, assertCurrent: () => void) {
  assertCurrent();
  const checkpoint = getVaultWriteCheckpoint();
  const rawText = JSON.stringify(value);
  useStore.getState().addDocument({ id: `academic-${value.revisionId}`, fileType: REFERENCE_TYPE, title: "Downloaded course reference",
    fileName: "course-reference.json", uploadedAt: new Date().toISOString(), rawText, sizeBytes: new TextEncoder().encode(rawText).length,
    tags: [], linkedQuestionSetIds: value.setIds, libraryOnly: true });
  await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint);
}

const termIdentity = (value: string): string => {
  const numbered = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return numbered ? `term${Number(numbered[1])}` : moduleKey(value);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bind a hosted collection to one stable local course owner. Revisions of the
 * same collection reuse this identity; another collection can never inherit
 * its tracker rows merely because the catalog labels are alike. */
export function connectedCourseBook(
  course: AcademicCourse,
  template: SourceDocument,
  workspace: { terms: readonly Term[]; courses: readonly Course[]; tracker: readonly TrackerItem[] } = {
    terms: [], courses: [], tracker: [],
  },
): CourseBook {
  if (!UUID.test(course.id)) throw new Error("This course has an invalid collection identity.");
  const section = parseCourseTemplate(template.rawText, template.fileName);
  if (section.problems.length || !section.items.length || !section.term
    || termIdentity(section.term) !== termIdentity(course.term)
    || canonicalModuleKey(section.module) !== canonicalModuleKey(course.module)) {
    throw new Error("This course plan does not match the catalog term and module. Your current course has not changed.");
  }
  const courseCode = `academic:${course.id}`;
  const exact: CourseBook = {
    kind: "course",
    id: courseBookId(course.term, courseCode, course.module),
    title: course.module,
    identifier: courseCode,
    shelf: course.term,
    count: 0,
    countLabel: "0 activities",
    state: "empty",
    stateNote: "Not loaded yet.",
    module: course.module,
    term: course.term,
    courseCode,
    courseName: course.title,
    origin: "curriculum",
    weeks: [],
    unfiled: 0,
    done: 0,
    templateIds: [template.id],
  };
  const owners = canonicalCourseOwnerUniverse(workspace, exact);
  const book = withPreparedCourses([exact], [template], workspace.tracker, owners)[0];
  if (!book || book.templateIds?.length !== 1 || book.templateIds[0] !== template.id) {
    throw new Error("This course plan could not be bound to its exact saved template.");
  }
  return book;
}

export function ConnectedCoursePlan({ course, onBack, onOpen, onCustomize, onSharingSaved }: {
  course: AcademicCourse; onBack: () => void; onOpen: (book: CourseBook) => void; onCustomize: (book: CourseBook) => void; onSharingSaved: () => void;
}) {
  const state = useStore();
  const accountId = useAccount(account => account.user?.id);
  const [template, setTemplate] = useState<SourceDocument>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const downloaded = useMemo(() => reference(state.documents, course, accountId), [state.documents, course, accountId]);
  const cachedTemplate = state.documents.find(document => downloaded?.templateIds.includes(document.id));
  useEffect(() => {
    if (cachedTemplate) {
      try { connectedCourseBook(course, cachedTemplate); setTemplate(cachedTemplate); setError(""); }
      catch (cause) { setTemplate(undefined); setError(cause instanceof Error ? cause.message : "The saved course plan could not be opened."); }
      return;
    }
    let cancelled = false;
    setTemplate(undefined); setError("");
    void academicPreview(course.current_revision_id, accountId).then(preview => {
      if (preview.collection_id !== course.id) throw new Error("This preview does not match the selected course.");
      return prepareCourseTemplate(preview.template_text, `${course.module} course plan.txt`);
    })
      .then(document => { connectedCourseBook(course, document); return document; })
      .then(document => { if (!cancelled) { setTemplate(document); setError(""); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The course preview could not be opened."); });
    return () => { cancelled = true; };
  }, [course, accountId, retry, cachedTemplate]);
  const book = useMemo(() => {
    if (!template) return;
    try {
      return connectedCourseBook(course, template, {
        terms: state.terms, courses: state.courses, tracker: state.tracker,
      });
    }
    catch { return undefined; }
  }, [template, state.terms, state.courses, state.tracker, course]);
  const bank = useMemo(() => {
    if (!downloaded) return;
    const ids = new Set(downloaded.questionIds);
    const sets = new Set(downloaded.setIds);
    return buildQuestionBankBooks({ terms: state.terms, courses: state.courses,
      questions: state.questions.filter(question => ids.has(question.id)), sets: state.questionSets.filter(set => sets.has(set.id)) })[0];
  }, [downloaded, state.terms, state.courses, state.questions, state.questionSets]);
  async function load(weeks: number[]) {
    if (!book || !weeks.length) return { status: "nothing-to-save" as const };
    setError("");
    const scope = academicAccountScope(accountId ?? "");
    try {
      scope.assertCurrent();
      if (!accountId) throw new Error("Sign in again before downloading this course.");
      let saved = downloaded;
      if (saved && useStore.getState().deferredContent) {
        setMessage("Downloading this course and your saved progress…");
        await downloadAccountContent({ questionIds: saved.questionIds, documentIds: saved.documentIds });
        scope.assertCurrent();
      }
      if (!saved?.bindings?.originals || !saved.questionIds.every(id => useStore.getState().questions.some(question => question.id === id))) {
        const ids = await downloadAcademicCourse(course.current_revision_id, setMessage, scope);
        scope.assertCurrent();
        saved = { ...ids, collectionId: course.id, revisionId: course.current_revision_id, accountId };
      }
      // Persist intent before the network call. A failed acknowledgement leaves
      // an explicit retry available and never removes the downloaded source.
      await saveReference({ ...saved, pendingWeeks: weeks }, scope.assertCurrent);
      const outcome = await loadPreparedCourse(book, weeks, scope.assertCurrent);
      if (outcome.status === "failed") return outcome;
      scope.assertCurrent();
      await enrollAcademicCourse(course, weeks, accountId);
      await saveReference({ ...saved, pendingWeeks: undefined }, scope.assertCurrent);
      setMessage("Course downloaded and enrollment saved to your account.");
      return outcome;
    } catch (cause) { return { status: "failed" as const, message: cause instanceof Error ? cause.message : "The course could not be loaded. Retry when connected." }; }
    finally { scope.dispose(); }
  }
  return <>
    {!book && <><GButton onClick={onBack}>All courses</GButton><p role="status">{error ? "Preview unavailable" : "Opening the weekly plan…"}</p></>}
    {error && <div role="alert"><p>{error}</p><GButton onClick={() => setRetry(value => value + 1)}>Retry preview</GButton></div>}
    {book && <><p className="course-connection-status" role="status">{message || (downloaded ? (downloaded.questionIds.every(id => state.questions.some(question => question.id === id)) ? "Course files downloaded on this device" : "Saved in your account. Download this course to continue on this device.") : `${course.ready_questions} reviewed questions available to download. Load Course downloads this revision for study.`)}</p>
      {downloaded && !downloaded.questionIds.every(id => state.questions.some(question => question.id === id)) && <GButton disabled={downloading} onClick={() => { setError(""); setDownloading(true); void downloadAccountContent({ questionIds: downloaded.questionIds, documentIds: downloaded.documentIds }).catch(cause => setError(cause instanceof Error ? cause.message : "Download unavailable. Retry when connected.")).finally(() => setDownloading(false)); }}>Download course to this device</GButton>}
      <AcademicSharing course={course} onSaved={onSharingSaved} />
      {downloaded?.pendingWeeks && <p role="status">Enrollment is saved on this device and needs an account retry. Load Course again when connected.</p>}
      <CoursePlan book={book} bank={bank} availableQuestions={course.ready_questions} onBack={onBack} onOpen={onOpen} onCustomize={onCustomize} onLoad={load} />
    </>}
  </>;
}
