import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, RefreshCw, Cloud, Play } from "lucide-react";
import { useCatalog } from "../../lib/cloudLibrary/useCatalog";
import { catalogCourses, selectedBanks, type CatalogCourse } from "../../lib/cloudLibrary/model";
import { loadCloudCourse, prepareCloudQuiz } from "../../lib/cloudLibrary/load";
import { buildShelves, type ShelfBook } from "../../lib/bookshelf/model";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import type { PracticeSelection } from "../../lib/bookshelf/questionBankBooks";
import { ICON_SIZE } from "../../lib/iconSize";
import { AcademicBookshelf } from "./AcademicBookshelf";
import { GButton, GhostButton } from "../ui/primitives";
import "../../styles/shared-catalog.css";

interface Props { mode: "courses" | "questions"; onPractice?: (selection: PracticeSelection) => void; onOpenCourse?: (book: CourseBook) => void; }
interface CatalogBook extends ShelfBook { course: CatalogCourse; }

/** One cloud catalog in both destinations. Learner imports stay a separate,
 * optional collection; no folder chooser is required to discover published content. */
export function SharedAcademicLibrary(props: Props) {
  const { state, refresh } = useCatalog();
  const shelves = useMemo(() => {
    if (state.status !== "ready") return [];
    const books: CatalogBook[] = catalogCourses(state.catalog.entries).flatMap(course => {
      const templates = course.entries.filter(e => e.kind === "template");
      const banks = course.entries.filter(e => e.kind === "bank");
      const questions = banks.reduce((n,e) => n + e.question_count, 0);
      const activities = templates.reduce((n,e) => n + e.activity_count, 0);
      const count = props.mode === "questions" ? questions : activities;
      if (!count) return [];
      return [{ id: `cloud:${course.key}`, course, title: course.module, shelf: course.term, count,
        countLabel: props.mode === "questions" ? `${questions} published questions` : `${activities} course activities`,
        state: "available" as const, stateNote: props.mode === "questions" ? `${banks.length} question sets` : `${templates.length} template sections` }];
    });
    return buildShelves(books);
  }, [state, props.mode]);
  return <section className="shared-academic-library" aria-label="Published academic library" aria-busy={state.status === "loading"}>
    <header className="shared-catalog-heading">
      <div><span className="shared-catalog-eyebrow"><Cloud size={ICON_SIZE.body} aria-hidden="true" /> AXOM LIBRARY</span>
        <h2>{props.mode === "courses" ? "Your course starts here" : "Choose what to practise"}</h2>
        <p>{props.mode === "courses" ? "Open a course, preview its structure, and load it into your tracker." : "Open a course and choose its published sets. Your answers and progress remain private."}</p>
      </div>
      <GhostButton onClick={refresh} disabled={state.status === "loading"} aria-label="Refresh published library"><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Refresh</GhostButton>
    </header>
    {state.status === "loading" && <p role="status" className="shared-catalog-notice">Loading available courses…</p>}
    {state.status === "error" && <div role="alert" className="shared-catalog-notice"><strong>Shared library unavailable</strong><p>{state.message}</p><p>Your saved courses and questions are still available below.</p></div>}
    {state.status === "ready" && !shelves.length && <div className="shared-catalog-notice" role="status"><BookOpen size={ICON_SIZE.control} aria-hidden="true" /><p>No {props.mode === "courses" ? "course templates" : "question sets"} have been published for this account yet.{!state.signedIn ? " Sign in to see any additional courses available to your account." : ""}</p><p>This is the shared catalog, not a count of your personal imports.</p></div>}
    {state.status === "ready" && shelves.length > 0 && <AcademicBookshelf label="Published courses" shelves={shelves}
      key={state.catalog.releases.map(r => `${r.id}:${r.version}`).join("|")}
      renderBook={(book, close) => <CatalogBookContent {...props} course={book.course} onClose={close} />} />}
  </section>;
}

function CatalogBookContent({ course, mode, onPractice, onOpenCourse, onClose }: Props & { course: CatalogCourse; onClose: () => void }) {
  const banks = course.entries.filter(e => e.kind === "bank");
  const templates = course.entries.filter(e => e.kind === "template");
  const [selected, setSelected] = useState<string[]>(banks.map(e => `${e.release_id}:${e.id}`));
  const [wanted, setWanted] = useState("20"), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [loaded, setLoaded] = useState<CourseBook>();
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const available = banks.filter(e => selected.includes(`${e.release_id}:${e.id}`)).reduce((n,e) => n + e.question_count, 0);
  const weeks = [...new Set(banks.map(e => e.week))].sort((a,b) => (a ?? Infinity) - (b ?? Infinity));
  async function run(action: "course" | "quiz") {
    if (busy) return;
    const next = new AbortController(); controller.current = next;
    const timer = setTimeout(() => next.abort(), 120_000);
    setBusy(true); setError(""); setNotice(action === "course" ? "Loading your course…" : "Preparing questions and their images…");
    try {
      if (action === "course") {
        const result = await loadCloudCourse(course, next.signal);
        setLoaded(result.book); setNotice(result.message);
      } else {
        const selection = await prepareCloudQuiz(selectedBanks(course, selected), Number(wanted), next.signal);
        setNotice(`${selection.count} unique questions ready.`);
        onClose(); onPractice?.(selection);
      }
    } catch (cause) {
      setNotice(""); setError(next.signal.aborted ? "Preparation stopped. Existing study data is intact; retry when ready." : cause instanceof Error ? cause.message : "This action could not finish.");
    } finally { clearTimeout(timer); setBusy(false); }
  }
  return <div className="shared-catalog-book">
    <p className="shared-catalog-eyebrow">{course.term} · PUBLISHED COURSE</p>
    <h2>{course.module}</h2>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {mode === "courses" && <>
      <p>{templates.reduce((n,e) => n + e.activity_count, 0)} activities across {templates.length} template sections. Loading preserves activities and progress you already have.</p>
      <ul className="shared-catalog-sections">{templates.map(e => <li key={`${e.release_id}:${e.id}`}><span>{e.title}</span><small>{e.activity_count} activities</small></li>)}</ul>
      <div className="shared-catalog-actions"><GButton variant="primary" disabled={busy || !templates.length} onClick={() => void run("course")}><BookOpen size={ICON_SIZE.body} aria-hidden="true" /> Load Course</GButton>
        {loaded && onOpenCourse && <GhostButton onClick={() => { onClose(); onOpenCourse(loaded); }}>Open my course</GhostButton>}</div>
      {!!banks.length && <p>{banks.reduce((n,e) => n + e.question_count, 0)} published questions are also available in Question Bank.</p>}
    </>}
    {mode === "questions" && <>
      <p>Select a set or combine related sets. Tutor and exam options are on the next screen.</p>
      <div className="shared-catalog-set-list">{weeks.map(week => <details key={week ?? "unfiled"} open={weeks.length === 1}>
        <summary>{week == null ? "Unscheduled sets" : `Week ${week}`} <small>{banks.filter(b => b.week === week).length} sets</small></summary>
        {banks.filter(b => b.week === week).map(entry => {
          const key = `${entry.release_id}:${entry.id}`;
          return <label key={key}><input type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={event => setSelected(ids => event.target.checked ? [...ids,key] : ids.filter(id => id !== key))} />
            <span>{entry.title}<small>{entry.question_count} questions{entry.image_question_count ? ` · ${entry.image_question_count} with images` : ""}</small></span></label>;
        })}
      </details>)}</div>
      <div className="shared-catalog-quiz-controls"><label>Questions<input type="number" min={1} max={Math.min(500,available) || 1} value={wanted} disabled={busy} onChange={event => setWanted(event.target.value)} /></label><span>{available} in selected sets. Duplicate questions count once in your quiz.</span></div>
      <GButton variant="primary" disabled={busy || !available || !Number.isSafeInteger(Number(wanted)) || Number(wanted) < 1 || Number(wanted) > 500} onClick={() => void run("quiz")}><Play size={ICON_SIZE.body} aria-hidden="true" /> Create Quiz</GButton>
    </>}
    {busy && <GhostButton onClick={() => controller.current?.abort()}>Cancel preparation</GhostButton>}
  </div>;
}
