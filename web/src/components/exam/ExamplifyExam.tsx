import { QuestionContent, QuestionSupportingContent } from "../questions/QuestionContent";
import { isAssetVisible } from "../../lib/question-content/visibility";
// ===========================================================================
// The Examplify (ExamSoft) interface, as a renderer over the shared exam
// block (useExamBlock). Layout, proportions, colours and behaviour follow
// ExamSoft's own published guide to the exam screen: a dark top bar with
// EXAM CONTROLS and TOOL KIT, a narrow rail of numbered circles with a
// FILTER, "Question N" with FLAG QUESTION and the highlighter, "Currently
// Selected", full-width answer pills with a tick or a strike-out eye, and a
// pale blue bottom bar with Previous and Next.
//
// It copies how the exam behaves and is laid out. It does not use ExamSoft's
// name, logo, artwork or any of its files: the mark in the top bar is AXOM's.
//
// What AXOM adds, kept apart from the exam's own controls: "Check answer" in
// tutor mode, the explanation once an answer is shown, and a read-only review
// of a finished block where the rail shows what was right and wrong. While a
// block is being sat as an exam, nothing on screen says whether an answer is
// right (lib/exam/engine: shownResult).
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AlarmClock, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Eraser, EyeOff, Flag, Highlighter, MoreHorizontal,
  MoreVertical, Paperclip, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionAnnotationTone } from "../../lib/questionAnnotations";
import { BUILD_INFO } from "../../lib/buildInfo";
import { formatClock } from "../../lib/examSim";
import { filterCounts, matchesFilter, type NavigatorEntry, type NavigatorFilter } from "../../lib/exam/engine";
import { useStore } from "../../lib/store";
import { AnnotatedQuestionText } from "../questions/AnnotatedQuestionText";
import { QuizCalculator, type QuizCalculatorValue } from "../questions/QuizCalculator";
import { AxomMark } from "../ui/BrandMark";
import { ExplanationBody, LabValuesPanel, useExhibitUrls } from "./parts";
import type { ExamBlockApi } from "./useExamBlock";
import "../../styles/exam-examplify.css";

type ToolkitTab = "tools" | "calculators" | "notes";
type FloatingWindow = "attachments" | "notices" | null;

interface Alarm {
  id: string;
  /** Block time (seconds elapsed) at which it goes off. */
  at: number;
  label: string;
}

/** The highlighter's five colours, left to right as the tool kit shows them, and the AXOM tone each one saves as. */
const HIGHLIGHTERS: ReadonlyArray<{ tone: QuestionAnnotationTone; name: string }> = [
  { tone: "red", name: "Red" },
  { tone: "yellow", name: "Yellow" },
  { tone: "green", name: "Green" },
  { tone: "cyan", name: "Blue" },
  { tone: "purple", name: "Pink" },
];

const FILTER_WORDS: Record<NavigatorFilter, string> = {
  all: "All", flagged: "Flagged", unanswered: "Unanswered", answered: "Answered", incorrect: "Incorrect", correct: "Correct",
};

export function ExamplifyExam({ exam, title, timeLimitSeconds, onClose }: {
  exam: ExamBlockApi;
  title: string;
  timeLimitSeconds?: number;
  onClose?: () => void;
}) {
  const { pool, question, index, item, entries, correctKey, revealed, result, prefs, setPrefs, tool, setTool, reviewing, profile } = exam;
  const taker = useStore((state) => state.profile.name);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<NavigatorFilter>("all");
  const [toolkit, setToolkit] = useState<ToolkitTab | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [coloursOpen, setColoursOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [floating, setFloating] = useState<FloatingWindow>(null);
  const [alarmEditor, setAlarmEditor] = useState(false);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [ringing, setRinging] = useState<Alarm[]>([]);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [calculator, setCalculator] = useState<QuizCalculatorValue>({ expression: "", result: "" });
  const railRef = useRef<HTMLOListElement>(null);

  const counts = useMemo(() => filterCounts(entries), [entries]);
  const filters: NavigatorFilter[] = reviewing ? [...profile.filters, "incorrect", "correct"] : [...profile.filters];
  const shown = entries.filter((entry) => matchesFilter(entry, filter));
  const timed = exam.remaining !== undefined;
  const clock = formatClock(exam.remaining ?? exam.elapsedSeconds);
  const anyMenu = controlsOpen || filterOpen || moreOpen;

  // A question the filter hides can still be reached by Next: show everything again rather than lose the place.
  useEffect(() => {
    if (filter !== "all" && !shown.some((entry) => entry.current)) setFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Keep the current number in view in the rail.
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView?.({ block: "nearest" });
  }, [index, filter]);

  // Alarms go off against the block clock.
  useEffect(() => {
    const due = alarms.filter((alarm) => exam.elapsedSeconds >= alarm.at);
    if (!due.length) return;
    setAlarms((current) => current.filter((alarm) => !due.includes(alarm)));
    setRinging((current) => [...current, ...due]);
  }, [alarms, exam.elapsedSeconds]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.closest("input:not([type=radio]):not([type=checkbox]):not([type=range]), textarea, select, [contenteditable='true']"));
      if (event.key === "Escape") {
        if (anyMenu) { setControlsOpen(false); setFilterOpen(false); setMoreOpen(false); event.preventDefault(); return; }
        if (alarmEditor) { setAlarmEditor(false); event.preventDefault(); return; }
        if (exam.confirmEnd) { exam.setConfirmEnd(false); event.preventDefault(); return; }
        if (floating) { setFloating(null); event.preventDefault(); return; }
        if (attachment) { setAttachment(null); event.preventDefault(); return; }
        if (toolkit) { setToolkit(null); event.preventDefault(); return; }
        return;
      }
      if (typing || exam.confirmEnd || alarmEditor || floating) return;
      if (exam.handleKey(event)) event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) return null;

  const style = { "--xfy-scale": prefs.textScale } as CSSProperties;
  const selectedWords = item.answerKey ?? "None";
  const closeMenus = () => { setControlsOpen(false); setFilterOpen(false); setMoreOpen(false); };

  function scrollRail(direction: 1 | -1) {
    railRef.current?.scrollBy?.({ top: direction * 156, behavior: "smooth" });
  }

  function addAlarm(seconds: number, from: "now" | "end") {
    const at = from === "end" && timeLimitSeconds !== undefined ? Math.max(exam.elapsedSeconds, timeLimitSeconds - seconds) : exam.elapsedSeconds + seconds;
    setAlarms((current) => [...current, { id: crypto.randomUUID(), at, label: from === "end" ? `${formatClock(seconds)} before the end` : `${formatClock(seconds)} alarm` }].sort((a, b) => a.at - b.at));
    setAlarmEditor(false);
  }

  return (
    <div ref={exam.rootRef} className={`exam-sim xfy ${reviewing ? "is-review" : ""} ${toolkit ? "has-toolkit" : ""}`} role="dialog" aria-modal="true"
      aria-label="ExamSoft (Examplify) exam simulation" tabIndex={-1} style={style} onClick={anyMenu ? closeMenus : undefined}>
      {/* ------------------------------------------------------------------ top */}
      <header className="xfy-top">
        <div className="xfy-brand" title="AXOM practice block in the Examplify layout">
          <AxomMark size={20} />
          <span className="xfy-brand-name">AXOM Exam</span>
        </div>
        {taker && <span className="xfy-taker">{taker}</span>}
        <span className="xfy-title">{title}{reviewing ? " · Review" : exam.block.mode === "tutor" ? " · Tutor" : ""}</span>

        <div className="xfy-top-right">
          {/* The exam keeps its clock at the top of the screen; an alarm sits over it. */}
          {!reviewing && (
            <div className="xfy-clock-wrap">
              <button type="button" className={`xfy-clock ${exam.lowTime ? "low" : ""}`} onClick={() => setToolkit("tools")} aria-label={`${timed ? "Time remaining" : "Time elapsed"} ${clock}. Open timers`}>
                <Clock size={15} aria-hidden="true" /> <b>{clock}</b>
              </button>
              {(exam.alarm || ringing.length > 0) && (
                <div className="xfy-alarm" role="alert">
                  <AlarmClock size={15} aria-hidden="true" />
                  <span>{exam.alarm ? "5 minutes remaining" : ringing[0].label}</span>
                  <button type="button" onClick={() => { if (exam.alarm) exam.dismissAlarm(); else setRinging((current) => current.slice(1)); }}>Dismiss alarm</button>
                </div>
              )}
            </div>
          )}
          <div className="xfy-menu-wrap">
            <button type="button" className="xfy-controls" aria-haspopup="menu" aria-expanded={controlsOpen}
              onClick={(event) => { event.stopPropagation(); setControlsOpen((open) => !open); setFilterOpen(false); setMoreOpen(false); }}>
              Exam Controls <ChevronDown size={15} aria-hidden="true" />
            </button>
            {controlsOpen && (
              <div className="xfy-menu xfy-controls-menu" role="menu" aria-label="Exam controls">
                <button type="button" role="menuitem" onClick={() => setFloating("attachments")}>Exam Attachments <span className="xfy-badge">1</span></button>
                <button type="button" role="menuitem" onClick={() => setFloating("notices")}>Exam Notices <span className="xfy-badge">1</span></button>
                {reviewing
                  ? <button type="button" role="menuitem" className="strong" onClick={onClose}>Close Review</button>
                  : <>
                    <button type="button" role="menuitem" onClick={exam.suspend}>Suspend Exam</button>
                    <button type="button" role="menuitem" className="strong" onClick={exam.requestEnd}>Submit Exam</button>
                  </>}
              </div>
            )}
          </div>
          <button type="button" className="xfy-toolkit-toggle" aria-pressed={Boolean(toolkit)} onClick={() => setToolkit((open) => (open ? null : "tools"))}>
            Tool Kit <MoreVertical size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------------------- body */}
      <div className="xfy-main">
        <nav className="xfy-rail" aria-label="Question list">
          <div className="xfy-menu-wrap">
            <button type="button" className="xfy-filter" aria-haspopup="menu" aria-expanded={filterOpen}
              onClick={(event) => { event.stopPropagation(); setFilterOpen((open) => !open); setControlsOpen(false); setMoreOpen(false); }}
              aria-label={`Filter questions. Showing ${FILTER_WORDS[filter].toLowerCase()}`}>
              Filter <ChevronRight size={14} aria-hidden="true" />
            </button>
            {filterOpen && (
              <div className="xfy-menu xfy-filter-menu" role="menu" aria-label="Show questions">
                {filters.map((option) => (
                  <button key={option} type="button" role="menuitemradio" aria-checked={filter === option} onClick={() => setFilter(option)}>
                    <Check size={15} className="xfy-menu-check" aria-hidden="true" />
                    {FILTER_WORDS[option]}{option === "all" ? "" : ` (${counts[option]})`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="xfy-rail-arrow" onClick={() => scrollRail(-1)} aria-label="Scroll the question list up"><ChevronUp size={18} /></button>
          <ol className="xfy-rail-list" ref={railRef}>
            {shown.map((entry) => (
              <li key={entry.id}>
                <button type="button" className={numberClass(entry)} onClick={() => exam.go(entry.position)} aria-current={entry.current ? "true" : undefined}
                  aria-label={`Question ${entry.position + 1}${entryWords(entry)}${entry.flagged ? ", flagged" : ""}`}>
                  <span>{entry.position + 1}</span>
                  {entry.flagged && <i className="xfy-num-flag" aria-hidden="true"><Flag size={9} fill="currentColor" /></i>}
                  {entry.result === "correct" && <i className="xfy-num-result ok" aria-hidden="true"><Check size={10} strokeWidth={3.2} /></i>}
                  {entry.result === "incorrect" && <i className="xfy-num-result bad" aria-hidden="true"><X size={10} strokeWidth={3.2} /></i>}
                </button>
              </li>
            ))}
            {!shown.length && <li className="xfy-rail-empty">None</li>}
          </ol>
          <button type="button" className="xfy-rail-arrow" onClick={() => scrollRail(1)} aria-label="Scroll the question list down"><ChevronDown size={18} /></button>
        </nav>

        <section className="xfy-question" data-exam-scroll aria-labelledby="xfy-question-heading">
          <div className="xfy-qhead">
            <button type="button" className="xfy-qtitle" id="xfy-question-heading" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}
              aria-label={`Question ${index + 1} of ${pool.length}. ${collapsed ? "Show" : "Hide"} the question text`}>
              Question {index + 1} <ChevronDown size={16} className={collapsed ? "turned" : ""} aria-hidden="true" />
            </button>
            <button type="button" className={`xfy-flag ${item.marked ? "on" : ""}`} onClick={exam.mark} disabled={reviewing} aria-pressed={item.marked}>
              {item.marked ? "Unflag question" : "Flag question"}
            </button>
            <div className="xfy-marks" role="group" aria-label="Highlighter">
              <button type="button" className={`xfy-mark-tool ${tool === "highlight" ? "on" : ""}`} aria-pressed={tool === "highlight"} aria-label="Highlight text"
                onClick={() => setTool((value) => (value === "highlight" ? null : "highlight"))}>
                <Highlighter size={17} className={`xfy-pen tone-${prefs.highlightColor}`} />
              </button>
              <button type="button" className={`xfy-mark-tool ${tool === "erase" ? "on" : ""}`} aria-pressed={tool === "erase"} aria-label="Erase highlighting"
                onClick={() => setTool((value) => (value === "erase" ? null : "erase"))}>
                <Eraser size={17} />
              </button>
              <button type="button" className="xfy-mark-tool" aria-expanded={coloursOpen} aria-label="Highlighter colours" onClick={() => setColoursOpen((open) => !open)}>
                <ChevronRight size={16} className={coloursOpen ? "turned" : ""} />
              </button>
              {coloursOpen && <ColourDots value={prefs.highlightColor} onChange={(tone) => { setPrefs({ highlightColor: tone }); setTool("highlight"); }} />}
            </div>
            <div className="xfy-menu-wrap xfy-more-wrap">
              <button type="button" className="xfy-more" aria-haspopup="menu" aria-expanded={moreOpen} aria-label="More for this question"
                onClick={(event) => { event.stopPropagation(); setMoreOpen((open) => !open); setControlsOpen(false); setFilterOpen(false); }}>
                <MoreHorizontal size={18} />
              </button>
              {moreOpen && (
                <div className="xfy-menu xfy-more-menu" role="menu">
                  <button type="button" role="menuitem" disabled={!item.struck.length || revealed} onClick={() => item.struck.forEach((key) => exam.strike(key))}>Restore struck-out choices</button>
                  <button type="button" role="menuitem" disabled={!exam.annotations.length} onClick={() => exam.annotations.forEach((annotation) => exam.onDeleteAnnotation(annotation.id))}>Clear highlighting</button>
                </div>
              )}
            </div>
          </div>

          {!collapsed && (
            <div className={`xfy-stem ${tool === "highlight" ? "tool-highlight" : ""} ${tool === "erase" ? "tool-erase" : ""}`}>
              <div aria-label={question.content ? "Question stem" : undefined} tabIndex={question.content ? -1 : undefined} ref={question.content ? exam.stemRef : undefined}><QuestionContent question={question} part="stem" fallback={<AnnotatedQuestionText
                text={question.stem}
                annotations={exam.annotations}
                className="xfy-stem-text"
                label="Question stem"
                focusRef={exam.stemRef}
                eraseMode={tool === "erase"}
                onDelete={exam.onDeleteAnnotation}
                onSelection={exam.onSelection}
              />} /></div>
            </div>
          )}
          {!question.content && (question.attachments?.length ?? 0) > 0 && <Exhibits question={question} opened={attachment} onOpen={setAttachment} />}

          <QuestionSupportingContent question={question} mode="question" />
          <p className="xfy-selected">
            <b>{revealed ? "Your Answer" : "Currently Selected"} : {selectedWords}</b>
            {revealed && correctKey && <b className="xfy-correct-line">Correct Answer : {correctKey}</b>}
          </p>

          <div className="xfy-choices" role="radiogroup" aria-label="Answer choices">
            {question.options.map((option) => {
              const selected = item.answerKey === option.key;
              const struck = item.struck.includes(option.key);
              const isCorrect = revealed && correctKey === option.key;
              const isWrong = revealed && selected && correctKey !== undefined && correctKey !== option.key;
              return (
                <div key={option.key} className={`xfy-choice ${selected ? "selected" : ""} ${struck ? "struck" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`}>
                  <button type="button" className="xfy-choice-main" role="radio" aria-checked={selected} disabled={revealed}
                    aria-label={`${option.key}. ${option.text}${struck ? " (struck out)" : ""}`} onClick={() => exam.pick(option.key)}>
                    <b>{option.key}</b>
                    <span><QuestionContent question={question} part="choice" choice={option.key} fallback={option.text} /></span>
                  </button>
                  {isCorrect ? <span className="xfy-choice-side ok" role="img" aria-label="Correct answer"><Check size={18} /></span>
                    : isWrong ? <span className="xfy-choice-side bad" role="img" aria-label="Your answer (incorrect)"><X size={18} /></span>
                    : revealed ? <span className="xfy-choice-side" aria-hidden="true" />
                    : selected ? (
                      // The tick is the exam's own "selected" mark: it says chosen, not correct.
                      <span className="xfy-choice-side chosen" aria-hidden="true"><Check size={17} /></span>
                    ) : (
                      <button type="button" className="xfy-choice-side" onClick={() => exam.strike(option.key)} aria-pressed={struck}
                        aria-label={`${struck ? "Restore" : "Strike out"} choice ${option.key}`}>
                        <EyeOff size={17} />
                      </button>
                    )}
                </div>
              );
            })}
          </div>

          {exam.block.mode === "tutor" && !reviewing && !revealed && (
            <button type="button" className="xfy-check" disabled={!item.answerKey} onClick={exam.reveal}>Check answer</button>
          )}
          {revealed && <ExplanationBody question={question} picked={item.answerKey} correctKey={correctKey} result={result} seconds={exam.seconds} />}
        </section>

        {attachment && <AttachmentPane question={question} attachmentId={attachment} number={index + 1} onClose={() => setAttachment(null)} />}

        {toolkit && (
          <aside className="xfy-toolkit" aria-label="Tool Kit">
            <div className="xfy-tabs" role="tablist" aria-label="Tool Kit">
              {(["tools", "calculators", "notes"] as ToolkitTab[]).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={toolkit === tab} className={toolkit === tab ? "on" : ""} onClick={() => setToolkit(tab)}>
                  {tab === "tools" ? "Tools" : tab === "calculators" ? "Calculators" : "Notes"}
                </button>
              ))}
            </div>
            <div className="xfy-toolkit-body">
              {toolkit === "tools" && (
                <>
                  <section>
                    <h3>Highlighter</h3>
                    <ColourDots value={prefs.highlightColor} onChange={(tone) => setPrefs({ highlightColor: tone })} />
                  </section>
                  <section>
                    <h3>Timers</h3>
                    {reviewing
                      ? <p className="xfy-timer-line"><Clock size={15} aria-hidden="true" /> {formatClock(exam.elapsedSeconds)} Time Taken</p>
                      : <p className="xfy-timer-line"><Clock size={15} aria-hidden="true" /> {clock} {timed ? "Time Remaining" : "Time Elapsed"}</p>}
                    {alarms.map((alarm) => (
                      <p key={alarm.id} className="xfy-timer-line">
                        <AlarmClock size={15} aria-hidden="true" /> {formatClock(Math.max(0, alarm.at - exam.elapsedSeconds))}
                        <button type="button" className="xfy-link" onClick={() => setAlarms((current) => current.filter((entry) => entry.id !== alarm.id))} aria-label={`Remove the ${alarm.label}`}>Remove</button>
                      </p>
                    ))}
                    {!reviewing && <button type="button" className="xfy-link xfy-add-alarm" onClick={() => setAlarmEditor(true)}><AlarmClock size={15} aria-hidden="true" /> Add Alarm</button>}
                    {!reviewing && (
                      <label className="xfy-check-row"><input type="checkbox" checked={prefs.fiveMinuteAlert} onChange={(event) => setPrefs({ fiveMinuteAlert: event.target.checked })} /> Alarm at 5 minutes remaining</label>
                    )}
                  </section>
                  <section>
                    <h3>Adjust Text Size</h3>
                    <div className="xfy-text-size">
                      <span aria-hidden="true">Aa</span>
                      <input type="range" min={1} max={2} step={0.1} value={prefs.textScale} onChange={(event) => setPrefs({ textScale: Number(event.target.value) })} aria-label="Text size" />
                      <span aria-hidden="true" className="big">Aa</span>
                    </div>
                  </section>
                </>
              )}
              {toolkit === "calculators" && <QuizCalculator onClose={() => setToolkit(null)} value={calculator} onChange={setCalculator} showClose={false} />}
              {toolkit === "notes" && (
                <textarea className="xfy-notes" value={exam.block.notes} onChange={(event) => exam.setNotes(event.target.value)} readOnly={reviewing}
                  aria-label="Exam notes" placeholder="A scratch pad for this exam. Kept if you suspend." autoFocus />
              )}
            </div>
            <button type="button" className="xfy-toolkit-close" onClick={() => setToolkit(null)}>Close Toolkit</button>
          </aside>
        )}
      </div>

      {/* --------------------------------------------------------------- bottom */}
      <footer className="xfy-bottom">
        <span className="xfy-count">{index + 1} of {pool.length} questions</span>
        <span className="xfy-version">AXOM {BUILD_INFO.version}</span>
        <div className="xfy-bottom-right">
          <button type="button" className="xfy-prev" disabled={index === 0} onClick={exam.previous}>Previous</button>
          <button type="button" className="xfy-next" disabled={index + 1 >= pool.length} onClick={exam.next}>Next</button>
        </div>
      </footer>

      {/* ------------------------------------------------------------- overlays */}
      {floating === "attachments" && (
        <FloatingPanel title="Exam Attachment" onClose={() => setFloating(null)} icon={<Paperclip size={16} />} wide>
          <LabValuesPanel autoFocus={false} />
        </FloatingPanel>
      )}
      {floating === "notices" && (
        <FloatingPanel title="Exam Notice" onClose={() => setFloating(null)}>
          <div className="xfy-notice">
            <p><b>{title}</b></p>
            <p>
              {pool.length} {pool.length === 1 ? "question" : "questions"}{timeLimitSeconds !== undefined ? `, ${Math.round(timeLimitSeconds / 60)} minutes` : ", no time limit"}.
              {" "}{exam.block.mode === "tutor" ? "Tutor: check each answer to see its explanation." : "Answers are final once you submit; results open after."}
            </p>
            <p>The lab reference values are under Exam Controls, Exam Attachments.</p>
            <p className="xfy-notice-keys">
              Keys as in the exam: <kbd>Ctrl</kbd> or <kbd>⌘</kbd> with <kbd>&gt;</kbd> next, with <kbd>&lt;</kbd> previous.
              AXOM adds <kbd>A</kbd> to <kbd>H</kbd> to choose, <kbd>Shift</kbd> with a letter to strike out, <kbd>F</kbd> to flag, and the arrow keys to move.
            </p>
          </div>
        </FloatingPanel>
      )}
      {alarmEditor && <AlarmEditor timed={timeLimitSeconds !== undefined} onCreate={addAlarm} onCancel={() => setAlarmEditor(false)} />}
      {exam.confirmEnd && <SubmitDialog exam={exam} onReview={(next) => { exam.setConfirmEnd(false); setFilter(next); }} />}
    </div>
  );
}

/** The rail's number: filled once answered, ringed when current, coloured by result only where a result may be shown. */
function numberClass(entry: NavigatorEntry): string {
  return [
    "xfy-num",
    entry.answered ? "answered" : "",
    entry.current ? "current" : "",
    entry.result === "correct" ? "right" : entry.result === "incorrect" ? "wrong" : "",
  ].filter(Boolean).join(" ");
}

function entryWords(entry: NavigatorEntry): string {
  return entry.result === "correct" ? ", correct" : entry.result === "incorrect" ? ", incorrect" : entry.answered ? ", answered" : ", unanswered";
}

function ColourDots({ value, onChange }: { value: QuestionAnnotationTone; onChange: (tone: QuestionAnnotationTone) => void }) {
  return (
    <div className="xfy-dots" role="radiogroup" aria-label="Highlighter colour">
      {HIGHLIGHTERS.map(({ tone, name }) => (
        <button key={tone} type="button" role="radio" aria-checked={value === tone} aria-label={name} className={`xfy-dot tone-${tone} ${value === tone ? "on" : ""}`} onClick={() => onChange(tone)} />
      ))}
    </div>
  );
}

/** A question's images, in the question, at their own shape. Opening one shows it beside the question, as the exam does. */
function Exhibits({ question, opened, onOpen }: { question: QuestionRecord; opened: string | null; onOpen: (id: string | null) => void }) {
  const attachments = (question.attachments ?? []).filter((asset) => asset.role === "exhibit" || asset.role && isAssetVisible(asset.role, "question"));
  const urls = useExhibitUrls(attachments);
  return (
    <div className="xfy-exhibits">
      {attachments.map((entry, position) => {
        const url = urls[entry.id];
        return url ? (
          <button key={entry.id} type="button" className="xfy-exhibit" aria-pressed={opened === entry.id} onClick={() => onOpen(opened === entry.id ? null : entry.id)}
            aria-label={`Open ${entry.altText || `image ${position + 1}`} beside the question`}>
            <img src={url} alt={entry.altText || `Question image ${position + 1}`} width={entry.width} height={entry.height} />
            <span className="xfy-exhibit-open"><ZoomIn size={14} aria-hidden="true" /> View</span>
          </button>
        ) : <div key={entry.id} className="xfy-exhibit-missing">This image is not on this device.</div>;
      })}
    </div>
  );
}

/** The exam's attachment viewer: the image beside the question, with zoom, and a bar to drag the split. */
function AttachmentPane({ question, attachmentId, number, onClose }: { question: QuestionRecord; attachmentId: string; number: number; onClose: () => void }) {
  const attachments = (question.attachments ?? []).filter((asset) => asset.role === "exhibit" || asset.role && isAssetVisible(asset.role, "question"));
  const urls = useExhibitUrls(attachments);
  const entry = attachments.find((candidate) => candidate.id === attachmentId);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(46);
  const dragging = useRef(false);
  useEffect(() => { if (!entry) onClose(); }, [entry, onClose]);
  if (!entry) return null;
  const url = urls[entry.id];

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const parent = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
    if (!parent) return;
    setWidth(Math.min(72, Math.max(26, ((parent.right - event.clientX) / parent.width) * 100)));
  }

  return (
    <aside className="xfy-attachment" style={{ width: `${width}%` }} aria-label={`Question ${number} attachment`}>
      <div className="xfy-divider" role="separator" aria-orientation="vertical" aria-label="Drag to resize the attachment" tabIndex={0}
        onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerMove={onPointerMove}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setWidth((value) => Math.min(72, value + 4));
          if (event.key === "ArrowRight") setWidth((value) => Math.max(26, value - 4));
        }} />
      <div className="xfy-attachment-head">
        <span>Question #{number} attachment</span>
        <button type="button" onClick={onClose} aria-label="Close the attachment"><X size={18} /></button>
      </div>
      <div className="xfy-viewer-bar">
        <span className="xfy-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))} aria-label="Zoom out"><ZoomOut size={16} /></button>
        <button type="button" onClick={() => setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))} aria-label="Zoom in"><ZoomIn size={16} /></button>
        <button type="button" className="xfy-link" onClick={() => setZoom(1)} disabled={zoom === 1}>Fit</button>
      </div>
      <div className="xfy-viewer">
        {url
          ? <img src={url} alt={entry.altText || `Question ${number} image`} style={{ width: `${zoom * 100}%` }} />
          : <p className="xfy-exhibit-missing">This image is not on this device.</p>}
      </div>
    </aside>
  );
}

function FloatingPanel({ title, icon, wide = false, onClose, children }: { title: string; icon?: ReactNode; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="xfy-scrim" onClick={onClose}>
      <div className={`xfy-window ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="xfy-window-head">
          {icon && <span className="xfy-window-icon" aria-hidden="true">{icon}</span>}
          <b>{title}</b>
          <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} autoFocus><X size={18} /></button>
        </div>
        <div className="xfy-window-body">{children}</div>
      </div>
    </div>
  );
}

function AlarmEditor({ timed, onCreate, onCancel }: { timed: boolean; onCreate: (seconds: number, from: "now" | "end") => void; onCancel: () => void }) {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [from, setFrom] = useState<"now" | "end">("now");
  const total = hours * 3600 + minutes * 60 + seconds;
  const field = (label: string, value: number, set: (next: number) => void, max: number) => (
    <label>
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} max={max} value={String(value).padStart(2, "0")}
        onChange={(event) => set(Math.min(max, Math.max(0, Math.floor(Number(event.target.value) || 0))))} aria-label={label === "Hrs" ? "Hours" : label === "Min" ? "Minutes" : "Seconds"} />
    </label>
  );
  return (
    <div className="xfy-scrim" onClick={onCancel}>
      <form className="xfy-window xfy-alarm-editor" role="dialog" aria-modal="true" aria-label="Add an alarm" onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); if (total > 0) onCreate(total, from); }}>
        <h3>+ Alarm</h3>
        <div className="xfy-alarm-time">
          {field("Hrs", hours, setHours, 23)}<i aria-hidden="true">:</i>{field("Min", minutes, setMinutes, 59)}<i aria-hidden="true">:</i>{field("Sec", seconds, setSeconds, 59)}
        </div>
        <div className="xfy-alarm-from" role="radiogroup" aria-label="When the alarm counts from">
          <label><input type="radio" name="xfy-alarm-from" checked={from === "now"} onChange={() => setFrom("now")} /> From this point in time</label>
          <label className={timed ? "" : "disabled"}><input type="radio" name="xfy-alarm-from" checked={from === "end"} disabled={!timed} onChange={() => setFrom("end")} /> Before end of time</label>
        </div>
        <button type="submit" className="xfy-create-alarm" disabled={total <= 0}>Create Alarm</button>
        <button type="button" className="xfy-cancel" onClick={onCancel}>Cancel</button>
      </form>
    </div>
  );
}

/** Submitting, the way the exam makes you mean it: a tick before the button works. */
function SubmitDialog({ exam, onReview }: { exam: ExamBlockApi; onReview: (filter: NavigatorFilter) => void }) {
  const [ready, setReady] = useState(false);
  const { counts } = exam;
  return (
    <div className="xfy-scrim">
      <div className="xfy-window xfy-submit" role="alertdialog" aria-modal="true" aria-labelledby="xfy-submit-title">
        <h3 id="xfy-submit-title">Submit exam?</h3>
        <p>
          You are about to close this exam. You will not be able to return to it, and your results open.
          {" "}{counts.unanswered
            ? <>You have <b>{counts.unanswered} unanswered</b> {counts.unanswered === 1 ? "question" : "questions"}{counts.flagged ? <> and <b>{counts.flagged} flagged</b></> : null}.</>
            : <>All {counts.total} questions are answered{counts.flagged ? <>, <b>{counts.flagged} flagged</b></> : null}.</>}
        </p>
        <label className="xfy-ready"><input type="checkbox" checked={ready} onChange={(event) => setReady(event.target.checked)} autoFocus /> I am ready to submit my exam</label>
        {(counts.unanswered > 0 || counts.flagged > 0) && (
          <div className="xfy-submit-links">
            {counts.unanswered > 0 && <button type="button" className="xfy-link" onClick={() => onReview("unanswered")}>Show unanswered</button>}
            {counts.flagged > 0 && <button type="button" className="xfy-link" onClick={() => onReview("flagged")}>Show flagged</button>}
          </div>
        )}
        <div className="xfy-submit-actions">
          <button type="button" className="xfy-prev" onClick={() => exam.setConfirmEnd(false)}>Return to Exam</button>
          <button type="button" className="xfy-next" disabled={!ready} onClick={exam.finish}>Submit</button>
        </div>
      </div>
    </div>
  );
}
