// ===========================================================================
// The marker grammar of the AXOM question bank DOCX template, and the neutral
// stream a Word document is turned into before it is read.
//
// A marker is a paragraph that holds nothing but a name in square brackets:
// [STEM]. Parsing rests on these words and on the order of the document body,
// never on fonts, colours or heading styles.
// ===========================================================================
import type { TableMerge } from "../blocks";

export const DOCX_MARKERS = [
  "AXOM META",
  "STEM",
  "STEM CONTINUED",
  "TABLE",
  "IMAGE",
  "CHOICES",
  "ANSWER",
  "EXPLANATION",
  "SOURCE",
  "FLAGS",
  "END QUESTION",
] as const;
export type DocxMarker = (typeof DOCX_MARKERS)[number];

export interface MarkerLine {
  marker: DocxMarker;
  /** What follows a colon inside the brackets, lower-cased: [IMAGE: answer reveal]. */
  argument?: string;
}

const MARKER_LINE = /^\s*\[\s*([A-Za-z][A-Za-z ]*?)\s*(?::\s*([^\]]*?)\s*)?\]\s*$/;

export function readMarker(line: string): MarkerLine | undefined {
  const match = MARKER_LINE.exec(line);
  if (!match) return undefined;
  const name = match[1].replace(/\s+/g, " ").toUpperCase();
  const marker = DOCX_MARKERS.find((entry) => entry === name);
  if (!marker) return undefined;
  return match[2] ? { marker, argument: match[2].toLowerCase() } : { marker };
}

/** A bracketed line in capitals that is not one of the markers is most likely a typing slip. */
export function looksLikeMarker(line: string): boolean {
  return /^\s*\[\s*[A-Z][A-Z ]*(?::[^\]]*)?\]\s*$/.test(line) && !readMarker(line);
}

/** An optional line that opens a question: "QUESTION" or "QUESTION 9". */
export const QUESTION_HEADING = /^\s*QUESTION(?:\s+(\d+))?\s*$/i;

/** A choice letter at the start of a paragraph: "A.", "A)", "(A)", in either case. */
export const CHOICE_LINE = /^\s*\(?([A-Za-z])[.)]\s*([\s\S]*)$/;

/** Formatting that covers a whole paragraph. Never imported as formatting; see `parseMarkedBody`. */
export interface ParagraphEmphasis {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  highlight?: boolean;
  colour?: boolean;
  strike?: boolean;
}

/**
 * One piece of a Word document body, in document order. `readDocxBody`
 * produces this stream by walking the document top to bottom, so a table or
 * a picture keeps its place between the paragraphs around it.
 */
export type DocxBodyElement =
  | {
      kind: "paragraph";
      text: string;
      /** Present when the paragraph has subscripts, superscripts or a word or two of emphasis. */
      html?: string;
      /** The number or letter Word shows before the paragraph, which is not in its text: "A.", "2)". */
      listLabel?: string;
      listKind?: "ordered" | "bullet";
      emphasis?: ParagraphEmphasis;
      /** The paragraph is styled as the caption of the picture or table before it. */
      caption?: boolean;
    }
  | {
      kind: "table";
      /** Rectangular: a cell covered by a merged neighbour is "". */
      rows: string[][];
      /** Cells hold rich text. */
      rich?: boolean;
      /** Leading rows the document marks as headings. */
      headerRows?: number;
      /** The first cell of each row below the headings is marked as that row's name. */
      rowHeaders?: boolean;
      /** Positions in `rows` as given, row 0 first. */
      merges?: TableMerge[];
    }
  | {
      kind: "image";
      /** The picture's path inside the document, such as "word/media/image3.png". */
      target: string;
      alt?: string;
      /** Size on the page in CSS pixels, not the size of the stored picture. */
      width?: number;
      height?: number;
      /** The part the document hides on each side, as a fraction of the stored picture. */
      crop?: { left: number; top: number; right: number; bottom: number };
    }
  | { kind: "equation"; plainText: string; latex?: string };
