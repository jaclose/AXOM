// ===========================================================================
// Question content as ORDERED BLOCKS. A stem, a choice or an explanation is a
// list of blocks (text, table, image, equation) in the order the source shows
// them, so a lab table sits between the vignette and the prompt instead of in
// a side list of attachments that has lost its place.
//
// Pure data: no store, no DOM, no I/O. `QuestionRecord.stem`, `options[].text`
// and `explanation` stay plain strings; `blocksToPlainText` is how they are
// read off the blocks, so search, duplicates and annotations see the same
// words. Source wording is never trimmed, re-cased or repaired here.
// ===========================================================================

export const ASSET_ROLES = ["question", "stem", "choice", "explanation", "answer_reveal", "reference", "source_page"] as const;
/**
 * What an image is for. `answer_reveal` is a copy of a question slide with the
 * answer marked: see `visibility.ts` for when each role may be shown.
 */
export type AssetRole = (typeof ASSET_ROLES)[number];

export interface TextBlock {
  type: "text";
  text: string;
}

/** Text that needs subscripts, superscripts or emphasis. Only `RICH_TEXT_TAGS` survive. */
export interface RichTextBlock {
  type: "rich_text";
  html: string;
}

export interface ImageBlock {
  type: "image";
  assetId: string;
  alt?: string;
  caption?: string;
  /** Overrides the asset's own role for this placement. The stricter of the two applies. */
  role?: AssetRole;
}

export interface TableBlock {
  type: "table";
  headers?: string[];
  /** Cells are text, never numbers, so "0.50", "↑↑" and "12 mg/dL" survive as written. */
  rows: string[][];
  caption?: string;
  /** The picture of this table in the source, kept to compare the rebuilt rows against. */
  sourceImageAssetId?: string;
  /** The first cell of each row names the row, as in a 2x2 table. */
  rowHeaders?: boolean;
  /** Only on a shared answer table: row i is the choice with this label. */
  rowKeys?: string[];
}

export interface EquationBlock {
  type: "equation";
  latex?: string;
  plainText?: string;
}

export interface DividerBlock {
  type: "divider";
}

export interface CalloutBlock {
  type: "callout";
  text: string;
  tone?: "note" | "warning";
}

export type QuestionBlock =
  | TextBlock
  | RichTextBlock
  | ImageBlock
  | TableBlock
  | EquationBlock
  | DividerBlock
  | CalloutBlock;

export type QuestionBlockType = QuestionBlock["type"];

// --- rich text ---------------------------------------------------------------

export const RICH_TEXT_TAGS: ReadonlySet<string> = new Set(["b", "strong", "i", "em", "u", "sub", "sup", "br"]);

/**
 * Keeps the bare formatting tags above and turns every other angle bracket
 * into text. Nothing is deleted: markup AXOM will not run is shown as written,
 * and "TSH < 0.1" keeps its "<". Safe to apply twice.
 */
export function sanitizeRichText(html: string): string {
  return inspectRichText(html).html;
}

/** `escaped` is true when something other than an allowed tag had to be turned into text. */
export function inspectRichText(html: string): { html: string; escaped: boolean } {
  let escaped = false;
  const safe = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*\/?>|[<>]/g, (match, close: string | undefined, name: string | undefined) => {
    if (name !== undefined && RICH_TEXT_TAGS.has(name.toLowerCase())) {
      const tag = name.toLowerCase();
      return tag === "br" ? "<br>" : `<${close ?? ""}${tag}>`;
    }
    escaped = true;
    return match.replace("<", "&lt;").replace(">", "&gt;");
  });
  return { html: safe, escaped };
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

function richTextToPlain(html: string): string {
  return sanitizeRichText(html)
    .replace(/<br>/g, "\n")
    .replace(/<\/?[a-z]+>/g, "")
    .replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]);
}

// --- reading blocks as plain text ---------------------------------------------

function tableToPlain(table: TableBlock): string {
  const lines: string[] = [];
  if (table.caption) lines.push(table.caption);
  if (table.headers) lines.push([...(table.rowKeys ? [""] : []), ...table.headers].join(" | "));
  table.rows.forEach((row, index) => {
    lines.push([...(table.rowKeys ? [table.rowKeys[index] ?? ""] : []), ...row].join(" | "));
  });
  return lines.join("\n");
}

/** One block as the words a search, a duplicate check or a screen reader summary needs. */
export function blockToPlainText(block: QuestionBlock): string {
  switch (block.type) {
    case "text": return block.text;
    case "rich_text": return richTextToPlain(block.html);
    case "image": return block.alt || block.caption ? `[Image: ${block.alt || block.caption}]` : "[Image]";
    case "table": return tableToPlain(block);
    case "equation": return block.plainText ?? block.latex ?? "";
    case "divider": return "";
    case "callout": return block.text;
  }
}

export function blocksToPlainText(blocks: readonly QuestionBlock[]): string {
  return blocks.map(blockToPlainText).filter((text) => text.length > 0).join("\n\n");
}

// --- counting ----------------------------------------------------------------

export interface MediaCounts {
  images: number;
  tables: number;
  equations: number;
}

export function countMedia(blocks: readonly QuestionBlock[]): MediaCounts {
  const counts: MediaCounts = { images: 0, tables: 0, equations: 0 };
  for (const block of blocks) {
    if (block.type === "image") counts.images += 1;
    else if (block.type === "table") counts.tables += 1;
    else if (block.type === "equation") counts.equations += 1;
  }
  return counts;
}

/** The order of block kinds, for asserting that placement survived a round trip. */
export function blockShape(blocks: readonly QuestionBlock[]): QuestionBlockType[] {
  return blocks.map((block) => block.type);
}
