import { useEffect, useRef, useState } from "react";
import { Download, Play, Square } from "lucide-react";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { useAccount } from "../../lib/account/accountStore";
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
type TermCourseActionsProps = {
  term: string; accountId: string; courses: readonly AcademicCourse[];
  disabled: boolean; onBusyChange: (busy: boolean) => void;
};

/** Scope all download, progress and failure UI to the exact learner and term.
 * Keying only the catalog lookup is insufficient: completed download failures
 * and quiz errors also survive a prop change until the component remounts. */
export function TermCourseActions(props: TermCourseActionsProps) {
  return <ScopedTermCourseActions key={JSON.stringify([props.accountId, props.term])} {...props} />;
}

function ScopedTermCourseActions({ term, accountId, courses, disabled, onBusyChange }: TermCourseActionsProps) {
  const workspace = useStore();
  const needsCatalog = termQuizNeedsCatalog(accountId, workspace);
  // The previous account's catalog must never be observable for even one
  // render after a prop change. Passive effect cleanup runs after commit, so
  // clearing state in an effect alone cannot protect the Practice button.
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalogState, setCatalogState] = useState<{
    term: string; accountId: string; retry: number;
    courses?: AcademicCourse[]; error?: string;
  }>();
  const currentCatalog = needsCatalog && catalogState?.term === term
    && catalogState.accountId === accountId && catalogState.retry === catalogRetry
    ? catalogState : undefined;
  const legacyCatalog = currentCatalog?.courses;
  const catalogError = currentCatalog?.error ?? "";
  useEffect(() => {
    let cancelled = false;
    setCatalogState(undefined);
    if (needsCatalog) void listTermCourses(term, accountId, { shouldStop: () => cancelled })
      .then(result => { if (!cancelled) setCatalogState({ term, accountId, retry: catalogRetry, courses: result }); })
      .catch(cause => { if (!cancelled) setCatalogState({ term, accountId, retry: catalogRetry,
        error: cause instanceof Error ? cause.message : "Saved course details could not be read." }); });
    return () => { cancelled = true; };
  }, [term, accountId, needsCatalog, catalogRetry]);
  // A visible catalog page is not proof for older termless receipts when the
  // complete term lookup is pending or has failed. Keep explicit-term receipts.
  const practiceCatalog = needsCatalog ? (legacyCatalog ?? []) : courses;
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
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  // A click-time-only scope cannot detect A → B → A before parent props commit.
  // Both Download and Practice must use the same mounted-lifetime witness.
  const accountLifetimeScopeRef = useRef<ReturnType<typeof academicAccountScope> | null>(null);
  useEffect(() => {
    const scope = academicAccountScope(accountId);
    accountLifetimeScopeRef.current = useAccount.getState().user?.id === accountId ? scope : null;
    return () => {
      if (accountLifetimeScopeRef.current === scope) accountLifetimeScopeRef.current = null;
      scope.dispose();
    };
  }, [accountId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
      // Preview navigation can unmount the controls while the current course
      // is still downloading. Retain the parent's lock until that course
      // settles; a real account switch releases it through the run listener.
    };
  }, []);

  async function download() {
    if (running.current || disabled) return;
    // An old A button must not start fresh network work after A → B → A.
    // Check the observer created for this mount *before* setting the busy lock.
    try {
      const mountedScope = accountLifetimeScopeRef.current;
      if (!mountedScope) throw new Error("The account changed. Reopen this course in your current account.");
      mountedScope.assertCurrent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account changed. Reopen this course.");
      return;
    }
    running.current = true; stopped.current = false;
    setBusy(true); setStopping(false); onBusyChange(true);
    setMessage(`Reading all courses in ${term}…`); setError(""); setFailures([]);
    const scope = academicAccountScope(accountId);
    // The controls can already be unmounted by preview navigation when the
    // account changes. Keep this listener alive for the request's lifetime so
    // the previous learner's lock is released immediately, not at settlement.
    // A stale account request may settle after B has started its own download.
    // Release A's original lock exactly once: later B account-store emissions
    // are not permission for A to clear B's active lock.
    let abandonedLockReleased = false;
    const unsubscribeAccount = useAccount.subscribe(state => {
      if (!abandonedLockReleased && state.user?.id !== accountId) {
        abandonedLockReleased = true;
        onBusyChangeRef.current(false);
      }
    });
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const allCourses = await listTermCourses(term, accountId, {
        shouldStop: () => stopped.current, assertCurrent: scope.assertCurrent,
      });
      scope.assertCurrent();
      // An empty eligible catalog is not a successful download. Tell the
      // learner why nothing arrived, without fabricating a source or receipt.
      if (!allCourses.length && !stopped.current) {
        if (mounted.current) setMessage(`No courses are available for ${term} in this account's catalog. Nothing was downloaded.`);
        return;
      }
      const pending = allCourses.filter(course => {
        if (!isAcademicCourseDownloaded(course, accountId, useStore.getState())) return true;
        skipped += 1;
        return false;
      });
      for (const [index, course] of pending.entries()) {
        scope.assertCurrent();
        if (stopped.current) break;
        const courseProgress = `Downloading ${index + 1} of ${pending.length}: ${course.module}${course.title === course.module ? "" : ` (${course.title})`}`;
        if (mounted.current) setMessage(courseProgress);
        // The canonical installer exposes source-by-source integrity stages.
        // Keep the ordinal visible, but never surface progress from a
        // stopped, unmounted, superseded or settled learner download.
        let acceptingProgress = true;
        try {
          await downloadCourseQuestions(course, accountId, phase => {
            if (!acceptingProgress || !mounted.current || stopped.current || !phase.trim()) return;
            try { scope.assertCurrent(); } catch { return; }
            setMessage(`${courseProgress} · ${phase}`);
          }, scope);
          scope.assertCurrent();
          completed += 1;
        } catch (cause) {
          // An account change ends the whole operation, never another account's course.
          scope.assertCurrent();
          failed += 1;
          if (mounted.current) setFailures(current => [...current, { id: course.id, title: course.title === course.module ? course.module : `${course.module}: ${course.title}`,
            reason: cause instanceof Error ? cause.message : "This course could not be downloaded. Try again when connected." }]);
        } finally {
          // Some readers may report after their own promise settles. Such a
          // callback cannot overwrite the next course or final summary.
          acceptingProgress = false;
        }
      }
      // A completed loop with failed courses is partial, not a successful
      // term download. Keep the exact receipt counts and retry guidance.
      const outcome = stopped.current ? "Download stopped" : failed ? "Download incomplete" : "Download complete";
      if (mounted.current) setMessage(`${outcome}. ${completed} downloaded, ${skipped} already on this device${failed ? `, ${failed} failed` : ""}.`);
    } catch (cause) {
      if (mounted.current) {
        if (stopped.current && (cause instanceof DOMException || cause instanceof Error) && cause.name === "AbortError") setMessage("Download stopped. Download this term again to continue.");
        else { setMessage(""); setError(cause instanceof Error ? cause.message : "This term could not be downloaded. Try again when connected."); }
      }
    } finally {
      // A preview-unmounted request still owns the parent's lock until it
      // settles. A changed-account request does not own the next learner's
      // lock and must never clear it after B has started downloading.
      let sameAccount = true;
      try { scope.assertCurrent(); } catch { sameAccount = false; }
      unsubscribeAccount();
      scope.dispose(); running.current = false;
      if (sameAccount) onBusyChangeRef.current(false);
      if (mounted.current) { setBusy(false); setStopping(false); }
    }
  }
  function practice() {
    setError("");
    // The account store can change before React commits new CourseLibrary
    // props. A stale Practice button must not launch the previous learner's
    // selected questions, even during that brief transition.
    const scope = accountLifetimeScopeRef.current;
    try {
      if (!scope) throw new Error("The account changed. Reopen this course in your current account.");
      scope.assertCurrent();
      const currentSelection = termQuizSelection(term, accountId, useStore.getState(), practiceCatalog);
      scope.assertCurrent();
      launchCourseQuiz(currentSelection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Practice could not be opened.");
    }
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
