// Builds a small .docx in memory for tests, from the XML of its body. Used
// for the constructs no fixture file happens to hold. Test support only.
import JSZip from "jszip";

const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
].join(" ");

export interface DocxParts {
  numbering?: string;
  styles?: string;
  /** Extra <Relationship .../> elements for the document part. */
  relationships?: string;
  media?: Record<string, Uint8Array>;
  /** Replaces the namespace declarations, for the "strict" spelling. */
  namespaces?: string;
}

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function buildDocx(body: string, parts: DocxParts = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${parts.namespaces ?? NAMESPACES}><w:body>${body}</w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.numbering ? `<Relationship Id="rIdN" Type="${REL}/numbering" Target="numbering.xml"/>` : ""}${parts.styles ? `<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/>` : ""}${parts.relationships ?? ""}</Relationships>`);
  if (parts.numbering) zip.file("word/numbering.xml", `<w:numbering ${NAMESPACES}>${parts.numbering}</w:numbering>`);
  if (parts.styles) zip.file("word/styles.xml", `<w:styles ${NAMESPACES}>${parts.styles}</w:styles>`);
  for (const [name, bytes] of Object.entries(parts.media ?? {})) zip.file(`word/media/${name}`, bytes);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const run = (text: string, properties = ""): string => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
export const paragraph = (inner: string, properties = ""): string => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${inner}</w:p>`;
export const p = (text: string): string => paragraph(run(text));
export const cell = (inner: string, properties = ""): string => `<w:tc>${properties ? `<w:tcPr>${properties}</w:tcPr>` : ""}${inner}</w:tc>`;
export const row = (cells: string, properties = ""): string => `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ""}${cells}</w:tr>`;
export const table = (rows: string): string => `<w:tbl>${rows}</w:tbl>`;
export const imageRelationship = (id: string, target: string, external = false): string =>
  `<Relationship Id="${id}" Type="${REL}/image" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
export const drawing = (relationship: string, extra = "", attribute = "r:embed"): string =>
  `<w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="A figure"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip ${attribute}="${relationship}"/>${extra}</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

/** A 2 by 1 PNG, enough to have a real header. */
export const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x7b, 0x40, 0xe8, 0xdd,
  0, 0, 0, 0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x01, 0x01, 0x07, 0, 0xf8, 0xff, 0, 0xff, 0, 0, 0, 0xff, 0, 0x08, 0xfb, 0x02, 0xfe, 0xa7, 0x36, 0x7b, 0x40,
  0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
