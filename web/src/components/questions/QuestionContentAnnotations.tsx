import { createElement, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { reconcileTextAnnotation, type QuestionTextAnnotation } from "../../lib/questionAnnotations";
import { blockToPlainText, sanitizeRichText } from "../../lib/question-content/blocks";
import type { QuestionTextSelection } from "./AnnotatedQuestionText";

export interface ContentAnnotationControls {
  annotations: QuestionTextAnnotation[];
  label: string;
  focusRef?: MutableRefObject<HTMLDivElement | null>;
  onSelection?: (selection: QuestionTextSelection | null) => void;
  onDelete?: (id: string) => void;
  eraseMode?: boolean;
}

/** Each text leaf carries its position in blocksToPlainText, including the gaps
 * for tables and images. DOM whitespace and figure labels are never offsets. */
export function useContentAnnotations(text: string, controls?: ContentAnnotationControls) {
  const root = useRef<HTMLDivElement | null>(null);
  const reconciled = useMemo(() => (controls?.annotations ?? []).map(mark => reconcileTextAnnotation(mark, text)), [controls?.annotations, text]);
  const active = reconciled.filter(mark => mark.status === "active");
  const repair = reconciled.filter(mark => mark.status === "needs-repair");

  function renderText(value: string, start: number): ReactNode {
    if (!controls) return value;
    const marks = active.filter(mark => mark.endOffset > start && mark.startOffset < start + value.length)
      .sort((a, b) => a.startOffset - b.startOffset);
    const pieces: ReactNode[] = [];
    let cursor = 0;
    for (const mark of marks) {
      const from = Math.max(cursor, mark.startOffset - start);
      const to = Math.min(value.length, mark.endOffset - start);
      if (to <= from) continue;
      if (from > cursor) pieces.push(value.slice(cursor, from));
      pieces.push(<mark key={`${mark.id}:${from}`} className={`question-highlight tone-${mark.tone}`}
        data-annotation-id={mark.id} data-erase-active={controls.eraseMode || undefined}
        tabIndex={0} aria-label={`Highlighted text: ${value.slice(from, to)}`} aria-keyshortcuts="Delete Backspace"
        onClick={event => {
          if (controls.eraseMode && window.getSelection()?.isCollapsed !== false) {
            event.stopPropagation(); controls.onDelete?.(mark.id);
          }
        }}
        onKeyDown={event => {
          if (controls.onDelete && (event.key === "Delete" || event.key === "Backspace" || (controls.eraseMode && (event.key === "Enter" || event.key === " ")))) {
            event.preventDefault(); event.stopPropagation(); controls.onDelete(mark.id);
            window.setTimeout(() => root.current?.focus(), 0);
          }
        }}>{value.slice(from, to)}</mark>);
      cursor = to;
    }
    if (cursor < value.length) pieces.push(value.slice(cursor));
    return <span data-question-text-start={start}>{pieces}</span>;
  }

  function renderRich(html: string, start: number): ReactNode {
    // Parse only the renderer's existing allowlist. Decode text with the same
    // canonical serializer, including literal unknown entities and notation.
    const tokens = sanitizeRichText(html).split(/(<\/?(?:b|strong|i|em|u|sub|sup|br)>)/g).filter(Boolean);
    let cursor = start;
    let index = 0;
    function read(closing?: string): ReactNode[] {
      const nodes: ReactNode[] = [];
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token === `</${closing}>`) break;
        const tag = token.match(/^<(b|strong|i|em|u|sub|sup)>$/)?.[1];
        if (tag) nodes.push(createElement(tag, { key: `${index}:${cursor}` }, read(tag)));
        else if (!/^<\//.test(token)) {
          const value = blockToPlainText({ type: "rich_text", html: token });
          nodes.push(<span key={`${index}:${cursor}`}>{renderText(value, cursor)}</span>);
          cursor += value.length;
        }
      }
      return nodes;
    }
    return read();
  }

  function captureSelection() {
    if (!controls?.onSelection) return;
    const selection = window.getSelection();
    if (!root.current || !selection || selection.isCollapsed || !selection.rangeCount) { controls.onSelection(null); return; }
    const selected = selection.getRangeAt(0);
    if (!root.current.contains(selected.commonAncestorContainer)) { controls.onSelection(null); return; }
    const compare = (a: Node, aOffset: number, b: Node, bOffset: number) => {
      const left = document.createRange(); left.setStart(a, aOffset); left.collapse(true);
      const right = document.createRange(); right.setStart(b, bOffset); right.collapse(true);
      return left.compareBoundaryPoints(Range.START_TO_START, right);
    };
    let startOffset: number | undefined;
    let endOffset: number | undefined;
    for (const leaf of root.current.querySelectorAll<HTMLElement>("[data-question-text-start]")) {
      const range = document.createRange(); range.selectNodeContents(leaf);
      if (compare(selected.startContainer, selected.startOffset, range.startContainer, range.startOffset) > 0) range.setStart(selected.startContainer, selected.startOffset);
      // An intersection must end after it starts; test before setting either
      // bound so Range's automatic collapse cannot manufacture a selection.
      const endNode = compare(selected.endContainer, selected.endOffset, leaf, leaf.childNodes.length) < 0 ? selected.endContainer : leaf;
      const end = endNode === leaf ? leaf.childNodes.length : selected.endOffset;
      if (!leaf.contains(range.startContainer) || compare(range.startContainer, range.startOffset, endNode, end) >= 0) continue;
      range.setEnd(endNode, end);
      if (!leaf.contains(range.endContainer) || !range.toString().length) continue;
      const before = document.createRange(); before.selectNodeContents(leaf); before.setEnd(range.startContainer, range.startOffset);
      const from = Number(leaf.dataset.questionTextStart) + before.toString().length;
      startOffset ??= from;
      endOffset = from + range.toString().length;
    }
    controls.onSelection(startOffset !== undefined && endOffset !== undefined && text.slice(startOffset, endOffset).trim()
      ? { startOffset, endOffset } : null);
  }

  return {
    renderText, renderRich,
    rootProps: controls ? {
      ref: (node: HTMLDivElement | null) => { root.current = node; if (controls.focusRef) controls.focusRef.current = node; },
      tabIndex: controls.focusRef ? -1 : 0, "aria-label": controls.label,
      onMouseUp: captureSelection, onKeyUp: captureSelection, onTouchEnd: captureSelection,
      style: { userSelect: "text" as const, WebkitUserSelect: "text" as const },
    } : {},
    repairNotice: repair.length > 0 && <span className="annotation-repair-status" role="status">{repair.length} highlights need repair: {repair.map(mark => mark.exactText).join(", ")}</span>,
  };
}
