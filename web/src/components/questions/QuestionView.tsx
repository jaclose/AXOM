import { useState, type ReactNode } from "react";
import { FileText, Presentation } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import type { QuizMode } from "../../lib/quiz";
import "../../styles/question-view.css";

export type QuestionView = "questions" | "slides";
const VIEW_KEY = "axom.questionView.v1";

/** A device presentation preference. It never changes the question or run. */
export function useQuestionView() {
  const [view, setView] = useState<QuestionView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === "slides" ? "slides" : "questions"; }
    catch { return "questions"; }
  });
  const [notice, setNotice] = useState("");
  function choose(next: QuestionView) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); setNotice(""); }
    catch { setNotice("This view is available now, but could not be remembered on this device."); }
  }
  return { view, choose, notice };
}

export function QuestionViewControls({ view, onChange, mode, onModeChange, notice }: {
  view: QuestionView;
  onChange: (view: QuestionView) => void;
  mode: QuizMode;
  onModeChange?: (mode: QuizMode) => void;
  notice?: string;
}) {
  return <div className="question-view-controls">
    <div className="question-view-switch" role="group" aria-label="Question view">
      <button type="button" aria-pressed={view === "questions"} onClick={() => onChange("questions")}><FileText size={ICON_SIZE.body} aria-hidden="true" />Questions</button>
      <button type="button" aria-pressed={view === "slides"} onClick={() => onChange("slides")}><Presentation size={ICON_SIZE.body} aria-hidden="true" />Slides</button>
    </div>
    <div className="question-mode-switch" role="group" aria-label="Block mode">
      {(["tutor", "exam"] as const).map(value => <button type="button" key={value}
        aria-pressed={mode === value} disabled={!onModeChange}
        aria-label={value === "tutor" ? "Tutor (feedback per question)" : "Exam (feedback at the end)"}
        onClick={() => onModeChange?.(value)}>{value === "tutor" ? "Tutor" : "Exam"}</button>)}
    </div>
    {!onModeChange && <span className="question-mode-note">{mode === "tutor" ? "Reveal after each answer" : "Reveal after the block"}</span>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

/** The very same reading/answer DOM in two layouts, with no second player. */
export function QuestionViewFrame({ view, children }: { view: QuestionView; children: ReactNode }) {
  return <div className={`question-view-frame ${view === "slides" ? "question-view-slide" : ""}`} data-question-view={view}>
    {view === "slides" && <p className="question-slide-label">Study slide</p>}
    {children}
  </div>;
}
