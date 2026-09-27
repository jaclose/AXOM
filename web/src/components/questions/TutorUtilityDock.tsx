import { useEffect, useRef } from "react";
import { Calculator, CircleHelp, Eraser, Highlighter, Minus, Plus, RotateCcw, StickyNote, Type, X } from "lucide-react";
import type { QuestionAnnotationTone } from "../../lib/questionAnnotations";
import { ICON_SIZE } from "../../lib/iconSize";
import { GhostButton } from "../ui/primitives";
import { QuestionAnnotationToolbar } from "./QuestionAnnotationToolbar";
import { QuestionNotesPanel } from "./QuestionNotesPanel";
import { QuizCalculator, type QuizCalculatorValue } from "./QuizCalculator";

export type TutorPanel = "highlight" | "calculator" | "notes" | "text" | "help";
export type AnnotationTool = { kind: "highlight"; tone: QuestionAnnotationTone } | { kind: "eraser" } | null;

export function TutorUtilityDock({
  activePanel,
  setActivePanel,
  annotationTool,
  setAnnotationTool,
  annotationStatus,
  hasAnnotations,
  onClearAnnotations,
  questionId,
  note,
  onSaveNote,
  calculator,
  onCalculatorChange,
  readingScale,
  readingScaleMin,
  readingScaleMax,
  onReadingScale,
  onResetReadingScale,
  tipVisible,
  onDismissTip,
  onResetTips,
}: {
  activePanel: TutorPanel | null;
  setActivePanel: (panel: TutorPanel | null) => void;
  annotationTool: AnnotationTool;
  setAnnotationTool: (tool: AnnotationTool) => void;
  annotationStatus?: string;
  hasAnnotations: boolean;
  onClearAnnotations: () => void;
  questionId: string;
  note?: string;
  onSaveNote: (value: string) => void;
  calculator: QuizCalculatorValue;
  onCalculatorChange: (value: QuizCalculatorValue) => void;
  readingScale: number;
  readingScaleMin: number;
  readingScaleMax: number;
  onReadingScale: (direction: 1 | -1) => void;
  onResetReadingScale: () => void;
  tipVisible: boolean;
  onDismissTip: () => void;
  onResetTips: () => void;
}) {
  const launcherRefs = useRef(new Map<TutorPanel, HTMLButtonElement>());
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (activePanel) panelRef.current?.focus();
  }, [activePanel]);

  function togglePanel(panel: TutorPanel) {
    if (activePanel === panel) {
      setActivePanel(null);
      window.setTimeout(() => launcherRefs.current.get(panel)?.focus(), 0);
    } else {
      setActivePanel(panel);
    }
  }

  function closePanel() {
    const previous = activePanel;
    setActivePanel(null);
    if (previous) window.setTimeout(() => launcherRefs.current.get(previous)?.focus(), 0);
  }

  const launcher = (panel: TutorPanel, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      ref={(node) => { if (node) launcherRefs.current.set(panel, node); }}
      className={`tutor-tool-launcher ${activePanel === panel ? "on" : ""}`}
      aria-label={label}
      aria-pressed={activePanel === panel}
      aria-controls={activePanel === panel ? "tutor-utility-panel" : undefined}
      onClick={() => togglePanel(panel)}
    >
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <aside className="tutor-utility-dock" aria-label="Tutor tools">
      <div className="tutor-tool-launchers" role="toolbar" aria-label="Tutor utility tools">
        {launcher("highlight", "Highlight tools", <Highlighter size={ICON_SIZE.body} />)}
        <button
          type="button"
          className={`tutor-tool-launcher ${annotationTool?.kind === "eraser" ? "on" : ""}`}
          aria-label="Erase highlights"
          aria-pressed={annotationTool?.kind === "eraser"}
          onClick={() => setAnnotationTool(annotationTool?.kind === "eraser" ? null : { kind: "eraser" })}
        ><Eraser size={ICON_SIZE.body} /><span>Eraser</span></button>
        {launcher("calculator", "Calculator", <Calculator size={ICON_SIZE.body} />)}
        {launcher("notes", "Question notes", <StickyNote size={ICON_SIZE.body} />)}
        {launcher("text", "Text settings", <Type size={ICON_SIZE.body} />)}
        {launcher("help", "Tutor tips", <CircleHelp size={ICON_SIZE.body} />)}
      </div>

      {tipVisible && (
        <div className="tutor-first-tip" role="status">
          <span>Highlight stays active for repeated selections. Calculator, notes, and text controls now open beside the question.</span>
          <GhostButton onClick={onDismissTip}>Got it</GhostButton>
        </div>
      )}

      {activePanel && (
        <section
          ref={panelRef}
          id="tutor-utility-panel"
          className="tutor-utility-panel"
          aria-label={`${activePanel} tools`}
          tabIndex={-1}
        >
          <div className="tutor-utility-head">
            <b>{panelTitle(activePanel)}</b>
            <GhostButton className="icon-only" aria-label={`Close ${activePanel} tools`} onClick={closePanel}>
              <X size={ICON_SIZE.body} />
            </GhostButton>
          </div>
          {activePanel === "highlight" && (
            <QuestionAnnotationToolbar
              activeMode={annotationTool}
              onHighlightMode={(tone) => setAnnotationTool(annotationTool?.kind === "highlight" && annotationTool.tone === tone ? null : { kind: "highlight", tone })}
              onEraserMode={() => setAnnotationTool(annotationTool?.kind === "eraser" ? null : { kind: "eraser" })}
              onClear={onClearAnnotations}
              statusMessage={annotationStatus}
            />
          )}
          {activePanel === "calculator" && (
            <QuizCalculator onClose={closePanel} value={calculator} onChange={onCalculatorChange} showClose={false} />
          )}
          {activePanel === "notes" && (
            <QuestionNotesPanel questionId={questionId} value={note} onSave={onSaveNote} />
          )}
          {activePanel === "text" && (
            <div className="tutor-text-settings" role="group" aria-label="Question text size">
              <GhostButton aria-label="Decrease reading size" disabled={readingScale <= readingScaleMin} onClick={() => onReadingScale(-1)}>
                <Minus size={ICON_SIZE.body} /> Smaller
              </GhostButton>
              <GhostButton aria-label="Reset reading size" disabled={readingScale === 1} onClick={onResetReadingScale}>
                <RotateCcw size={ICON_SIZE.body} /> Reset
              </GhostButton>
              <GhostButton aria-label="Increase reading size" disabled={readingScale >= readingScaleMax} onClick={() => onReadingScale(1)}>
                <Plus size={ICON_SIZE.body} /> Larger
              </GhostButton>
              <span className="sub" role="status">{Math.round(readingScale * 100)}% question text</span>
            </div>
          )}
          {activePanel === "help" && (
            <div className="tutor-help-copy">
              <p><b>Highlight:</b> choose a color, then select as many stem or explanation phrases as needed. Press Escape to turn the tool off.</p>
              <p><b>Eraser:</b> activate it and choose one marked phrase. Clear all is a separate confirmed action.</p>
              <p><b>Notes:</b> question notes autosave locally. Text size is a device preference.</p>
              <GhostButton onClick={onResetTips}>Show first-use tip again</GhostButton>
            </div>
          )}
          {activePanel === "highlight" && !hasAnnotations && <span className="sub">No saved highlights on this question yet.</span>}
        </section>
      )}
    </aside>
  );
}

function panelTitle(panel: TutorPanel) {
  if (panel === "highlight") return "Highlight and erase";
  if (panel === "calculator") return "Calculator";
  if (panel === "notes") return "Question notes";
  if (panel === "text") return "Text settings";
  return "Tutor tips";
}
