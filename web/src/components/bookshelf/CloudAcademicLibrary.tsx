import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, Cloud, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { GButton } from "../ui/primitives";
import { loadSupabase } from "../../lib/account/supabase";
import { listCloudCatalog, type CloudCatalog } from "../../lib/cloudLibrary/client";
import { catalogCourses, selectedBanks, type CatalogCourse } from "../../lib/cloudLibrary/model";
import { loadCloudCourse, prepareCloudQuiz } from "../../lib/cloudLibrary/load";
import type { PracticeSelection } from "../../lib/bookshelf/questionBankBooks";
import "../../styles/cloud-library.css";

/** Published content is shared; choosing a course never shares personal progress. */
export function CloudAcademicLibrary({ onPractice }: { onPractice?: (selection: PracticeSelection) => void }) {
  const prefix = useId();
  const [catalog, setCatalog] = useState<CloudCatalog>({ releases: [], entries: [] });
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const action = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const detail = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    let alive = true, unsubscribe: (() => void) | undefined;
    void loadSupabase().then(client => {
      if (!alive || !client) return;
      const { data } = client.auth.onAuthStateChange(event => {
        if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
        action.current?.abort();
        setCatalog({ releases: [], entries: [] }); setSelected(null);
        setBankIds([]); setMessage(""); setRevision(n => n + 1);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => { /* The catalog request presents configuration errors. */ });
    return () => { alive = false; unsubscribe?.(); action.current?.abort(); };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    setPhase("loading"); setError("");
    void listCloudCatalog(request.signal).then(next => {
      if (!request.signal.aborted) { setCatalog(next); setPhase("ready"); }
    }).catch(cause => {
      if (!request.signal.aborted) { setError(cause instanceof Error ? cause.message : "The shared library could not be loaded."); setPhase("error"); }
    });
    return () => request.abort();
  }, [revision]);
  const courses = useMemo(() => catalogCourses(catalog.entries), [catalog.entries]);
  const course = courses.find(c => c.key === selected);
  const visible = courses.filter(c => (!term || c.term === term) && `${c.module} ${c.term} ${c.entries.map(e => e.title).join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  useEffect(() => { if (selected) detail.current?.focus(); }, [selected]);
  const keyOf = (entry: { id: string; release_id: string }) => `${entry.release_id}:${entry.id}`;
  function openCourse(next: CatalogCourse, button: HTMLButtonElement) {
    opener.current = button; setSelected(next.key); setBankIds([]); setMessage(""); setError("");
  }
  function back() { setSelected(null); setMessage(""); setError(""); requestAnimationFrame(() => opener.current?.focus()); }
  async function perform(kind: "course" | "quiz") {
    if (!course || busy) return;
    const request = new AbortController(); action.current = request;
    setBusy(true); setError(""); setMessage(kind === "course" ? "Preparing your course…" : "Preparing your selected questions and images…");
    try {
      if (kind === "course") {
        const result = await loadCloudCourse(course, request.signal);
        if (!request.signal.aborted) setMessage(result);
      } else {
        const selection = await prepareCloudQuiz(selectedBanks(course, bankIds), count, request.signal);
        if (!request.signal.aborted) { setMessage("Questions are ready. Choose your study mode."); onPractice?.(selection); }
      }
    } catch (cause) {
      if (!request.signal.aborted) { setMessage(""); setError(cause instanceof Error ? cause.message : "This action did not finish. Your progress is unchanged."); }
    } finally {
      if (action.current === request) { action.current = null; setBusy(false); }
    }
  }
  return <section className="cloud-library" aria-label="Published academic library" aria-busy={phase === "loading" || busy}>
    <header className="cloud-library-heading">
      <div><span className="cloud-library-eyebrow"><Cloud size={14} aria-hidden="true" /> AXOM library</span>
        <h3>{course ? course.module : "Your next chapter"}</h3>
        <p>{course ? `${course.term}. Choose what to study. Your progress remains yours.` : "Courses and question sets, ready to use. No files to import."}</p></div>
      {phase !== "loading" && <GButton size="sm" disabled={busy} onClick={() => { action.current?.abort(); setSelected(null); setBankIds([]); setRevision(n => n + 1); }} aria-label="Refresh published library"><RefreshCw size={14} /> Refresh</GButton>}
    </header>
    {phase === "loading" && <p className="cloud-library-status" role="status"><LoaderCircle size={16} aria-hidden="true" /> Finding available courses…</p>}
    {error && <p role="alert" className="cloud-library-error">{error}</p>}
    {message && <p role="status" className="cloud-library-status"><Check size={16} aria-hidden="true" /> {message}</p>}
    {phase === "ready" && !courses.length && <div className="cloud-library-empty"><BookOpen size={24} aria-hidden="true" /><p>No courses have been published for this account yet. Sign in for account-only collections, or try again after your publisher releases them.</p></div>}
    {phase === "ready" && courses.length > 0 && !course && <>
      <div className="cloud-library-filters">
        <label htmlFor={`${prefix}-search`}><Search size={16} aria-hidden="true" /><span className="cloud-library-sr">Search published courses and sets</span><input id={`${prefix}-search`} type="search" placeholder="Find a course or topic" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label htmlFor={`${prefix}-term`}><span className="cloud-library-sr">Filter published courses by term</span><select id={`${prefix}-term`} value={term} onChange={e => setTerm(e.target.value)}><option value="">All terms</option>{[...new Set(courses.map(c => c.term))].sort((a,b) => a.localeCompare(b, undefined, { numeric: true })).map(t => <option key={t}>{t}</option>)}</select></label>
      </div>
      <div className="cloud-course-grid">{visible.map(c => {
        const banks = c.entries.filter(e => e.kind === "bank"), templates = c.entries.filter(e => e.kind === "template");
        return <button key={c.key} type="button" className="cloud-course-book" onClick={e => openCourse(c, e.currentTarget)} aria-label={`Open ${c.module}, ${c.term}`}>
          <span className="cloud-course-spine"><BookOpen size={22} aria-hidden="true" /><span>{c.term}</span><strong>{c.module}</strong></span>
          <span className="cloud-course-caption"><b>{banks.length ? `${banks.length} question set${banks.length === 1 ? "" : "s"}` : "Course template"}</b><span>{templates.length ? `${templates.length} template section${templates.length === 1 ? "" : "s"}` : "Practice collection"}</span><span className="cloud-course-link">{onPractice && banks.length ? "Explore and create quiz" : "Preview and load course"} →</span></span>
        </button>;
      })}</div>
      {!visible.length && <p>No courses match these filters. Clear the search or choose another term.</p>}
    </>}
    {phase === "ready" && course && <div className="cloud-course-detail">
      <GButton size="sm" disabled={busy} onClick={back}><ArrowLeft size={14} aria-hidden="true" /> All courses</GButton>
      <h4 ref={detail} tabIndex={-1}>{course.module} · {course.term}</h4>
      {course.entries.some(e => e.kind === "template") && <div className="cloud-course-load"><div><b>Course plan</b><p>{course.entries.filter(e => e.kind === "template").reduce((n,e) => n + e.activity_count, 0)} published activities. Loading adds missing activities and keeps your existing progress.</p></div><GButton variant="primary" disabled={busy} onClick={() => void perform("course")}>Load Course</GButton></div>}
      {course.entries.some(e => e.kind === "bank") && <fieldset className="cloud-bank-selection" disabled={busy}><legend>Choose question sets</legend>
        {course.entries.filter(e => e.kind === "bank").sort((a,b) => (a.week ?? 999) - (b.week ?? 999) || a.title.localeCompare(b.title)).map(entry => <label key={keyOf(entry)} className="cloud-bank-option"><input type="checkbox" checked={bankIds.includes(keyOf(entry))} onChange={e => setBankIds(ids => e.target.checked ? [...ids, keyOf(entry)] : ids.filter(id => id !== keyOf(entry)))} /><span><b>{entry.title}</b><small>{entry.week ? `Week ${entry.week} · ` : ""}{entry.question_count} verified questions{entry.image_question_count ? ` · ${entry.image_question_count} with images` : ""}</small></span></label>)}
        {onPractice ? <div className="cloud-quiz-action"><label htmlFor={`${prefix}-count`}>Questions<input id={`${prefix}-count`} type="number" min={1} max={500} value={Number.isFinite(count) ? count : ""} onChange={e => setCount(e.target.valueAsNumber)} /></label><GButton variant="primary" disabled={!bankIds.length || !Number.isSafeInteger(count) || count < 1 || count > 500} onClick={() => void perform("quiz")}>Create Quiz</GButton><small>Duplicate questions are counted once. Choose Tutor or Exam next.</small></div> : <p>Open Question Bank to create a quiz from these sets.</p>}
      </fieldset>}
      {busy && <GButton size="sm" onClick={() => { action.current?.abort(); setMessage("Stopped. Any completed saves are preserved."); }}>Cancel preparation</GButton>}
    </div>}
  </section>;
}
