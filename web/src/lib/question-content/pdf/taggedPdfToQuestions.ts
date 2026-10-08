// ===========================================================================
// A tagged PDF, already read into pages, becomes package questions.
//
// The questions themselves are found by AXOM's existing PDF parser, deck
// reader and figure placer. What this adds is what the tags make possible:
// each table goes through the parser as an anchor and comes back as a real
// table where the parser kept it. In a document, a figure does the same, so
// it lands where the tags put it. On a slide, a graph drawn as many shapes is
// cut out as one figure and placed by where it sits, and each answer slide is
// kept as an answer-reveal picture of the page. A file that holds several
// sets of questions, each numbered from 1, is read one set at a time.
//
// It does not read which choice a mark on an answer slide points at. A
// question whose only key is such a mark is left without a key and says so.
// ===========================================================================
import type { DeckPage } from "../../deckPages";
import { locateQuestionPages, placeFigures, withoutDecorations, type FigureBox, type PageLine, type QuestionPage } from "../../pdfFigures";
import { parsePdfQuestions } from "../../pdfQuestionImport";
import type { ParsedQuestionDraft } from "../../questionParse";
import { answerKeyLines, bodyToAnchoredText, type AnchoredText, type UnplacedMedia } from "../fromDrafts";
import type { PackageIssue, PackageQuestion } from "../package";
import { splitParts } from "./parts";
import { pdfDraftsToQuestions, type PdfConversionDefaults, type PdfFigureBox } from "./pdfToQuestions";
import { dropPageNumbers, marksOnAnswerPage, parseFigureTarget, type FigureRegion, type PageBody, type TaggedFigure } from "./taggedPdf";

/** What to draw for an asset: a region of a page, or the whole page when there is no box. */
export interface RenderRequest {
  page: number;
  box?: FigureBox;
}

export interface TaggedConversion {
  questions: PackageQuestion[];
  issues: PackageIssue[];
  /** For each image asset id, what has to be drawn from the PDF to make its file. */
  renders: Map<string, RenderRequest>;
  /** Tables and figures that belong to no question the parser found, each with the reason, to be placed by hand. */
  unplaced: UnplacedMedia[];
  /** Plain notes on how the file was read. */
  notes: string[];
  /** Counts only, for a report that can be shown without showing a question. */
  report: {
    pages: number;
    readByPosition: boolean;
    /** Sets of questions in the file, each numbered from 1. */
    sets: number;
    pageNumbersDropped: number;
    /** Axis numbers and the like taken out of the text of a slide and kept with its drawing. */
    figureLabels: number;
    tables: number;
    tablesPlaced: number;
    answerKeyTables: number;
    figures: number;
    figuresPlaced: number;
    answerPages: number;
    answerPagesWithMarks: number;
    taggedShare: number;
    deck: boolean;
  };
}

export interface TaggedConversionInput {
  pages: readonly PageBody[];
}

export function taggedPdfToQuestions(input: TaggedConversionInput, defaults: PdfConversionDefaults): TaggedConversion {
  // Working copies: page furniture comes out of these, not out of what the caller holds.
  const pages: PageBody[] = input.pages.map((page) => ({ ...page, elements: [...page.elements], lines: [...page.lines] }));
  const pageNumbersDropped = dropPageNumbers(pages);
  const base = defaults.sourceFilename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const pageByNumber = new Map(pages.map((page) => [page.page, page]));
  const figureAt = (target: string): { page: number; index: number; box: TaggedFigure } | undefined => {
    const at = parseFigureTarget(target);
    const box = at ? pageByNumber.get(at.page)?.figures[at.index] : undefined;
    return at && box ? { ...at, box } : undefined;
  };

  // A picture in the same place on most pages is a logo, not a figure of a question.
  const inStream = withoutDecorations(pages.map((page) => ({
    page: page.page,
    boxes: page.elements.flatMap((element) => (element.kind === "image" ? [figureAt(element.target)?.box].filter((box): box is TaggedFigure => Boolean(box)) : [])),
  })));
  for (const page of pages) {
    const kept = inStream.get(page.page) ?? [];
    page.elements = page.elements.filter((element) => element.kind !== "image" || kept.some((box) => box === figureAt(element.target)?.box));
  }

  const anchored: AnchoredText = { text: "", media: [], flattened: false };
  let answerKeyTables = 0;
  const pageTexts = pages.map((page) => {
    for (const element of page.elements) {
      if (element.kind === "table" && answerKeyLines(element.rows, element.headerRows ?? (element.rows.length >= 2 ? 1 : 0))) answerKeyTables += 1;
    }
    return bodyToAnchoredText(page.elements, { paragraphBreak: "\n", into: anchored }).text;
  });

  // One parse for each set of questions. Everything after it works on all of them together.
  const parts = splitParts(pageTexts);
  const headings = new Set(pages.flatMap((page) => page.headings));
  const drafts: ParsedQuestionDraft[] = [];
  const ids: string[] = [];
  const setOf: number[] = [];
  const questionPages: QuestionPage[] = [];
  const notes: string[] = [];
  let deckPages: readonly DeckPage[] = [];
  let deck = false;
  parts.forEach((part, at) => {
    const parsed = parsePdfQuestions(part.pages.join("\n\n"), part.pages);
    const located = locateQuestionPages(parsed.drafts, part.pages);
    const label = parts.length > 1 ? `Set ${at + 1}: ` : "";
    parsed.drafts.forEach((draft, index) => {
      const number = String(draft.questionNumber ?? index + 1).padStart(2, "0");
      ids.push(parts.length > 1 ? `${defaults.bankId}-s${at + 1}-q${number}` : `${defaults.bankId}-q${number}`);
      // The set's own heading files its questions, when the tags say the line is a heading.
      if (parts.length > 1 && part.title && headings.has(part.title) && !draft.topic) draft.topic = part.title;
      drafts.push(draft);
      setOf.push(at + 1);
      questionPages.push(located[index]);
    });
    notes.push(...parsed.notes.map((note) => `${label}${note}`));
    if (part.answerSectionNote) notes.push(`${label}${part.answerSectionNote}`);
    // Slides are one set. A file split into sets is a document.
    if (parts.length === 1) {
      deckPages = parsed.deckPages ?? [];
      deck = Boolean(parsed.deck);
    }
  });
  if (parts.length > 1) notes.unshift(`The file holds ${parts.length} sets of questions, each numbered from 1. They were read one set at a time.`);
  const roleOf = new Map(deckPages.map((entry) => [entry.page, entry]));
  const isAnswerPage = (page: number): boolean => ["answer", "explanation", "answer-key"].includes(roleOf.get(page)?.kind ?? "");

  // Figures placed by where they sit: only on a page read by position, and only one that holds a
  // question. A document's figures are already in its text. An answer slide is kept whole, below.
  const regions = pages.map((page) => ({ page: page.page, boxes: isAnswerPage(page.page) ? [] : page.regions }));
  const figures: PdfFigureBox[] = [];
  const renders = new Map<string, RenderRequest>();
  let figureLabels = 0;
  for (const [page, boxes] of withoutDecorations(regions)) {
    boxes.forEach((box, index) => {
      const { labels, alt, ...place }: FigureRegion = box;
      figureLabels += labels?.length ?? 0;
      // The words taken out of the text with the drawing stay readable as its description.
      const described = alt ?? (labels?.length ? `Labels in the figure: ${labels.join(", ")}`.slice(0, 240) : undefined);
      figures.push({ ...place, page, name: `${base}-p${page}-fig${index + 1}.png`, ...(described ? { alt: described } : {}) });
    });
  }
  const linesByPage = new Map<number, PageLine[]>(pages.map((page) => [page.page, page.lines]));
  const placements = placeFigures(
    figures,
    drafts.map((draft, index) => ({ stem: draft.stem, sourcePage: questionPages[index].page, repeatsOn: questionPages[index].repeatsOn })),
    linesByPage,
    deckPages,
  );
  const converted = pdfDraftsToQuestions({ drafts, figures, placements, questionPages, linesByPage, deckPages, media: anchored.media, ids }, defaults);
  if (parts.length > 1) converted.questions.forEach((question, index) => { question.source.set = setOf[index]; });
  const byName = new Map(figures.map((figure) => [figure.name, figure]));
  for (const [assetId, name] of converted.figureOfAsset) {
    const figure = byName.get(name);
    if (figure) renders.set(assetId, { page: figure.page, box: { left: figure.left, top: figure.top, width: figure.width, height: figure.height } });
  }
  // A figure that came through the parser in the text is cut out of its page like any other.
  for (const question of converted.questions) {
    for (const asset of question.assets) {
      const found = figureAt(converted.assetTargets.get(asset.id) ?? "");
      if (!found) continue;
      const { left, top, width, height } = found.box;
      asset.filename = `${base}-p${found.page}-fig${found.index + 1}.png`;
      asset.mimeType = "image/png";
      asset.sourceFile = defaults.sourceFilename;
      asset.sourcePage = found.page;
      asset.derivation = "region-render";
      asset.bounds = { x: left, y: top, width, height };
      renders.set(asset.id, { page: found.page, box: { left, top, width, height } });
    }
  }

  // Each answer slide, whole, as the answer-reveal picture of its question.
  let answerPages = 0;
  let answerPagesWithMarks = 0;
  for (const entry of deckPages) {
    if (entry.kind !== "answer" || entry.questionPage === undefined) continue;
    const owners = questionPages.flatMap((located, index) => (located.page === entry.questionPage ? [index] : []));
    const question = owners.length === 1 ? converted.questions[owners[0]] : undefined;
    if (!question) continue;
    answerPages += 1;
    const marks = marksOnAnswerPage(pageByNumber.get(entry.questionPage)?.figures ?? [], pageByNumber.get(entry.page)?.figures ?? []);
    if (marks.length) answerPagesWithMarks += 1;
    const clean = question.assets.filter((asset) => asset.role === "stem");
    const asset = {
      id: `${question.id}-img-${question.assets.length + 1}`,
      filename: `${base}-p${entry.page}-answer.png`,
      mimeType: "image/png",
      sourceFile: defaults.sourceFilename,
      sourcePage: entry.page,
      role: "answer_reveal" as const,
      questionId: question.id,
      derivation: "page-render" as const,
      ...(clean.length === 1 ? { revealOf: clean[0].id } : {}),
    };
    question.assets.push(asset);
    renders.set(asset.id, { page: entry.page });
    if (!question.correctAnswer && !question.flags?.some((flag) => flag.type === "answer_needs_review")) {
      (question.flags ??= []).push({
        type: "answer_needs_review",
        message: marks.length
          ? `The answer is shown on the answer slide (page ${entry.page}) by a mark drawn beside a choice. AXOM does not read that mark. Open the slide in review and set the answer.`
          : `The answer slide (page ${entry.page}) repeats the question and prints no key AXOM could read. Open the slide in review and set the answer.`,
      });
    }
  }

  const tagged = pages.reduce((sum, page) => sum + page.coverage.tagged, 0);
  const all = pages.reduce((sum, page) => sum + page.coverage.all, 0);
  const placedTables = converted.questions.reduce((sum, question) =>
    sum + [question.stem, ...(question.choices.map((choice) => choice.blocks)), question.explanation ?? []].flat().filter((block) => block.type === "table").length, 0);
  const placedFigures = converted.questions.reduce((sum, question) => sum + question.assets.filter((asset) => asset.role !== "answer_reveal").length, 0);
  return {
    questions: converted.questions,
    issues: converted.issues,
    renders,
    unplaced: converted.unplaced,
    notes,
    report: {
      pages: pages.length,
      readByPosition: pages.some((page) => page.order === "position"),
      sets: parts.length,
      pageNumbersDropped,
      figureLabels,
      tables: anchored.media.filter((entry) => entry.kind === "table").length,
      tablesPlaced: placedTables,
      answerKeyTables,
      figures: figures.length + anchored.media.filter((entry) => entry.kind === "image").length,
      figuresPlaced: placedFigures,
      answerPages,
      answerPagesWithMarks,
      taggedShare: all ? tagged / all : 1,
      deck,
    },
  };
}
