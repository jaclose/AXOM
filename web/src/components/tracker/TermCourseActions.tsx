import { useEffect, useRef, useState } from "react";
import { Download, Play, Square } from "lucide-react";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { downloadCourseQuestions, isAcademicCourseDownloaded } from "../../lib/academicLibrary/downloadReference";
import { listTermCourses, termQuizNeedsCatalog, termQuizSelection } from "../../lib/academicLibrary/termCourses";
import { launchCourseQuiz, MAX_COURSE_QUIZ_QUESTIONS } from "../../lib/course-engine/quizLaunch";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import { GButton } from "../ui/primitives";

interface DownloadFailure { id: string; title: string; reason: string }

/** Term downloads share the single-course installer and its durable account receipt.
 * Stop finishes the current course so a retry can safely skip it. */
export function TermCourseActions({ term, accountId, courses, disabled, onBusyChange }: {
  term: string; accountId: string; courses: readonly AcademicCourse[];
  disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const workspace = useStore();
  const needsCatalog = termQuizNeedsCatalog(accountId, workspace);
  const [legacyCatalog, setLegacyCatalog] = useState<AcademicCourse[]>();
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLegacyCatalog(undefined); setCatalogError("");
    if (needsCatalog) void listTermCourses(term, accountId, { shouldStop: () => cancelled })
      .then(result => { if (!cancelled) setLegacyCatalog(result); })
      .catch(cause => { if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : "Saved course details could not be read."); });
    return () => { cancelled = true; };
  }, [term, accountId, needsCatalog, catalogRetry]);
  const practiceCatalog = legacyCatalog ?? courses;
  const selection = termQuizSelection(term, accountId, workspace, practiceCatalog);
  const practicePending = needsCatalog && !legacyCatalog;
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<DownloadFailure[]>([]);
  const running = useRef(false);
  const stopped = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopped.current = true; };
  }, []);

  async function download() {
    if (running.current || disabled) return;
    running.current = true; stopped.current = false;
    setBusy(true); setStopping(false); onBusyChange(true);
    setMessage(`Reading all courses in ${term}…`); setError(""); setFailures([]);
    const scope = academicAccountScope(accountId);
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const allCourses = await listTermCourses(term, accountId, {
        shouldStop: () => stopped.current, assertCurrent: scope.assertCurrent,
      });
      const pending = allCourses.filter(course => {
        if (!isAcademicCourseDownloaded(course, accountId, useStore.getState())) return true;
        skipped += 1;
        return false;
      });
      for (const [index, course] of pending.entries()) {
        scope.assertCurrent();
        if (stopped.current) break;
        if (mounted.current) setMessage(`Downloading ${index + 1} of ${pending.length}: ${course.module}${course.title === course.module ? "" : ` (${course.title})`}`);
        try {
          await downloadCourseQuestions(course, accountId, () => {}, scope);
          scope.assertCurrent();
          completed += 1;
        } catch (cause) {
          // An account change ends the whole operation, never another account's course.
          scope.assertCurrent();
          failed += 1;
          if (mounted.current) setFailures(current => [...current, { id: course.id, title: course.title === course.module ? course.module : `${course.module}: ${course.title}`,
            reason: cause instanceof Error ? cause.message : "This course could not be downloaded. Try again when connected." }]);
        }
      }
      if (mounted.current) setMessage(`${stopped.current ? "Download stopped" : "Download complete"}. ${completed} downloaded, ${skipped} already on this device${failed ? `, ${failed} failed` : ""}.`);
    } catch (cause) {
      if (mounted.current) {
        if (stopped.current && (cause instanceof DOMException || cause instanceof Error) && cause.name === "AbortError") setMessage("Download stopped. Download this term again to continue.");
        else { setMessage(""); setError(cause instanceof Error ? cause.message : "This term could not be downloaded. Try again when connected."); }
      }
    } finally {
      scope.dispose(); running.current = false; onBusyChange(false);
      if (mounted.current) { setBusy(false); setStopping(false); }
    }
  }
  function practice() {
    setError("");
    try { launchCourseQuiz(termQuizSelection(term, accountId, useStore.getState(), practiceCatalog)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Practice could not be opened."); }
  }
  const overLimit = selection.questionIds.length > MAX_COURSE_QUIZ_QUESTIONS
    || selection.setIds.length > MAX_COURSE_QUIZ_QUESTIONS;
  return <div className="course-term-actions" role="group" aria-label={`${term} downloads and practice`}>
    <div className="course-term-buttons">
      <GButton size="sm" disabled={disabled || busy} onClick={() => void download()}><Download size={ICON_SIZE.body} /> Download {term}</GButton>
      <GButton size="sm" disabled={busy || practicePending || !selection.questionIds.length || overLimit} onClick={practice}><Play size={ICON_SIZE.body} /> Practice {term}</GButton>
      {busy && <GButton size="sm" disabled={stopping} onClick={() => { stopped.current = true; setStopping(true); }}><Square size={ICON_SIZE.body} /> {stopping ? "Stopping…" : "Stop"}</GButton>}
    </div>
    <p className="course-term-hint">{selection.questionIds.length} answer-ready {selection.questionIds.length === 1 ? "question" : "questions"} on this device. Downloads keep your weekly plan unchanged.</p>
    {disabled && !busy && <p role="status">Another course download is running. You can download this term when it finishes.</p>}
    {practicePending && !catalogError && <p role="status">Reading saved course details for term practice…</p>}
    {catalogError && <div role="alert"><p>{catalogError}</p><GButton size="sm" onClick={() => setCatalogRetry(value => value + 1)}>Retry term practice</GButton></div>}
    {overLimit && <p>Term practice supports up to {MAX_COURSE_QUIZ_QUESTIONS} questions. Choose a smaller set in Question Bank.</p>}
    <p className="course-term-progress" role="status" aria-live="polite">{message}{stopping ? " Finishing the current course before stopping." : ""}</p>
    {error && <p role="alert">{error}</p>}
    {failures.length > 0 && <div className="course-term-failures" role="alert"><p>Download this term again to retry these courses. Completed downloads will be skipped.</p>
      <ul>{failures.map(failure => <li key={failure.id}><strong>{failure.title}:</strong> {failure.reason}</li>)}</ul>
    </div>}
  </div>;
}
