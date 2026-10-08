// ===========================================================================
// Walks a .docx top to bottom and returns its body as an ordered stream of
// paragraphs, tables, pictures and equations, with the picture files.
//
// Order is the point: a table or a picture comes out where the document has
// it. What cannot be read is reported, never dropped quietly. Nothing here
// knows about questions; `parseMarkedBody` and `fromDrafts` read the stream.
// ===========================================================================
import type { TableMerge } from "../blocks";
import type { IssueCode, IssueSeverity, PackageIssue } from "../package";
import type { DocxBodyElement, ParagraphEmphasis } from "./markers";
import { MATH_NS, readEquation } from "./omml";
import { attribute, child, descend, elements, findAll, isElement, parseXml, textOf, XmlError, type XmlElement } from "./xml";
import { openZip, ZipError, type ZipArchive, type ZipOptions } from "./zip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const V = "urn:schemas-microsoft-com:vml";
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Word's "Strict Open XML" spells the same namespaces differently. */
const STRICT: Readonly<Record<string, string>> = {
  "http://purl.oclc.org/ooxml/wordprocessingml/main": W,
  "http://purl.oclc.org/ooxml/officeDocument/relationships": R,
  "http://purl.oclc.org/ooxml/drawingml/main": A,
  "http://purl.oclc.org/ooxml/drawingml/picture": PIC,
  "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": WP,
  "http://purl.oclc.org/ooxml/officeDocument/math": MATH_NS,
};

export interface DocxBody {
  elements: DocxBodyElement[];
  /** Picture bytes by their path inside the document. */
  media: Map<string, Uint8Array>;
  issues: PackageIssue[];
}

type ImageElement = Extract<DocxBodyElement, { kind: "image" }>;

// --- characters typed in a symbol font ----------------------------------------
// "m" set in the Symbol font is drawn as μ. Reading the letter and not the
// glyph would turn μg into mg, so these fonts are translated.

/** The Symbol font: codes 0x20 to 0x7E read as ASCII unless listed here. */
const SYMBOL_FONT: Readonly<Record<number, string>> = {
  0x22: "∀", 0x24: "∃", 0x27: "∍", 0x2a: "∗", 0x2d: "−", 0x40: "≅",
  0x41: "Α", 0x42: "Β", 0x43: "Χ", 0x44: "Δ", 0x45: "Ε", 0x46: "Φ", 0x47: "Γ", 0x48: "Η", 0x49: "Ι", 0x4a: "ϑ", 0x4b: "Κ", 0x4c: "Λ", 0x4d: "Μ",
  0x4e: "Ν", 0x4f: "Ο", 0x50: "Π", 0x51: "Θ", 0x52: "Ρ", 0x53: "Σ", 0x54: "Τ", 0x55: "Υ", 0x56: "ς", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0x5a: "Ζ",
  0x5c: "∴", 0x5e: "⊥", 0x60: "‾",
  0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6a: "ϕ", 0x6b: "κ", 0x6c: "λ", 0x6d: "μ",
  0x6e: "ν", 0x6f: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x76: "ϖ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ",
  0x7e: "∼",
  0xa0: "€", 0xa1: "ϒ", 0xa2: "′", 0xa3: "≤", 0xa4: "⁄", 0xa5: "∞", 0xa6: "ƒ", 0xa7: "♣", 0xa8: "♦", 0xa9: "♥", 0xaa: "♠", 0xab: "↔", 0xac: "←",
  0xad: "↑", 0xae: "→", 0xaf: "↓", 0xb0: "°", 0xb1: "±", 0xb2: "″", 0xb3: "≥", 0xb4: "×", 0xb5: "∝", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠",
  0xba: "≡", 0xbb: "≈", 0xbc: "…", 0xbf: "↵", 0xc0: "ℵ", 0xc1: "ℑ", 0xc2: "ℜ", 0xc3: "℘", 0xc4: "⊗", 0xc5: "⊕", 0xc6: "∅", 0xc7: "∩", 0xc8: "∪",
  0xc9: "⊃", 0xca: "⊇", 0xcb: "⊄", 0xcc: "⊂", 0xcd: "⊆", 0xce: "∈", 0xcf: "∉", 0xd0: "∠", 0xd1: "∇", 0xd2: "®", 0xd3: "©", 0xd4: "™", 0xd5: "∏",
  0xd6: "√", 0xd7: "⋅", 0xd8: "¬", 0xd9: "∧", 0xda: "∨", 0xdb: "⇔", 0xdc: "⇐", 0xdd: "⇑", 0xde: "⇒", 0xdf: "⇓", 0xe0: "◊", 0xe1: "〈", 0xe2: "®",
  0xe3: "©", 0xe4: "™", 0xe5: "∑", 0xf1: "〉", 0xf2: "∫",
};
const WINGDINGS_FONT: Readonly<Record<number, string>> = {
  0xdf: "←", 0xe0: "→", 0xe1: "↑", 0xe2: "↓", 0xe8: "➔", 0xef: "⇦", 0xf0: "⇨", 0xf1: "⇧", 0xf2: "⇩", 0xfb: "✗", 0xfc: "✓", 0xfd: "☒", 0xfe: "☑",
  0x6c: "●", 0x6e: "■", 0xa7: "▪", 0xa8: "◻", 0xd8: "➢",
};

type GlyphFont = "symbol" | "wingdings";

function glyphFont(font: string | undefined): GlyphFont | undefined {
  if (!font) return undefined;
  if (/^symbol$/i.test(font)) return "symbol";
  if (/^wingdings$/i.test(font)) return "wingdings";
  return undefined;
}

/** The character a symbol font draws for a code, by the code's low byte. */
function glyph(font: GlyphFont, code: number): string | undefined {
  const low = code >= 0xf000 ? code - 0xf000 : code;
  if (font === "wingdings") return WINGDINGS_FONT[low];
  return SYMBOL_FONT[low] ?? (low >= 0x20 && low <= 0x7e ? String.fromCharCode(low) : undefined);
}

// --- formatting ---------------------------------------------------------------

interface Format {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  highlight?: boolean;
  colour?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  hidden?: boolean;
  font?: string;
}

interface Piece extends Format {
  text: string;
}

const val = (element: XmlElement | undefined): string | undefined => attribute(element, W, "val");

function onOff(properties: XmlElement | undefined, name: string): boolean | undefined {
  const found = child(properties, W, name);
  if (!found) return undefined;
  const value = val(found);
  return !(value === "0" || value === "false" || value === "off" || value === "none");
}

function formatOf(properties: XmlElement | undefined): Format {
  if (!properties) return {};
  const format: Format = {};
  const set = <K extends keyof Format>(key: K, value: Format[K] | undefined): void => {
    if (value !== undefined) format[key] = value;
  };
  set("bold", onOff(properties, "b"));
  set("italic", onOff(properties, "i"));
  set("strike", onOff(properties, "strike") ?? onOff(properties, "dstrike"));
  set("hidden", onOff(properties, "vanish"));
  const underline = child(properties, W, "u");
  if (underline) format.underline = val(underline) !== "none";
  const highlight = child(properties, W, "highlight");
  const shade = attribute(child(properties, W, "shd"), W, "fill");
  if (highlight) format.highlight = val(highlight) !== "none";
  else if (shade) format.highlight = !/^(auto|ffffff)$/i.test(shade);
  const colour = val(child(properties, W, "color"));
  if (colour) format.colour = !/^(auto|000000)$/i.test(colour);
  const align = val(child(properties, W, "vertAlign"));
  if (align) {
    format.sup = align === "superscript";
    format.sub = align === "subscript";
  }
  const fonts = child(properties, W, "rFonts");
  set("font", attribute(fonts, W, "ascii") ?? attribute(fonts, W, "hAnsi") ?? attribute(fonts, W, "cs"));
  return format;
}

// --- styles and numbering -------------------------------------------------------

interface StyleRecord {
  basedOn?: string;
  format: Format;
  list?: { numId: string; level: number };
}

function readStyles(root: XmlElement | undefined): Map<string, StyleRecord> {
  const styles = new Map<string, StyleRecord>();
  for (const style of elements(root, W, "style")) {
    const id = attribute(style, W, "styleId");
    if (!id) continue;
    const numbering = descend(style, W, "pPr", "numPr");
    const numId = val(child(numbering, W, "numId"));
    styles.set(id, {
      basedOn: val(child(style, W, "basedOn")),
      format: formatOf(child(style, W, "rPr")),
      ...(numId ? { list: { numId, level: Number(val(child(numbering, W, "ilvl")) ?? 0) } } : {}),
    });
  }
  return styles;
}

function resolveStyle(styles: Map<string, StyleRecord>, id: string | undefined): StyleRecord {
  const merged: StyleRecord = { format: {} };
  const chain: StyleRecord[] = [];
  for (let current = id, depth = 0; current && depth < 12; depth += 1) {
    const found = styles.get(current);
    if (!found) break;
    chain.unshift(found);
    current = found.basedOn;
  }
  for (const entry of chain) {
    Object.assign(merged.format, entry.format);
    if (entry.list) merged.list = entry.list;
  }
  return merged;
}

interface ListLevel {
  format: string;
  text: string;
  start: number;
}

const letters = (count: number): string => {
  // Word repeats the letter past Z: AA, BB, CC.
  const index = (count - 1) % 26;
  return String.fromCharCode(65 + index).repeat(Math.floor((count - 1) / 26) + 1);
};
const roman = (count: number): string => {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let left = count;
  let out = "";
  for (const [value, numeral] of table) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
};

function formatCount(count: number, format: string): string {
  switch (format) {
    case "upperLetter": return letters(count);
    case "lowerLetter": return letters(count).toLowerCase();
    case "upperRoman": return roman(count);
    case "lowerRoman": return roman(count).toLowerCase();
    case "decimalZero": return String(count).padStart(2, "0");
    default: return String(count);
  }
}

class Numbering {
  private readonly abstracts = new Map<string, Map<number, ListLevel>>();
  private readonly instances = new Map<string, { abstractId: string; overrides: Map<number, { start?: number; level?: ListLevel }> }>();
  private readonly counters = new Map<string, number[]>();
  private readonly restarted = new Set<string>();

  constructor(root: XmlElement | undefined) {
    const readLevel = (level: XmlElement): ListLevel => ({
      format: val(child(level, W, "numFmt")) ?? "decimal",
      text: val(child(level, W, "lvlText")) ?? "",
      start: Number(val(child(level, W, "start")) ?? 1),
    });
    const styleLinks = new Map<string, string>();
    const borrowed = new Map<string, string>();
    for (const abstract of elements(root, W, "abstractNum")) {
      const id = attribute(abstract, W, "abstractNumId");
      if (id === undefined) continue;
      this.abstracts.set(id, new Map(elements(abstract, W, "lvl").map((level) => [Number(attribute(level, W, "ilvl") ?? 0), readLevel(level)])));
      const defines = val(child(abstract, W, "styleLink"));
      const uses = val(child(abstract, W, "numStyleLink"));
      if (defines) styleLinks.set(defines, id);
      if (uses) borrowed.set(id, uses);
    }
    // A list can take its levels from a numbering style defined by another list.
    for (const [id, style] of borrowed) {
      const source = styleLinks.get(style);
      if (source) this.abstracts.set(id, this.abstracts.get(source) ?? new Map());
    }
    for (const instance of elements(root, W, "num")) {
      const id = attribute(instance, W, "numId");
      const abstractId = val(child(instance, W, "abstractNumId"));
      if (id === undefined || abstractId === undefined) continue;
      const overrides = new Map<number, { start?: number; level?: ListLevel }>();
      for (const override of elements(instance, W, "lvlOverride")) {
        const start = val(child(override, W, "startOverride"));
        const level = child(override, W, "lvl");
        overrides.set(Number(attribute(override, W, "ilvl") ?? 0), {
          ...(start !== undefined ? { start: Number(start) } : {}),
          ...(level ? { level: readLevel(level) } : {}),
        });
      }
      this.instances.set(id, { abstractId, overrides });
    }
  }

  /** The label Word draws for the next paragraph of this list at this level. */
  next(numId: string, level: number): { label: string; kind: "ordered" | "bullet" } | undefined {
    const instance = this.instances.get(numId);
    if (!instance) return undefined;
    const levelOf = (index: number): ListLevel =>
      instance.overrides.get(index)?.level ?? this.abstracts.get(instance.abstractId)?.get(index) ?? { format: "decimal", text: `%${index + 1}.`, start: 1 };
    const current = levelOf(level);
    // Lists made from one definition count on from each other unless one says where to start.
    const counters = this.counters.get(instance.abstractId) ?? [];
    this.counters.set(instance.abstractId, counters);
    const restart = instance.overrides.get(level)?.start;
    if (restart !== undefined && !this.restarted.has(`${numId}/${level}`)) {
      this.restarted.add(`${numId}/${level}`);
      counters[level] = restart - 1;
    }
    counters[level] = (counters[level] ?? current.start - 1) + 1;
    counters.length = level + 1;
    if (current.format === "none") return undefined;
    if (current.format === "bullet") return { label: "•", kind: "bullet" };
    const label = current.text.replace(/%(\d)/g, (_, digit: string) => {
      const index = Number(digit) - 1;
      return formatCount(counters[index] ?? levelOf(index).start, levelOf(index).format);
    });
    return { label, kind: "ordered" };
  }
}

// --- the walk -----------------------------------------------------------------

type Inline =
  | { piece: Piece }
  | { image: ImageElement }
  | { equation: { plainText: string; latex: string }; display: boolean }
  | { blocks: XmlElement };

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const AUTO_ALT = /\s*Description automatically generated.*$/is;

class Walker {
  readonly issues: PackageIssue[] = [];
  readonly targets = new Set<string>();
  private readonly said = new Set<string>();

  constructor(
    private readonly relationships: Map<string, { target: string; external: boolean }>,
    private readonly styles: Map<string, StyleRecord>,
    private readonly numbering: Numbering,
  ) {}

  note(severity: IssueSeverity, code: IssueCode, message: string, once = true): void {
    if (once && this.said.has(message)) return;
    this.said.add(message);
    this.issues.push({ severity, code, message });
  }

  // --- pictures

  private image(embed: string | undefined, link: string | undefined, frame: { alt?: string; width?: number; height?: number; crop?: ImageElement["crop"] }): ImageElement | undefined {
    const relationship = embed ? this.relationships.get(embed) : undefined;
    if (!relationship || relationship.external) {
      this.note("error", "missing_required_media", link || relationship?.external
        ? "A picture is linked from outside the document, not placed in it. Open the document in Word, embed the picture and save it again."
        : "A picture in the document points at a file the document does not hold.", false);
      return undefined;
    }
    this.targets.add(relationship.target);
    return { kind: "image", target: relationship.target, ...frame };
  }

  private drawing(drawing: XmlElement): Inline[] {
    const out: Inline[] = [];
    const frames = [...elements(drawing, WP, "inline"), ...elements(drawing, WP, "anchor")];
    for (const frame of frames.length ? frames : [drawing]) {
      const extent = child(frame, WP, "extent");
      const properties = child(frame, WP, "docPr");
      const described = (attribute(properties, "", "descr") || attribute(properties, "", "title") || "").replace(AUTO_ALT, "").trim();
      const cx = Number(attribute(extent, "", "cx"));
      const cy = Number(attribute(extent, "", "cy"));
      const pictures = findAll(frame, PIC, "pic");
      for (const picture of pictures) {
        const fill = child(picture, PIC, "blipFill");
        const blip = child(fill, A, "blip");
        const source = child(fill, A, "srcRect");
        const edge = (name: string): number => Math.max(0, Number(attribute(source, "", name) ?? 0) / 100000);
        const crop = source ? { left: edge("l"), top: edge("t"), right: edge("r"), bottom: edge("b") } : undefined;
        const found = this.image(attribute(blip, R, "embed"), attribute(blip, R, "link"), {
          ...(described ? { alt: described } : {}),
          // 9525 EMU to a CSS pixel. Only one picture can take the frame's own size.
          ...(pictures.length === 1 && cx > 0 && cy > 0 ? { width: Math.round(cx / 9525), height: Math.round(cy / 9525) } : {}),
          ...(crop && (crop.left || crop.top || crop.right || crop.bottom) ? { crop } : {}),
        });
        if (found) out.push({ image: found });
      }
      const boxes = findAll(frame, W, "txbxContent");
      for (const box of boxes) out.push({ blocks: box });
      if (!pictures.length && !boxes.length) {
        const kind = attribute(descend(frame, A, "graphic", "graphicData"), "", "uri") ?? "";
        this.note("warning", "unsupported_content", /chart/.test(kind)
          ? "The document holds a chart that AXOM cannot read. In Word, copy it and paste it back as a picture."
          : /diagram/.test(kind)
            ? "The document holds a SmartArt diagram that AXOM cannot read. In Word, copy it and paste it back as a picture."
            : "The document holds a drawing that AXOM cannot read. In Word, copy it and paste it back as a picture.");
      }
    }
    return out;
  }

  private legacyPicture(holder: XmlElement): Inline[] {
    const out: Inline[] = [];
    for (const data of findAll(holder, V, "imagedata")) {
      const title = attribute(data, "urn:schemas-microsoft-com:office:office", "title");
      const found = this.image(attribute(data, R, "id"), attribute(data, R, "href"), title ? { alt: title } : {});
      if (found) out.push({ image: found });
    }
    for (const box of findAll(holder, W, "txbxContent")) out.push({ blocks: box });
    return out;
  }

  // --- runs

  private run(run: XmlElement, inherited: Format, inLink: boolean): Inline[] {
    const properties = child(run, W, "rPr");
    const style = resolveStyle(this.styles, val(child(properties, W, "rStyle"))).format;
    const format: Format = { ...inherited, ...style, ...formatOf(properties) };
    if (inLink) {
      // A link is blue and underlined because it is a link.
      delete format.colour;
      delete format.underline;
    }
    const out: Inline[] = [];
    const push = (text: string): void => {
      if (!text) return;
      if (format.hidden) {
        this.note("info", "unsupported_content", "The document has hidden text. It was left out.");
        return;
      }
      const { hidden: _hidden, font: _font, ...shown } = format;
      out.push({ piece: { ...shown, text } });
    };
    const glyphs = glyphFont(format.font);
    for (const node of run.children) {
      if (!isElement(node)) continue;
      if (node.ns === MC && node.name === "AlternateContent") {
        out.push(...this.alternate(node, (part) => part.children.filter(isElement).flatMap((entry) => this.runChild(entry, push, glyphs))));
      } else out.push(...this.runChild(node, push, glyphs));
    }
    return out;
  }

  private runChild(node: XmlElement, push: (text: string) => void, glyphs: GlyphFont | undefined): Inline[] {
    if (node.ns !== W) return [];
    switch (node.name) {
      case "t": {
        const text = textOf(node);
        // Symbol fonts keep their glyphs at U+F020 to U+F0FF, or on plain letters: "m" is drawn as μ.
        push(glyphs || /[\uf020-\uf0ff]/.test(text)
          ? [...text].map((char) => {
              const code = char.charCodeAt(0);
              if (!glyphs && code < 0xf000) return char;
              const mapped = glyph(glyphs ?? "symbol", code);
              if (!mapped) this.unreadSymbol();
              return mapped ?? (code >= 0xf000 ? "\uFFFD" : char);
            }).join("")
          : text);
        return [];
      }
      case "tab": push("\t"); return [];
      case "cr": push("\n"); return [];
      case "br": {
        const kind = attribute(node, W, "type");
        if (!kind || kind === "textWrapping") push("\n");
        return [];
      }
      case "noBreakHyphen": push("-"); return [];
      case "sym": {
        const code = Number.parseInt(attribute(node, W, "char") ?? "", 16);
        const font = glyphFont(attribute(node, W, "font"));
        // In a symbol font the code is a glyph number. In any other font it is the character itself.
        const mapped = font ? glyph(font, code) : code > 0x1f && code < 0xf000 ? String.fromCharCode(code) : glyph("symbol", code);
        if (!mapped) this.unreadSymbol();
        push(mapped ?? "\uFFFD");
        return [];
      }
      case "drawing": return this.drawing(node);
      case "pict":
      case "object": return this.legacyPicture(node);
      default: return [];
    }
  }

  /** Newer content with an older fallback beside it: read one of the two, never both. */
  private alternate<T>(node: XmlElement, read: (part: XmlElement) => T[]): T[] {
    const issuesBefore = this.issues.length;
    for (const choice of elements(node, MC, "Choice")) {
      const found = read(choice);
      if (found.length) return found;
    }
    // The newer form gave nothing AXOM reads; what it reported about it does not apply to the fallback.
    for (const issue of this.issues.splice(issuesBefore)) this.said.delete(issue.message);
    const fallback = child(node, MC, "Fallback");
    return fallback ? read(fallback) : [];
  }

  private inlines(parent: XmlElement, inherited: Format, inLink = false): Inline[] {
    const out: Inline[] = [];
    for (const node of parent.children) {
      if (!isElement(node)) continue;
      if (node.ns === MATH_NS && (node.name === "oMath" || node.name === "oMathPara")) {
        out.push({ equation: readEquation(node), display: node.name === "oMathPara" });
      } else if (node.ns === MC && node.name === "AlternateContent") {
        out.push(...this.alternate(node, (part) => this.inlines(part, inherited, inLink)));
      } else if (node.ns !== W) continue;
      else if (node.name === "r") out.push(...this.run(node, inherited, inLink));
      else if (node.name === "hyperlink") out.push(...this.inlines(node, inherited, true));
      else if (node.name === "sdt") out.push(...this.inlines(child(node, W, "sdtContent") ?? node, inherited, inLink));
      else if (node.name === "ins" || node.name === "moveTo") {
        this.tracked();
        out.push(...this.inlines(node, inherited, inLink));
      } else if (node.name === "del" || node.name === "moveFrom") this.tracked();
      else if (node.name === "smartTag" || node.name === "fldSimple" || node.name === "customXml" || node.name === "bdo" || node.name === "dir") {
        out.push(...this.inlines(node, inherited, inLink));
      } else if (node.name === "commentRangeStart") this.note("info", "unsupported_content", "The document has comments. They were not imported.");
    }
    return out;
  }

  private unreadSymbol(): void {
    this.note("warning", "unsupported_content", "A symbol in the document could not be read and shows as \uFFFD. Check arrows and Greek letters against the source.");
  }

  private tracked(): void {
    this.note("info", "tracked_changes", "The document has tracked changes. AXOM read it as if every change were accepted.");
  }

  // --- paragraphs

  /** The text of a run of pieces, and its rich form when it needs one. */
  private compose(pieces: Piece[], paragraphShaded: boolean): { text: string; html?: string; emphasis?: ParagraphEmphasis } {
    const text = pieces.map((piece) => piece.text).join("");
    const inked = pieces.filter((piece) => piece.text.trim().length > 0);
    const emphasis: ParagraphEmphasis = {};
    for (const key of ["bold", "italic", "underline", "highlight", "colour", "strike"] as const) {
      if (inked.length > 0 && inked.every((piece) => piece[key])) emphasis[key] = true;
    }
    if (paragraphShaded && inked.length) emphasis.highlight = true;
    // Formatting on a whole paragraph is styling. Only a marked word or two is content.
    const tagsOf = (piece: Piece): string[] => [
      ...(piece.bold && !emphasis.bold ? ["b"] : []),
      ...(piece.italic && !emphasis.italic ? ["i"] : []),
      ...(piece.underline && !emphasis.underline ? ["u"] : []),
      ...(piece.sub ? ["sub"] : piece.sup ? ["sup"] : []),
    ];
    const rich = inked.some((piece) => tagsOf(piece).length > 0);
    const html = rich
      ? pieces.map((piece) => {
          const tags = piece.text.trim() ? tagsOf(piece) : [];
          return `${tags.map((tag) => `<${tag}>`).join("")}${escapeHtml(piece.text).replace(/\n/g, "<br>")}${tags.reverse().map((tag) => `</${tag}>`).join("")}`;
        }).join("")
      : undefined;
    return { text, ...(html ? { html } : {}), ...(Object.keys(emphasis).length ? { emphasis } : {}) };
  }

  private listOf(paragraph: XmlElement): { label: string; kind: "ordered" | "bullet" } | undefined {
    const properties = child(paragraph, W, "pPr");
    const direct = child(properties, W, "numPr");
    const directId = val(child(direct, W, "numId"));
    const styled = resolveStyle(this.styles, val(child(properties, W, "pStyle"))).list;
    const numId = directId ?? styled?.numId;
    if (!numId || numId === "0") return undefined;
    const level = val(child(direct, W, "ilvl"));
    return this.numbering.next(numId, level !== undefined ? Number(level) : styled?.level ?? 0);
  }

  paragraph(paragraph: XmlElement, into: DocxBodyElement[]): void {
    const properties = child(paragraph, W, "pPr");
    // A paragraph struck out in tracked changes is gone once the change is accepted.
    if (descend(properties, W, "rPr", "del")) {
      this.tracked();
      if (!findAll(paragraph, W, "t").length) return;
    }
    const styleId = val(child(properties, W, "pStyle"));
    const style = resolveStyle(this.styles, styleId);
    const caption = styleId !== undefined && /caption/i.test(styleId);
    const shade = attribute(child(properties, W, "shd"), W, "fill");
    const shaded = Boolean(shade && !/^(auto|ffffff)$/i.test(shade));
    const list = this.listOf(paragraph);
    const found = this.inlines(paragraph, style.format);
    let pieces: Piece[] = [];
    let first = true;
    const after: XmlElement[] = [];
    const flush = (force: boolean): void => {
      const composed = this.compose(pieces, shaded);
      pieces = [];
      if (!force && !composed.text.trim() && !(first && list)) return;
      // A caption is set in italics by its style. That is not emphasis on the words.
      if (caption) delete composed.emphasis;
      into.push({ kind: "paragraph", ...composed, ...(first && list ? { listLabel: list.label, listKind: list.kind } : {}), ...(caption ? { caption: true } : {}) });
      first = false;
    };
    const lone = found.filter((entry) => !("piece" in entry) || entry.piece.text.trim().length > 0);
    for (const entry of found) {
      if ("piece" in entry) pieces.push(entry.piece);
      else if ("image" in entry) {
        flush(false);
        into.push(entry.image);
        first = false;
      } else if ("blocks" in entry) after.push(entry.blocks);
      else if (entry.display || lone.length === 1) {
        // An equation alone on its line is a block of its own.
        flush(false);
        into.push({ kind: "equation", plainText: entry.equation.plainText, ...(entry.equation.latex ? { latex: entry.equation.latex } : {}) });
        first = false;
      } else pieces.push({ text: entry.equation.plainText });
    }
    // A paragraph with nothing in it still marks a gap between two blocks of text.
    flush(first);
    for (const box of after) this.blocks(box, into);
  }

  // --- tables

  private cell(cell: XmlElement): { text: string; html?: string; images: ImageElement[]; nested: boolean } {
    const inner: DocxBodyElement[] = [];
    this.blocks(cell, inner);
    const lines: { text: string; html?: string }[] = [];
    const images: ImageElement[] = [];
    let nested = false;
    for (const element of inner) {
      if (element.kind === "paragraph") {
        const label = element.listLabel ? `${element.listLabel} ` : "";
        if (element.text.trim() || label) lines.push({ text: `${label}${element.text}`, ...(element.html ? { html: `${escapeHtml(label)}${element.html}` } : {}) });
      } else if (element.kind === "image") images.push(element);
      else if (element.kind === "equation") lines.push({ text: element.plainText });
      else {
        nested = true;
        lines.push(...element.rows.map((row) => ({ text: row.join(" | ") })));
      }
    }
    const rich = lines.some((line) => line.html);
    return {
      text: lines.map((line) => line.text).join("\n"),
      ...(rich ? { html: lines.map((line) => line.html ?? escapeHtml(line.text)).join("<br>") } : {}),
      images,
      nested,
    };
  }

  /** Rows and cells may sit inside content controls or tracked insertions. */
  private within(parent: XmlElement, name: string): XmlElement[] {
    return parent.children.filter(isElement).flatMap((node) => {
      if (node.ns !== W) return [];
      if (node.name === name) return [node];
      if (node.name === "sdt") return this.within(child(node, W, "sdtContent") ?? node, name);
      if (node.name === "customXml" || node.name === "ins" || node.name === "moveTo" || node.name === "sdtContent") return this.within(node, name);
      return [];
    });
  }

  table(table: XmlElement, into: DocxBodyElement[]): void {
    const rows: { text: string; html?: string }[][] = [];
    const merges: TableMerge[] = [];
    const open = new Map<number, TableMerge>();
    const images: ImageElement[] = [];
    let headerRows = 0;
    let nested = false;
    const tableRows = this.within(table, "tr");
    // One cell is a box drawn round some text, not a table.
    const only = tableRows.length === 1 ? this.within(tableRows[0], "tc") : [];
    if (only.length === 1) {
      this.blocks(only[0], into);
      return;
    }
    for (const tableRow of tableRows) {
      const rowProperties = child(tableRow, W, "trPr");
      if (child(rowProperties, W, "del")) {
        this.tracked();
        continue;
      }
      if (onOff(rowProperties, "tblHeader") && headerRows === rows.length) headerRows += 1;
      const row: { text: string; html?: string }[] = [];
      for (let skip = Number(val(child(rowProperties, W, "gridBefore")) ?? 0); skip > 0; skip -= 1) row.push({ text: "" });
      for (const tableCell of this.within(tableRow, "tc")) {
        const cellProperties = child(tableCell, W, "tcPr");
        const span = Math.max(1, Number(val(child(cellProperties, W, "gridSpan")) ?? 1));
        const vertical = child(cellProperties, W, "vMerge");
        const column = row.length;
        const continues = vertical !== undefined && val(vertical) !== "restart";
        const above = open.get(column);
        if (continues && above) {
          above.rowSpan += 1;
          for (let index = 0; index < span; index += 1) row.push({ text: "" });
          continue;
        }
        open.delete(column);
        const content = this.cell(tableCell);
        images.push(...content.images);
        nested = nested || content.nested;
        row.push({ text: content.text, ...(content.html ? { html: content.html } : {}) });
        for (let index = 1; index < span; index += 1) row.push({ text: "" });
        if (span > 1 || vertical) {
          const merge: TableMerge = { row: rows.length, column, rowSpan: 1, columnSpan: span };
          merges.push(merge);
          if (vertical) open.set(column, merge);
        }
      }
      rows.push(row);
    }
    const width = Math.max(0, ...rows.map((row) => row.length));
    for (const row of rows) while (row.length < width) row.push({ text: "" });
    const rich = rows.some((row) => row.some((entry) => entry.html));
    const spans = merges.filter((merge) => merge.rowSpan > 1 || merge.columnSpan > 1);
    if (rows.some((row) => row.some((entry) => entry.text.trim()))) {
      if (nested) this.note("warning", "table_parse_uncertain", "A table inside a table cell was read as lines of text in that cell.");
      into.push({
        kind: "table",
        rows: rows.map((row) => row.map((entry) => (rich ? entry.html ?? escapeHtml(entry.text) : entry.text))),
        ...(rich ? { rich: true } : {}),
        ...(headerRows > 0 && headerRows < rows.length ? { headerRows } : {}),
        ...(spans.length ? { merges: spans } : {}),
      });
      if (images.length) this.note("info", "media_association_uncertain", "A picture inside a table was placed straight after the table.");
    }
    into.push(...images);
  }

  // --- blocks

  blocks(parent: XmlElement, into: DocxBodyElement[]): void {
    for (const node of parent.children) {
      if (!isElement(node)) continue;
      if (node.ns === MC && node.name === "AlternateContent") {
        into.push(...this.alternate(node, (part) => {
          const found: DocxBodyElement[] = [];
          this.blocks(part, found);
          return found;
        }));
      } else if (node.ns !== W) continue;
      else if (node.name === "p") this.paragraph(node, into);
      else if (node.name === "tbl") this.table(node, into);
      else if (node.name === "sdt") this.blocks(child(node, W, "sdtContent") ?? node, into);
      else if (node.name === "customXml" || node.name === "ins" || node.name === "moveTo") this.blocks(node, into);
      else if (node.name === "del" || node.name === "moveFrom") this.tracked();
      else if (node.name === "altChunk") this.note("warning", "unsupported_content", "Part of the document is another file placed inside it. That part was not read.");
    }
  }
}

// --- opening the file -----------------------------------------------------------

const directoryOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${directoryOf(base)}${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

async function relationshipsOf(zip: ZipArchive, part: string): Promise<{ id: string; type: string; target: string; external: boolean }[]> {
  const source = await zip.text(`${directoryOf(part)}_rels/${part.slice(directoryOf(part).length)}.rels`);
  if (!source) return [];
  return elements(parseXml(source), PACKAGE_RELS, "Relationship").map((entry) => {
    const external = attribute(entry, "", "TargetMode") === "External";
    const target = attribute(entry, "", "Target") ?? "";
    return { id: attribute(entry, "", "Id") ?? "", type: attribute(entry, "", "Type") ?? "", target: external ? target : resolvePath(part, target), external };
  });
}

const failed = (message: string): DocxBody => ({ elements: [], media: new Map(), issues: [{ severity: "error", code: "invalid_document", message }] });

export async function readDocxBody(input: ArrayBuffer | Uint8Array, options: ZipOptions = {}): Promise<DocxBody> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) {
    return failed("This is an older .doc file. Open it in Word, save it as .docx, and import that.");
  }
  try {
    const zip = await openZip(data, options);
    const main = (await relationshipsOf(zip, "")).find((entry) => entry.type.endsWith("/officeDocument"))?.target ?? "word/document.xml";
    const source = await zip.text(main);
    if (!source) return failed(zip.has("content.xml") ? "This is an OpenDocument file. Save it as .docx and import that." : "This file is not a Word document.");
    const root = parseXml(source, { aliases: STRICT });
    const body = child(root, W, "body");
    if (root.ns !== W || root.name !== "document" || !body) return failed("This file is not a Word document.");

    const related = await relationshipsOf(zip, main);
    const part = async (suffix: string, fallback: string): Promise<XmlElement | undefined> => {
      const text = await zip.text(related.find((entry) => entry.type.endsWith(suffix))?.target ?? resolvePath(main, fallback));
      return text ? parseXml(text, { aliases: STRICT }) : undefined;
    };
    const walker = new Walker(
      new Map(related.map((entry) => [entry.id, { target: entry.target, external: entry.external }])),
      readStyles(await part("/styles", "styles.xml")),
      new Numbering(await part("/numbering", "numbering.xml")),
    );
    const out: DocxBodyElement[] = [];
    walker.blocks(body, out);

    const media = new Map<string, Uint8Array>();
    for (const target of walker.targets) {
      const bytes = await zip.bytes(target);
      if (bytes) media.set(target, bytes);
      else walker.note("error", "missing_required_media", `The document names the picture ${target} but does not hold it.`, false);
    }
    return { elements: out, media, issues: walker.issues };
  } catch (error) {
    if (error instanceof ZipError || error instanceof XmlError) return failed(error.message);
    throw error;
  }
}
