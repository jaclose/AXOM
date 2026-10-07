// ===========================================================================
// Figures in a question PDF. Finds where each embedded image is drawn on its
// page, cuts that region out of the rendered page, and decides which question
// it belongs to. The cut is of the page as the source shows it, so a figure
// keeps its labels and arrows; nothing is read out of the image and no text is
// invented from it.
//
// A figure is placed only on evidence: it shares a page with one question, it
// sits below a question's first line, or it is on the page a question runs on
// to. A figure that fits none of those is returned as unplaced with the reason,
// never dropped and never guessed onto a question.
//
// The box and placement logic is pure and tested; only `extractPdfFigures`
// needs a browser (pdf.js and a canvas).
// ===========================================================================
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface FigureBox {
  /** Page coordinates in points, origin at the top left. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageLine { top: number; text: string }

export interface PdfFigure extends FigureBox {
  page: number;
  /** Stable within the file: "<file>-p12-fig1.png". */
  name: string;
  file: File;
}

export type FigurePlacementBasis = "only-question-on-page" | "below-question-start" | "question-runs-onto-page";

export const FIGURE_BASIS_LABEL: Record<FigurePlacementBasis, string> = {
  "only-question-on-page": "the only question on its page",
  "below-question-start": "the question it sits under",
  "question-runs-onto-page": "the question that runs onto its page",
};

export interface FigurePlacement {
  name: string;
  page: number;
  /** Index into the drafts, or undefined when it could not be placed. */
  draftIndex?: number;
  basis?: FigurePlacementBasis;
  /** Why it was left unplaced, in plain words. */
  reason?: string;
}

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Where images are drawn on a page. A PDF draws an image into the unit square
 * under the current transform, so the box is that square carried through every
 * transform in force, then through the page's own viewport transform.
 */
export function imageBoxes(
  operators: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> },
  ops: { save: number; restore: number; transform: number; paintImageXObject: number; paintInlineImageXObject?: number },
  viewportTransform: readonly number[],
): FigureBox[] {
  const boxes: FigureBox[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = [1, 0, 0, 1, 0, 0];
  const view = viewportTransform as unknown as Matrix;
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index];
    if (fn === ops.save) stack.push(current);
    else if (fn === ops.restore) current = stack.pop() ?? current;
    else if (fn === ops.transform) current = multiply(current, operators.argsArray[index] as Matrix);
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      const m = multiply(view, current);
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      boxes.push({ left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top });
    }
  }
  return boxes;
}

/**
 * The boxes worth keeping as figures. Logos, bullets and rules are too small
 * to be one; an image covering the page is the page itself (a slide export or
 * a scan), which is a different case from a figure on a page.
 */
export function figureBoxes(boxes: readonly FigureBox[], page: { width: number; height: number }): { figures: FigureBox[]; pageIsImage: boolean } {
  const pageArea = page.width * page.height;
  let pageIsImage = false;
  const kept: FigureBox[] = [];
  for (const raw of boxes) {
    // Clip to the page: an image may be drawn partly off it.
    const left = Math.max(0, raw.left);
    const top = Math.max(0, raw.top);
    const width = Math.min(page.width, raw.left + raw.width) - left;
    const height = Math.min(page.height, raw.top + raw.height) - top;
    if (width <= 0 || height <= 0) continue;
    const share = (width * height) / pageArea;
    if (share >= 0.85) { pageIsImage = true; continue; }
    if (width < 48 || height < 48 || share < 0.005) continue;
    // A figure drawn in tiles or layers is one figure: join boxes that overlap.
    const box = { left, top, width, height };
    const overlapping = kept.findIndex((other) => (
      box.left < other.left + other.width + 4 && other.left < box.left + box.width + 4
      && box.top < other.top + other.height + 4 && other.top < box.top + box.height + 4
    ));
    if (overlapping < 0) { kept.push(box); continue; }
    const other = kept[overlapping];
    const joinedLeft = Math.min(box.left, other.left);
    const joinedTop = Math.min(box.top, other.top);
    kept[overlapping] = {
      left: joinedLeft,
      top: joinedTop,
      width: Math.max(box.left + box.width, other.left + other.width) - joinedLeft,
      height: Math.max(box.top + box.height, other.top + other.height) - joinedTop,
    };
  }
  return { figures: kept.sort((a, b) => a.top - b.top || a.left - b.left), pageIsImage };
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Drop images drawn at the same place on most pages: a logo or a banner from
 * the slide template, not a figure of any one question.
 */
export function withoutDecorations(pages: ReadonlyArray<{ page: number; boxes: readonly FigureBox[] }>): Map<number, FigureBox[]> {
  const signature = (box: FigureBox) => [box.left, box.top, box.width, box.height].map((value) => Math.round(value / 4)).join("|");
  const seenOn = new Map<string, number>();
  for (const entry of pages) {
    for (const key of new Set(entry.boxes.map(signature))) seenOn.set(key, (seenOn.get(key) ?? 0) + 1);
  }
  const withImages = pages.filter((entry) => entry.boxes.length > 0).length;
  const result = new Map<number, FigureBox[]>();
  for (const entry of pages) {
    const kept = entry.boxes.filter((box) => {
      const count = seenOn.get(signature(box)) ?? 0;
      return !(count >= 4 && count >= withImages * 0.5);
    });
    if (kept.length) result.set(entry.page, kept);
  }
  return result;
}

export interface QuestionPage {
  /** The page the question starts on, when one could be found. */
  page?: number;
  /** True when the page came from where the question's opening words first appear. */
  byFirstAppearance: boolean;
  /** Other pages that repeat the question: usually its answer or explanation page. */
  repeatsOn: number[];
}

/**
 * The page each question starts on. A page already attributed to it stands.
 * Otherwise it is the first page, at or after the previous question's, on
 * which its opening words appear: review decks print a question once to be
 * answered and again with the answer, and the first of those is the question.
 */
export function locateQuestionPages(
  drafts: ReadonlyArray<{ stem: string; sourcePage?: number }>,
  pageTexts: readonly string[],
): QuestionPage[] {
  const pages = pageTexts.map(squash);
  let cursor = 1;
  return drafts.map((draft): QuestionPage => {
    const opening = squash(draft.stem).slice(0, 40);
    const found = opening.length >= 16
      ? pages.flatMap((text, index) => (text.includes(opening) ? [index + 1] : []))
      : [];
    const page = draft.sourcePage ?? found.find((candidate) => candidate >= cursor) ?? found[0];
    if (page !== undefined) cursor = Math.max(cursor, page);
    return { page, byFirstAppearance: draft.sourcePage === undefined && page !== undefined, repeatsOn: found.filter((candidate) => candidate !== page) };
  });
}

/** The line a question starts on, found by its opening words. */
function startTop(stem: string, lines: readonly PageLine[]): number | undefined {
  const opening = squash(stem).slice(0, 28);
  if (opening.length < 8) return undefined;
  return lines.find((line) => {
    const text = squash(line.text);
    return text.includes(opening) || (text.length >= 12 && opening.startsWith(text.slice(-Math.min(text.length, 28))));
  })?.top;
}

/**
 * Decide which question each figure belongs to. Drafts are in document order
 * with the page each starts on.
 */
export function placeFigures(
  figures: ReadonlyArray<Pick<PdfFigure, "name" | "page" | "top">>,
  drafts: ReadonlyArray<{ stem: string; sourcePage?: number; repeatsOn?: readonly number[] }>,
  linesByPage: ReadonlyMap<number, readonly PageLine[]> = new Map(),
): FigurePlacement[] {
  return figures.map((figure): FigurePlacement => {
    const onPage = drafts.flatMap((draft, index) => (draft.sourcePage === figure.page ? [{ draft, index }] : []));
    if (onPage.length === 1) return { name: figure.name, page: figure.page, draftIndex: onPage[0].index, basis: "only-question-on-page" };

    if (onPage.length > 1) {
      const lines = linesByPage.get(figure.page) ?? [];
      const starts = onPage.flatMap((entry) => {
        const top = startTop(entry.draft.stem, lines);
        return top === undefined ? [] : [{ ...entry, top }];
      });
      // Every question on the page has to be found before "nearest above" means anything.
      if (starts.length === onPage.length) {
        const above = starts.filter((entry) => entry.top <= figure.top).sort((a, b) => b.top - a.top)[0];
        if (above) return { name: figure.name, page: figure.page, draftIndex: above.index, basis: "below-question-start" };
      }
      return {
        name: figure.name, page: figure.page,
        reason: `Page ${figure.page} holds ${onPage.length} questions and AXOM could not tell which one this image is under.`,
      };
    }

    // A page that prints a question again is its answer page. An image there may
    // be the marked-up answer, so it is kept out of the question, and said so.
    if (drafts.some((draft) => draft.repeatsOn?.includes(figure.page))) {
      return {
        name: figure.name, page: figure.page,
        reason: `Page ${figure.page} repeats a question, which is usually its answer page, so this image was kept out of the question to avoid giving the answer away.`,
      };
    }

    // No question starts here: the page continues the last question before it.
    let previous: number | undefined;
    drafts.forEach((draft, index) => {
      if (draft.sourcePage !== undefined && draft.sourcePage === figure.page - 1) previous = index;
    });
    if (previous !== undefined) return { name: figure.name, page: figure.page, draftIndex: previous, basis: "question-runs-onto-page" };
    return { name: figure.name, page: figure.page, reason: `No question was found on page ${figure.page} or the page before it.` };
  });
}

export interface PdfFigureResult {
  figures: PdfFigure[];
  linesByPage: Map<number, PageLine[]>;
  /** Pages that are one full-page image: slides or scans, with no separate figure to cut. */
  imagePages: number[];
  warnings: string[];
}

/** Longest edge of a saved figure, in pixels. Enough to read labels, small enough to store. */
const MAX_FIGURE_EDGE = 1600;
/** Stop before a huge deck fills the device: the rest are reported, not hidden. */
const MAX_FIGURES = 120;

/** Browser only. Reads every page with a drawn image and cuts each figure out. */
export async function extractPdfFigures(buffer: ArrayBuffer, fileName: string): Promise<PdfFigureResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = browserPdfWorkerUrl;
  const result: PdfFigureResult = { figures: [], linesByPage: new Map(), imagePages: [], warnings: [] };
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  let skipped = 0;
  try {
    // First pass: where images are drawn on every page, so that a logo repeated
    // across the deck can be told from a figure before anything is rendered.
    const drawn: Array<{ page: number; boxes: FigureBox[] }> = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const operators = await page.getOperatorList();
      const { figures, pageIsImage } = figureBoxes(imageBoxes(operators, pdfjs.OPS, viewport.transform), viewport);
      if (pageIsImage) result.imagePages.push(number);
      drawn.push({ page: number, boxes: figures });
    }
    const figuresByPage = withoutDecorations(drawn);
    const decorations = drawn.reduce((total, entry) => total + entry.boxes.length, 0)
      - [...figuresByPage.values()].reduce((total, boxes) => total + boxes.length, 0);
    if (decorations > 0) result.warnings.push(`${decorations} image${decorations === 1 ? "" : "s"} drawn in the same place on most pages (a logo or banner) ${decorations === 1 ? "was" : "were"} left out.`);

    for (const [number, figures] of figuresByPage) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });

      const content = await page.getTextContent();
      const lines = new Map<number, string>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const top = Math.round(viewport.height - item.transform[5]);
        lines.set(top, `${lines.get(top) ?? ""} ${item.str}`.trim());
      }
      result.linesByPage.set(number, [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([top, text]) => ({ top, text })));

      const largest = Math.max(...figures.map((box) => Math.max(box.width, box.height)));
      const scale = Math.min(3, Math.max(1, MAX_FIGURE_EDGE / largest));
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      const context = canvas.getContext("2d");
      if (!context) { result.warnings.push(`Page ${number}: this browser could not draw the page, so its images were not cut out.`); continue; }
      await page.render({ canvas, canvasContext: context, viewport: scaled }).promise;

      for (const [index, box] of figures.entries()) {
        if (result.figures.length >= MAX_FIGURES) { skipped += 1; continue; }
        const cut = document.createElement("canvas");
        cut.width = Math.max(1, Math.round(box.width * scale));
        cut.height = Math.max(1, Math.round(box.height * scale));
        cut.getContext("2d")?.drawImage(canvas, Math.round(box.left * scale), Math.round(box.top * scale), cut.width, cut.height, 0, 0, cut.width, cut.height);
        const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, "image/png"));
        if (!blob) { result.warnings.push(`Page ${number}: one image could not be saved.`); continue; }
        const name = `${base}-p${number}-fig${index + 1}.png`;
        result.figures.push({ ...box, page: number, name, file: new File([blob], name, { type: "image/png" }) });
      }
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }
  if (skipped > 0) result.warnings.push(`${skipped} more image${skipped === 1 ? " was" : "s were"} left out: AXOM stops at ${MAX_FIGURES} per file. Split the file to bring the rest in.`);
  if (result.imagePages.length > 0) {
    result.warnings.push(`${result.imagePages.length} page${result.imagePages.length === 1 ? " is" : "s are"} one full-page image (a slide or a scan). Those have no separate figure to cut out.`);
  }
  return result;
}
