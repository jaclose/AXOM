// ===========================================================================
// AXOM's existing PDF import, carried into package questions.
//
// Nothing about reading a PDF is redone here. The text parser, the deck
// reader and the figure placer already exist; this takes what they return
// and writes it as blocks, with each figure put where it sits in the stem.
// A figure the placer held back because it is on an answer page becomes an
// answer-reveal asset, never part of the question.
//
// It does not look for marked answers in the page. That is separate work.
// ===========================================================================
import type { DeckPage } from "../../deckPages";
import type { FigurePlacement, PageLine, PdfFigure, QuestionPage } from "../../pdfFigures";
import type { ParsedQuestionDraft } from "../../questionParse";
import { describeAssets } from "../assets";
import type { ConvertedQuestions } from "../docx/docxToQuestions";
import { draftsToQuestions, type AnchoredMedia, type UnplacedMedia } from "../fromDrafts";
import type { PackageIssue, PackageQuestion, QuestionAsset } from "../package";

export type PdfFigureBox = Pick<PdfFigure, "name" | "page" | "left" | "top" | "width" | "height"> & { alt?: string };

export interface PdfConversionInput {
  drafts: readonly ParsedQuestionDraft[];
  figures?: readonly PdfFigureBox[];
  placements?: readonly FigurePlacement[];
  /** Where each draft starts and which pages repeat it, in step with `drafts`. */
  questionPages?: readonly QuestionPage[];
  linesByPage?: ReadonlyMap<number, readonly PageLine[]>;
  deckPages?: readonly DeckPage[];
  /** Tables carried through the parser as anchors, to be put back where it kept them. */
  media?: AnchoredMedia[];
  /** An id for each draft, in step with `drafts`. */
  ids?: readonly string[];
}

export interface PdfConversionDefaults {
  bankId: string;
  sourceFilename: string;
  createdAt?: string;
}

export interface PdfDraftConversion {
  questions: PackageQuestion[];
  issues: PackageIssue[];
  /** For each image asset id, the name of the figure it came from. */
  figureOfAsset: Map<string, string>;
  /** For each image asset that came through the parser as an anchor, the target it named. */
  assetTargets: Map<string, string>;
  unplaced: UnplacedMedia[];
}

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Where in the stem a figure sits: the place in the stem's text where the
 * last line printed above the figure ends. Undefined when no line of the
 * stem can be found above it on that page.
 */
export function splitPointAbove(stem: string, lines: readonly PageLine[], figureTop: number): number | undefined {
  const squashedStem: string[] = [];
  const origin: number[] = [];
  for (let index = 0; index < stem.length; index += 1) {
    const char = stem[index].toLowerCase();
    if (/[a-z0-9]/.test(char)) {
      squashedStem.push(char);
      origin.push(index);
    }
  }
  const haystack = squashedStem.join("");
  const above = lines.filter((line) => line.top < figureTop).sort((a, b) => b.top - a.top);
  for (const line of above) {
    let needle = squash(line.text);
    if (needle.length < 6) continue;
    let at = haystack.lastIndexOf(needle);
    if (at < 0) {
      // The line that opens the question starts with its number, which the stem does not keep.
      needle = needle.replace(/^\d{1,3}/, "");
      at = needle.length >= 6 ? haystack.lastIndexOf(needle) : -1;
    }
    if (at < 0) continue;
    // Take the full stop or bracket that closes the line with it.
    let end = origin[at + needle.length - 1] + 1;
    while (end < stem.length && !/[\s\p{L}\p{N}]/u.test(stem[end])) end += 1;
    return end;
  }
  return undefined;
}

export function pdfDraftsToQuestions(input: PdfConversionInput, defaults: PdfConversionDefaults): PdfDraftConversion {
  const converted = draftsToQuestions(input.drafts, { media: input.media ?? [] }, { ...defaults, method: "pdf-import", ...(input.ids ? { ids: input.ids } : {}) });
  const { questions, issues } = converted;
  const figureOfAsset = new Map<string, string>();
  // Tables the parser left outside every question are listed with the figures that were.
  const unplaced: UnplacedMedia[] = [...converted.unplaced];
  const unplacedIssue = issues.findIndex((issue) => issue.code === "media_association_uncertain" && !issue.questionId);
  if (unplacedIssue >= 0) issues.splice(unplacedIssue, 1);
  const figures = new Map((input.figures ?? []).map((figure) => [figure.name, figure]));

  const assetFor = (question: PackageQuestion, figure: PdfFigureBox, role: QuestionAsset["role"]): QuestionAsset => {
    const asset: QuestionAsset = {
      id: `${question.id}-img-${question.assets.length + 1}`,
      filename: figure.name,
      mimeType: "image/png",
      sourceFile: defaults.sourceFilename,
      sourcePage: figure.page,
      role,
      questionId: question.id,
      derivation: "region-render",
      bounds: { x: figure.left, y: figure.top, width: figure.width, height: figure.height },
    };
    question.assets.push(asset);
    figureOfAsset.set(asset.id, figure.name);
    return asset;
  };

  /** The question an answer or explanation page belongs to: the deck's own word first, then a repeated stem. */
  const questionOfPage = (page: number): PackageQuestion | undefined => {
    const questionPage = input.deckPages?.find((entry) => entry.page === page)?.questionPage;
    const owners = (input.questionPages ?? []).flatMap((entry, index) =>
      (questionPage !== undefined && entry.page === questionPage) || entry.repeatsOn.includes(page) ? [index] : []);
    return owners.length === 1 ? questions[owners[0]] : undefined;
  };

  for (const placement of input.placements ?? []) {
    const figure = figures.get(placement.name);
    if (!figure) continue;
    const leaveOut = (reason: string): void => {
      unplaced.push({ media: { kind: "image", element: { kind: "image", target: figure.name } }, reason });
    };
    if (placement.draftIndex !== undefined) {
      const question = questions[placement.draftIndex];
      if (!question) continue;
      const asset = assetFor(question, figure, "stem");
      // The figure goes after the last stretch of stem text that is printed above it on its page.
      const lines = input.linesByPage?.get(figure.page) ?? [];
      let placed = false;
      for (let index = question.stem.length - 1; index >= 0 && !placed; index -= 1) {
        const block = question.stem[index];
        if (block.type !== "text") continue;
        const split = splitPointAbove(block.text, lines, figure.top);
        if (split === undefined) continue;
        const before = block.text.slice(0, split).replace(/\s+$/, "");
        const after = block.text.slice(split).replace(/^\s+/, "");
        question.stem.splice(index, 1, ...(before ? [{ type: "text" as const, text: before }] : []), { type: "image" as const, assetId: asset.id, ...(figure.alt ? { alt: figure.alt } : {}) }, ...(after ? [{ type: "text" as const, text: after }] : []));
        placed = true;
      }
      if (!placed) {
        question.stem.push({ type: "image", assetId: asset.id, ...(figure.alt ? { alt: figure.alt } : {}) });
        (question.flags ??= []).push({
          type: "media_association_uncertain",
          message: `The picture from page ${figure.page} belongs to this question, but where it sits in the stem could not be worked out. It is placed after the text.`,
        });
      }
      continue;
    }
    const owner = placement.held === "answer-slide" || placement.held === "below-answer" ? questionOfPage(figure.page) : undefined;
    if (!owner) {
      leaveOut(placement.reason ?? "It could not be tied to a question.");
      continue;
    }
    if (placement.held === "answer-slide") {
      // The same picture again on the answer page: kept for review, never shown with the question.
      const asset = assetFor(owner, figure, "answer_reveal");
      const clean = owner.assets.filter((entry) => entry.role === "stem");
      if (clean.length === 1) asset.revealOf = clean[0].id;
    } else {
      const asset = assetFor(owner, figure, "explanation");
      (owner.explanation ??= []).push({ type: "image", assetId: asset.id });
    }
  }
  if (unplaced.length) {
    issues.push({
      severity: "warning",
      code: "media_association_uncertain",
      message: `${unplaced.length} ${unplaced.length === 1 ? "picture" : "pictures"} in the PDF could not be tied to a question. Each one is listed so it can be placed by hand.`,
    });
  }
  return { questions, issues, figureOfAsset, assetTargets: converted.assetTargets, unplaced };
}

/**
 * Browser only: the existing extraction, parsing and figure passes, then the
 * conversion above. The PDF is read by the same code the import screen uses.
 */
export async function pdfToQuestions(buffer: ArrayBuffer, defaults: PdfConversionDefaults): Promise<ConvertedQuestions & { notes: string[] }> {
  const [{ extractPdfText }, { parsePdfQuestions }, { extractPdfFigures, locateQuestionPages, placeFigures }] = await Promise.all([
    import("../../extractText"),
    import("../../pdfQuestionImport"),
    import("../../pdfFigures"),
  ]);
  // pdf.js may take the buffer it is given, so each pass gets its own copy.
  const extracted = await extractPdfText(buffer.slice(0));
  const parsed = parsePdfQuestions(extracted.text, extracted.pages);
  const found = await extractPdfFigures(buffer.slice(0), defaults.sourceFilename);
  const questionPages = locateQuestionPages(parsed.drafts, extracted.pages);
  const placements = placeFigures(
    found.figures,
    parsed.drafts.map((draft, index) => ({ stem: draft.stem, sourcePage: questionPages[index].page, repeatsOn: questionPages[index].repeatsOn })),
    found.linesByPage,
    parsed.deckPages,
  );
  const converted = pdfDraftsToQuestions(
    { drafts: parsed.drafts, figures: found.figures, placements, questionPages, linesByPage: found.linesByPage, ...(parsed.deckPages ? { deckPages: parsed.deckPages } : {}) },
    defaults,
  );
  const bytesByFigure = new Map<string, Uint8Array>();
  for (const figure of found.figures) bytesByFigure.set(figure.name, new Uint8Array(await figure.file.arrayBuffer()));
  const files = await describeAssets(converted.questions, (asset) => bytesByFigure.get(converted.figureOfAsset.get(asset.id) ?? ""));
  return {
    questions: converted.questions,
    files,
    issues: converted.issues,
    readBy: converted.questions.length ? "text-parser" : "nothing",
    unplaced: converted.unplaced,
    notes: [...parsed.notes, ...extracted.warnings, ...found.warnings],
  };
}
