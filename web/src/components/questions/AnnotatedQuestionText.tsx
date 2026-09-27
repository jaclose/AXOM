import { useMemo, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import {
  reconcileTextAnnotation,
  type QuestionTextAnnotation,
} from "../../lib/questionAnnotations";

export interface QuestionTextSelection {
  startOffset: number;
  endOffset: number;
}

export function AnnotatedQuestionText({
  text,
  annotations,
  className,
  label,
  focusRef,
  onSelection,
  onDelete,
  eraseMode = false,
  inline = false,
}: {
  text: string;
  annotations: QuestionTextAnnotation[];
  className?: string;
  label: string;
  focusRef?: MutableRefObject<HTMLDivElement | null>;
  onSelection?: (selection: QuestionTextSelection | null) => void;
  onDelete?: (annotationId: string) => void;
  eraseMode?: boolean;
  inline?: boolean;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const reconciledAll = useMemo(() => annotations
    .map((annotation) => reconcileTextAnnotation(annotation, text)), [annotations, text]);
  const reconciled = reconciledAll
    .filter((annotation) => annotation.status === "active")
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
  const needsRepair = reconciledAll.filter((annotation) => annotation.status === "needs-repair");

  function captureSelection() {
    if (!onSelection) return;
    const root = localRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      onSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      onSelection(null);
      return;
    }
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const endOffset = startOffset + range.toString().length;
    onSelection(endOffset > startOffset && range.toString().trim()
      ? { startOffset, endOffset }
      : null);
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const annotation of reconciled) {
    if (annotation.startOffset < cursor) continue;
    if (annotation.startOffset > cursor) segments.push(text.slice(cursor, annotation.startOffset));
    segments.push(
      <mark
        key={annotation.id}
        className={`question-highlight tone-${annotation.tone}`}
        tabIndex={0}
        aria-label={`Highlighted text: ${annotation.exactText}`}
        aria-keyshortcuts="Delete Backspace"
        data-annotation-id={annotation.id}
        data-erase-active={eraseMode || undefined}
        onClick={() => {
          if (eraseMode && onDelete) onDelete(annotation.id);
        }}
        onKeyDown={(event) => {
          if (onDelete && (event.key === "Delete" || event.key === "Backspace" || (eraseMode && (event.key === "Enter" || event.key === " ")))) {
            event.preventDefault();
            onDelete(annotation.id);
            window.setTimeout(() => localRef.current?.focus(), 0);
          }
        }}
      >
        {text.slice(annotation.startOffset, annotation.endOffset)}
      </mark>,
    );
    cursor = annotation.endOffset;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));

  const common = {
    ref: (node: HTMLDivElement | HTMLSpanElement | null) => {
      localRef.current = node as HTMLDivElement | null;
      if (focusRef) focusRef.current = node as HTMLDivElement | null;
    },
    className,
    tabIndex: focusRef ? -1 : onSelection || onDelete ? 0 : undefined,
    "aria-label": label,
    onMouseUp: captureSelection,
    onKeyUp: captureSelection,
  };
  return inline ? (
    <span {...common}>
      {segments}
      {needsRepair.length > 0 && (
        <span className="annotation-repair-status" role="status">
          {needsRepair.length} highlight{needsRepair.length === 1 ? "" : "s"} need repair: {needsRepair.map((item) => item.exactText).join(", ")}
        </span>
      )}
    </span>
  ) : (
    <div
      {...common}
    >
      {segments}
      {needsRepair.length > 0 && (
        <span className="annotation-repair-status" role="status">
          {needsRepair.length} highlight{needsRepair.length === 1 ? "" : "s"} need repair: {needsRepair.map((item) => item.exactText).join(", ")}
        </span>
      )}
    </div>
  );
}
