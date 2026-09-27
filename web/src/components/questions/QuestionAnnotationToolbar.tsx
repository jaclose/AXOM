import { Eraser } from "lucide-react";
import type { QuestionAnnotationTone } from "../../lib/questionAnnotations";
import { GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

const TONES: Array<{ tone: QuestionAnnotationTone; label: string }> = [
  { tone: "yellow", label: "Yellow" },
  { tone: "cyan", label: "Cyan" },
  { tone: "purple", label: "Purple" },
];

export function QuestionAnnotationToolbar({
  activeMode,
  onHighlightMode,
  onEraserMode,
  hasSelection,
  onHighlight,
  onClear,
  statusMessage,
}: {
  activeMode: { kind: "highlight"; tone: QuestionAnnotationTone } | { kind: "eraser" } | null;
  onHighlightMode: (tone: QuestionAnnotationTone) => void;
  onEraserMode: () => void;
  hasSelection?: boolean;
  onHighlight?: () => void;
  onClear: () => void;
  statusMessage?: string;
}) {
  return (
    <div className="question-annotation-toolbar row wrap gap6" role="toolbar" aria-label="Question annotation tools">
      <span className="field-label">Highlight</span>
      {TONES.map(({ tone, label }) => (
        <button
          type="button"
          key={tone}
          className={`annotation-tone tone-${tone} ${activeMode?.kind === "highlight" && activeMode.tone === tone ? "on" : ""}`}
          aria-label={`${label} persistent highlight`}
          aria-pressed={activeMode?.kind === "highlight" && activeMode.tone === tone}
          onClick={() => onHighlightMode(tone)}
        ><span className="sr-only">{label}</span></button>
      ))}
      <GhostButton
        className={activeMode?.kind === "eraser" ? "active-tool" : ""}
        aria-pressed={activeMode?.kind === "eraser"}
        onClick={onEraserMode}
      ><Eraser size={ICON_SIZE.body} /> Erase one</GhostButton>
      {onHighlight && <GhostButton disabled={!hasSelection} onClick={onHighlight}>Highlight selection</GhostButton>}
      <GhostButton onClick={onClear}>Clear highlights</GhostButton>
      <span className="sub">
        {activeMode?.kind === "highlight"
          ? "Highlight mode is active. Select text to mark it."
          : activeMode?.kind === "eraser"
            ? "Eraser is active. Choose one highlighted phrase."
            : "Choose a color or eraser. Escape turns the active tool off."}
      </span>
      {statusMessage && <span className="sub" role="status" aria-live="polite">{statusMessage}</span>}
    </div>
  );
}
