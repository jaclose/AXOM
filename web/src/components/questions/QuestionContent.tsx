import { useEffect, useState, type ReactNode } from "react";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { blocksToPlainText, sanitizeRichText, type AssetRole, type QuestionBlock, type TableBlock } from "../../lib/question-content/blocks";
import type { PackageQuestion, QuestionAsset } from "../../lib/question-content/package";
import { effectiveRole, isAssetVisible, visibleBlocks, type ContentViewMode } from "../../lib/question-content/visibility";
import type { QuestionRecord } from "../../lib/questions";
import { Modal } from "../ui/Modal";
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
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const file = files?.find((entry) => entry.name === asset.filename);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      const blob = file ?? (attachment ? (await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined))?.blob : undefined);
      if (cancelled) return;
      if (!blob) { setMissing(true); return; }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      setMissing(false);
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, attachment]);
  const crop = asset.crop;
  const width = Math.max(.01, 1 - (crop?.left ?? 0) - (crop?.right ?? 0));
  const height = Math.max(.01, 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0));
  const picture = url && <span className="qcontent-crop" style={crop ? { aspectRatio: `${(asset.width ?? 1) * width} / ${(asset.height ?? 1) * height}` } : undefined}>
    <img src={url} alt={alt} style={crop ? { width: `${100 / width}%`, maxWidth: "none", position: "absolute", left: `${-100 * crop.left / width}%`, top: `${-100 * crop.top / height}%` } : undefined} />
  </span>;
  if (missing) return <span className="qcontent-missing" role="status">Image unavailable: {asset.filename}. Restore its media backup before practising.</span>;
  if (!url) return <span role="status">Loading figure…</span>;
  return <>
    {enlarge ? <button type="button" className="qcontent-image" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>{picture}</button> : <span className="qcontent-image">{picture}</span>}
    {open && <Modal title={alt} onClose={() => setOpen(false)} className="qcontent-enlarged">{picture}</Modal>}
  </>;
}

export function QuestionBlocks({ blocks, content, attachments, files, mode, section = "stem", enlarge = true }: {
  blocks: readonly QuestionBlock[]; content: PackageQuestion; attachments?: readonly QuestionImageAttachment[]; files?: readonly File[];
  mode: ContentViewMode; section?: AssetRole; enlarge?: boolean;
}) {
  const assets = new Map(content.assets.map((asset) => [asset.id, asset]));
  const shown = visibleBlocks(blocks, mode, (block) => effectiveRole(block.role, assets.get(block.assetId)?.role, section));
  return <div className="qcontent-blocks">{shown.map((block, index) => {
    switch (block.type) {
      case "text": return <p key={index}>{block.text}</p>;
      case "rich_text": return <p key={index}><Rich value={block.html} /></p>;
      case "table": return <ContentTable key={index} block={block} />;
      case "equation": return <p key={index} className="qcontent-equation">{block.plainText ?? block.latex}</p>;
      case "callout": return <p key={index} className="qcontent-callout">{block.text}</p>;
      case "divider": return <hr key={index} />;
      case "image": {
        const asset = assets.get(block.assetId);
        return asset ? <figure key={asset.id} data-asset-role={effectiveRole(block.role, asset.role, section)}>
          <ContentImage asset={asset} files={files} attachment={attachments?.find((entry) => entry.assetId === asset.id)} alt={block.alt ?? block.caption ?? "Question figure"} enlarge={enlarge} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure> : <p key={index} role="status">A required figure is missing.</p>;
      }
    }
  })}</div>;
}

/** Edited legacy text wins over source blocks. Otherwise render the source in order. */
export function QuestionContent({ question, part, choice, mode = "question", fallback }: {
  question: QuestionRecord; part: "stem" | "choice" | "explanation"; choice?: string; mode?: ContentViewMode; fallback: ReactNode;
}) {
  const content = question.content;
  if (!content) return fallback;
  const blocks = part === "stem" ? content.stem : part === "explanation" ? content.explanation ?? [] : content.choices.find((entry) => entry.label === choice)?.blocks ?? [];
  const plain = part === "stem" ? question.stem : part === "explanation" ? question.explanation ?? "" : question.options.find((entry) => entry.key === choice)?.text ?? "";
  if (!blocks.length || blocksToPlainText(blocks).trim() !== plain.trim()) return fallback;
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
  return <QuestionBlocks blocks={blocks} content={content} attachments={question.attachments} mode={mode} />;
}
