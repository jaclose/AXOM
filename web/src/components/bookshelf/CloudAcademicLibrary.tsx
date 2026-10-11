import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, RefreshCw } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { buildShelves, type ShelfBook } from "../../lib/bookshelf/model";
import type { PracticeSelection } from "../../lib/bookshelf/questionBankBooks";
import { catalogCourses, selectedBanks, type CatalogCourse } from "../../lib/cloudLibrary/model";
import { useCloudCatalog } from "../../lib/cloudLibrary/useCloudCatalog";
import { loadCloudCourse, prepareCloudQuiz } from "../../lib/cloudLibrary/load";
import { AcademicBookshelf } from "./AcademicBookshelf";
import { GButton, GhostButton } from "../ui/primitives";
import "./CloudAcademicLibrary.css";
interface CloudBook extends ShelfBook { course: CatalogCourse; }
export function CloudAcademicLibrary({ mode, onPractice }: {
  mode: "courses" | "questions";
  onPractice?: (selection: PracticeSelection) => void;
}) {
  const { state, refresh } = useCloudCatalog();
  const entries = state.status === "ready" ? state.catalog.entries : [];
  const books = useMemo<CloudBook[]>(() => catalogCourses(entries).flatMap(course => {
    const relevant = course.entries.filter(e => e.kind === (mode === "courses" ? "template" : "bank"));
    if (!relevant.length) return [];
    const count = relevant.reduce((n,e) => n + (mode === "courses" ? e.activity_count : e.question_count), 0);
    return [{ id: `cloud:${course.key}`, title: course.module, shelf: course.term, identifier: "AXOM Library", count,
      countLabel: `${count} ${mode === "courses" ? "published activities" : "ready questions"}`, state: "available", course }];
  }), [entries, mode]);
  return <section className="cloud-academic-library" aria-label={mode === "courses" ? "Published course catalog" : "Published question catalog"}>
    <header className="cloud-library-heading">
      <div><span className="cloud-library-eyebrow">AXOM Library</span><h2>{mode === "courses" ? "Choose your course" : "Find your next practice"}</h2>
        <p>{mode === "courses" ? "Published templates, ready to load. Your progress stays yours." : "Choose a course, select its sets, and create a quiz. No file import needed."}</p></div>
      <GhostButton onClick={refresh} disabled={state.status === "loading"} aria-label="Refresh published library"><RefreshCw size={ICON_SIZE.emphasis} /></GhostButton>
    </header>
    {state.status === "loading" && <p role="status" className="cloud-library-notice">Loading available courses…</p>}
    {state.status === "unconfigured" && <p className="cloud-library-notice">The shared library is not configured on this build. Your saved and custom material is available below.</p>}
    {state.status === "error" && <div className="cloud-library-notice"><p role="alert">{state.message}</p><GButton onClick={refresh}>Retry library</GButton></div>}
    {state.status === "ready" && !books.length && <p role="status" className="cloud-library-notice">{state.signedIn
      ? "No published content is available to this account yet. Nothing is missing from your personal library."
      : "No public collections are available yet. Sign in through Account to check the courses available to you."}</p>}
    {state.status === "ready" && books.length > 0 && <AcademicBookshelf key={state.identity} label={mode === "courses" ? "Cloud course bookshelf" : "Cloud question bookshelf"}
      shelves={buildShelves(books)} renderBook={(book, close) => <CloudCourseContent key={`${state.identity}:${book.id}`}
        course={book.course} mode={mode} onPractice={selection => { close(); onPractice?.(selection); }} />} />}
  </section>;
}
function CloudCourseContent({ course, mode, onPractice }: {
  course: CatalogCourse; mode: "courses" | "questions"; onPractice: (selection: PracticeSelection) => void;
}) {
  const banks = course.entries.filter(e => e.kind === "bank");
  const [selection, setSelection] = useState(() => banks.map(e => `${e.release_id}:${e.id}`));
  const [wanted, setWanted] = useState("20");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const selected = banks.filter(e => selection.includes(`${e.release_id}:${e.id}`));
  const available = selected.reduce((n,e) => n + e.question_count, 0);
  const weeks = [...new Set(banks.map(e => e.week))].sort((a,b) => (a ?? Infinity) - (b ?? Infinity));
  const totalActivities = course.entries.reduce((n,e) => n + e.activity_count, 0);
  async function run(kind: "course" | "quiz") {
    if (busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setMessage(kind === "course" ? "Loading your course…" : "Preparing your selected questions and images…");
    try {
      if (kind === "course") {
        const result = await loadCloudCourse(course, request.signal);
        if (!request.signal.aborted) setMessage(result);
      } else {
        const result = await prepareCloudQuiz(selectedBanks(course, selection), Number(wanted), request.signal);
        if (!request.signal.aborted) { setMessage(""); onPractice(result); }
      }
    } catch (cause) {
      if (!request.signal.aborted) { setMessage(""); setError(cause instanceof Error ? cause.message : "This action could not finish. Your saved work is intact."); }
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="cloud-course-content">
    <div className="cloud-course-intro"><span>{course.term}</span><h3>{course.module}</h3><p>{totalActivities} activities · {banks.reduce((n,e)=>n+e.question_count,0)} ready questions</p></div>
    {mode === "courses" ? <>
      <p>Load this course into your tracker. Already loaded activities, personal edits, and completed work are preserved.</p>
      <ul className="cloud-template-sections">{course.entries.filter(e=>e.kind === "template").map(e => <li key={`${e.release_id}:${e.id}`}><BookOpen size={ICON_SIZE.body} /><span>{e.title}</span><small>{e.activity_count} activities</small></li>)}</ul>
      <GButton variant="primary" disabled={busy || !totalActivities} onClick={() => void run("course")}><BookOpen size={ICON_SIZE.emphasis} /> Load Course</GButton>
    </> : <>
      <p>Select the sets you want. Images and questions are downloaded securely when you create your quiz.</p>
      <div className="cloud-set-selection">{weeks.map(week => <fieldset key={week ?? "unscheduled"} disabled={busy}>
        <legend>{week == null ? "Course practice" : `Week ${week}`}</legend>
        {banks.filter(e=>e.week === week).map(e => {
          const key = `${e.release_id}:${e.id}`;
          return <label key={key}><input type="checkbox" checked={selection.includes(key)} onChange={event => setSelection(current => event.target.checked ? [...current,key] : current.filter(id=>id!==key))} />
            <span>{e.title}<small>{e.question_count} questions{e.image_question_count ? ` · ${e.image_question_count} with images` : ""}</small></span></label>;
        })}</fieldset>)}</div>
      <div className="cloud-quiz-actions"><label>Questions<input type="number" inputMode="numeric" min={1} max={500} value={wanted} disabled={busy} onChange={e=>setWanted(e.target.value)} /></label>
        <GButton variant="primary" disabled={busy || !selected.length || !Number.isSafeInteger(Number(wanted)) || Number(wanted)<1 || Number(wanted)>500}
          onClick={()=>void run("quiz")}>Create Quiz</GButton></div>
      <p className="cloud-library-detail">{available} questions in selected collections. The next screen lets you choose Tutor or Exam. Any overlap is removed before practice starts.</p>
    </>}
    {message && <p role="status" className="cloud-library-message">{!busy && <Check size={ICON_SIZE.body} />} {message}</p>}
    {error && <p role="alert" className="cloud-library-error">{error}</p>}
  </div>;
}
