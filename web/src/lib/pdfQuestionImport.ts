// ===========================================================================
// Questions out of a PDF's text. One entry point for the single-file and mass
// importers.
//
// An ordinary document is parsed as running text, and each question is given a
// page only where its wording is unique. A slide deck is read slide by slide
// (lib/deckPages), which gives every question its exact page, reads a question
// that is printed twice once, and keeps answer slides out of the question.
//
// The slide reading is only kept when the question parser returns exactly one
// question for every question slide. Anything else falls back to running text.
// ===========================================================================
import { readSlideDeck, type DeckPage, type SlideDeck } from "./deckPages";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "./questionParse";
import { assignDraftProvenancePages } from "./questionProvenance";

export interface PdfQuestions {
  drafts: ParsedQuestionDraft[];
  /** What the learner should know about how the file was read. */
  notes: string[];
  /** Set when the questions were rebuilt from the slides. */
  deck?: { questions: number; repeated: number; explanationSlides: number; otherSlides: number; paired: boolean };
  /** What each page is, whenever the document is a deck. The figure pass uses it. */
  deckPages?: DeckPage[];
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const pageList = (pages: readonly number[]) => (pages.length > 10 ? `${pages.slice(0, 10).join(", ")} and ${pages.length - 10} more` : pages.join(", "));

function readAsText(text: string, pages: string[]): ParsedQuestionDraft[] {
  const drafts = parseQuestionBlocks(text);
  assignDraftProvenancePages(drafts, pages);
  return drafts;
}

/** The deck's blocks through the question parser: one question per slide, or nothing. */
function readFromSlides(deck: SlideDeck): { drafts: ParsedQuestionDraft[]; keyApplied: boolean } | undefined {
  const attempts = deck.keyText ? [`${deck.text}\n\n${deck.keyText}`, deck.text] : [deck.text];
  for (const [attempt, source] of attempts.entries()) {
    const drafts = parseQuestionBlocks(source);
    if (drafts.length === deck.questions.length && drafts.every((draft) => draft.options.length >= 2)) {
      return { drafts, keyApplied: Boolean(deck.keyText) && attempt === 0 };
    }
  }
  return undefined;
}

export function parsePdfQuestions(text: string, pages: string[]): PdfQuestions {
  const deck = readSlideDeck(pages);
  if (!deck) return { drafts: readAsText(text, pages), notes: [] };

  if (!deck.paired) {
    // One question per page and nothing printed twice: an exam export as much
    // as a slide deck. Running text reads that well when the questions are
    // numbered, and it keeps what the slide reading would drop (a question
    // with two options, or none). So it stands unless it plainly failed: it
    // found far fewer questions than there are question pages, or a large
    // share of what it found has no options. Then the slides only supply the
    // pages running text could not: a question whose opening words are on
    // exactly one question page is on that page.
    const drafts = readAsText(text, pages);
    const whole = drafts.filter((draft) => draft.options.length >= 2).length;
    const broken = drafts.length - whole;
    const failed = whole < deck.questions.length * 0.8 || (broken >= 3 && broken >= drafts.length * 0.3);
    if (!failed) {
      const questionPages = deck.questions.map((entry) => ({ page: entry.questionPage, text: squash(pages[entry.questionPage - 1] ?? "") }));
      for (const draft of drafts) {
        const opening = squash(draft.stem).slice(0, 30);
        if (draft.sourcePage !== undefined || opening.length < 12) continue;
        const found = questionPages.filter((entry) => entry.text.includes(opening));
        if (found.length === 1) {
          draft.sourcePage = found[0].page;
          draft.questionSourcePage = found[0].page;
        }
      }
      return { drafts, notes: [], deckPages: deck.classified };
    }
  }

  const read = readFromSlides(deck);
  if (!read) return { drafts: readAsText(text, pages), notes: [] };
  const { drafts, keyApplied } = read;

  drafts.forEach((draft, index) => {
    const source = deck.questions[index];
    draft.sourcePage = source.questionPage;
    draft.questionSourcePage = source.questionPage;
    if (draft.explanation && source.explanationPage) draft.explanationSourcePage = source.explanationPage;
    if (draft.correctKey) {
      const page = source.answerLinePage ?? (keyApplied && deck.answerKeyPages.length === 1 ? deck.answerKeyPages[0] : undefined);
      if (page) draft.answerEvidencePage = page;
    }
    const warnings: string[] = [];
    const rules: string[] = [];
    if (source.continuationPages.length) {
      rules.push("deck.runs-over-slides");
      warnings.push(`This question runs over pages ${pageList([source.questionPage, ...source.continuationPages])}. Check it is complete.`);
    }
    if (source.scattered) {
      rules.push("deck.options-out-of-order");
      warnings.push(`On page ${source.questionPage} the answer options are not drawn in order. They were put back in order: check each option is whole.`);
    } else if (source.optionsFirst) {
      rules.push("deck.options-before-stem");
      warnings.push(`On page ${source.questionPage} the answer options are drawn before the question text. Check where the last option ends and the question begins.`);
    }
    if (source.looseTail) {
      rules.push("deck.loose-text");
      warnings.push(`Page ${source.questionPage} has text after its answer options, usually a table or the labels of a figure. It was added to the end of the question: check it belongs there.`);
    }
    if (warnings.length) {
      draft.warnings = [...(draft.warnings ?? []), ...warnings];
      draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), ...rules])];
      draft.needsReview = true;
    }
  });

  const repeated = deck.questions.filter((entry) => entry.answerPages.length > 0).length;
  const explanationSlides = deck.classified.filter((entry) => entry.kind === "explanation").length;
  const leftOut = deck.classified.filter((entry) => entry.kind === "other").map((entry) => entry.page);
  const unkeyed = drafts.filter((draft) => !draft.correctKey).length;
  const notes = [
    `Read slide by slide: ${plural(drafts.length, "question")}, one to a slide`
      + `${repeated ? `, ${repeated} printed again on an answer slide` : ""}`
      + `${explanationSlides ? `, ${plural(explanationSlides, "explanation slide")}` : ""}.`
      + `${leftOut.length ? ` ${plural(leftOut.length, "slide")} with no question ${leftOut.length === 1 ? "was" : "were"} left out (page${leftOut.length === 1 ? "" : "s"} ${pageList(leftOut)}).` : ""}`,
  ];
  if (!deck.ownNumbers) notes.push("Questions are numbered in slide order: the deck does not number every question, or starts its numbering again.");
  const keyPages = `page${deck.answerKeyPages.length === 1 ? "" : "s"} ${pageList(deck.answerKeyPages)}`;
  if (keyApplied) {
    notes.push(deck.keyMatch === "order"
      ? `Answers were read from the answer key on ${keyPages} and matched to the questions in slide order, because the slides are not numbered. Check a few against the source.`
      : `Answers were read from the answer key on ${keyPages}.`);
  } else if (deck.answerKeyPages.length) {
    notes.push(`An answer key was found on ${keyPages}, but it could not be matched to the questions${deck.keyMatch ? "" : ": the slides are not numbered and the key does not list one answer for each of them"}. Set those answers in review.`);
  }
  if (unkeyed > 0) notes.push(`${plural(unkeyed, "question")} ${unkeyed === 1 ? "has" : "have"} no answer in the text. A deck that marks the answer only by colour or bold cannot be read for it: set ${unkeyed === 1 ? "that answer" : "those answers"} in review.`);
  if (deck.runningLinesDropped > 0) notes.push("Lines repeated on most slides (a header, footer or slide number) were left out.");

  return {
    drafts,
    notes,
    deck: { questions: drafts.length, repeated, explanationSlides, otherSlides: leftOut.length, paired: deck.paired },
    deckPages: deck.classified,
  };
}
