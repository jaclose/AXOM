// ===========================================================================
// Reads a tagged PDF by its tags.
//
// Word and PowerPoint write a structure tree into the PDFs they export: this
// is a paragraph, this is a table with these rows and cells, this is a
// figure. Reading that tree gives a table exactly as its author made it, with
// no guessing from where text sits on the page, and it leaves out page
// furniture, which is not tagged as content.
//
// The result is the same neutral stream a Word file is read into, so a PDF
// and a .docx go through one pipeline after this point. Pure: it is handed
// what pdf.js returned and touches no file, canvas or network.
// ===========================================================================
import type { FigureBox, PageLine } from "../../pdfFigures";
import type { DocxBodyElement } from "../docx/markers";

/** A node of pdf.js's structure tree (`page.getStructTree()`). */
export interface StructNode {
  role?: string;
  children?: StructNode[];
  /** "content" on a leaf that points at marked content on the page. */
  type?: string;
  id?: string;
  alt?: string;
  /** [x1, y1, x2, y2] in page units from the bottom left, when the tag carries one. */
  bbox?: readonly number[];
}

/** An item of pdf.js's text content read with `includeMarkedContent`. */
export interface TextItem {
  type?: string;
  id?: string;
  str?: string;
  /** [a, b, c, d, x, y]: x and y place the start of the baseline, from the bottom left. */
  transform?: readonly number[];
  width?: number;
  height?: number;
}

export interface TaggedPageInput {
  page: number;
  width: number;
  height: number;
  tree: StructNode | null;
  items: readonly TextItem[];
  /** Where embedded pictures are drawn, from the top left (`imageBoxes` in lib/pdfFigures). */
  imageBoxes?: readonly FigureBox[];
  /** A slide: its text boxes are tagged in the order they were made, not the order they are read. */
  slide?: boolean;
}

export interface TaggedFigure extends FigureBox {
  alt?: string;
}

/** A drawing on a slide, with the words printed around it that belong to it. */
export interface FigureRegion extends TaggedFigure {
  /** Axis numbers, axis titles and curve letters taken out of the running text, in reading order. */
  labels?: string[];
}

/** How a figure on a page is named inside the stream: `figureTarget(3, 0)` is "page:3:figure:0". */
export const figureTarget = (page: number, index: number): string => `page:${page}:figure:${index}`;

export function parseFigureTarget(target: string): { page: number; index: number } | undefined {
  const match = /^page:(\d+):figure:(\d+)$/.exec(target);
  return match ? { page: Number(match[1]), index: Number(match[2]) } : undefined;
}

export interface PageBody {
  page: number;
  height: number;
  /** The text of each block the tags mark as a heading or title. */
  headings: string[];
  /**
   * Paragraphs and tables in reading order. On a page read in tag order, a
   * figure large enough to be one is here too, where the tags put it.
   */
  elements: DocxBodyElement[];
  /** Each paragraph with how far down the page it starts, for placing figures between them. */
  lines: PageLine[];
  /** Every tagged figure and embedded picture, each on its own, from the top left. */
  figures: TaggedFigure[];
  /**
   * On a page read by position: the drawings worth cutting out, each grown to
   * take in its own labels. Empty on a page read in tag order, where a figure
   * is in `elements`.
   */
  regions: FigureRegion[];
  /** Non-space characters inside the tags, and on the page in all. */
  coverage: { tagged: number; all: number };
  /** Whether the tags' own order was kept or the page was read by position. */
  order: "tags" | "position";
}

// --- text -------------------------------------------------------------------

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ",
};

/** Raised or lowered text as Unicode, only when every character has one: "10" then a raised "3" must not read as 103. */
function scripted(text: string, table: Readonly<Record<string, string>>): string {
  const chars = [...text];
  return chars.every((char) => table[char] !== undefined) ? chars.map((char) => table[char]).join("") : text;
}

interface Run {
  text: string;
  /** How far down the page its first baseline is. */
  top: number;
  left: number;
  /** What its ink covers, from the top left. Text set on its side is boxed as it lies. */
  box?: FigureBox;
  /** Where its first character starts and its last one ends, on their baselines, as the file counts them. */
  first?: { x: number; y: number };
  last?: { x: number; y: number };
  /** The size most of it is set in. */
  size: number;
}

/** The box a piece of text covers on the page, whichever way it is turned. */
function inkBox(item: TextItem, pageHeight: number): FigureBox {
  const [a, b, , , x, y] = item.transform!;
  const along = Math.hypot(a, b) || 1;
  const ux = a / along;
  const uy = b / along;
  const width = item.width ?? 0;
  const height = item.height ?? along;
  // Along the line of text, and up from it.
  const xs = [x, x + ux * width, x - uy * height, x + ux * width - uy * height];
  const ys = [y, y + uy * width, y + ux * height, y + uy * width + ux * height];
  const left = Math.min(...xs);
  const top = pageHeight - Math.max(...ys);
  return { left, top, width: Math.max(...xs) - left, height: pageHeight - Math.min(...ys) - top };
}

function unionBox(boxes: readonly FigureBox[]): FigureBox | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  return { left, top, width: Math.max(...boxes.map((box) => box.left + box.width)) - left, height: Math.max(...boxes.map((box) => box.top + box.height)) - top };
}

/** The text of each piece of marked content, keyed by its id. */
function textByMarkedContent(items: readonly TextItem[], pageHeight: number): { runs: Map<string, Run>; all: number } {
  const groups = new Map<string, TextItem[]>();
  const open: (string | undefined)[] = [];
  let all = 0;
  for (const item of items) {
    if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") open.push(item.id);
    else if (item.type === "endMarkedContent") open.pop();
    else if (typeof item.str === "string") {
      all += item.str.replace(/\s/g, "").length;
      // The innermost id owns the text: a span inside a paragraph is its own leaf of the tree.
      let id: string | undefined;
      for (let index = open.length - 1; index >= 0 && !id; index -= 1) id = open[index];
      if (!id) continue;
      const group = groups.get(id) ?? [];
      group.push(item);
      groups.set(id, group);
    }
  }
  const runs = new Map<string, Run>();
  for (const [id, group] of groups) {
    const inked = group.filter((item) => item.str!.trim().length > 0 && item.transform);
    // The size most of the text is set in, by character count.
    const sizes = new Map<number, number>();
    for (const item of inked) {
      const size = Math.round((item.height ?? 0) * 2) / 2;
      sizes.set(size, (sizes.get(size) ?? 0) + item.str!.length);
    }
    const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    let text = "";
    let baseline: number | undefined;
    let end: number | undefined;
    for (const item of group) {
      const str = item.str!;
      if (!item.transform) {
        text += str;
        continue;
      }
      const y = item.transform[5];
      const x = item.transform[4];
      const size = item.height ?? body;
      const small = body > 0 && size > 0 && size <= body * 0.82 && str.trim().length > 0;
      const shift = baseline === undefined ? 0 : y - baseline;
      if (small && baseline !== undefined && Math.abs(shift) < body) {
        // Smaller type, off the baseline of the text beside it: a superscript or a subscript.
        text += shift > body * 0.15 ? scripted(str, SUPERSCRIPT) : shift < -body * 0.05 ? scripted(str, SUBSCRIPT) : str;
        end = x + (item.width ?? 0);
        continue;
      }
      if (baseline !== undefined && Math.abs(shift) > Math.max(2, body * 0.6)) {
        // A new line of the same paragraph.
        if (text && !/\s$/.test(text)) text += " ";
      } else if (end !== undefined && x - end > Math.max(1, size * 0.2) && text && !/\s$/.test(text) && !/^\s/.test(str)) {
        text += " ";
      }
      text += str;
      if (str.trim()) baseline = y;
      end = x + (item.width ?? 0);
    }
    const top = inked.length ? Math.min(...inked.map((item) => pageHeight - item.transform![5])) : Number.POSITIVE_INFINITY;
    const left = inked.length ? Math.min(...inked.map((item) => item.transform![4])) : Number.POSITIVE_INFINITY;
    const box = unionBox(inked.map((item) => inkBox(item, pageHeight)));
    const opening = inked[0]?.transform;
    runs.set(id, {
      text, top, left, size: body,
      ...(box ? { box } : {}),
      ...(opening ? { first: { x: opening[4], y: opening[5] } } : {}),
      ...(baseline !== undefined && end !== undefined ? { last: { x: end, y: baseline } } : {}),
    });
  }
  return { runs, all };
}

// --- the tree ----------------------------------------------------------------

interface Block {
  element: DocxBodyElement;
  top: number;
  left: number;
  /** Set on a figure: which tagged figure it is, in the order the tags name them. */
  figure?: number;
  /** What a paragraph's ink covers. */
  box?: FigureBox;
}

/** How far a label can sit from its drawing, or from a label already taken, in points. */
const LABEL_GAP = 20;
const LABEL_LENGTH = 40;
const CHOICE_OR_NUMBER = /^(?:\(?[A-Ha-h][.)](?:\s|$)|\d{1,3}[.)]\s)/;
const BARE_CHOICE_LABEL = /^\(?[A-Ha-h][.)]$/;

/** A few words or numbers with no sentence to them: what is printed along an axis or beside a curve. */
const labelLike = (text: string): boolean => {
  if (!text || text.length > LABEL_LENGTH || CHOICE_OR_NUMBER.test(text) || /[.?!:;]$/.test(text)) return false;
  const words = text.split(/\s+/);
  return words.length <= 4 || words.every((word) => /^[\d.,%+\-−–]+$/.test(word));
};

const apart = (a: FigureBox, b: FigureBox): number =>
  Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width), a.top - (b.top + b.height), b.top - (a.top + a.height));

/**
 * A graph drawn on a slide has its axis numbers, axis titles and curve
 * letters as text of the slide. Read as text, they land in whatever line of
 * the question shares their height: "A. 5 mg" becomes "A. 5 mg 20 B". They
 * belong to the drawing. Each region takes the labels that sit against it,
 * and then the labels that sit against those, and grows to cover them, so
 * the picture cut from the page shows its own axes. The blocks taken are
 * removed from `blocks`.
 *
 * A line shaped like an answer choice or a numbered question is never taken,
 * and neither is the text beside a bare choice letter.
 */
function takeFigureLabels(regions: FigureRegion[], blocks: Block[]): void {
  const besideChoiceLetter = (block: Block): boolean =>
    blocks.some((other) => other !== block && other.element.kind === "paragraph" && BARE_CHOICE_LABEL.test(other.element.text) && Math.abs(other.top - block.top) <= 3 && other.left < block.left);
  for (const region of regions) {
    const taken: Block[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (block.element.kind !== "paragraph" || !block.box || !labelLike(block.element.text)) continue;
        if (apart(region, block.box) > LABEL_GAP || besideChoiceLetter(block)) continue;
        Object.assign(region, unionBox([region, block.box]));
        taken.push(block);
        blocks.splice(index, 1);
        grew = true;
      }
    }
    if (taken.length) {
      taken.sort((a, b) => a.top - b.top || a.left - b.left);
      region.labels = taken.map((block) => (block.element.kind === "paragraph" ? block.element.text : ""));
    }
  }
}

const BLOCK_ROLES = /^(P|H|H[1-6]|Title|Caption|BlockQuote|Note|Code|TOCI|Index|Formula)$/;
const TABLE_PARTS = new Set(["THead", "TBody", "TFoot"]);

const squeeze = (text: string): string => text.replace(/[ \t\u00a0]+/g, " ").trim();

export function readTaggedPage(input: TaggedPageInput): PageBody {
  const { runs, all } = textByMarkedContent(input.items, input.height);
  let tagged = 0;

  // A paragraph can be several pieces of marked content: one for each change of style, or one
  // for each line. They are joined as they sit: a space where a new line starts or a gap shows,
  // and nothing where one piece runs straight on from the last.
  type Piece = Pick<Run, "text" | "first" | "last" | "size">;
  const pieceOf = (node: StructNode): Piece => {
    if (node.type === "content") return runs.get(node.id ?? "") ?? { text: "", size: 0 };
    let joined: Piece = { text: "", size: 0 };
    for (const child of node.children ?? []) {
      const next = pieceOf(child);
      if (!next.text) continue;
      if (!joined.text) {
        joined = { ...next };
        continue;
      }
      const size = Math.max(joined.size, next.size);
      const apartOnPage = joined.last !== undefined && next.first !== undefined
        && (Math.abs(next.first.y - joined.last.y) > Math.max(2, size * 0.6) || next.first.x - joined.last.x > Math.max(1, size * 0.2));
      const space = apartOnPage && !/\s$/.test(joined.text) && !/^\s/.test(next.text) ? " " : "";
      joined = { text: `${joined.text}${space}${next.text}`, first: joined.first, last: next.last ?? joined.last, size };
    }
    return joined;
  };
  const textOf = (node: StructNode): string => pieceOf(node).text;
  const placeOf = (node: StructNode): { top: number; left: number } => {
    if (node.type === "content") {
      const run = runs.get(node.id ?? "");
      return { top: run?.top ?? Number.POSITIVE_INFINITY, left: run?.left ?? Number.POSITIVE_INFINITY };
    }
    let top = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    for (const child of node.children ?? []) {
      const place = placeOf(child);
      if (place.top < top - 0.5 || (Math.abs(place.top - top) <= 0.5 && place.left < left)) ({ top, left } = place);
    }
    return { top, left };
  };

  const blocks: Block[] = [];
  const headings: string[] = [];
  /** Tagged figures in the order the tags name them; a box is filled in below for one that has none. */
  const taggedFigures: { node: StructNode; box?: TaggedFigure }[] = [];

  /** A cell's paragraphs, one to a line. */
  const cellText = (cell: StructNode): string => {
    const parts: string[] = [];
    const gather = (node: StructNode): void => {
      if (node.type === "content" || BLOCK_ROLES.test(node.role ?? "") || node.role === "LI") {
        const text = squeeze(textOf(node));
        if (text) parts.push(text);
      } else for (const child of node.children ?? []) gather(child);
    };
    gather(cell);
    return parts.join("\n");
  };

  const table = (node: StructNode): void => {
    const rows: string[][] = [];
    let headerRows = 0;
    let firstCellsAreHeadings = true;
    const collect = (parent: StructNode, inHead: boolean): void => {
      for (const child of parent.children ?? []) {
        if (child.role === "TR") {
          const cells = (child.children ?? []).filter((cell) => cell.role === "TD" || cell.role === "TH");
          if (!cells.length) continue;
          const heading = cells.every((cell) => cell.role === "TH");
          if ((inHead || heading) && headerRows === rows.length) headerRows += 1;
          else if (cells[0].role !== "TH") firstCellsAreHeadings = false;
          rows.push(cells.map(cellText));
        } else if (TABLE_PARTS.has(child.role ?? "")) collect(child, child.role === "THead");
        else if (child.role) collect(child, inHead);
      }
    };
    collect(node, false);
    const width = Math.max(0, ...rows.map((row) => row.length));
    if (!rows.some((row) => row.some((cell) => cell.length > 0))) return;
    for (const row of rows) while (row.length < width) row.push("");
    tagged += rows.flat().join("").replace(/\s/g, "").length;
    blocks.push({
      ...placeOf(node),
      element: {
        kind: "table",
        rows,
        ...(headerRows > 0 && headerRows < rows.length ? { headerRows } : {}),
        ...(firstCellsAreHeadings && rows.length > headerRows && width > 1 ? { rowHeaders: true } : {}),
      },
    });
  };

  const inkOf = (node: StructNode): FigureBox[] => {
    if (node.type === "content") {
      const box = runs.get(node.id ?? "")?.box;
      return box ? [box] : [];
    }
    return (node.children ?? []).flatMap(inkOf);
  };
  const paragraph = (node: StructNode, text: string): void => {
    tagged += text.replace(/\s/g, "").length;
    const box = unionBox(inkOf(node));
    blocks.push({ ...placeOf(node), element: { kind: "paragraph", text }, ...(box ? { box } : {}) });
  };

  const walk = (node: StructNode): void => {
    const role = node.role ?? "";
    if (role === "Table") return table(node);
    if (role === "Figure") {
      const entry: { node: StructNode; box?: TaggedFigure } = { node };
      if (node.bbox && node.bbox.length === 4) {
        const [x1, y1, x2, y2] = node.bbox;
        entry.box = { left: Math.min(x1, x2), top: input.height - Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), ...(node.alt ? { alt: node.alt } : {}) };
      }
      blocks.push({ top: entry.box?.top ?? Number.POSITIVE_INFINITY, left: entry.box?.left ?? Number.POSITIVE_INFINITY, figure: taggedFigures.length, element: { kind: "image", target: figureTarget(input.page, taggedFigures.length), ...(node.alt ? { alt: node.alt } : {}) } });
      taggedFigures.push(entry);
      return;
    }
    if (role === "LI") {
      // The label of a list item is real text in a PDF: "A.", "12.", a bullet.
      const label = (node.children ?? []).filter((child) => child.role === "Lbl").map((child) => squeeze(textOf(child))).join(" ");
      const bodies = (node.children ?? []).filter((child) => child.role !== "Lbl");
      const nested = bodies.flatMap((child) => (child.children ?? []).filter((inner) => inner.role === "L"));
      const own = squeeze(bodies.map((child) => (child.role === "LBody" ? (child.children ?? []).filter((inner) => inner.role !== "L").map(textOf).join(" ") : textOf(child))).join(" "));
      paragraph(node, squeeze(`${label} ${own}`));
      for (const list of nested) walk(list);
      return;
    }
    if (BLOCK_ROLES.test(role) || node.type === "content") {
      const text = squeeze(textOf(node));
      if (/^(H[1-6]?|Title)$/.test(role) && text) headings.push(text);
      return paragraph(node, text);
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (input.tree) walk(input.tree);

  // A figure tag with no box of its own is an embedded picture: take the pictures drawn on the page, in order.
  const pictures = [...(input.imageBoxes ?? [])].sort((a, b) => a.top - b.top || a.left - b.left);
  const unboxed = taggedFigures.filter((entry) => !entry.box);
  unboxed.forEach((entry, index) => {
    const box = pictures[index];
    if (box) entry.box = { ...box, ...(entry.node.alt ? { alt: entry.node.alt } : {}) };
  });
  // Index k of `figures` is the k-th tagged figure, so a figure in the stream can be found again.
  const figures: TaggedFigure[] = taggedFigures.map((entry) => entry.box ?? { left: 0, top: 0, width: 0, height: 0 });
  for (const box of pictures.slice(unboxed.length)) {
    if (!figures.some((figure) => Math.abs(figure.left - box.left) < 2 && Math.abs(figure.top - box.top) < 2 && Math.abs(figure.width - box.width) < 2)) figures.push({ ...box });
  }
  // In the stream, keep only what is large enough to be a figure: a rule, a bullet or a logo is not content.
  const area = input.width * input.height;
  const isFigure = (box: FigureBox): boolean => box.width >= 48 && box.height >= 48 && (box.width * box.height) / area >= 0.005 && (box.width * box.height) / area < 0.85;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.figure === undefined) continue;
    const box = figures[block.figure];
    // On a slide, figures are placed by where they sit, not by the order of the tags.
    if (input.slide || !isFigure(box)) blocks.splice(index, 1);
    else {
      block.top = box.top;
      block.left = box.left;
    }
  }

  // A slide's text boxes are tagged in the order they were made. A letter in one box and its
  // answer in another are one line only by where they sit, so a slide is read by position.
  let order: PageBody["order"] = "tags";
  let ordered = blocks;
  const regions: FigureRegion[] = [];
  if (input.slide) {
    order = "position";
    regions.push(...figureRegions(figures.filter((figure) => figure.width > 0 && figure.height > 0), input));
    takeFigureLabels(regions, blocks);
    for (const region of regions) {
      region.left = Math.max(0, region.left);
      region.top = Math.max(0, region.top);
      region.width = Math.min(input.width - region.left, region.width);
      region.height = Math.min(input.height - region.top, region.height);
    }
    const placed = blocks.filter((block) => Number.isFinite(block.top) && (block.element.kind !== "paragraph" || block.element.text));
    placed.sort((a, b) => (Math.abs(a.top - b.top) <= 3 ? a.left - b.left : a.top - b.top));
    ordered = [];
    for (const block of placed) {
      const last = ordered[ordered.length - 1];
      if (last && last.element.kind === "paragraph" && block.element.kind === "paragraph" && Math.abs(last.top - block.top) <= 3) {
        last.element = { kind: "paragraph", text: `${last.element.text} ${block.element.text}` };
      } else ordered.push({ ...block });
    }
  }

  return {
    page: input.page,
    height: input.height,
    headings,
    elements: ordered.map((block) => block.element),
    lines: ordered.flatMap((block) => (block.element.kind === "paragraph" && block.element.text && Number.isFinite(block.top) ? [{ top: Math.round(block.top), text: block.element.text }] : [])),
    figures,
    regions,
    coverage: { tagged, all },
    order,
  };
}

// --- across the document --------------------------------------------------------

/**
 * A page or slide number is tagged as a paragraph like any other. A bare
 * number standing alone at the foot of the page, on several pages, is page
 * furniture: left in, it ends up stuck to the last answer choice. Returns how
 * many were taken out.
 */
export function dropPageNumbers(pages: PageBody[]): number {
  const found = pages.map((page) => page.lines.filter((line) => /^\d{1,3}$/.test(line.text) && line.top >= page.height * 0.9).sort((a, b) => b.top - a.top)[0]);
  const count = found.filter(Boolean).length;
  if (count < 3) return 0;
  pages.forEach((page, at) => {
    const line = found[at];
    if (!line) return;
    // The last paragraph with those digits: a stem can hold the same number.
    const element = page.elements.reduce((keep, entry, index) => (entry.kind === "paragraph" && entry.text === line.text ? index : keep), -1);
    if (element >= 0) page.elements.splice(element, 1);
    page.lines.splice(page.lines.lastIndexOf(line), 1);
  });
  return count;
}

/**
 * The regions worth cutting out as figures: tagged shapes that touch are one
 * drawing (a graph is many shapes), and anything too small to be a figure is
 * left out. Boxes are from the top left.
 */
export function figureRegions(figures: readonly TaggedFigure[], page: { width: number; height: number }, gap = 8): TaggedFigure[] {
  const regions: TaggedFigure[] = [];
  const touching = (a: FigureBox, b: FigureBox): boolean =>
    a.left < b.left + b.width + gap && b.left < a.left + a.width + gap && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
  for (const figure of figures) {
    let merged: TaggedFigure = { ...figure };
    for (let index = regions.length - 1; index >= 0; index -= 1) {
      if (!touching(regions[index], merged)) continue;
      const other = regions.splice(index, 1)[0];
      const left = Math.min(merged.left, other.left);
      const top = Math.min(merged.top, other.top);
      merged = {
        left, top,
        width: Math.max(merged.left + merged.width, other.left + other.width) - left,
        height: Math.max(merged.top + merged.height, other.top + other.height) - top,
        ...(merged.alt ?? other.alt ? { alt: merged.alt ?? other.alt } : {}),
      };
      index = regions.length;
    }
    regions.push(merged);
  }
  const area = page.width * page.height;
  return regions
    .map((region) => {
      const left = Math.max(0, region.left);
      const top = Math.max(0, region.top);
      return { ...region, left, top, width: Math.min(page.width, region.left + region.width) - left, height: Math.min(page.height, region.top + region.height) - top };
    })
    .filter((region) => region.width >= 48 && region.height >= 48 && (region.width * region.height) / area >= 0.005 && (region.width * region.height) / area < 0.85)
    .sort((a, b) => a.top - b.top || a.left - b.left);
}

const sameBox = (a: FigureBox, b: FigureBox): boolean =>
  Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;

/**
 * The shapes an answer slide has that its question slide does not: the marks
 * drawn to show the answer. Reading which choice a mark points at is not done
 * here. This only says where the marks are, so that a reader of marks has
 * them and so that a mark is never cut out and shown as a figure.
 */
export function marksOnAnswerPage(question: readonly FigureBox[], answer: readonly FigureBox[]): FigureBox[] {
  return answer.filter((box) => !question.some((other) => sameBox(box, other)));
}
