import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { reconcileTextAnnotation, type QuestionTextAnnotation } from "../../lib/questionAnnotations";
import { blockToPlainText, blocksToPlainText, sanitizeRichText, type AssetRole, type QuestionBlock, type TableBlock } from "../../lib/question-content/blocks";
import type { PackageQuestion, QuestionAsset } from "../../lib/question-content/package";
import { effectiveRole, isAssetVisible, visibleBlocks, type ContentViewMode } from "../../lib/question-content/visibility";
import type { QuestionRecord } from "../../lib/questions";
import { Modal } from "../ui/Modal";
import type { QuestionTextSelection } from "./AnnotatedQuestionText";
import { blockMarks, escapeHtml, paintBlock, stemSelection, stemTextStarts, type BlockMark } from "./stemMarks";
import "../../styles/question-content.css";

function Rich({ value }: { value: string }) {
  return <span dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }} />;
}

function ContentTable({ block }: { block: TableBlock }) {
  const rows = [...(block.headers ? [block.headers] : []), ...block.rows];
  const renderRow = (row: string[], rowIndex: number) => <tr key={rowIndex}>
    {block.rowKeys && <th scope="row">{rowIndex === 0 && block.headers ? "" : block.rowKeys[rowIndex - (block.headers ? 1 : 0)]}</th>}
    {row.map((cell, column) => {
      const merge = block.merges?.find((entry) => entry.row === rowIndex && entry.column === column);
      const covered = block.merges?.some((entry) => (entry.row !== rowIndex || entry.column !== column) && rowIndex >= entry.row && rowIndex < entry.row + entry.rowSpan && column >= entry.column && column < entry.column + entry.columnSpan);
      if (covered) return null;
      const Tag = rowIndex === 0 && block.headers || block.rowHeaders && column === 0 ? "th" : "td";
      return <Tag key={column} rowSpan={merge?.rowSpan} colSpan={merge?.columnSpan}>{block.rich ? <Rich value={cell} /> : cell}</Tag>;
    })}
  </tr>;
  return <div className="qcontent-table-scroll" tabIndex={0} aria-label={block.caption ?? "Question table"}>
    <table>{block.caption && <caption>{block.caption}</caption>}{block.headers && <thead>{renderRow(rows[0], 0)}</thead>}
      <tbody>{rows.slice(block.headers ? 1 : 0).map((row, index) => renderRow(row, index + (block.headers ? 1 : 0)))}</tbody>
    </table>
  </div>;
}

function ContentImage({ asset, attachment, files, alt, enlarge }: {
  asset: QuestionAsset; attachment?: QuestionImageAttachment; files?: readonly File[]; alt: string; enlarge: boolean;
}) {
  const file = files?.find((entry) => entry.name === asset.filename);
  // A reused asset ID across questions must never display the prior figure
  // during the render before React runs cleanup for its asynchronous loader.
  // Include both source identity and the actual selected File object.
  const identity = [
    asset.id, asset.filename, asset.checksum ?? "",
    attachment?.blobKey ?? "", attachment?.assetId ?? "", attachment?.updatedAt ?? "",
    file?.name ?? "", file?.size ?? "", file?.lastModified ?? "",
  ].join("|");
  const [loaded, setLoaded] = useState<{
    identity: string; asset: QuestionAsset; file?: File; url?: string; missing: boolean;
  }>(() => ({ identity, asset, file, missing: false }));
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const current = loaded.identity === identity && loaded.asset === asset && loaded.file === file ? loaded : undefined;
  const url = current?.url;
  const missing = current?.missing ?? false;
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoaded({ identity, asset, file, missing: false });
    setOpen(false);
    void (async () => {
      const blob = file ?? (attachment ? (await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined))?.blob : undefined);
      if (cancelled) return;
      if (!blob) { setLoaded({ identity, asset, file, missing: true }); return; }
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ identity, asset, file, url: objectUrl, missing: false });
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [identity, asset, file, attachment, retry]);
  const crop = asset.crop;
  const width = Math.max(.01, 1 - (crop?.left ?? 0) - (crop?.right ?? 0));
  const height = Math.max(.01, 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0));
  const picture = url && <span className="qcontent-crop" style={crop ? { aspectRatio: `${(asset.width ?? 1) * width} / ${(asset.height ?? 1) * height}` } : undefined}>
    <img src={url} alt={alt} style={crop ? { width: `${100 / width}%`, maxWidth: "none", position: "absolute", left: `${-100 * crop.left / width}%`, top: `${-100 * crop.top / height}%` } : undefined} />
  </span>;
  if (missing) return <span className="qcontent-missing" role="status">This figure is not available on this device yet. Reconnect or restore a media backup. <button type="button" className="gbtn" onClick={() => { setLoaded({ identity, asset, file, missing: false }); setRetry((value) => value + 1); }}>Try loading figure again</button></span>;
  if (!url) return <span role="status">Loading figure…</span>;
  return <>
    {enlarge ? <button type="button" className="qcontent-image" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>{picture}</button> : <span className="qcontent-image">{picture}</span>}
    {open && <Modal title={alt} onClose={() => setOpen(false)} className="qcontent-enlarged">{picture}</Modal>}
  </>;
}

/** Where the stem's paragraphs sit in the plain stem, and the highlights to draw on them. */
interface StemMarking {
  starts: ReadonlyMap<QuestionBlock, number>;
  annotations: readonly QuestionTextAnnotation[];
  erase: boolean;
}

function MarkedBlock({ html, start, length, marking, className }: {
  html: string; start: number; length: number; marking: StemMarking; className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  // Repaint only when this paragraph's highlights change, never on a parent's
  // re-render (a ticking timer), which would drop a drag in progress.
  const plan = JSON.stringify(blockMarks(start, length, marking.annotations));
  const { erase } = marking;
  useLayoutEffect(() => {
    if (ref.current) paintBlock(ref.current, html, length, JSON.parse(plan) as BlockMark[], erase);
  }, [html, length, plan, erase]);
  return <p ref={ref} className={className} data-stem-start={start} />;
}

export function QuestionBlocks({ blocks, content, attachments, files, mode, section = "stem", enlarge = true, marking }: {
  blocks: readonly QuestionBlock[]; content: PackageQuestion; attachments?: readonly QuestionImageAttachment[]; files?: readonly File[];
  mode: ContentViewMode; section?: AssetRole; enlarge?: boolean; marking?: StemMarking;
}) {
  const assets = new Map(content.assets.map((asset) => [asset.id, asset]));
  const shown = visibleBlocks(blocks, mode, (block) => effectiveRole(block.role, assets.get(block.assetId)?.role, section));
  const marked = (block: QuestionBlock, key: number, html: string, plain: string, className?: string) => {
    const start = marking?.starts.get(block);
    return marking && start !== undefined
      ? <MarkedBlock key={key} html={html} start={start} length={plain.length} marking={marking} className={className} />
      : undefined;
  };
  return <div className="qcontent-blocks" data-study-text="source-content">{shown.map((block, index) => {
    switch (block.type) {
      case "text": return marked(block, index, escapeHtml(block.text), block.text) ?? <p key={index}>{block.text}</p>;
      case "rich_text": return marked(block, index, sanitizeRichText(block.html), blockToPlainText(block)) ?? <p key={index}><Rich value={block.html} /></p>;
      case "table": return <ContentTable key={index} block={block} />;
      case "equation": return <p key={index} className="qcontent-equation">{block.plainText ?? block.latex}</p>;
      case "callout": return marked(block, index, escapeHtml(block.text), block.text, "qcontent-callout") ?? <p key={index} className="qcontent-callout">{block.text}</p>;
      case "divider": return <hr key={index} />;
      case "image": {
        const asset = assets.get(block.assetId);
        return asset ? <figure key={asset.id} data-asset-role={effectiveRole(block.role, asset.role, section)} data-asset-derivation={asset.derivation}>
          <ContentImage asset={asset} files={files} attachment={attachments?.find((entry) => entry.assetId === asset.id)} alt={block.alt ?? block.caption ?? "Question figure"} enlarge={enlarge} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure> : <p key={index} role="status">A required figure is missing.</p>;
      }
    }
  })}</div>;
}

/** The stem's highlights and the handlers an exam passes to AnnotatedQuestionText. */
export interface StemAnnotations {
  annotations: readonly QuestionTextAnnotation[];
  onSelection?: (selection: QuestionTextSelection | null) => void;
  onDelete?: (annotationId: string) => void;
  eraseMode?: boolean;
}

const markId = (target: EventTarget): string | undefined =>
  (target instanceof Element ? target.closest("mark[data-annotation-id]")?.getAttribute("data-annotation-id") : null) ?? undefined;

/** An imported stem that takes highlights the way plain stem text does: drag to mark, drag across a mark to grow it. */
function AnnotatedStem({ question, content, blocks, mode, annotate }: {
  question: QuestionRecord; content: PackageQuestion; blocks: readonly QuestionBlock[]; mode: ContentViewMode; annotate: StemAnnotations;
}) {
  const root = useRef<HTMLDivElement>(null);
  const stem = question.stem;
  const starts = useMemo(() => stemTextStarts(blocks, stem), [blocks, stem]);
  const reconciled = useMemo(() => annotate.annotations.map((annotation) => reconcileTextAnnotation(annotation, stem)), [annotate.annotations, stem]);
  const active = useMemo(() => reconciled.filter((annotation) => annotation.status === "active"), [reconciled]);
  const needsRepair = reconciled.filter((annotation) => annotation.status === "needs-repair");
  const { onSelection, onDelete, eraseMode = false } = annotate;
  function capture() {
    if (!onSelection || !root.current) return;
    const range = stemSelection(root.current, window.getSelection());
    if (!range) { onSelection(null); return; }
    let { startOffset, endOffset } = range;
    while (startOffset < endOffset && /\s/.test(stem[startOffset] ?? "")) startOffset += 1;
    while (endOffset > startOffset && /\s/.test(stem[endOffset - 1] ?? "")) endOffset -= 1;
    onSelection(endOffset > startOffset ? { startOffset, endOffset: Math.min(endOffset, stem.length) } : null);
  }
  const blocksView = <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} section="stem"
    marking={starts && { starts, annotations: active, erase: eraseMode }} />;
  if (!starts) return blocksView;
  return <div ref={root} className="qcontent-annotated" tabIndex={-1}
    onMouseUp={capture} onKeyUp={capture} onTouchEnd={capture}
    onClick={(event) => {
      const id = markId(event.target);
      if (id && eraseMode && onDelete && window.getSelection()?.isCollapsed !== false) onDelete(id);
    }}
    onKeyDown={(event) => {
      const id = markId(event.target);
      if (id && onDelete && (event.key === "Delete" || event.key === "Backspace" || (eraseMode && (event.key === "Enter" || event.key === " ")))) {
        event.preventDefault();
        onDelete(id);
        window.setTimeout(() => root.current?.focus(), 0);
      }
    }}>
    {blocksView}
    {needsRepair.length > 0 && <span className="annotation-repair-status" role="status">
      {needsRepair.length} highlight{needsRepair.length === 1 ? "" : "s"} need repair: {needsRepair.map((item) => item.exactText).join(", ")}
    </span>}
  </div>;
}

/** Edited legacy text wins over source wording. Required source figures still render. */
export function QuestionContent({ question, part, choice, mode = "question", fallback, annotate }: {
  question: QuestionRecord; part: "stem" | "choice" | "explanation"; choice?: string; mode?: ContentViewMode; fallback: ReactNode;
  /** Stem highlights: an unedited imported stem takes them on its own paragraphs; an edited one through `fallback`. */
  annotate?: StemAnnotations;
}) {
  const content = question.content;
  if (!content) return fallback;
  const blocks = part === "stem" ? content.stem : part === "explanation" ? content.explanation ?? [] : content.choices.find((entry) => entry.label === choice)?.blocks ?? [];
  const plain = part === "stem" ? question.stem : part === "explanation" ? question.explanation ?? "" : question.options.find((entry) => entry.key === choice)?.text ?? "";
  if (!blocks.length) return fallback;
  if (blocksToPlainText(blocks).trim() !== plain.trim()) {
    // `content` is immutable source evidence while the legacy text fields are
    // reviewer-editable. Do not restore stale source wording after an edit, but
    // also do not let that text override silently remove a required figure from
    // an otherwise scoreable question. Visibility still runs through the same
    // role gate, so answer-reveal and explanation media cannot leak early.
    const sourceFigures = blocks.filter((block) => block.type === "image");
    return <>{fallback}{sourceFigures.length > 0 && <QuestionBlocks
      blocks={sourceFigures} content={content} attachments={question.attachments}
      mode={mode} section={part} enlarge={part !== "choice"}
    />}</>;
  }
  if (part === "stem" && annotate) return <AnnotatedStem question={question} content={content} blocks={blocks} mode={mode} annotate={annotate} />;
  return <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} section={part} enlarge={part !== "choice"} />;
}

export function QuestionSupportingContent({ question, mode }: { question: QuestionRecord; mode: ContentViewMode }) {
  const content = question.content;
  if (!content) return null;
  const placed = new Set([content.stem, content.explanation ?? [], ...content.choices.map((choice) => choice.blocks)].flat().flatMap((block) => block.type === "image" ? [block.assetId] : []));
  const blocks: QuestionBlock[] = [
    ...(content.choiceTable && mode === "question" ? [content.choiceTable] : []),
    ...content.assets.filter((asset) => !placed.has(asset.id) && isAssetVisible(asset.role, mode) && (mode !== "answered" || !isAssetVisible(asset.role, "question"))).map((asset): QuestionBlock => ({ type: "image", assetId: asset.id, role: asset.role, alt: asset.role === "answer_reveal" ? "Source answer slide" : "Source figure" })),
  ];
  if (!blocks.length) return null;
  const teachingVisual = mode !== "question" && blocks.some((block) => block.type === "image");
  if (teachingVisual) return <section className="question-teaching-visuals" aria-label="Teaching visuals" data-study-media="answer-support">
    <span className="field-label">Visual explanation</span>
    <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} />
  </section>;
  return <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} />;
}
