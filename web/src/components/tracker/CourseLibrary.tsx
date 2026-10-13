import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Search } from "lucide-react";
import { useStore } from "../../lib/store";
import { CURRICULA } from "../../lib/curricula";
import { buildCourseBooks, type CourseBook } from "../../lib/bookshelf/courseBooks";
import { withPreparedCourses } from "../../lib/bookshelf/preparedCourses";
import { PreparedLibrary } from "../bookshelf/PreparedLibrary";
import { GButton } from "../ui/primitives";
import { buildQuestionBankBooks } from "../../lib/bookshelf/questionBankBooks";
import { moduleKey } from "../../lib/course-engine/vocabulary";
import { CoursePlan } from "./CoursePlan";
import { ConnectedCoursePlan } from "./ConnectedCoursePlan";
import { useAccount } from "../../lib/account/accountStore";
import { useAcademicCatalog } from "../../lib/academicLibrary/useAcademicCatalog";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/course-library.css";
import { AcademicCourseUpload } from "./AcademicCourseUpload";

export function CourseLibrary({ onClose, onTemplate, onOpen, onCreate }: {
  onClose: () => void; onTemplate: (book?: CourseBook) => void;
  onOpen: (book: CourseBook) => void; onCreate: () => void;
}) {
  const s = useStore();
  const accountId = useAccount(account => account.user?.id);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"available" | "mine" | "all">("available");
  const { courses: connected, loading: catalogLoading, error: catalogError, more: moreAvailable,
    loadMore: more, retry: retryCatalog } = useAcademicCatalog(accountId, query, term);
  const [selected, setSelected] = useState<string | null>(() => new URL(window.location.href).searchParams.get("course"));
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
  const bankFor = (book: CourseBook) => banks.find(bank => moduleKey(bank.module) === moduleKey(book.module) && bank.term === book.term);
  const mine = (book: CourseBook) => book.templateIds?.length ? (book.loadedActivities ?? 0) > 0 : book.origin === "workspace" && book.count > 0;
  const available = (book: CourseBook) => Boolean(book.templateIds?.length || book.count || bankFor(book)?.ready);
  const shown = books.filter(book => !connected.some(course => moduleKey(course.module) === moduleKey(book.module) && course.term === book.term)
    && (!term || book.term === term) && (view === "all" || (view === "mine" ? mine(book) : available(book)))
    && `${book.title} ${book.courseName ?? ""} ${book.courseCode ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen = books.find(book => book.id === selected);
  const connectedChosen = connected.find(course => `remote:${course.id}` === selected);
  const connectedShown = connected.filter(course => view !== "mine" || s.documents.some(document => document.id === `academic-${course.current_revision_id}`));
  return <div className="course-library-page" ref={heading}>
    {connectedChosen ? <ConnectedCoursePlan key={`${accountId}:${connectedChosen.current_revision_id}`} course={connectedChosen} onBack={() => setSelected(null)} onOpen={onOpen} onCustomize={onTemplate} onSharingSaved={retryCatalog} /> : chosen ? <CoursePlan key={chosen.id} book={chosen} bank={bankFor(chosen)} onBack={() => setSelected(null)} onOpen={onOpen} onCustomize={onTemplate} /> : <>
      <header className="course-library-heading"><div><p className="course-eyebrow">Academic collection</p><h1 tabIndex={-1}>Course Library</h1><p>Find your course. See the weeks ahead. Study what matters now.</p></div><GButton onClick={onClose}><ArrowLeft size={ICON_SIZE.body} /> My Courses</GButton></header>
      <div className="course-library-tools">
        <div className="course-view-switch" role="group" aria-label="Course collection">
          <button aria-pressed={view === "available"} onClick={() => setView("available")}>Available courses</button>
          <button aria-pressed={view === "mine"} onClick={() => setView("mine")}>My Courses</button>
          <button aria-pressed={view === "all"} onClick={() => setView("all")}>Course map</button>
        </div>
        <label className="course-search"><Search size={ICON_SIZE.emphasis} /><span className="sr-only">Search courses</span><input name="course-search" autoComplete="off" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Course or module" /></label>
        <label className="course-term-filter"><span className="sr-only">Filter by term</span><select value={term} onChange={event => setTerm(event.target.value)}><option value="">All terms</option>{[...new Set([...books.map(book => book.term), ...connected.map(course => course.term)])].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className="course-collection-count" role="status">{catalogLoading ? "Loading the collection…" : `${shown.length + connectedShown.length} courses${view === "mine" ? " activated" : accountId ? " available" : " available on this device"}`}</p>
      {catalogError && <div role="alert"><p>{catalogError}</p><GButton onClick={retryCatalog}>Retry collection</GButton></div>}
      {!shown.length && !connectedShown.length && !catalogLoading && <div className="course-empty"><BookOpen size={32} /><h2>{view === "mine" ? "Your courses start here" : "No courses to show"}</h2><p>{query || term ? "Try a different search or term." : "Choose an available course to preview its weekly plan. Your progress stays separate from the collection."}</p>{view !== "available" && <GButton onClick={() => setView("available")}>Browse available courses</GButton>}</div>}
      <div className="course-collection">
        {connectedShown.map(course => <button key={course.id} data-course-id={course.id} className="course-card" onClick={() => setSelected(`remote:${course.id}`)} aria-label={`Preview ${course.module}, ${course.academic_term || course.term}`}>
          <div className="course-card-cover"><span>{course.term}</span><strong>{course.module}</strong><BookOpen size={28} strokeWidth={1} /></div>
          <div className="course-card-copy"><span className="course-card-context">{course.academic_term || course.term}{course.cohort ? ` · ${course.cohort}` : ""}</span><h2>{course.module}</h2><p>{course.title}</p><span className="course-card-facts">{course.ready_questions} ready questions{course.review_questions ? ` · ${course.review_questions} awaiting review` : ""}</span><span className="course-card-state">{course.owned ? "Your upload" : "Academic collection"} · {course.visibility === "private" ? "Private" : course.review_status === "approved" ? "Reviewed" : "Sharing review pending"}</span></div><ArrowUpRight size={ICON_SIZE.control} aria-hidden="true" />
        </button>)}
        {shown.map(book => <button key={book.id} className="course-card" onClick={() => setSelected(book.id)} aria-label={`Preview ${book.module}, ${book.term}`}>
        <div className="course-card-cover"><span>{book.term}</span><strong>{book.module}</strong><BookOpen size={28} strokeWidth={1} /></div>
        <div className="course-card-copy"><span className="course-card-context">{book.courseCode || book.term}</span><h2>{book.module}</h2><p>{book.courseName || "Academic module"}</p><span className="course-card-facts">{book.weeks.length ? `${book.weeks.length} weeks · ${book.count} activities` : "Weekly plan not available"}</span><span className="course-card-state">{mine(book) ? "In My Courses" : available(book) ? "Ready to preview" : "Not prepared yet"}{bankFor(book)?.ready ? ` · ${bankFor(book)?.ready} questions` : ""}</span></div><ArrowUpRight size={ICON_SIZE.control} aria-hidden="true" />
      </button>)}</div>
      {moreAvailable && <GButton disabled={catalogLoading} onClick={() => void more()}>Load more courses</GButton>}
      <details className="course-management"><summary>Manage sources and custom courses</summary><p className="sub">Prepared collections and personal imports are kept separate from course activation.</p><div className="row wrap gap8"><GButton onClick={() => onTemplate()}>Saved templates and imports</GButton><GButton onClick={onCreate}>Create a custom course</GButton></div><AcademicCourseUpload key={accountId} onSaved={retryCatalog} /><PreparedLibrary /></details>
    </>}
  </div>;
}
