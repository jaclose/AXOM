// ===========================================================================
// Exam simulator — practice inside the interface you will actually sit:
// UWorld, USMLE/NBME (2026 Prometric software) or ExamSoft Examplify. One
// engine (lib/examSim), three faithful skins, AXOM's evidence underneath:
// every answer, mark and second lands in the same QuizSession history.
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlarmClock, ArrowLeft, ArrowRight, Calculator, Check, ChevronLeft, ChevronRight, Contrast, Eraser, EyeOff, Flag,
  FlaskConical, Highlighter, LayoutGrid, Maximize2, Minimize2, NotebookPen, PauseCircle, Settings, Square, SquareCheck, X, ZoomIn,
} from "lucide-react";
import type { QuestionRecord } from "../../lib/questions";
import { questionMappingStatus } from "../../lib/questions";
import type { QuizAnswer } from "../../lib/quiz";
import { useStore } from "../../lib/store";
import {
  EXAM_SKINS, answersFromItems, blockCounts, clockElapsedMs, emptyItem, formatClock, pauseClock, readExamSimPrefs,
  reviewIndices, writeExamSimPrefs, type BlockClock, type ExamItemState, type ExamSimPrefs, type ExamSkin, type ReviewFilter,
  type SuspendedBlock,
} from "../../lib/examSim";
import { createTextAnnotationWithIntegrity, removeTextAnnotationById, type QuestionTextAnnotation } from "../../lib/questionAnnotations";
import { getQuestionAttachmentBlob } from "../../lib/questionAttachments";
import { LAB_SECTIONS, LAB_VALUES_SOURCE, searchLabValues, type LabSection } from "../../data/labValues";
import { AnnotatedQuestionText } from "./AnnotatedQuestionText";
import { QuizCalculator, type QuizCalculatorValue } from "./QuizCalculator";

type Panel = "labs" | "notes" | "calculator" | "settings" | null;

export interface ExamSimulatorProps {
  skin: ExamSkin;
  mode: "exam" | "tutor";
  pool: QuestionRecord[];
  timeLimitSeconds?: number;
  title?: string;
  resume?: SuspendedBlock;
  onFinish: (answers: QuizAnswer[], meta: { startedAt: string; elapsedSeconds: number }) => void;
  onSuspend: (block: SuspendedBlock) => void;
}

function trustedKey(question: QuestionRecord | undefined): string | undefined {
  return question && questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
}

export function ExamSimulator({ skin, mode, pool, timeLimitSeconds, title = "AXOM practice block", resume, onFinish, onSuspend }: ExamSimulatorProps) {
  const updateQuestion = useStore((s) => s.updateQuestion);
  const ids = useMemo(() => pool.map((question) => question.id), [pool]);
  const [index, setIndex] = useState(() => Math.min(resume?.index ?? 0, Math.max(0, pool.length - 1)));
  const [items, setItems] = useState<Record<string, ExamItemState>>(() => resume?.items ?? {});
  const [clock] = useState<BlockClock>(() => ({ elapsedMs: resume?.elapsedMs ?? 0, runningSince: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  const [notes, setNotes] = useState(resume?.notes ?? "");
  const [panel, setPanel] = useState<Panel>(null);
  const [prefs, setPrefsState] = useState<ExamSimPrefs>(() => readExamSimPrefs());
  const [tool, setTool] = useState<"highlight" | "erase" | null>(skin === "examsoft" ? null : "highlight");
  const [review, setReview] = useState<ReviewFilter | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navFilter, setNavFilter] = useState<ReviewFilter>("all");
  const [alertOpen, setAlertOpen] = useState(false);
  const [calculator, setCalculator] = useState<QuizCalculatorValue>({ expression: "", result: "" });
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [annotations, setAnnotations] = useState<Record<string, QuestionTextAnnotation[]>>(() => Object.fromEntries(pool.map((q) => [q.id, q.annotations ?? []])));
  const startedAt = useRef(resume?.startedAt ?? new Date().toISOString()).current;
  const shownAt = useRef(Date.now());
  const alerted = useRef(false);
  const finished = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stemRef = useRef<HTMLDivElement | null>(null);

  const question = pool[index];
  const item = (question && items[question.id]) || emptyItem();
  const counts = blockCounts(ids, items);
  const elapsedSeconds = Math.floor(clockElapsedMs(clock, now) / 1000);
  const remaining = timeLimitSeconds !== undefined ? Math.max(0, timeLimitSeconds - elapsedSeconds) : undefined;
  const correctKey = trustedKey(question);
  const revealed = mode === "tutor" && Boolean(item.submitted);

  const setPrefs = (patch: Partial<ExamSimPrefs>) => setPrefsState((current) => {
    const next = { ...current, ...patch };
    writeExamSimPrefs(next);
    return next;
  });

  const patchItem = useCallback((id: string, patch: Partial<ExamItemState>) => {
    setItems((current) => ({ ...current, [id]: { ...(current[id] ?? emptyItem()), ...patch } }));
  }, []);

  /** Add the time spent on the current item since it was shown. */
  const commitTime = useCallback((base: Record<string, ExamItemState>) => {
    const current = pool[index];
    if (!current) return base;
    const spent = (Date.now() - shownAt.current) / 1000;
    shownAt.current = Date.now();
    const previous = base[current.id] ?? emptyItem();
    return { ...base, [current.id]: { ...previous, visited: true, seconds: previous.seconds + spent } };
  }, [index, pool]);

  // Exam focus: hide AXOM's own overlays (dock, toasts, check-ins) while the block runs.
  useEffect(() => {
    document.body.classList.add("exam-sim-active");
    rootRef.current?.focus();
    return () => document.body.classList.remove("exam-sim-active");
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!question) return;
    patchItem(question.id, { visited: true });
    shownAt.current = Date.now();
    stemRef.current?.focus({ preventScroll: true });
    const body = rootRef.current?.querySelector<HTMLElement>(".exam-sim-item");
    if (body) body.scrollTop = 0;
  }, [index, question, patchItem]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const finalItems = commitTime(items);
    const answers = answersFromItems(ids, finalItems, (id) => trustedKey(pool.find((q) => q.id === id)));
    onFinish(answers, { startedAt, elapsedSeconds: Math.floor(clockElapsedMs(clock) / 1000) });
  }, [clock, commitTime, ids, items, onFinish, pool, startedAt]);

  // Time is up: the block ends, exactly like the real thing.
  useEffect(() => {
    if (remaining === 0) finish();
    if (remaining !== undefined && remaining <= 300 && remaining > 0 && prefs.fiveMinuteAlert && !alerted.current && (timeLimitSeconds ?? 0) > 600) {
      alerted.current = true;
      setAlertOpen(true);
    }
  }, [remaining, finish, prefs.fiveMinuteAlert, timeLimitSeconds]);

  function go(target: number) {
    if (target < 0 || target >= pool.length) return;
    setItems((current) => commitTime(current));
    setIndex(target);
    setNavigatorOpen(false);
  }

  function next() {
    if (index + 1 < pool.length) go(index + 1);
    else if (skin === "nbme") { setItems((current) => commitTime(current)); setReview("all"); }
    else setConfirmEnd(true);
  }

  function pick(key: string) {
    if (!question || revealed) return;
    patchItem(question.id, { answerKey: key, struck: item.struck.filter((struck) => struck !== key) });
  }

  function toggleStrike(key: string) {
    if (!question || revealed) return;
    const struck = item.struck.includes(key) ? item.struck.filter((value) => value !== key) : [...item.struck, key];
    patchItem(question.id, { struck, answerKey: item.answerKey === key && !item.struck.includes(key) ? undefined : item.answerKey });
  }

  function toggleMark() {
    if (!question) return;
    patchItem(question.id, { marked: !item.marked });
    updateQuestion(question.id, { marked: !item.marked });
  }

  function submitTutor() {
    if (!question || !item.answerKey || revealed) return;
    patchItem(question.id, { submitted: true });
  }

  function suspend() {
    finished.current = true;
    const finalItems = commitTime(items);
    const paused = pauseClock(clock);
    onSuspend({
      version: 1, skin, mode, poolIds: ids, index, items: finalItems, elapsedMs: paused.elapsedMs,
      timeLimitSeconds, notes, startedAt, suspendedAt: new Date().toISOString(),
    });
  }

  function endBlockRequested() {
    setItems((current) => commitTime(current));
    if (skin === "nbme") setReview("all");
    else setConfirmEnd(true);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { /* not allowed here */ }
  }

  // --- highlighting (persists on the question, like the rest of AXOM) --------
  function onSelection(range: { startOffset: number; endOffset: number } | null) {
    if (!question || !range || tool !== "highlight") return;
    const existing = annotations[question.id] ?? [];
    const result = createTextAnnotationWithIntegrity({
      id: `annotation-${crypto.randomUUID()}`,
      target: "stem",
      sourceText: question.stem,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      tone: prefs.highlightColor,
      now: new Date().toISOString(),
      existingAnnotations: existing,
    });
    if (result.status !== "created") return;
    const nextAnnotations = [...existing, result.annotation];
    setAnnotations((current) => ({ ...current, [question.id]: nextAnnotations }));
    updateQuestion(question.id, { annotations: nextAnnotations });
    window.getSelection()?.removeAllRanges();
  }

  function onDeleteAnnotation(annotationId: string) {
    if (!question) return;
    const nextAnnotations = removeTextAnnotationById(annotations[question.id] ?? [], annotationId);
    setAnnotations((current) => ({ ...current, [question.id]: nextAnnotations }));
    updateQuestion(question.id, { annotations: nextAnnotations });
  }

  // --- keyboard (UWorld: Alt+N / Alt+P; letters pick; Shift+letter strikes) ----
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Radios and checkboxes are part of the item, not text entry: shortcuts still apply.
      const typing = Boolean(target?.closest("input:not([type=radio]):not([type=checkbox]):not([type=range]), textarea, select, [contenteditable='true']"));
      if (event.key === "Escape") {
        if (panel) { setPanel(null); event.preventDefault(); return; }
        if (navigatorOpen) { setNavigatorOpen(false); event.preventDefault(); return; }
        if (confirmEnd) { setConfirmEnd(false); event.preventDefault(); return; }
        return;
      }
      if (typing || review !== null || confirmEnd) return;
      const key = event.key.toLowerCase();
      if (event.altKey && (key === "n" || event.code === "KeyN")) { next(); event.preventDefault(); return; }
      if (event.altKey && (key === "p" || event.code === "KeyP")) { go(index - 1); event.preventDefault(); return; }
      if (event.altKey && event.code === "KeyL") { setPanel((value) => (value === "labs" ? null : "labs")); event.preventDefault(); return; }
      if (event.altKey && event.code === "KeyC") { setPanel((value) => (value === "calculator" ? null : "calculator")); event.preventDefault(); return; }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight") { next(); event.preventDefault(); return; }
      if (event.key === "ArrowLeft") { go(index - 1); event.preventDefault(); return; }
      if (key === "m") { toggleMark(); event.preventDefault(); return; }
      if (event.key === "Enter" && mode === "tutor") { if (revealed) next(); else submitTutor(); event.preventDefault(); return; }
      const letter = event.key.toUpperCase();
      if (/^[A-J]$/.test(letter) && question?.options.some((option) => option.key === letter)) {
        if (event.shiftKey) toggleStrike(letter); else pick(letter);
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) return null;

  const timeLabel = remaining !== undefined ? "Block Time Remaining" : "Block Time Elapsed";
  const timeValue = formatClock(remaining ?? elapsedSeconds);
  const lowTime = remaining !== undefined && remaining <= 300;
  const style = { "--sim-scale": prefs.textScale } as CSSProperties;
  const shortId = question.id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();

  const toolButtons = (
    <>
      <SimTool icon={<Highlighter size={18} />} label="Highlight" active={tool === "highlight"} onClick={() => setTool((value) => (value === "highlight" ? null : "highlight"))} />
      <SimTool icon={<Eraser size={18} />} label="Erase" active={tool === "erase"} onClick={() => setTool((value) => (value === "erase" ? null : "erase"))} />
      <SimTool icon={<FlaskConical size={18} />} label="Lab Values" active={panel === "labs"} onClick={() => setPanel((value) => (value === "labs" ? null : "labs"))} />
      <SimTool icon={<NotebookPen size={18} />} label="Notes" active={panel === "notes"} onClick={() => setPanel((value) => (value === "notes" ? null : "notes"))} />
      <SimTool icon={<Calculator size={18} />} label="Calculator" active={panel === "calculator"} onClick={() => setPanel((value) => (value === "calculator" ? null : "calculator"))} />
    </>
  );

  return (
    <div ref={rootRef} className={`exam-sim skin-${skin} theme-${prefs.theme}`} role="dialog" aria-modal="true" aria-label={`${EXAM_SKINS[skin].label} exam simulation`} tabIndex={-1} style={style}>
      {/* ---------------------------------------------------------------- top */}
      <header className="exam-sim-top">
        {skin === "examsoft" ? (
          <div className="sim-top-left">
            <b className="sim-exam-title">{title}</b>
            <span className="sim-item-count">Question {index + 1} of {pool.length}</span>
          </div>
        ) : (
          <div className="sim-top-left">
            <div className="sim-item-meta">
              <b>Item {index + 1} of {pool.length}</b>
              {skin === "uworld" && <small>Question Id: {shortId}</small>}
            </div>
            <button type="button" className={`sim-mark ${item.marked ? "on" : ""}`} onClick={toggleMark} aria-pressed={item.marked} aria-label="Mark item for review">
              {item.marked ? <SquareCheck size={16} /> : <Square size={16} />} <Flag size={15} className="sim-flag" /> <span>Mark</span>
            </button>
          </div>
        )}

        <div className="sim-top-center">
          {skin !== "examsoft" && <>
            <SimNav icon={<ArrowLeft size={20} />} label="Previous" disabled={index === 0} onClick={() => go(index - 1)} />
            {skin === "nbme" && <SimNav icon={<LayoutGrid size={20} />} label="Navigator" onClick={() => setNavigatorOpen((value) => !value)} active={navigatorOpen} />}
            <SimNav icon={<ArrowRight size={20} />} label="Next" disabled={index + 1 >= pool.length && skin === "uworld"} onClick={next} />
          </>}
        </div>

        <div className="sim-top-right">
          {skin === "examsoft" && (
            <span className={`sim-time-top ${lowTime ? "low" : ""}`}>
              {prefs.showTimer ? <b>{timeValue}</b> : <span>Time hidden</span>}
              <button type="button" className="sim-link" onClick={() => setPrefs({ showTimer: !prefs.showTimer })}>{prefs.showTimer ? "Hide" : "Show"}</button>
            </span>
          )}
          {toolButtons}
          {skin !== "examsoft" && <SimTool icon={fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />} label={fullscreen ? "Exit Full Screen" : "Full Screen"} onClick={() => void toggleFullscreen()} />}
          {skin === "uworld" && <SimTool icon={<Contrast size={18} />} label="Reverse Color" active={prefs.theme === "dark"} onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })} />}
          {skin === "uworld" && (
            <span className="sim-zoom" role="group" aria-label="Text zoom">
              <button type="button" onClick={() => setPrefs({ textScale: Math.max(1, Math.round((prefs.textScale - 0.1) * 10) / 10) })} aria-label="Smaller text">A−</button>
              <button type="button" onClick={() => setPrefs({ textScale: Math.min(2, Math.round((prefs.textScale + 0.1) * 10) / 10) })} aria-label="Larger text">A+</button>
            </span>
          )}
          <SimTool icon={<Settings size={18} />} label="Settings" active={panel === "settings"} onClick={() => setPanel((value) => (value === "settings" ? null : "settings"))} />
        </div>
      </header>

      {/* --------------------------------------------------------------- body */}
      <div className={`exam-sim-main ${panel ? "with-panel" : ""}`}>
        {skin === "uworld" && navOpen && (
          <nav className="sim-sidebar" aria-label="Items">
            {pool.map((entry, position) => {
              const state = items[entry.id];
              const answeredState = state?.submitted && mode === "tutor"
                ? (trustedKey(entry) ? (state.answerKey === trustedKey(entry) ? "right" : "wrong") : "done")
                : state?.answerKey ? "done" : "";
              return (
                <button key={entry.id} type="button" className={`sim-side-item ${position === index ? "current" : ""} ${answeredState}`}
                  onClick={() => go(position)} aria-current={position === index ? "true" : undefined}
                  aria-label={`Item ${position + 1}${state?.answerKey ? ", answered" : ", unanswered"}${state?.marked ? ", marked" : ""}`}>
                  <span className={`sim-dot ${state?.answerKey ? "filled" : ""}`} aria-hidden="true" />
                  <span>{position + 1}</span>
                  {state?.marked && <Flag size={13} className="sim-flag" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
        )}
        {skin === "uworld" && (
          <button type="button" className="sim-sidebar-toggle" onClick={() => setNavOpen((value) => !value)} aria-label={navOpen ? "Hide item list" : "Show item list"}>
            {navOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}

        {skin === "examsoft" && (
          <nav className="sim-pane" aria-label="Question list">
            <div className="sim-pane-filter" role="group" aria-label="Show questions">
              {(["all", "incomplete", "marked"] as ReviewFilter[]).map((filter) => (
                <button key={filter} type="button" className={navFilter === filter ? "on" : ""} aria-pressed={navFilter === filter} onClick={() => setNavFilter(filter)}>
                  {filter === "all" ? "All" : filter === "incomplete" ? "Unanswered" : "Flagged"}
                </button>
              ))}
            </div>
            <div className="sim-pane-list">
              {reviewIndices(ids, items, navFilter).map((position) => {
                const state = items[ids[position]];
                return (
                  <button key={ids[position]} type="button" className={`sim-pane-item ${position === index ? "current" : ""}`} onClick={() => go(position)}
                    aria-current={position === index ? "true" : undefined} aria-label={`Question ${position + 1}${state?.answerKey ? ", answered" : ""}${state?.marked ? ", flagged" : ""}`}>
                    <span>{position + 1}</span>
                    {state?.answerKey ? <Check size={14} className="sim-answered" aria-hidden="true" /> : <span className="sim-dot" aria-hidden="true" />}
                    {state?.marked && <Flag size={13} className="sim-flag" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="sim-pane-counts">{counts.answered}/{counts.total} answered · {counts.marked} flagged</div>
          </nav>
        )}

        <section className="exam-sim-item" aria-labelledby="sim-item-heading">
          <h2 id="sim-item-heading" className="sr-only">Item {index + 1} of {pool.length}</h2>
          {skin === "examsoft" && (
            <div className="sim-es-qhead">
              <b>Question {index + 1}</b>
              <button type="button" className={`sim-es-flag ${item.marked ? "on" : ""}`} onClick={toggleMark} aria-pressed={item.marked} aria-label="Flag question">
                <Flag size={15} /> {item.marked ? "Flagged" : "Flag question"}
              </button>
            </div>
          )}
          <div className={`sim-stem ${tool === "highlight" ? "tool-highlight" : ""} ${tool === "erase" ? "tool-erase" : ""}`}>
            <AnnotatedQuestionText
              text={question.stem}
              annotations={(annotations[question.id] ?? []).filter((annotation) => annotation.target === "stem")}
              className="sim-stem-text"
              label="Question stem"
              focusRef={stemRef}
              eraseMode={tool === "erase"}
              onDelete={onDeleteAnnotation}
              onSelection={onSelection}
            />
          </div>
          {(question.attachments?.length ?? 0) > 0 && <SimExhibits question={question} />}

          <fieldset className="sim-choices" aria-label="Answer choices">
            {question.options.map((option) => {
              const selected = item.answerKey === option.key;
              const struck = item.struck.includes(option.key);
              const isCorrect = revealed && correctKey === option.key;
              const isWrong = revealed && selected && correctKey !== undefined && correctKey !== option.key;
              return (
                <div key={option.key} className={`sim-choice ${selected ? "selected" : ""} ${struck ? "struck" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}
                  onContextMenu={(event) => { event.preventDefault(); toggleStrike(option.key); }}>
                  <label>
                    <input type="radio" name={`sim-${question.id}`} checked={selected} disabled={revealed} onChange={() => pick(option.key)} aria-label={`${option.key}. ${option.text}`} />
                    <span className="sim-choice-key">{option.key}.</span>
                    <span className="sim-choice-text">{option.text}</span>
                  </label>
                  {isCorrect && <Check size={18} className="sim-choice-mark ok" aria-label="Correct answer" />}
                  {isWrong && <X size={18} className="sim-choice-mark bad" aria-label="Your answer (incorrect)" />}
                  {!revealed && (
                    <button type="button" className="sim-strike" onClick={() => toggleStrike(option.key)} aria-pressed={struck}
                      aria-label={`${struck ? "Restore" : "Strike out"} choice ${option.key}`} title="Strike out (or right-click the choice)">
                      <EyeOff size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </fieldset>

          {mode === "tutor" && !revealed && (
            <button type="button" className="sim-submit" disabled={!item.answerKey} onClick={submitTutor}>Submit</button>
          )}
          {revealed && <SimExplanation question={question} picked={item.answerKey} correctKey={correctKey} seconds={item.seconds} />}
        </section>

        {panel && (
          <aside className={`sim-panel sim-panel-${panel}`} aria-label={panelLabel(panel)}>
            <div className="sim-panel-head">
              <b>{panelLabel(panel)}</b>
              <button type="button" onClick={() => setPanel(null)} aria-label={`Close ${panelLabel(panel)}`}><X size={16} /></button>
            </div>
            {panel === "labs" && <LabValuesPanel />}
            {panel === "notes" && (
              <textarea className="sim-notes" value={notes} onChange={(event) => setNotes(event.target.value)} aria-label="Block notes" placeholder="Scratch work and reminders for this block. Saved with Suspend." autoFocus />
            )}
            {panel === "calculator" && <QuizCalculator onClose={() => setPanel(null)} value={calculator} onChange={setCalculator} showClose={false} />}
            {panel === "settings" && <SimSettings prefs={prefs} onChange={setPrefs} skin={skin} />}
          </aside>
        )}
      </div>

      {/* ------------------------------------------------------------- bottom */}
      <footer className="exam-sim-bottom">
        {skin === "examsoft" ? (
          <>
            <div className="sim-bottom-left">
              <button type="button" className="sim-es-btn" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={16} /> Previous</button>
              <button type="button" className="sim-es-btn primary" disabled={index + 1 >= pool.length} onClick={next}>Next <ChevronRight size={16} /></button>
            </div>
            <div className="sim-bottom-right">
              <button type="button" className="sim-bottom-btn" onClick={suspend}><PauseCircle size={16} /> Save &amp; exit</button>
              <button type="button" className="sim-es-btn submit" onClick={endBlockRequested}>Review &amp; submit</button>
            </div>
          </>
        ) : (
          <>
            <div className="sim-bottom-left">
              {prefs.showTimer
                ? <span className={`sim-time ${lowTime ? "low" : ""}`}>{skin === "nbme" ? (remaining !== undefined ? "Time Remaining" : "Time Elapsed") : timeLabel}: <b>{timeValue}</b></span>
                : <span className="sim-time muted">Timer hidden</span>}
              {skin === "nbme" && <span className="sim-time muted">{counts.answered} of {counts.total} answered</span>}
              {mode === "tutor" && <span className="sim-mode">Tutor</span>}
            </div>
            <div className="sim-bottom-right">
              <button type="button" className="sim-bottom-btn" onClick={suspend}><PauseCircle size={16} /> Suspend</button>
              <button type="button" className="sim-bottom-btn end" onClick={endBlockRequested}><Square size={14} /> End Block</button>
            </div>
          </>
        )}
      </footer>

      {/* ----------------------------------------------------------- overlays */}
      {navigatorOpen && skin === "nbme" && (
        <div className="sim-navigator" role="dialog" aria-label="Navigator">
          <div className="sim-panel-head"><b>Navigator</b><button type="button" onClick={() => setNavigatorOpen(false)} aria-label="Close navigator"><X size={16} /></button></div>
          <ReviewTable ids={ids} items={items} filter="all" current={index} onPick={go} />
        </div>
      )}

      {review !== null && (
        <div className="sim-review" role="dialog" aria-modal="true" aria-label="Item Review">
          <div className="sim-review-card">
            <h3>Item Review</h3>
            <p>{counts.incomplete ? `${counts.incomplete} incomplete` : "All items answered"} · {counts.marked} marked. Choose items to revisit, or end the block.</p>
            <div className="sim-review-filters" role="group" aria-label="Review filter">
              <button type="button" className={review === "all" ? "on" : ""} onClick={() => setReview("all")}>Review All</button>
              <button type="button" className={review === "incomplete" ? "on" : ""} onClick={() => setReview("incomplete")} disabled={!counts.incomplete}>Review Incomplete</button>
              <button type="button" className={review === "marked" ? "on" : ""} onClick={() => setReview("marked")} disabled={!counts.marked}>Review Marked</button>
            </div>
            <ReviewTable ids={ids} items={items} filter={review} current={index} onPick={(position) => { setReview(null); go(position); }} />
            <div className="sim-review-actions">
              <button type="button" className="sim-bottom-btn" onClick={() => setReview(null)}>Return to item {index + 1}</button>
              <button type="button" className="sim-bottom-btn end" onClick={finish}>End Block</button>
            </div>
          </div>
        </div>
      )}

      {confirmEnd && (
        <div className="sim-review" role="alertdialog" aria-modal="true" aria-labelledby="sim-end-title">
          <div className="sim-review-card narrow">
            <h3 id="sim-end-title">{skin === "examsoft" ? "Submit exam?" : "End block?"}</h3>
            <p>
              {counts.incomplete
                ? <>You have <b>{counts.incomplete} unanswered</b> {counts.incomplete === 1 ? "item" : "items"}{counts.marked ? <> and <b>{counts.marked} marked</b></> : null}.</>
                : <>All {counts.total} items answered{counts.marked ? <> · <b>{counts.marked} marked</b></> : null}.</>}
              {" "}After ending, answers are final and your results open.
            </p>
            <div className="sim-review-actions">
              {counts.incomplete > 0 && <button type="button" className="sim-bottom-btn" onClick={() => { setConfirmEnd(false); setReview("incomplete"); }}>Review unanswered</button>}
              {counts.marked > 0 && <button type="button" className="sim-bottom-btn" onClick={() => { setConfirmEnd(false); setReview("marked"); }}>Review marked</button>}
              <button type="button" className="sim-bottom-btn" onClick={() => setConfirmEnd(false)}>Cancel</button>
              <button type="button" className="sim-bottom-btn end" onClick={finish} autoFocus>{skin === "examsoft" ? "Submit" : "End Block"}</button>
            </div>
          </div>
        </div>
      )}

      {alertOpen && (
        <div className="sim-alert" role="alert">
          <AlarmClock size={18} /> <b>5 minutes remaining</b> in this block.
          <button type="button" onClick={() => setAlertOpen(false)} aria-label="Dismiss time alert"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function panelLabel(panel: Exclude<Panel, null>) {
  return panel === "labs" ? "Lab Values" : panel === "notes" ? "Notes" : panel === "calculator" ? "Calculator" : "Settings";
}

function SimTool({ icon, label, onClick, active = false }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" className={`sim-tool ${active ? "on" : ""}`} onClick={onClick} aria-pressed={active} aria-label={label} title={label}>
      {icon}<span>{label}</span>
    </button>
  );
}

function SimNav({ icon, label, onClick, disabled = false, active = false }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`sim-nav ${active ? "on" : ""}`} onClick={onClick} disabled={disabled} aria-label={label}>
      {icon}<span>{label}</span>
    </button>
  );
}

function ReviewTable({ ids, items, filter, current, onPick }: {
  ids: readonly string[];
  items: Readonly<Record<string, ExamItemState>>;
  filter: ReviewFilter;
  current: number;
  onPick: (position: number) => void;
}) {
  const rows = reviewIndices(ids, items, filter);
  if (!rows.length) return <p className="sim-review-empty">Nothing to show for this filter.</p>;
  return (
    <div className="sim-review-grid" role="list">
      {rows.map((position) => {
        const state = items[ids[position]];
        return (
          <button key={ids[position]} type="button" role="listitem" className={`sim-review-cell ${position === current ? "current" : ""} ${state?.answerKey ? "" : "incomplete"}`} onClick={() => onPick(position)}
            aria-label={`Item ${position + 1}: ${state?.answerKey ? "complete" : "incomplete"}${state?.marked ? ", marked" : ""}`}>
            <b>{position + 1}</b>
            <small>{state?.answerKey ? "Complete" : state?.visited ? "Incomplete" : "Unseen"}</small>
            {state?.marked && <Flag size={13} className="sim-flag" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function LabValuesPanel() {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<LabSection["id"]>("serum");
  const [showSi, setShowSi] = useState(false);
  const results = query.trim() ? searchLabValues(query) : null;
  const active = LAB_SECTIONS.find((item) => item.id === section)!;
  const rows = results ?? active.values.map((value) => ({ ...value, section: active.title }));
  let lastGroup: string | undefined;
  return (
    <div className="sim-labs">
      <input className="sim-labs-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lab values (e.g. sodium, TSH, CSF glucose)" aria-label="Search lab values" autoFocus />
      {!results && (
        <div className="sim-labs-tabs" role="tablist" aria-label="Lab sections">
          {LAB_SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={section === item.id ? "on" : ""} onClick={() => setSection(item.id)}>{item.title}</button>
          ))}
        </div>
      )}
      <label className="sim-labs-si"><input type="checkbox" checked={showSi} onChange={(event) => setShowSi(event.target.checked)} /> SI reference intervals</label>
      <table className="sim-labs-table">
        <thead><tr><th scope="col">Test</th><th scope="col">{showSi ? "SI reference interval" : "Reference range"}</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const heading = results ? row.section : row.group;
            const showHeading = heading && heading !== lastGroup;
            lastGroup = heading;
            return (
              <FragmentRows key={`${row.section}-${row.group ?? ""}-${row.name}`} heading={showHeading ? heading : undefined}>
                <tr><th scope="row">{row.name}</th><td>{(showSi ? row.si : row.range).split("; ").map((part) => <span key={part}>{part}</span>)}</td></tr>
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {results && !results.length && <p className="sim-review-empty">No lab value matches “{query}”.</p>}
      <p className="sim-labs-source">{LAB_VALUES_SOURCE}</p>
    </div>
  );
}

function FragmentRows({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <>
      {heading && <tr className="sim-labs-group"><th colSpan={2} scope="colgroup">{heading}</th></tr>}
      {children}
    </>
  );
}

function SimSettings({ prefs, onChange, skin }: { prefs: ExamSimPrefs; onChange: (patch: Partial<ExamSimPrefs>) => void; skin: ExamSkin }) {
  return (
    <div className="sim-settings">
      <label>
        <span>Text size <b>{Math.round(prefs.textScale * 100)}%</b></span>
        <input type="range" min={1} max={2} step={0.1} value={prefs.textScale} onChange={(event) => onChange({ textScale: Number(event.target.value) })} aria-label="Text size" />
      </label>
      <div className="sim-settings-row" role="radiogroup" aria-label="Theme">
        <span>Theme</span>
        {(["light", "dark"] as const).map((theme) => (
          <button key={theme} type="button" role="radio" aria-checked={prefs.theme === theme} className={prefs.theme === theme ? "on" : ""} onClick={() => onChange({ theme })}>{theme === "light" ? "Light" : "Dark"}</button>
        ))}
      </div>
      <div className="sim-settings-row" role="radiogroup" aria-label="Highlighter color">
        <span>Highlighter</span>
        {(["yellow", "cyan", "purple"] as const).map((tone) => (
          <button key={tone} type="button" role="radio" aria-checked={prefs.highlightColor === tone} className={`sim-swatch tone-${tone} ${prefs.highlightColor === tone ? "on" : ""}`} onClick={() => onChange({ highlightColor: tone })} aria-label={tone} />
        ))}
      </div>
      <label className="sim-settings-check"><input type="checkbox" checked={prefs.showTimer} onChange={(event) => onChange({ showTimer: event.target.checked })} /> Show timer</label>
      <label className="sim-settings-check"><input type="checkbox" checked={prefs.fiveMinuteAlert} onChange={(event) => onChange({ fiveMinuteAlert: event.target.checked })} /> Alert at 5 minutes remaining</label>
      <p className="sim-settings-help">
        Keys: <kbd>A</kbd>–<kbd>E</kbd> choose · <kbd>Shift</kbd>+letter strikes out · <kbd>M</kbd> mark · <kbd>←</kbd>/<kbd>→</kbd> or <kbd>Alt</kbd>+<kbd>P</kbd>/<kbd>N</kbd> move · <kbd>Alt</kbd>+<kbd>L</kbd> labs · <kbd>Alt</kbd>+<kbd>C</kbd> calculator.
        {skin !== "examsoft" && " Select text to highlight; right-click a choice to strike it out."}
      </p>
    </div>
  );
}

/** Exhibits with per-image contrast and invert (USMLE 2026 image controls). */
function SimExhibits({ question }: { question: QuestionRecord }) {
  const attachments = question.attachments ?? [];
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adjust, setAdjust] = useState<Record<string, { contrast: number; invert: boolean }>>({});
  const [zoomed, setZoomed] = useState<string | null>(null);
  const signature = attachments.map((attachment) => `${attachment.id}:${attachment.blobKey}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const attachment of attachments) {
        const record = await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined);
        if (record) { const url = URL.createObjectURL(record.blob); created.push(url); next[attachment.id] = url; }
      }
      if (!cancelled) setUrls(next); else created.forEach((url) => URL.revokeObjectURL(url));
    })();
    return () => { cancelled = true; created.forEach((url) => URL.revokeObjectURL(url)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return (
    <div className="sim-exhibits">
      {attachments.map((attachment) => {
        const url = urls[attachment.id];
        const setting = adjust[attachment.id] ?? { contrast: 1, invert: false };
        const filter = `contrast(${setting.contrast})${setting.invert ? " invert(1)" : ""}`;
        return (
          <figure key={attachment.id} className="sim-exhibit">
            {url ? (
              <button type="button" className="sim-exhibit-img" onClick={() => setZoomed(attachment.id)} aria-label={`Enlarge ${attachment.altText || "exhibit"}`}>
                <img src={url} alt={attachment.altText || "Question exhibit"} style={{ filter }} />
                <ZoomIn size={16} className="sim-exhibit-zoom" aria-hidden="true" />
              </button>
            ) : <div className="sim-exhibit-missing">Image unavailable on this device</div>}
            <figcaption>
              <label><Contrast size={14} aria-hidden="true" /> Contrast
                <input type="range" min={0.5} max={2} step={0.1} value={setting.contrast} aria-label="Image contrast"
                  onChange={(event) => setAdjust((current) => ({ ...current, [attachment.id]: { ...setting, contrast: Number(event.target.value) } }))} />
              </label>
              <label className="sim-settings-check"><input type="checkbox" checked={setting.invert}
                onChange={(event) => setAdjust((current) => ({ ...current, [attachment.id]: { ...setting, invert: event.target.checked } }))} /> Invert</label>
            </figcaption>
            {zoomed === attachment.id && url && (
              <div className="sim-zoom-overlay" role="dialog" aria-label="Exhibit" onClick={() => setZoomed(null)}>
                <img src={url} alt={attachment.altText || "Question exhibit"} style={{ filter }} />
              </div>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function SimExplanation({ question, picked, correctKey, seconds }: { question: QuestionRecord; picked?: string; correctKey?: string; seconds: number }) {
  const correct = correctKey ? picked === correctKey : undefined;
  const rationales = question.choiceRationales ?? {};
  return (
    <section className="sim-explanation" aria-label="Explanation">
      <div className={`sim-explanation-verdict ${correct === true ? "ok" : correct === false ? "bad" : ""}`}>
        <b>{correct === undefined ? "Answer key not confirmed" : correct ? "Correct" : "Incorrect"}</b>
        {correctKey && <span>Correct answer: {correctKey}</span>}
        <span>Time spent: {formatClock(seconds).replace(/^00:/, "")}</span>
      </div>
      {question.explanation && <div className="sim-explanation-text">{question.explanation.trim()}</div>}
      {Object.keys(rationales).length > 0 && (
        <dl className="sim-rationales">
          {question.options.filter((option) => rationales[option.key]).map((option) => (
            <div key={option.key} className={option.key === correctKey ? "ok" : option.key === picked ? "bad" : ""}>
              <dt>({option.key}) {option.text}</dt>
              <dd>{rationales[option.key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {!question.explanation && !Object.keys(rationales).length && <p className="sim-review-empty">No explanation was imported for this item.</p>}
    </section>
  );
}
