import { downloadAccountContent } from "../../lib/sync/contentDownloads";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Download, Play } from "lucide-react";
import { useStore } from "../../lib/store";
import { useAccount } from "../../lib/account/accountStore";
import { academicPreview, downloadAcademicCourse, enrollAcademicCourse, type AcademicCourse } from "../../lib/academicLibrary/client";
import { prepareCourseTemplate } from "../../lib/course-engine/templateLibrary";
import { parseCourseTemplate } from "../../lib/course-engine/templateParse";
import { canonicalModuleKey, moduleKey } from "../../lib/course-engine/vocabulary";
import { canonicalCourseOwnerUniverse, withPreparedCourses, loadPreparedCourse } from "../../lib/bookshelf/preparedCourses";
import { buildQuestionBankBooks, type QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { courseBookId, type CourseBook } from "../../lib/bookshelf/courseBooks";
import type { QuestionSet, SourceDocument } from "../../lib/library";
import { questionMappingStatus, type QuestionRecord } from "../../lib/questions";
import type { Course, Term, TrackerItem } from "../../lib/types";
import { CoursePlan } from "./CoursePlan";
import { GButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { launchCourseQuiz, MAX_COURSE_QUIZ_QUESTIONS } from "../../lib/course-engine/quizLaunch";
import { splitAcademicPlanSections } from "../../lib/academicLibrary/coursePlan";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { AcademicSharing } from "./AcademicSharing";
import { downloadCourseQuestions, readDownloadReference, saveDownloadReference, type DownloadReference } from "../../lib/academicLibrary/downloadReference";

const termIdentity = (value: string): string => {
  const numbered = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return numbered ? `term${Number(numbered[1])}` : moduleKey(value);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bind a hosted collection to one stable local course owner. Revisions of the
 * same collection reuse this identity; another collection can never inherit
 * its tracker rows merely because the catalog labels are alike. A course may
 * hold several plan sections of its module. A section that does not state its
 * term takes the collection's reviewed term; one that does must agree. */
export function connectedCourseBook(
  course: AcademicCourse,
  plan: SourceDocument | readonly SourceDocument[],
  workspace: { terms: readonly Term[]; courses: readonly Course[]; tracker: readonly TrackerItem[] } = {
    terms: [], courses: [], tracker: [],
  },
): CourseBook {
  if (!UUID.test(course.id)) throw new Error("This course has an invalid collection identity.");
  const templates: readonly SourceDocument[] = Array.isArray(plan) ? plan : [plan as SourceDocument];
  if (!templates.length || new Set(templates.map(template => template.id)).size !== templates.length)
    throw new Error("This course plan could not be bound to its exact saved template.");
  for (const template of templates) {
    const section = parseCourseTemplate(template.rawText, template.fileName);
    if (section.problems.length || !section.items.length
      || (section.term !== undefined && termIdentity(section.term) !== termIdentity(course.term))
      || canonicalModuleKey(section.module) !== canonicalModuleKey(course.module)) {
      throw new Error("This course plan does not match the catalog term and module. Your current course has not changed.");
    }
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
    // Published courses are titled by their module; do not repeat it as a subtitle.
    ...(course.title.trim() !== course.module.trim() ? { courseName: course.title } : {}),
    origin: "curriculum",
    weeks: [],
    unfiled: 0,
    done: 0,
    templateIds: templates.map(template => template.id),
  };
  const owners = canonicalCourseOwnerUniverse(workspace, exact);
  const book = withPreparedCourses([exact], templates, workspace.tracker, owners)[0];
  if (!book || book.templateIds?.length !== templates.length
    || book.templateIds.some((id, index) => id !== templates[index].id)) {
    throw new Error("This course plan could not be bound to its exact saved template.");
  }
  return book;
}

/** Project only the question membership named by this collection's durable
 * download receipt onto its exact local hosted-course owner. A same-named
 * local course, or simply the first generated bank, is never sufficient. */
export function connectedQuestionBank(
  course: Pick<AcademicCourse, "id" | "module" | "term">,
  downloaded: Pick<DownloadReference, "questionIds" | "setIds"> | undefined,
  workspace: {
    terms: readonly Term[];
    courses: readonly Course[];
    questions: readonly QuestionRecord[];
    questionSets: readonly QuestionSet[];
  },
): QuestionBankBook | undefined {
  if (!downloaded?.questionIds.length) return;
  const courseCode = `academic:${course.id}`;
  const owners = workspace.courses.filter(owner => owner.code === courseCode
    && termIdentity(workspace.terms.find(term => term.id === owner.termId)?.name ?? "") === termIdentity(course.term)
    && owner.modules.some(module => canonicalModuleKey(module.name) === canonicalModuleKey(course.module)));
  if (owners.length !== 1) return;
  const owner = owners[0];
  const questionIds = new Set(downloaded.questionIds);
  const setIds = new Set(downloaded.setIds);
  if (questionIds.size !== downloaded.questionIds.length || setIds.size !== downloaded.setIds.length) return;
  const questions = workspace.questions.filter(question => questionIds.has(question.id));
  const sets = workspace.questionSets.filter(set => setIds.has(set.id));
  if (questions.length !== questionIds.size || sets.length !== setIds.size) return;
  if (questions.some(question => (question.courseId && question.courseId !== owner.id)
    || (question.module && canonicalModuleKey(question.module) !== canonicalModuleKey(course.module)))
    || sets.some(set => (set.scope?.courseId && set.scope.courseId !== owner.id)
      || (set.scope?.module && canonicalModuleKey(set.scope.module) !== canonicalModuleKey(course.module)))) return;
  const scopedQuestions = questions.map(question => ({
    ...question, courseId: owner.id, module: question.module ?? course.module,
  }));
  const scopedSets = sets.map(set => ({
    ...set, scope: { ...set.scope, courseId: owner.id, module: set.scope?.module ?? course.module },
  }));
  const matches = buildQuestionBankBooks({
    terms: workspace.terms,
    courses: workspace.courses,
    questions: scopedQuestions,
    sets: scopedSets,
  }).filter(bank => bank.courseId === owner.id
    && canonicalModuleKey(bank.module) === canonicalModuleKey(course.module)
    && termIdentity(bank.term) === termIdentity(course.term));
  if (matches.length !== 1) return;
  const represented = new Set(matches[0].weeks.flatMap(week => week.collections.flatMap(collection => collection.questionIds ?? [])));
  return represented.size === questionIds.size && [...questionIds].every(id => represented.has(id)) ? matches[0] : undefined;
}

export function ConnectedCoursePlan({ course, onBack, onOpen, onCustomize, onSharingSaved }: {
  course: AcademicCourse; onBack: () => void; onOpen: (book: CourseBook) => void; onCustomize: (book: CourseBook) => void; onSharingSaved: () => void;
}) {
  const state = useStore();
  const accountId = useAccount(account => account.user?.id);
  // Undefined while opening; an empty list is a question collection with no weekly plan.
  const [templates, setTemplates] = useState<SourceDocument[]>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const downloaded = useMemo(() => readDownloadReference(state.documents, course, accountId), [state.documents, course, accountId]);
  // Template ids are content addresses, so equal ids mean the same saved sections.
  const cachedPlan = useMemo(() => {
    const ids = downloaded?.templateIds ?? [];
    return ids.length && ids.every(id => state.documents.some(document => document.id === id)) ? ids.join("\n") : "";
  }, [downloaded, state.documents]);
  useEffect(() => {
    if (cachedPlan) {
      const documents = useStore.getState().documents;
      const cached = cachedPlan.split("\n").flatMap(id => documents.filter(document => document.id === id).slice(0, 1));
      try { connectedCourseBook(course, cached); setTemplates(cached); setError(""); }
      catch (cause) { setTemplates(undefined); setError(cause instanceof Error ? cause.message : "The saved course plan could not be opened."); }
      return;
    }
    let cancelled = false;
    setTemplates(undefined); setError("");
    void academicPreview(course.current_revision_id, accountId).then(preview => {
      if (preview.collection_id !== course.id) throw new Error("This preview does not match the selected course.");
      if (!preview.template_text) return [];
      const sections = splitAcademicPlanSections(preview.template_text);
      return Promise.all(sections.map((text, index) => prepareCourseTemplate(text,
        sections.length === 1 ? `${course.module} course plan.txt` : `${course.module} course plan ${index + 1}.txt`)));
    })
      .then(documents => { if (documents.length) connectedCourseBook(course, documents); return documents; })
      .then(documents => { if (!cancelled) { setTemplates(documents); setError(""); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The course preview could not be opened."); });
    return () => { cancelled = true; };
  }, [course, accountId, retry, cachedPlan]);
  const book = useMemo(() => {
    if (!templates?.length) return;
    try {
      return connectedCourseBook(course, templates, {
        terms: state.terms, courses: state.courses, tracker: state.tracker,
      });
    }
    catch { return undefined; }
  }, [templates, state.terms, state.courses, state.tracker, course]);
  const bank = useMemo(() => {
    return connectedQuestionBank(course, downloaded, {
      terms: state.terms,
      courses: state.courses,
      questions: state.questions,
      questionSets: state.questionSets,
    });
  }, [course, downloaded, state.terms, state.courses, state.questions, state.questionSets]);
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
        saved = { ...ids, collectionId: course.id, revisionId: course.current_revision_id, accountId, term: course.term, module: course.module };
      }
      saved = { ...saved, term: course.term, module: course.module };
      // Persist intent before the network call. A failed acknowledgement leaves
      // an explicit retry available and never removes the downloaded source.
      await saveDownloadReference({ ...saved, pendingWeeks: weeks }, scope.assertCurrent);
      const outcome = await loadPreparedCourse(book, weeks, scope.assertCurrent);
      if (outcome.status === "failed") return outcome;
      scope.assertCurrent();
      await enrollAcademicCourse(course, weeks, accountId);
      await saveDownloadReference({ ...saved, pendingWeeks: undefined }, scope.assertCurrent);
      setMessage("Course downloaded and enrollment saved to your account.");
      return outcome;
    } catch (cause) { return { status: "failed" as const, message: cause instanceof Error ? cause.message : "The course could not be loaded. Retry when connected." }; }
    finally { scope.dispose(); }
  }
  /** A collection without a weekly plan downloads its questions only; there is
   * no tracker row to create and no week to enroll. */
  async function downloadQuestions() {
    if (downloading) return;
    setError(""); setDownloading(true);
    try {
      await downloadCourseQuestions(course, accountId ?? "", setMessage);
      setMessage("Questions downloaded to this device.");
    } catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "The questions could not be downloaded. Retry when connected."); }
    finally { setDownloading(false); }
  }

  return <>
    {templates === undefined && <><GButton onClick={onBack}>All courses</GButton><p role="status">{error ? "Preview unavailable" : "Opening the weekly plan…"}</p></>}
    {error && <div role="alert"><p>{error}</p><GButton onClick={() => setRetry(value => value + 1)}>Retry preview</GButton></div>}
    {templates?.length === 0 && <ConnectedQuestionCollection course={course} downloaded={downloaded} questions={state.questions}
      busy={downloading} message={message} onBack={onBack} onDownload={() => void downloadQuestions()} onSharingSaved={onSharingSaved} />}
    {templates?.length !== 0 && book && <><p className="course-connection-status" role="status">{message || (downloaded ? (downloaded.questionIds.every(id => state.questions.some(question => question.id === id)) ? "Course files downloaded on this device" : "Saved in your account. Download this course to continue on this device.") : `${course.ready_questions} reviewed questions available to download. Load Course downloads this revision for study.`)}</p>
      {downloaded && !downloaded.questionIds.every(id => state.questions.some(question => question.id === id)) && <GButton disabled={downloading} onClick={() => { setError(""); setDownloading(true); void downloadAccountContent({ questionIds: downloaded.questionIds, documentIds: downloaded.documentIds }).catch(cause => setError(cause instanceof Error ? cause.message : "Download unavailable. Retry when connected.")).finally(() => setDownloading(false)); }}>Download course to this device</GButton>}
      <AcademicSharing course={course} onSaved={onSharingSaved} />
      {downloaded?.pendingWeeks && <p role="status">Enrollment is saved on this device and needs an account retry. Load Course again when connected.</p>}
      <CoursePlan book={book} bank={bank} availableQuestions={course.ready_questions} onBack={onBack} onOpen={onOpen} onCustomize={onCustomize} onLoad={load} />
    </>}
  </>;
}

/** Questions filed to a term and module whose source has no weekly plan. */
function ConnectedQuestionCollection({ course, downloaded, questions, busy, message, onBack, onDownload, onSharingSaved }: {
  course: AcademicCourse; downloaded: DownloadReference | undefined; questions: readonly QuestionRecord[];
  busy: boolean; message: string; onBack: () => void; onDownload: () => void; onSharingSaved: () => void;
}) {
  const [launchError, setLaunchError] = useState("");
  const onDevice = Boolean(downloaded?.questionIds.length)
    && downloaded!.questionIds.every(id => questions.some(question => question.id === id));
  const practiceIds = useMemo(() => {
    const ids = new Set(downloaded?.questionIds ?? []);
    return questions.filter(question => ids.has(question.id)
      && questionMappingStatus(question) === "ready" && question.options.length >= 2).map(question => question.id);
  }, [downloaded, questions]);
  function practice() {
    setLaunchError("");
    try {
      launchCourseQuiz({ module: course.module, term: course.term, questionIds: practiceIds,
        setIds: [...new Set(downloaded?.setIds ?? [])] });
    } catch (cause) { setLaunchError(cause instanceof Error ? cause.message : "Practice could not be opened."); }
  }
  return <section className="course-plan" aria-label={`${course.module} question collection`}>
    <GButton size="sm" onClick={onBack}><ArrowLeft size={ICON_SIZE.body} /> All courses</GButton>
    <div className="course-plan-heading">
      <div className="course-plan-cover" aria-hidden="true"><span>{course.term}</span><strong>{course.module}</strong><BookOpen size={40} strokeWidth={1} /></div>
      <div><p className="course-eyebrow">{course.academic_term || course.term}{course.cohort ? ` · ${course.cohort}` : ""}</p><h1 tabIndex={-1}>{course.module}</h1>
        <p>{course.title.trim() !== course.module.trim() ? course.title : "Question collection"}</p>
        <div className="course-plan-facts"><span><b>{course.ready_questions}</b> reviewed {course.ready_questions === 1 ? "question" : "questions"}</span>{course.review_questions > 0 && <span><b>{course.review_questions}</b> awaiting review</span>}</div>
      </div>
    </div>
    <div className="course-plan-layout">
      <div className="course-week-list">
        <div className="course-section-heading"><h2>Question sets</h2></div>
        <p className="course-empty">This collection has no weekly plan. Its questions keep the term and module of their source, and any week the source states. Weeks the source does not state stay unassigned.</p>
        <AcademicSharing course={course} onSaved={onSharingSaved} />
      </div>
      <aside className="course-plan-actions" aria-label="Question collection actions">
        <h2>Study these questions</h2>
        <p>{onDevice ? `${practiceIds.length} reviewed ${practiceIds.length === 1 ? "question is" : "questions are"} on this device.` : `Download ${course.ready_questions} reviewed ${course.ready_questions === 1 ? "question" : "questions"} and their images to practice them, including offline.`}</p>
        {!onDevice && <GButton variant="primary" disabled={busy || course.ready_questions < 1} onClick={onDownload}><Download size={ICON_SIZE.emphasis} /> {busy ? "Downloading…" : "Download questions"}</GButton>}
        {onDevice && practiceIds.length > MAX_COURSE_QUIZ_QUESTIONS && <p>This collection holds more than {MAX_COURSE_QUIZ_QUESTIONS} questions. Choose its sets in Question Bank to build a block.</p>}
        {onDevice && practiceIds.length <= MAX_COURSE_QUIZ_QUESTIONS && <GButton variant="primary" disabled={!practiceIds.length} onClick={practice}><Play size={ICON_SIZE.emphasis} /> Create Quiz</GButton>}
        {launchError && <p role="alert">{launchError}</p>}
        <p role="status" aria-live="polite">{message}</p>
      </aside>
    </div>
  </section>;
}
