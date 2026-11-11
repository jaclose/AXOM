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

const STORAGE_QUOTA_RECOVERY = "This course was not confirmed. Do not clear AXOM site data. Keep your existing work, free browser or device storage safely, then retry this term.";

/** A safety-backup failure can wrap the original browser quota exception in
 * AggregateError. Distinguish local storage exhaustion from remote API quotas;
 * neither case authorizes discarding any saved academic data. */
function isBrowserStorageQuotaFailure(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length && seen.size < 16) {
    const current = pending.pop();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    const record = typeof current === "object" ? current as {
      name?: unknown; message?: unknown; cause?: unknown; errors?: unknown;
    } : undefined;
    const name = typeof record?.name === "string" ? record.name : "";
    const message = typeof record?.message === "string" ? record.message
      : typeof current === "string" ? current : "";
    if (name === "QuotaExceededError"
      || /QuotaExceededError|(?:browser|device|disk)\s+(?:storage\s+)?(?:is\s+)?full|(?:workspace|storage|backup)\s+exceeded\s+(?:the\s+)?quota/i.test(message)) return true;
    if (record?.cause != null) pending.push(record.cause);
    if (Array.isArray(record?.errors)) pending.push(...record.errors);
  }
  return false;
}

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
  // A failed lookup must not hide questions whose downloaded receipt already
  // identifies this term. Unknown older receipts stay out of the selection.
  const practicePending = needsCatalog && !legacyCatalog && !catalogError;
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
    let pausedForStorage = false;
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
          const storageFull = isBrowserStorageQuotaFailure(cause);
          if (mounted.current) setFailures(current => [...current, { id: course.id, title: course.title === course.module ? course.module : `${course.module}: ${course.title}`,
            reason: storageFull ? STORAGE_QUOTA_RECOVERY
              : cause instanceof Error ? cause.message : "This course could not be downloaded. Try again when connected." }]);
          // Retrying another large course cannot restore browser capacity.
          // Keep the earlier durable installs and leave later courses untouched.
          if (storageFull) { pausedForStorage = true; break; }
        }
      }
      if (mounted.current) setMessage(pausedForStorage
        ? `Download paused: browser storage is full. ${completed} downloaded, ${skipped} already on this device. Later courses were not attempted.`
        : `${stopped.current ? "Download stopped" : "Download complete"}. ${completed} downloaded, ${skipped} already on this device${failed ? `, ${failed} failed` : ""}.`);
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
    {catalogError && <div role="alert"><p>{catalogError}</p>
      <p>{selection.questionIds.length
        ? `You can practice the answer-ready questions already identified as ${term} on this device. Older downloads without a saved term are excluded until their course details can be checked.`
        : `Older downloads without a saved term cannot be included until their course details can be checked.`}</p>
      <GButton size="sm" onClick={() => setCatalogRetry(value => value + 1)}>Retry term practice</GButton></div>}
    {overLimit && <p>Term practice supports up to {MAX_COURSE_QUIZ_QUESTIONS} questions. Choose a smaller set in Question Bank.</p>}
    <p className="course-term-progress" role="status" aria-live="polite">{message}{stopping ? " Finishing the current course before stopping." : ""}</p>
    {error && <p role="alert">{error}</p>}
    {failures.length > 0 && <div className="course-term-failures" role="alert"><p>Download this term again to retry these courses. Completed downloads will be skipped.</p>
      <ul>{failures.map(failure => <li key={failure.id}><strong>{failure.title}:</strong> {failure.reason}</li>)}</ul>
    </div>}
  </div>;
}
