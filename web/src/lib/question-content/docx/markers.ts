// ===========================================================================
// The marker grammar of the AXOM question bank DOCX template, and the neutral
// stream a Word document is turned into before it is read.
//
// A marker is a paragraph that holds nothing but a name in square brackets:
// [STEM]. Parsing rests on these words and on the order of the document body,
// never on fonts, colours or heading styles.
// ===========================================================================

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

/** A typed choice letter at the start of a paragraph: "A." or "A)". */
export const CHOICE_LINE = /^\s*([A-Z])[.)]\s*([\s\S]*)$/;

/**
 * One piece of a Word document body, in document order. Phase 2 produces
 * this stream by walking `word/document.xml` top to bottom, so a table or a
 * picture keeps its place between the paragraphs around it.
 */
export type DocxBodyElement =
  | {
      kind: "paragraph";
      text: string;
      /** Present when the paragraph has subscripts, superscripts or emphasis worth keeping. */
      html?: string;
    }
  | { kind: "table"; rows: string[][] }
  | {
      kind: "image";
      /** The picture's path inside the document, such as "media/image3.png". */
      target: string;
      alt?: string;
      width?: number;
      height?: number;
    };
