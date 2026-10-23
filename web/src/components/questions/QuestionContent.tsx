import { useEffect, useState, type ReactNode } from "react";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { blockToPlainText, blocksToPlainText, sanitizeRichText, type AssetRole, type QuestionBlock, type TableBlock } from "../../lib/question-content/blocks";
import type { PackageQuestion, QuestionAsset } from "../../lib/question-content/package";
import { effectiveRole, isAssetVisible, visibleBlocks, type ContentViewMode } from "../../lib/question-content/visibility";
import type { QuestionRecord } from "../../lib/questions";
import { Modal } from "../ui/Modal";
import "../../styles/question-content.css";
import { useContentAnnotations, type ContentAnnotationControls } from "./QuestionContentAnnotations";

function Rich({ value }: { value: string }) {
  return <span dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }} />;
}

function ContentTable({ block, start = 0, text, rich }: { block: TableBlock; start?: number;
  text?: (value: string, offset: number) => ReactNode; rich?: (value: string, offset: number) => ReactNode;
}) {
  let cursor = start + (block.caption ? block.caption.length + 1 : 0);
  const offsets = [...(block.headers ? [block.headers] : []), ...block.rows].map((row, index) => {
    const key = block.rowKeys ? (index === 0 && block.headers ? "" : block.rowKeys[index - (block.headers ? 1 : 0)] ?? "") : undefined;
    const rowStart = cursor;
    if (key !== undefined) cursor += key.length + 3;
    const cells = row.map((cell, column) => {
      const offset = cursor;
      cursor += (block.rich ? blockToPlainText({ type: "rich_text", html: cell }) : cell).length + (column < row.length - 1 ? 3 : 0);
      return offset;
    });
    cursor += 1;
    return { rowStart, key, cells };
  });
  const rows = [...(block.headers ? [block.headers] : []), ...block.rows];
  const renderRow = (row: string[], rowIndex: number) => <tr key={rowIndex}>
    {block.rowKeys && <th scope="row">{text ? text(offsets[rowIndex].key ?? "", offsets[rowIndex].rowStart) : offsets[rowIndex].key}</th>}
    {row.map((cell, column) => {
      const merge = block.merges?.find((entry) => entry.row === rowIndex && entry.column === column);
      const covered = block.merges?.some((entry) => (entry.row !== rowIndex || entry.column !== column) && rowIndex >= entry.row && rowIndex < entry.row + entry.rowSpan && column >= entry.column && column < entry.column + entry.columnSpan);
      if (covered) return null;
      const Tag = rowIndex === 0 && block.headers || block.rowHeaders && column === 0 ? "th" : "td";
      return <Tag key={column} rowSpan={merge?.rowSpan} colSpan={merge?.columnSpan}>{block.rich ? (rich ? rich(cell, offsets[rowIndex].cells[column]) : <Rich value={cell} />) : text ? text(cell, offsets[rowIndex].cells[column]) : cell}</Tag>;
    })}
  </tr>;
  return <div className="qcontent-table-scroll" tabIndex={0} aria-label={block.caption ?? "Question table"}>
    <table>{block.caption && <caption>{text ? text(block.caption, start) : block.caption}</caption>}{block.headers && <thead>{renderRow(rows[0], 0)}</thead>}
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

export function QuestionBlocks({ blocks, content, attachments, files, mode, section = "stem", enlarge = true, annotation }: {
  blocks: readonly QuestionBlock[]; content: PackageQuestion; attachments?: readonly QuestionImageAttachment[]; files?: readonly File[];
  mode: ContentViewMode; section?: AssetRole; enlarge?: boolean; annotation?: ContentAnnotationControls;
}) {
  const marked = useContentAnnotations(blocksToPlainText(blocks), annotation);
  let cursor = 0;
  const positions = new Map(blocks.map(block => {
    const length = blockToPlainText(block).length;
    const start = cursor;
    if (length) cursor += length + 2;
    return [block, start] as const;
  }));
  const assets = new Map(content.assets.map((asset) => [asset.id, asset]));
  const shown = visibleBlocks(blocks, mode, (block) => effectiveRole(block.role, assets.get(block.assetId)?.role, section));
  return <div className="qcontent-blocks" {...marked.rootProps}>{shown.map((block, index) => {
    const offset = positions.get(block) ?? 0;
    switch (block.type) {
      case "text": return <p key={index}>{marked.renderText(block.text, offset)}</p>;
      case "rich_text": return <p key={index}>{annotation ? marked.renderRich(block.html, offset) : <Rich value={block.html} />}</p>;
      case "table": return <ContentTable key={index} block={block} start={offset} text={annotation ? marked.renderText : undefined} rich={annotation ? marked.renderRich : undefined} />;
      case "equation": return <p key={index} className="qcontent-equation">{marked.renderText(block.plainText ?? block.latex ?? "", offset)}</p>;
      case "callout": return <p key={index} className="qcontent-callout">{marked.renderText(block.text, offset)}</p>;
      case "divider": return <hr key={index} />;
      case "image": {
        const asset = assets.get(block.assetId);
        return asset ? <figure key={asset.id} data-asset-role={effectiveRole(block.role, asset.role, section)}>
          <ContentImage asset={asset} files={files} attachment={attachments?.find((entry) => entry.assetId === asset.id)} alt={block.alt ?? block.caption ?? "Question figure"} enlarge={enlarge} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure> : <p key={index} role="status">A required figure is missing.</p>;
      }
    }
  })}{marked.repairNotice}</div>;
}

/** Edited legacy text wins over source wording. Required source figures still render. */
export function QuestionContent({ question, part, choice, mode = "question", fallback, annotation }: {
  question: QuestionRecord; part: "stem" | "choice" | "explanation"; choice?: string; mode?: ContentViewMode; fallback: ReactNode; annotation?: ContentAnnotationControls;
}) {
  const content = question.content;
  if (!content) return fallback;
  const blocks = part === "stem" ? content.stem : part === "explanation" ? content.explanation ?? [] : content.choices.find((entry) => entry.label === choice)?.blocks ?? [];
  const plain = part === "stem" ? question.stem : part === "explanation" ? question.explanation ?? "" : question.options.find((entry) => entry.key === choice)?.text ?? "";
  if (!blocks.length) return fallback;
  if (blocksToPlainText(blocks) !== plain) {
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
  return <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} section={part} enlarge={part !== "choice"} annotation={annotation} />;
}

export function QuestionSupportingContent({ question, mode }: { question: QuestionRecord; mode: ContentViewMode }) {
  const content = question.content;
  if (!content) return null;
  const placed = new Set([content.stem, content.explanation ?? [], ...content.choices.map((choice) => choice.blocks)].flat().flatMap((block) => block.type === "image" ? [block.assetId] : []));
  const blocks: QuestionBlock[] = [
    ...(content.choiceTable && mode === "question" ? [content.choiceTable] : []),
    ...content.assets.filter((asset) => !placed.has(asset.id) && isAssetVisible(asset.role, mode) && (mode !== "answered" || !isAssetVisible(asset.role, "question"))).map((asset): QuestionBlock => ({ type: "image", assetId: asset.id, role: asset.role, alt: asset.role === "answer_reveal" ? "Source answer slide" : "Source figure" })),
  ];
  return <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} />;
}
