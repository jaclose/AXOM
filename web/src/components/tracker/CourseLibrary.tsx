import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Search } from "lucide-react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { buildCourseBooks, type CourseBook } from "../../lib/bookshelf/courseBooks";
import { withPreparedCourses } from "../../lib/bookshelf/preparedCourses";
import { PreparedLibrary } from "../bookshelf/PreparedLibrary";
import { GButton } from "../ui/primitives";
import { buildQuestionBankBooks } from "../../lib/bookshelf/questionBankBooks";
import { bankForCourseBook } from "./courseLibraryMatching";
import { CoursePlan } from "./CoursePlan";
import { ConnectedCoursePlan } from "./ConnectedCoursePlan";
import { useAccount } from "../../lib/account/accountStore";
import { useAcademicCatalog } from "../../lib/academicLibrary/useAcademicCatalog";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/course-library.css";
import { AcademicCourseUpload } from "./AcademicCourseUpload";
import { getAcademicCourse, type AcademicCourse } from "../../lib/academicLibrary/client";

function courseCoverTitle(module: string): string {
  const words = module.trim().split(/\s+/);
  return module.length > 10 && words.length > 1 ? words.map(word => word[0]).join("") : module;
}

export function CourseLibrary({ onClose, onTemplate, onOpen, onCreate }: {
  onClose: () => void; onTemplate: (book?: CourseBook) => void;
  onOpen: (book: CourseBook) => void; onCreate: () => void;
}) {
  const s = useStore();
  const accountId = useAccount(account => account.user?.id);
  const profileKey = s.profile.educationTrack ?? "universal";
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"available" | "mine" | "all">("available");
  const { courses: connected, loading: catalogLoading, error: catalogError, more: moreAvailable,
    loadMore: more, retry: retryCatalog } = useAcademicCatalog(accountId, query, term, profileKey);
  const [selected, setSelected] = useState<string | null>(() => new URL(window.location.href).searchParams.get("course"));
  const [linkedCourse, setLinkedCourse] = useState<{ accountId: string; course: AcademicCourse }>();
  const [linkedError, setLinkedError] = useState("");
  const remoteId = selected?.startsWith("remote:") ? selected.slice(7) : undefined;
  const listedCourse = connected.find(course => course.id === remoteId);
  useEffect(() => {
    let cancelled = false;
    setLinkedCourse(undefined); setLinkedError("");
    if (accountId && remoteId && !listedCourse) {
      void getAcademicCourse(remoteId, accountId, profileKey).then(course => {
        if (!cancelled) setLinkedCourse({ accountId, course });
      }).catch(cause => { if (!cancelled) setLinkedError(cause instanceof Error ? cause.message : "This course could not be opened."); });
    }
    return () => { cancelled = true; };
  }, [accountId, profileKey, remoteId, listedCourse]);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("course", selected); else url.searchParams.delete("course");
    window.history.replaceState(null, "", url);
    heading.current?.scrollIntoView({ block: "start" });
    heading.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [selected]);
  const books = useMemo(() => withPreparedCourses(buildCourseBooks({ terms: s.terms, courses: s.courses,
    tracker: s.tracker, questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), s.documents, s.tracker),
  [s.terms, s.courses, s.tracker, s.questions, s.questionSets, s.documents]);
  const banks = useMemo(() => buildQuestionBankBooks({ terms: s.terms, courses: s.courses,
    questions: s.questions, sets: s.questionSets, curricula: CURRICULA }), [s.terms, s.courses, s.questions, s.questionSets]);
  const bankFor = (book: CourseBook) => bankForCourseBook(book, banks, books);
  const mine = (book: CourseBook) => book.templateIds?.length ? (book.loadedActivities ?? 0) > 0 : book.origin === "workspace" && book.count > 0;
  const available = (book: CourseBook) => Boolean(book.templateIds?.length || book.count || bankFor(book)?.ready);
  // A remote catalog record does not prove it is the same as a local course.
  // Keep both accessible; never hide another course by matching its module title.
  const shown = books.filter(book => (!term || book.term === term) && (view === "all" || (view === "mine" ? mine(book) : available(book)))
    && `${book.title} ${book.courseName ?? ""} ${book.courseCode ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen = books.find(book => book.id === selected);
  const connectedChosen = listedCourse ?? (linkedCourse && linkedCourse.accountId === accountId && linkedCourse.course.id === remoteId ? linkedCourse.course : undefined);
  const connectedShown = connected.filter(course => view !== "mine" || s.documents.some(document => document.id === `academic-${course.current_revision_id}`));
  const shownTerms = [...new Set([...connectedShown.map(course => course.term), ...shown.map(book => book.term)])]
    .sort((a, b) => Number(/^(?:term\s*|t)\d/i.test(b)) - Number(/^(?:term\s*|t)\d/i.test(a))
      || a.localeCompare(b, undefined, { numeric: true }));
  return <div className="course-library-page" ref={heading}>
    {remoteId && !connectedChosen && <div><GButton onClick={() => setSelected(null)}>All courses</GButton><p role={linkedError ? "alert" : "status"}>{linkedError || (accountId ? "Opening your course…" : "Sign in to open this course.")}</p></div>}
    {connectedChosen ? <ConnectedCoursePlan key={`${accountId}:${connectedChosen.current_revision_id}`} course={connectedChosen} onBack={() => setSelected(null)} onOpen={onOpen} onCustomize={onTemplate} onSharingSaved={retryCatalog} /> : chosen ? <CoursePlan key={chosen.id} book={chosen} bank={bankFor(chosen)} onBack={() => setSelected(null)} onOpen={onOpen} onCustomize={onTemplate} /> : <>
      <header className="course-library-heading"><div><p className="course-eyebrow">Your academic collection</p><h1 tabIndex={-1}>Course Library</h1><p>Preview the weeks. Choose what to load. Keep your progress.</p></div><GButton onClick={onClose}><ArrowLeft size={ICON_SIZE.body} /> My Courses</GButton></header>
      <div className="course-library-tools">
        <div className="course-view-switch" role="group" aria-label="Course collection">
          <button aria-pressed={view === "available"} onClick={() => setView("available")}>Available courses</button>
          <button aria-pressed={view === "mine"} onClick={() => setView("mine")}>My Courses</button>
          <button aria-pressed={view === "all"} onClick={() => setView("all")}>Course map</button>
        </div>
        <label className="course-search"><Search size={ICON_SIZE.emphasis} /><span className="sr-only">Search courses</span><input name="course-search" autoComplete="off" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Course or module" /></label>
        <label className="course-term-filter"><span className="sr-only">Filter by term</span><select value={term} onChange={event => setTerm(event.target.value)}><option value="">All terms</option>{[...new Set([...books.map(book => book.term), ...connected.map(course => course.term)])].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="course-collection-summary"><p className="course-collection-count" role="status">{catalogLoading ? "Loading the collection…" : `${shown.length + connectedShown.length} courses${view === "mine" ? " activated" : view === "all" ? " in the course map" : accountId ? " available" : " available on this device"}`}</p><span className="course-storage-context">{accountId ? "Account + this device" : "On this device"}</span></div>
      {catalogError && <div role="alert"><p>{catalogError}</p><GButton onClick={retryCatalog}>Retry collection</GButton></div>}
      {!shown.length && !connectedShown.length && !catalogLoading && <div className="course-empty"><BookOpen size={32} /><h2>{view === "mine" ? "Your courses start here" : "No courses to show"}</h2><p>{query || term ? "Try a different search or term." : "Choose an available course to preview its weekly plan. Your progress stays separate from the collection."}</p>{view !== "available" && <GButton onClick={() => setView("available")}>Browse available courses</GButton>}</div>}
      {shownTerms.map((sectionTerm, index) => <section className="course-term-section" key={sectionTerm} aria-labelledby={`course-term-${index}`}>
        <header className="course-term-heading"><h2 id={`course-term-${index}`}>{sectionTerm}</h2><span>{shown.filter(book => book.term === sectionTerm).length + connectedShown.filter(course => course.term === sectionTerm).length} courses</span></header>
        <div className="course-collection">
        {connectedShown.filter(course => course.term === sectionTerm).map(course => <button key={course.id} data-course-id={course.id} className="course-card" onClick={() => setSelected(`remote:${course.id}`)} aria-label={`Preview ${course.module}, ${course.academic_term || course.term}`}>
          <div className="course-card-cover" aria-hidden="true"><span>{course.term}</span><strong>{courseCoverTitle(course.module)}</strong><BookOpen size={28} strokeWidth={1} /></div>
          <div className="course-card-copy"><span className="course-card-context">{course.academic_term || course.term}{course.cohort ? ` · ${course.cohort}` : ""}</span><h3>{course.module}</h3><p>{course.title}</p><span className="course-card-facts">{course.ready_questions} ready questions{course.review_questions ? ` · ${course.review_questions} awaiting review` : ""}</span><span className="course-card-state">{course.owned ? "Your upload" : "Academic collection"} · {course.visibility === "private" ? "Private" : course.review_status === "approved" ? "Reviewed" : "Sharing review pending"}</span></div><ArrowUpRight size={ICON_SIZE.control} aria-hidden="true" />
        </button>)}
        {shown.filter(book => book.term === sectionTerm).map(book => <button key={book.id} className="course-card" data-available={available(book)} onClick={() => setSelected(book.id)} aria-label={`Preview ${book.module}, ${book.term}`}>
        <div className="course-card-cover" aria-hidden="true"><span>{book.term}</span><strong>{courseCoverTitle(book.module)}</strong><BookOpen size={28} strokeWidth={1} /></div>
        <div className="course-card-copy"><span className="course-card-context">{book.courseCode || book.term}</span><h3>{book.module}</h3><p>{book.courseName || "Academic module"}</p><span className="course-card-facts">{book.weeks.length ? `${book.weeks.length} weeks · ${book.count} activities` : "Weekly plan not available"}</span><span className="course-card-state">{mine(book) ? "In My Courses" : available(book) ? "Ready to preview" : "Not prepared yet"}{bankFor(book)?.ready ? ` · ${bankFor(book)?.ready} ready questions` : ""}</span></div><ArrowUpRight size={ICON_SIZE.control} aria-hidden="true" />
      </button>)}</div></section>)}
      {moreAvailable && <GButton disabled={catalogLoading} onClick={() => void more()}>Load more courses</GButton>}
      <details className="course-management"><summary>Manage sources and custom courses</summary><p className="sub">Prepared collections and personal imports are kept separate from course activation.</p><div className="row wrap gap8"><GButton onClick={() => onTemplate()}>Saved templates and imports</GButton><GButton onClick={onCreate}>Create a custom course</GButton></div><AcademicCourseUpload key={accountId} onSaved={retryCatalog} /><PreparedLibrary /></details>
    </>}
  </div>;
}
