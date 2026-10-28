import { blockToPlainText, type QuestionBlock } from "../../lib/question-content/blocks";
import type { QuestionTextAnnotation } from "../../lib/questionAnnotations";
import type { QuestionTextSelection } from "./AnnotatedQuestionText";

// Highlights on an imported question's stem. They are saved, like every
// highlight, as offsets into the plain stem (`question.stem`), which is the
// blocks read as text and joined by a blank line. Each paragraph that can hold
// highlights carries where its words start in that stem; tables, figures and
// equations keep their own layout and are never marked.

/** Blocks whose words a person can highlight. */
const MARKABLE = new Set<QuestionBlock["type"]>(["text", "rich_text", "callout"]);

/**
 * Where each markable block's words start in the plain stem. Undefined when the
 * blocks no longer read as that stem, for example after a reviewer edited it.
 */
export function stemTextStarts(blocks: readonly QuestionBlock[], stem: string): Map<QuestionBlock, number> | undefined {
  const parts = blocks.map(blockToPlainText);
  const full = parts.filter((part) => part.length > 0).join("\n\n");
  if (full.trim() !== stem.trim()) return undefined;
  // The saved stem is trimmed; offsets before its first word are negative.
  let cursor = full.trimStart().length - full.length;
  const starts = new Map<QuestionBlock, number>();
  blocks.forEach((block, index) => {
    if (!parts[index].length) return;
    if (MARKABLE.has(block.type)) starts.set(block, cursor);
    cursor += parts[index].length + 2;
  });
  return starts.size ? starts : undefined;
}

/** A node's words as the plain stem reads them: a line break is one character. */
export function plainLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (node.nodeName === "BR") return 1;
  let length = 0;
  node.childNodes.forEach((child) => { length += plainLength(child); });
  return length;
}

function blockAt(root: Element, container: Node): HTMLElement | undefined {
  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement;
  const block = element?.closest<HTMLElement>("[data-stem-start]");
  return block && root.contains(block) ? block : undefined;
}

/** The stem offset of a point inside a markable block. */
function stemOffsetAt(root: Element, container: Node, offset: number): number | undefined {
  const block = blockAt(root, container);
  if (!block) return undefined;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(container, offset);
  return Number(block.dataset.stemStart) + plainLength(before.cloneContents());
}

/**
 * What a drag across the stem selected, in stem offsets. A drag that starts or
 * ends in a table, a figure or past the stem is held to the text it crossed.
 */
export function stemSelection(root: Element, selection: Selection | null): QuestionTextSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const crossed = [...root.querySelectorAll<HTMLElement>("[data-stem-start]")].filter((block) => range.intersectsNode(block));
  if (!crossed.length || !range.toString().trim()) return null;
  const first = crossed[0];
  const last = crossed[crossed.length - 1];
  const start = stemOffsetAt(root, range.startContainer, range.startOffset) ?? Number(first.dataset.stemStart);
  const end = stemOffsetAt(root, range.endContainer, range.endOffset) ?? Number(last.dataset.stemStart) + plainLength(last);
  return end > Math.max(0, start) ? { startOffset: Math.max(0, start), endOffset: end } : null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One highlight's place inside a block, relative to the block's first word. */
export interface BlockMark {
  id: string;
  from: number;
  to: number;
  tone: QuestionTextAnnotation["tone"];
  label: string;
}

/** The highlights that touch a block, in order and without overlaps, relative to its start. */
export function blockMarks(start: number, length: number, annotations: readonly QuestionTextAnnotation[]): BlockMark[] {
  const marks: BlockMark[] = [];
  let cursor = -Infinity;
  for (const annotation of [...annotations].sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)) {
    if (annotation.startOffset < cursor) continue;
    cursor = annotation.endOffset;
    const from = Math.max(0, annotation.startOffset - start);
    const to = Math.min(length, annotation.endOffset - start);
    if (to > from) marks.push({ id: annotation.id, from, to, tone: annotation.tone, label: annotation.exactText });
  }
  return marks;
}

/** Fill a block with its markup, then wrap each highlighted run of its text in a mark. */
export function paintBlock(block: HTMLElement, html: string, marks: readonly BlockMark[], erase: boolean): void {
  block.innerHTML = html;
  for (const mark of marks) {
    // Find the pieces first: wrapping changes the tree being walked.
    const pieces: Array<{ node: Text; from: number; to: number }> = [];
    let cursor = 0;
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        const end = cursor + text.data.length;
        if (end > mark.from && cursor < mark.to) pieces.push({ node: text, from: Math.max(0, mark.from - cursor), to: Math.min(text.data.length, mark.to - cursor) });
        cursor = end;
      } else if (node.nodeName === "BR") cursor += 1;
      else node.childNodes.forEach(walk);
    };
    walk(block);
    for (const piece of pieces) {
      if (piece.to < piece.node.data.length) piece.node.splitText(piece.to);
      const text = piece.from > 0 ? piece.node.splitText(piece.from) : piece.node;
      const element = document.createElement("mark");
      element.className = `question-highlight tone-${mark.tone}`;
      element.tabIndex = 0;
      element.setAttribute("aria-label", `Highlighted text: ${mark.label}`);
      element.setAttribute("aria-keyshortcuts", "Delete Backspace");
      element.dataset.annotationId = mark.id;
      if (erase) element.dataset.eraseActive = "true";
      text.replaceWith(element);
      element.append(text);
    }
  }
}
