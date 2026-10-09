import { QuestionContent, QuestionSupportingContent } from "./QuestionContent";
import { isAssetVisible } from "../../lib/question-content/visibility";
// ===========================================================================
// Exam simulator — practice inside the interface you will actually sit:
// UWorld, USMLE/NBME (2026 Prometric software) or ExamSoft Examplify. One
// engine (lib/exam/engine, run by components/exam/useExamBlock), a behaviour
// profile per exam (lib/exam/profiles) and a renderer per look: UWorld and
// NBME below, Examplify in components/exam/ExamplifyExam. AXOM's evidence is
// underneath all of them: every answer, mark and second lands in the same
// QuizSession history.
// ===========================================================================
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock, ArrowLeft, ArrowRight, Calculator, Check, ChevronLeft, ChevronRight, Contrast, Eraser, EyeOff, Flag,
  FlaskConical, Highlighter, LayoutGrid, Maximize2, Minimize2, NotebookPen, PauseCircle, Settings, Square, SquareCheck, X, ZoomIn,
} from "lucide-react";
import type { QuestionRecord } from "../../lib/questions";
import type { QuizAnswer } from "../../lib/quiz";
import { EXAM_SKINS, formatClock, reviewIndices, type ExamItemState, type ExamSimPrefs, type ExamSkin, type ReviewFilter, type SuspendedBlock } from "../../lib/examSim";
import type { NavigatorEntry } from "../../lib/exam/engine";
import { AnnotatedQuestionText } from "./AnnotatedQuestionText";
import { QuizCalculator, type QuizCalculatorValue } from "./QuizCalculator";
import { ExamplifyExam } from "../exam/ExamplifyExam";
import { ExplanationBody, LabValuesPanel, useExhibitUrls } from "../exam/parts";
import { useExamBlock, type ExamBlockApi, type FinishedBlock } from "../exam/useExamBlock";

type Panel = "labs" | "notes" | "calculator" | "settings" | null;

export interface ExamSimulatorProps {
  skin: ExamSkin;
  mode: "exam" | "tutor";
  pool: QuestionRecord[];
  timeLimitSeconds?: number;
  title?: string;
  resume?: SuspendedBlock;
  /** A finished block to read through in the same interface: read-only, results shown. */
  review?: FinishedBlock;
  onFinish: (answers: QuizAnswer[], meta: { startedAt: string; elapsedSeconds: number }) => void;
  onSuspend: (block: SuspendedBlock) => void;
  /** Leave a review. */
  onClose?: () => void;
}

export function ExamSimulator(props: ExamSimulatorProps) {
  const exam = useExamBlock(props);
  const title = props.title ?? "AXOM practice block";
  // An exam takes the whole screen. Rendered at the document root, because inside
  // AXOM's page frame "fixed" is measured from the frame and the exam sat inset.
  return createPortal(
    props.skin === "examsoft"
      ? <ExamplifyExam exam={exam} title={title} timeLimitSeconds={props.timeLimitSeconds} onClose={props.onClose} />
      : <ClassicExam exam={exam} skin={props.skin} mode={props.mode} onClose={props.onClose} />,
    document.body,
  );
}

/** The UWorld and NBME interfaces: a navy top bar, tools on the right, the block clock in the bottom bar. */
function ClassicExam({ exam, skin, mode, onClose }: {
  exam: ExamBlockApi;
  skin: Exclude<ExamSkin, "examsoft">;
  mode: "exam" | "tutor";
  onClose?: () => void;
}) {
  const { pool, question, index, item, counts, entries, correctKey, revealed, result, prefs, setPrefs, tool, setTool, reviewing } = exam;
  const [panel, setPanel] = useState<Panel>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [calculator, setCalculator] = useState<QuizCalculatorValue>({ expression: "", result: "" });
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function go(target: number) {
    exam.go(target);
    setNavigatorOpen(false);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await exam.rootRef.current?.requestFullscreen();
    } catch { /* not allowed here */ }
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
        if (exam.confirmEnd) { exam.setConfirmEnd(false); event.preventDefault(); return; }
        return;
      }
      if (typing || exam.itemReview !== null || exam.confirmEnd) return;
      if (event.altKey && event.code === "KeyL") { setPanel((value) => (value === "labs" ? null : "labs")); event.preventDefault(); return; }
      if (event.altKey && event.code === "KeyC") { setPanel((value) => (value === "calculator" ? null : "calculator")); event.preventDefault(); return; }
      if (exam.handleKey(event)) {
        setNavigatorOpen(false);
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) return null;

  const { remaining, elapsedSeconds, lowTime } = exam;
  const timeLabel = remaining !== undefined ? "Block Time Remaining" : "Block Time Elapsed";
  const timeValue = formatClock(remaining ?? elapsedSeconds);
  const style = { "--sim-scale": prefs.textScale } as CSSProperties;
  const shortId = question.id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  const itemsById = legacyItems(exam);
  const ids = exam.block.ids;

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
    <div ref={exam.rootRef} className={`exam-sim skin-${skin} theme-${prefs.theme} ${reviewing ? "is-review" : ""}`} role="dialog" aria-modal="true" aria-label={`${EXAM_SKINS[skin].label} exam simulation`} tabIndex={-1} style={style}>
      {/* ---------------------------------------------------------------- top */}
      <header className="exam-sim-top">
        <div className="sim-top-left">
          <div className="sim-item-meta">
            <b>Item {index + 1} of {pool.length}</b>
            {skin === "uworld" && <small>Question Id: {shortId}</small>}
          </div>
          <button type="button" className={`sim-mark ${item.marked ? "on" : ""}`} onClick={exam.mark} disabled={reviewing} aria-pressed={item.marked} aria-label="Mark item for review">
            {item.marked ? <SquareCheck size={16} /> : <Square size={16} />} <Flag size={15} className="sim-flag" /> <span>Mark</span>
          </button>
        </div>

        <div className="sim-top-center">
          <SimNav icon={<ArrowLeft size={20} />} label="Previous" disabled={index === 0} onClick={() => go(index - 1)} />
          {skin === "nbme" && <SimNav icon={<LayoutGrid size={20} />} label="Navigator" onClick={() => setNavigatorOpen((value) => !value)} active={navigatorOpen} />}
          <SimNav icon={<ArrowRight size={20} />} label="Next" disabled={index + 1 >= pool.length && (skin === "uworld" || reviewing)} onClick={exam.next} />
        </div>

        <div className="sim-top-right">
          {toolButtons}
          <SimTool icon={fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />} label={fullscreen ? "Exit Full Screen" : "Full Screen"} onClick={() => void toggleFullscreen()} />
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
            {entries.map((entry) => (
              <button key={entry.id} type="button" className={`sim-side-item ${entry.current ? "current" : ""} ${sidebarState(entry)}`}
                onClick={() => go(entry.position)} aria-current={entry.current ? "true" : undefined}
                aria-label={`Item ${entry.position + 1}${entryWords(entry)}${entry.flagged ? ", marked" : ""}`}>
                {entry.result === "correct" ? <Check size={13} className="sim-result ok" aria-hidden="true" />
                  : entry.result === "incorrect" ? <X size={13} className="sim-result bad" aria-hidden="true" />
                  : <span className={`sim-dot ${entry.answered ? "filled" : ""}`} aria-hidden="true" />}
                <span>{entry.position + 1}</span>
                {entry.flagged && <Flag size={13} className="sim-flag" aria-hidden="true" />}
              </button>
            ))}
          </nav>
        )}
        {skin === "uworld" && (
          <button type="button" className="sim-sidebar-toggle" onClick={() => setNavOpen((value) => !value)} aria-label={navOpen ? "Hide item list" : "Show item list"}>
            {navOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}

        <section className="exam-sim-item" data-exam-scroll aria-labelledby="sim-item-heading">
          <h2 id="sim-item-heading" className="sr-only">Item {index + 1} of {pool.length}</h2>
          <div className={`sim-stem ${tool === "highlight" ? "tool-highlight" : ""} ${tool === "erase" ? "tool-erase" : ""}`}>
            <div aria-label={question.content ? "Question stem" : undefined} tabIndex={question.content ? -1 : undefined} ref={question.content ? exam.stemRef : undefined}><QuestionContent question={question} part="stem" fallback={<AnnotatedQuestionText
              text={question.stem}
              annotations={exam.annotations}
              className="sim-stem-text"
              label="Question stem"
              focusRef={exam.stemRef}
              eraseMode={tool === "erase"}
              onDelete={exam.onDeleteAnnotation}
              onSelection={exam.onSelection}
            />} /></div>
          </div>
          {!question.content && (question.attachments?.length ?? 0) > 0 && <SimExhibits question={question} />}

          <QuestionSupportingContent question={question} mode="question" />
          <fieldset className="sim-choices" aria-label="Answer choices">
            {question.options.map((option) => {
              const selected = item.answerKey === option.key;
              const struck = item.struck.includes(option.key);
              const isCorrect = revealed && correctKey === option.key;
              const isWrong = revealed && selected && correctKey !== undefined && correctKey !== option.key;
              return (
                <div key={option.key} className={`sim-choice ${selected ? "selected" : ""} ${struck ? "struck" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}
                  onContextMenu={(event) => { event.preventDefault(); exam.strike(option.key); }}>
                  <label>
                    <input type="radio" name={`sim-${question.id}`} checked={selected} disabled={revealed} onChange={() => exam.pick(option.key)} aria-label={`${option.key}. ${option.text}`} />
                    <span className="sim-choice-key">{option.key}.</span>
                    <span className="sim-choice-text"><QuestionContent question={question} part="choice" choice={option.key} fallback={option.text} /></span>
                  </label>
                  {isCorrect && <Check size={18} className="sim-choice-mark ok" aria-label="Correct answer" />}
                  {isWrong && <X size={18} className="sim-choice-mark bad" aria-label="Your answer (incorrect)" />}
                  {!revealed && (
                    <button type="button" className="sim-strike" onClick={() => exam.strike(option.key)} aria-pressed={struck}
                      aria-label={`${struck ? "Restore" : "Strike out"} choice ${option.key}`} title="Strike out (or right-click the choice)">
                      <EyeOff size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </fieldset>

          {mode === "tutor" && !revealed && (
            <button type="button" className="sim-submit" disabled={!item.answerKey} onClick={exam.reveal}>Submit</button>
          )}
          {revealed && <ExplanationBody question={question} picked={item.answerKey} correctKey={correctKey} result={result} seconds={exam.seconds} />}
        </section>

        {panel && (
          <aside className={`sim-panel sim-panel-${panel}`} aria-label={panelLabel(panel)}>
            <div className="sim-panel-head">
              <b>{panelLabel(panel)}</b>
              <button type="button" onClick={() => setPanel(null)} aria-label={`Close ${panelLabel(panel)}`}><X size={16} /></button>
            </div>
            {panel === "labs" && <LabValuesPanel />}
            {panel === "notes" && (
              <textarea className="sim-notes" value={exam.block.notes} onChange={(event) => exam.setNotes(event.target.value)} readOnly={reviewing} aria-label="Block notes" placeholder="Scratch work and reminders for this block. Saved with Suspend." autoFocus />
            )}
            {panel === "calculator" && <QuizCalculator onClose={() => setPanel(null)} value={calculator} onChange={setCalculator} showClose={false} />}
            {panel === "settings" && <SimSettings prefs={prefs} onChange={setPrefs} />}
          </aside>
        )}
      </div>

      {/* ------------------------------------------------------------- bottom */}
      <footer className="exam-sim-bottom">
        <div className="sim-bottom-left">
          {reviewing
            ? <span className="sim-time muted">Review · block time {formatClock(elapsedSeconds)}</span>
            : prefs.showTimer
              ? <span className={`sim-time ${lowTime ? "low" : ""}`}>{skin === "nbme" ? (remaining !== undefined ? "Time Remaining" : "Time Elapsed") : timeLabel}: <b>{timeValue}</b></span>
              : <span className="sim-time muted">Timer hidden</span>}
          {skin === "nbme" && <span className="sim-time muted">{counts.answered} of {counts.total} answered</span>}
          {mode === "tutor" && !reviewing && <span className="sim-mode">Tutor</span>}
        </div>
        <div className="sim-bottom-right">
          {reviewing
            ? <button type="button" className="sim-bottom-btn end" onClick={onClose}><X size={14} /> Close review</button>
            : <>
              <button type="button" className="sim-bottom-btn" onClick={exam.suspend}><PauseCircle size={16} /> Suspend</button>
              <button type="button" className="sim-bottom-btn end" onClick={exam.requestEnd}><Square size={14} /> End Block</button>
            </>}
        </div>
      </footer>

      {/* ----------------------------------------------------------- overlays */}
      {navigatorOpen && skin === "nbme" && (
        <div className="sim-navigator" role="dialog" aria-label="Navigator">
          <div className="sim-panel-head"><b>Navigator</b><button type="button" onClick={() => setNavigatorOpen(false)} aria-label="Close navigator"><X size={16} /></button></div>
          <ReviewTable ids={ids} items={itemsById} entries={entries} filter="all" current={index} onPick={go} />
        </div>
      )}

      {exam.itemReview !== null && (
        <div className="sim-review" role="dialog" aria-modal="true" aria-label="Item Review">
          <div className="sim-review-card">
            <h3>Item Review</h3>
            <p>{counts.unanswered ? `${counts.unanswered} incomplete` : "All items answered"} · {counts.flagged} marked. Choose items to revisit, or end the block.</p>
            <div className="sim-review-filters" role="group" aria-label="Review filter">
              <button type="button" className={exam.itemReview === "all" ? "on" : ""} onClick={() => exam.setItemReview("all")}>Review All</button>
              <button type="button" className={exam.itemReview === "incomplete" ? "on" : ""} onClick={() => exam.setItemReview("incomplete")} disabled={!counts.unanswered}>Review Incomplete</button>
              <button type="button" className={exam.itemReview === "marked" ? "on" : ""} onClick={() => exam.setItemReview("marked")} disabled={!counts.flagged}>Review Marked</button>
            </div>
            <ReviewTable ids={ids} items={itemsById} entries={entries} filter={exam.itemReview} current={index} onPick={(position) => { exam.setItemReview(null); go(position); }} />
            <div className="sim-review-actions">
              <button type="button" className="sim-bottom-btn" onClick={() => exam.setItemReview(null)}>Return to item {index + 1}</button>
              <button type="button" className="sim-bottom-btn end" onClick={exam.finish}>End Block</button>
            </div>
          </div>
        </div>
      )}

      {exam.confirmEnd && (
        <div className="sim-review" role="alertdialog" aria-modal="true" aria-labelledby="sim-end-title">
          <div className="sim-review-card narrow">
            <h3 id="sim-end-title">End block?</h3>
            <p>
              {counts.unanswered
                ? <>You have <b>{counts.unanswered} unanswered</b> {counts.unanswered === 1 ? "item" : "items"}{counts.flagged ? <> and <b>{counts.flagged} marked</b></> : null}.</>
                : <>All {counts.total} items answered{counts.flagged ? <> · <b>{counts.flagged} marked</b></> : null}.</>}
              {" "}After ending, answers are final and your results open.
            </p>
            <div className="sim-review-actions">
              {counts.unanswered > 0 && <button type="button" className="sim-bottom-btn" onClick={() => { exam.setConfirmEnd(false); exam.setItemReview("incomplete"); }}>Review unanswered</button>}
              {counts.flagged > 0 && <button type="button" className="sim-bottom-btn" onClick={() => { exam.setConfirmEnd(false); exam.setItemReview("marked"); }}>Review marked</button>}
              <button type="button" className="sim-bottom-btn" onClick={() => exam.setConfirmEnd(false)}>Cancel</button>
              <button type="button" className="sim-bottom-btn end" onClick={exam.finish} autoFocus>End Block</button>
            </div>
          </div>
        </div>
      )}

      {exam.alarm && (
        <div className="sim-alert" role="alert">
          <AlarmClock size={18} /> <b>5 minutes remaining</b> in this block.
          <button type="button" onClick={exam.dismissAlarm} aria-label="Dismiss time alert"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

/** The item states in the shape the item review table reads. */
function legacyItems(exam: ExamBlockApi): Record<string, ExamItemState> {
  return Object.fromEntries(exam.entries.map((entry) => {
    const state = exam.block.items[entry.id];
    return [entry.id, { answerKey: state?.answerKey, marked: entry.flagged, struck: [...(state?.struck ?? [])], seconds: 0, visited: entry.visited }];
  }));
}

/** UWorld's item list: a tick or a cross once a result may be shown, a dot before. */
function sidebarState(entry: NavigatorEntry): string {
  return entry.result === "correct" ? "right" : entry.result === "incorrect" ? "wrong" : entry.answered ? "done" : "";
}

function entryWords(entry: NavigatorEntry): string {
  return entry.result === "correct" ? ", correct" : entry.result === "incorrect" ? ", incorrect" : entry.answered ? ", answered" : ", unanswered";
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

function ReviewTable({ ids, items, entries, filter, current, onPick }: {
  ids: readonly string[];
  items: Readonly<Record<string, ExamItemState>>;
  entries: readonly NavigatorEntry[];
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
        // Only a result that may be shown is named (a revealed tutor item, or a finished block in review).
        const result = entries[position]?.result;
        const words = result === "correct" ? "Correct" : result === "incorrect" ? "Incorrect" : state?.answerKey ? "Complete" : state?.visited ? "Incomplete" : "Unseen";
        return (
          <button key={ids[position]} type="button" role="listitem" className={`sim-review-cell ${position === current ? "current" : ""} ${state?.answerKey ? "" : "incomplete"} ${result === "correct" ? "right" : result === "incorrect" ? "wrong" : ""}`} onClick={() => onPick(position)}
            aria-label={`Item ${position + 1}: ${result === "correct" ? "correct" : result === "incorrect" ? "incorrect" : state?.answerKey ? "complete" : "incomplete"}${state?.marked ? ", marked" : ""}`}>
            <b>{position + 1}</b>
            <small>{words}</small>
            {result === "correct" && <Check size={13} className="sim-result ok" aria-hidden="true" />}
            {result === "incorrect" && <X size={13} className="sim-result bad" aria-hidden="true" />}
            {state?.marked && <Flag size={13} className="sim-flag" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function SimSettings({ prefs, onChange }: { prefs: ExamSimPrefs; onChange: (patch: Partial<ExamSimPrefs>) => void }) {
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
        {" "}Select text to highlight; right-click a choice to strike it out.
      </p>
    </div>
  );
}

/** Exhibits with per-image contrast and invert (USMLE 2026 image controls). */
function SimExhibits({ question }: { question: QuestionRecord }) {
  const attachments = (question.attachments ?? []).filter((asset) => asset.role === "exhibit" || asset.role && isAssetVisible(asset.role, "question"));
  const urls = useExhibitUrls(attachments);
  const [adjust, setAdjust] = useState<Record<string, { contrast: number; invert: boolean }>>({});
  const [zoomed, setZoomed] = useState<string | null>(null);
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
