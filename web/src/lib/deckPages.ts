// ===========================================================================
// Slide decks. A deck puts one question on a slide and follows a small
// grammar around it, which running text cannot show:
//
//   question     a stem and one run of answer options (A, B, C ...)
//   continuation the same question carried onto the next slide
//   answer       a later slide that prints a question again, usually with the
//                answer marked and something added
//   explanation  a slide with no options that opens "Answer: ..." or
//                "Explanation ...", or that follows an answer slide
//   answer-key   a page of "1. B" lines
//   other        a title or instruction slide
//
// Read as running text, a deck that repeats its questions imports every
// question twice, an unnumbered deck imports as one question, and nothing says
// which page a question is on. This pass reads the pages instead and rebuilds
// one block per question for the existing parser.
//
// Nothing is read from formatting or images: an answer the deck marks only in
// colour or bold stays unresolved. A mark written in the text of an answer
// slide (a tick, an asterisk, "(correct)") is text, and is passed to the parser
// on its option. Lines repeated across the deck (a header, footer or slide
// number) are dropped before anything is classified.
// ===========================================================================

export type DeckPageKind = "question" | "continuation" | "answer" | "explanation" | "answer-key" | "other";

export const DECK_PAGE_KIND_LABEL: Record<DeckPageKind, string> = {
  question: "Question slide",
  continuation: "Continues the question before it",
  answer: "Answer slide",
  explanation: "Explanation slide",
  "answer-key": "Answer key",
  other: "Title or instruction slide",
};

export interface DeckPage {
  /** 1-based. */
  page: number;
  kind: DeckPageKind;
  /** The question slide this page belongs to, for every kind that has one. */
  questionPage?: number;
  /** Why it was classed this way, in plain words. */
  evidence: string;
}

export interface DeckQuestion {
  /** The slide the question starts on. */
  questionPage: number;
  /** Slides its own text runs onto. */
  continuationPages: number[];
  /** Slides that print it again. Images there may give the answer away. */
  answerPages: number[];
  explanationPages: number[];
  /** The number its block carries in `text`. */
  number: number;
  /** The slide draws its options before its question text, so where the last option ends is a judgement. */
  optionsFirst: boolean;
  /** Text follows the options on the question slide and is not an option's wrapped line. It was added to the question. */
  looseTail: boolean;
  /** The slide draws its options out of order (D and E before A), so they were put back in order. */
  scattered: boolean;
  /** The page a written answer line ("Answer: C") came from. */
  answerLinePage?: number;
  /** The first page that added explanation text. */
  explanationPage?: number;
}

export interface SlideDeck {
  /** One numbered block per question, for the question parser. */
  text: string;
  /** The answer key's entries under an "Answer key" heading, when the key can be matched to the questions. */
  keyText?: string;
  /**
   * How the key is matched: by the numbers the slides carry, or, when they
   * carry none, in slide order, which is only done when the key lists exactly
   * 1 to the number of questions.
   */
  keyMatch?: "numbers" | "order";
  /** For each block, in order: where it came from. */
  questions: DeckQuestion[];
  classified: DeckPage[];
  /** Most questions have a slide that prints them again. */
  paired: boolean;
  /** Blocks keep the deck's own numbers. Otherwise they are numbered in deck order. */
  ownNumbers: boolean;
  answerKeyPages: number[];
  /** How many header, footer or slide-number lines were dropped. */
  runningLinesDropped: number;
  /** Every page's lines once those were dropped, by page (index 0 is page 1). */
  lines: string[][];
}

/** An answer option, with or without a mark in front of it. */
const OPTION_LINE = /^[*✓✔☑]?\s*\(?([A-Ha-h])[.)]\s*\S/;
/** An option the source marks as correct in its text. The parser reads and removes the mark. */
const MARKED_OPTION = /^[*✓✔☑]|[*✓✔☑]\s*$|\(\s*(?:correct(?:\s+answer)?|right)\s*\)\s*$/i;
const LEADING_NUMBER = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):]\s*/i;
/**
 * How an explanation opens: "Answer: C", "The correct answer is B",
 * "Explanation: ...". A bare "Answers" is a section title, not an explanation.
 */
const EXPLANATION_LEAD = /^(?:the\s+)?(?:correct\s+)?(?:answers?|option|choice)\s*(?:is\b|[:\-–=])|^(?:explanation|rationale|discussion|teaching\s+points?|key\s+concepts?)\s*(?:[:\-–]|$)/i;
/** A short line that states the answer. Passed to the parser untouched so it is read as the key. */
const ANSWER_LINE = /^(?:the\s+)?(?:correct\s+)?(?:answers?|option|choice)\s*(?:is\b|[:\-–=])/i;
const KEY_LINE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-–]?\s*\(?[A-Ha-h]\)?\.?$/i;
const SLIDE_NUMBER = /^\d{1,3}$/;
/** What the question parser could take for the start of another question. */
const QUESTION_START = /^(?:q(?:uestion)?\s*#?\s*:?\s*)?\d/i;
/** Shorter than this, the text before the options is a label, not a question. */
const MIN_STEM = 12;

const linesOf = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const key = (line: string) => line.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** As `key`, but blind to numbers: "Question 9" and "Question 10" are the same footer. */
const runningKey = (line: string) => line.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, "");
const wordsIn = (line: string) => line.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
const contentWords = (lines: readonly string[]) => new Set(lines.flatMap(wordsIn));
const nextLetter = (letter: string) => String.fromCharCode(letter.charCodeAt(0) + 1);
const optionLetter = (line: string) => OPTION_LINE.exec(line)?.[1].toUpperCase();

/**
 * Header and footer lines, and slide numbers. A line is running text when it
 * sits on most pages. A number alone on a line is a slide number when it
 * tracks the page count, or sits at the edge of the slide and climbs through
 * the deck. Answer options are never dropped: a deck can ask every question
 * against the same options.
 */
function withoutRunningLines(pages: readonly string[]): { cleaned: string[][]; dropped: number } {
  const all = pages.map(linesOf);
  const counts = new Map<string, number>();
  for (const lines of all) {
    for (const line of new Set(lines.filter((entry) => !OPTION_LINE.test(entry)).map(runningKey))) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const threshold = Math.max(4, pages.length * 0.5);
  const running = new Set([...counts.entries()].filter(([line, count]) => line.replace(/#/g, "").length >= 3 && count >= threshold).map(([line]) => line));
  const kept = all.map((lines) => lines.filter((line) => OPTION_LINE.test(line) || !running.has(runningKey(line))));

  const offsets = new Map<number, number>();
  kept.forEach((lines, index) => {
    for (const value of new Set(lines.filter((line) => SLIDE_NUMBER.test(line)).map(Number))) {
      const offset = value - index - 1;
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
  });
  const commonest = [...offsets.entries()].sort((a, b) => b[1] - a[1])[0];
  const offset = commonest && commonest[1] >= Math.max(4, pages.length * 0.3) ? commonest[0] : undefined;
  const edges = kept.flatMap((lines) => {
    const edge = [lines[0], lines[lines.length - 1]].find((line) => line !== undefined && SLIDE_NUMBER.test(line));
    return edge === undefined ? [] : [Number(edge)];
  });
  const climbing = edges.length >= 4 && edges.every((value, index) => index === 0 || value > edges[index - 1]);

  const cleaned = kept.map((lines, index) => lines.filter((line, at) => {
    if (!SLIDE_NUMBER.test(line)) return true;
    if (offset !== undefined && Number(line) === index + 1 + offset) return false;
    return !(climbing && (at === 0 || at === lines.length - 1));
  }));
  const count = (pagesOfLines: readonly string[][]) => pagesOfLines.reduce((total, lines) => total + lines.length, 0);
  return { cleaned, dropped: count(all) - count(cleaned) };
}

interface OptionRun {
  /** Indexes of the option lines, in letter order. */
  at: number[];
  last: string;
  /** The lines are not in letter order on the slide. */
  scattered?: boolean;
}

/** Runs of options that start at A and climb. A stray "F) ..." in a stem is not one. */
function optionRuns(lines: readonly string[]): OptionRun[] {
  const runs: OptionRun[] = [];
  let current: OptionRun | undefined;
  lines.forEach((line, index) => {
    const letter = optionLetter(line);
    if (!letter) return;
    if (letter === "A") {
      current = { at: [index], last: "A" };
      runs.push(current);
    } else if (current && letter === nextLetter(current.last)) {
      current.at.push(index);
      current.last = letter;
    }
  });
  return runs.filter((run) => run.at.length >= 3);
}

/**
 * One list drawn out of order: a run from A, and two or more other option
 * lines that carry on from it, each letter once (D and E set above A, B, C).
 * A single stray line is left alone: "F) ..." in a stem is a temperature.
 */
function scatteredRun(lines: readonly string[], runs: readonly OptionRun[]): OptionRun | undefined {
  if (runs.length !== 1) return undefined;
  const all = lines.flatMap((line, index) => {
    const letter = optionLetter(line);
    return letter ? [{ index, letter }] : [];
  });
  if (all.length - runs[0].at.length < 2) return undefined;
  const ordered = [...all].sort((a, b) => a.letter.localeCompare(b.letter));
  if (!ordered.every((entry, index) => entry.letter === String.fromCharCode(65 + index))) return undefined;
  return { at: ordered.map((entry) => entry.index), last: ordered[ordered.length - 1].letter, scattered: true };
}

/**
 * A slide can draw its option list twice (a second copy laid over the first).
 * When every later run repeats the first, the copies go and one list is left.
 * Runs that differ are different questions and are returned untouched.
 */
function withoutRepeatedRuns(lines: readonly string[], runs: readonly OptionRun[]): { lines: string[]; runs: OptionRun[] } {
  if (runs.length < 2) return { lines: [...lines], runs: [...runs] };
  const first = runs[0].at.map((at) => key(lines[at]));
  const copies = runs.slice(1);
  if (!copies.every((run) => run.at.length === first.length && run.at.every((at, index) => key(lines[at]) === first[index]))) return { lines: [...lines], runs: [...runs] };
  const drop = new Set(copies.flatMap((run) => run.at));
  const kept = lines.filter((_, index) => !drop.has(index));
  return { lines: kept, runs: optionRuns(kept).slice(0, 1) };
}

/**
 * A line inside a question that opens with a number ("5.0 mg/dL" wrapped off
 * an option) would be read as the start of another question. One slide is one
 * question, so such a line is joined to the line it follows.
 */
function joinNumberedLines(lines: readonly string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    if (joined.length && !OPTION_LINE.test(line) && QUESTION_START.test(line)) joined[joined.length - 1] += ` ${line}`;
    else joined.push(line);
  }
  return joined;
}

/** The same wording, allowing one copy a few extra characters in front: its question number. */
function sameText(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.length - shorter.length <= 6 && longer.endsWith(shorter);
}

/**
 * Some decks print a block of text twice in a row: once set wide, then again
 * wrapped. When a run of lines is spelled again by the lines straight after
 * it, the first copy goes.
 */
function withoutDoubledStem(stem: readonly string[]): string[] {
  const keys = stem.map(key);
  for (let from = 0; from < stem.length - 1; from += 1) {
    let first = "";
    for (let split = from + 1; split < stem.length; split += 1) {
      first += keys[split - 1];
      if (first.length < 40) continue;
      let second = "";
      for (let end = split; end < stem.length && second.length < first.length + 6; end += 1) {
        second += keys[end];
        if (second.length >= first.length - 6 && sameText(first, second)) return [...stem.slice(0, from), ...stem.slice(split)];
      }
    }
  }
  return [...stem];
}

const stemText = (stem: readonly string[]) => stem.join(" ").replace(LEADING_NUMBER, "").trim();

interface SlideParts {
  stem: string[];
  /** The options, with their wrapped lines. */
  options: string[];
  /** Text after the options that is not an option's wrapped line: a table, or a figure's labels. */
  loose: string[];
  /** An answer or explanation written on the question slide itself. */
  own: string[];
  optionsFirst: boolean;
  scattered?: boolean;
}

function splitSlide(lines: readonly string[], run: OptionRun): SlideParts {
  if (run.scattered) {
    // Out of order: the options are taken on their own, in letter order, and
    // every other line after the first of them is loose text.
    const start = Math.min(...run.at);
    const taken = new Set(run.at);
    const rest = lines.slice(start).filter((_, index) => !taken.has(start + index));
    const led = rest.findIndex((line) => EXPLANATION_LEAD.test(line));
    const text = (led < 0 ? rest : rest.slice(0, led)).filter((line) => key(line));
    const stem = withoutDoubledStem(lines.slice(0, start));
    const asked = stemText(stem).length >= MIN_STEM;
    return {
      stem: asked ? stem : withoutDoubledStem([...stem, ...text]),
      options: run.at.map((at) => lines[at]),
      loose: asked ? text : [],
      own: led < 0 ? [] : rest.slice(led),
      optionsFirst: !asked,
      scattered: true,
    };
  }
  const first = run.at[0];
  const lastOption = run.at[run.at.length - 1];
  const wraps = run.at.slice(1).map((at, index) => at - run.at[index] - 1);
  const before = withoutDoubledStem(lines.slice(0, first));
  const after = lines.slice(lastOption + 1);
  const lead = after.findIndex((line) => EXPLANATION_LEAD.test(line));
  const tail = lead < 0 ? after : after.slice(0, lead);
  const own = lead < 0 ? [] : after.slice(lead);
  if (stemText(before).length >= MIN_STEM) {
    // The last option may wrap as far as the longest wrap among the others.
    // Anything past that is not part of an option.
    const wrapped = Math.min(tail.length, Math.max(...wraps));
    return { stem: before, options: lines.slice(first, lastOption + 1 + wrapped), loose: tail.slice(wrapped).filter((line) => key(line)), own, optionsFirst: false };
  }
  // The options were drawn first, so the question text follows them. The last
  // option is given only the shortest wrap among the others.
  const wrapped = Math.min(tail.length, Math.min(...wraps));
  return { stem: withoutDoubledStem([...before, ...tail.slice(wrapped)]), options: lines.slice(first, lastOption + 1 + wrapped), loose: [], own, optionsFirst: true };
}

interface Reading {
  page: number;
  stem: string[];
  options: string[];
  loose: string[];
  own: string[];
  ownNumber?: number;
  lastLetter: string;
  optionsFirst: boolean;
  scattered: boolean;
  opening: string;
  /** The last words of the stem: where the question itself is asked. */
  closing: string;
  /** The opening of each answer option. */
  optionOpenings: string[];
  words: Set<string>;
  continuation: number[];
  answers: Array<{ page: number; lines: string[] }>;
  explanations: Array<{ page: number; lines: string[] }>;
}

function reading(page: number, parts: SlideParts, lastLetter: string): Reading {
  const number = LEADING_NUMBER.exec(parts.stem.join(" "))?.[1];
  const stem = key(stemText(parts.stem));
  return {
    page, stem: parts.stem, options: parts.options, loose: parts.loose, own: parts.own, lastLetter,
    ownNumber: number ? Number(number) : undefined,
    optionsFirst: parts.optionsFirst,
    scattered: Boolean(parts.scattered),
    opening: stem.slice(0, 40),
    closing: stem.slice(-40),
    optionOpenings: parts.options.filter((line) => OPTION_LINE.test(line)).map((line) => key(line).slice(0, 24)),
    words: contentWords([...parts.stem, ...parts.options, ...parts.loose, ...parts.own]),
    continuation: [], answers: [], explanations: [],
  };
}

/**
 * Does this slide print that question again? Judged on wording, not on lines:
 * an answer slide often sets the stem smaller, so it breaks in other places.
 * The stem has to open and close the same way and the options have to match:
 * two questions on one vignette share most of their words but ask, and offer,
 * different things.
 */
function repeatsQuestion(question: Reading, lines: readonly string[]): boolean {
  if (question.opening.length < 16 || !question.words.size) return false;
  const text = key(lines.join(" "));
  if (!text.includes(question.opening) || !text.includes(question.closing)) return false;
  if (question.optionOpenings.filter((option) => text.includes(option)).length < question.optionOpenings.length * 0.8) return false;
  const there = contentWords(lines);
  let shared = 0;
  for (const word of question.words) if (there.has(word)) shared += 1;
  return shared / question.words.size >= 0.8;
}

const keyNumbers = (lines: readonly string[]) => lines.flatMap((line) => KEY_LINE.exec(line)?.[1] ?? []).map(Number);
const isAnswerKey = (lines: readonly string[]) => {
  const entries = keyNumbers(lines).length;
  return entries >= 3 && entries >= lines.length * 0.5;
};

interface Slides {
  classified: DeckPage[];
  questions: Reading[];
  /** Pages that hold more than one question: the document is running text, not slides. */
  crowded: number[];
  keyPages: number[];
  cleaned: string[][];
  dropped: number;
}

function readSlides(pages: readonly string[]): Slides {
  const { cleaned, dropped } = withoutRunningLines(pages);
  // A page printed three times or more is a stock slide (a table of normal
  // values, a "next question" card), not the explanation of one question.
  const printed = new Map<string, number>();
  for (const lines of cleaned) printed.set(key(lines.join("")), (printed.get(key(lines.join(""))) ?? 0) + 1);
  const classified: DeckPage[] = [];
  const questions: Reading[] = [];
  const crowded: number[] = [];
  const keyPages: number[] = [];
  /** The question the page before this one belongs to. */
  let owner: Reading | undefined;

  cleaned.forEach((raw, index) => {
    const page = index + 1;
    const single = withoutRepeatedRuns(raw, optionRuns(raw));
    const { lines } = single;
    const scattered = scatteredRun(lines, single.runs);
    const runs = scattered ? [scattered] : single.runs;
    cleaned[index] = lines;
    const previous = classified[index - 1];

    if (runs.length) {
      const repeated = questions.find((question) => repeatsQuestion(question, lines));
      if (repeated) {
        repeated.answers.push({ page, lines });
        classified.push({ page, kind: "answer", questionPage: repeated.page, evidence: `prints the question on page ${repeated.page} again` });
        owner = repeated;
        return;
      }
      if (runs.length > 1) {
        crowded.push(page);
        classified.push({ page, kind: "other", evidence: `${runs.length} sets of answer options: more than one question` });
        owner = undefined;
        return;
      }
      const parts = splitSlide(lines, runs[0]);
      if (stemText(parts.stem).length >= MIN_STEM) {
        const question = reading(page, parts, runs[0].last);
        questions.push(question);
        classified.push({ page, kind: "question", evidence: `${runs[0].at.length} answer options${parts.scattered ? ", drawn out of order" : parts.optionsFirst ? ", drawn before the question text" : ""}` });
        owner = question;
        return;
      }
      // Options and nothing to ask: the question text is the slide before, if that slide has any.
      const before = index > 0 ? cleaned[index - 1] : [];
      if (previous?.kind === "other" && !crowded.includes(page - 1) && before.some((line) => line.length >= 20)) {
        const question = reading(page - 1, { ...parts, stem: withoutDoubledStem(before), loose: parts.stem.filter((line) => key(line)), optionsFirst: false }, runs[0].last);
        question.continuation.push(page);
        questions.push(question);
        classified[index - 1] = { page: page - 1, kind: "question", evidence: `question text, with its answer options on page ${page}` };
        classified.push({ page, kind: "continuation", questionPage: page - 1, evidence: `the answer options for the question on page ${page - 1}` });
        owner = question;
        return;
      }
      classified.push({ page, kind: "other", evidence: "answer options with no question text" });
      owner = undefined;
      return;
    }

    if (isAnswerKey(lines)) {
      keyPages.push(page);
      classified.push({ page, kind: "answer-key", evidence: "a list of question numbers and letters" });
      owner = undefined;
      return;
    }
    if (owner) {
      const letters = lines.flatMap((line) => optionLetter(line) ?? []);
      if ((previous?.kind === "question" || previous?.kind === "continuation") && letters[0] === nextLetter(owner.lastLetter)) {
        owner.options.push(...lines);
        for (const letter of letters) if (letter === nextLetter(owner.lastLetter)) owner.lastLetter = letter;
        owner.continuation.push(page);
        owner.words = contentWords([...owner.stem, ...owner.options, ...owner.loose, ...owner.own]);
        owner.optionOpenings = owner.options.filter((line) => OPTION_LINE.test(line)).map((line) => key(line).slice(0, 24));
        classified.push({ page, kind: "continuation", questionPage: owner.page, evidence: `carries on the answer options from page ${page - 1}` });
        return;
      }
      const text = lines.join(" ");
      if (lines.slice(0, 3).some((line) => EXPLANATION_LEAD.test(line)) && text.length >= 40) {
        owner.explanations.push({ page, lines });
        classified.push({ page, kind: "explanation", questionPage: owner.page, evidence: `opens with an answer or explanation, after the question on page ${owner.page}` });
        return;
      }
      if ((previous?.kind === "answer" || previous?.kind === "explanation") && text.length >= 60 && (printed.get(key(lines.join(""))) ?? 0) < 3) {
        owner.explanations.push({ page, lines });
        classified.push({ page, kind: "explanation", questionPage: owner.page, evidence: `follows the answer slide for the question on page ${owner.page}` });
        return;
      }
    }
    owner = undefined;
    const options = lines.filter((line) => OPTION_LINE.test(line)).length;
    classified.push({ page, kind: "other", evidence: options ? `only ${options} answer option${options === 1 ? "" : "s"}` : "no answer options" });
  });
  return { classified, questions, crowded, keyPages, cleaned, dropped };
}

export function classifyDeckPages(pages: readonly string[]): DeckPage[] {
  return readSlides(pages).classified;
}

/** A deck is paired when most of its questions are printed again on another slide. */
function isPaired(questions: readonly Reading[]): boolean {
  const repeated = questions.filter((question) => question.answers.length > 0).length;
  return repeated >= 3 && repeated >= questions.length * 0.6;
}

/**
 * With no repeats to go on, pages are only read as slides when the document
 * plainly is a question deck: most pages are one question, and most of those
 * questions ask something.
 */
function isQuestionPerSlide(slides: Slides): boolean {
  const filled = slides.cleaned.filter((lines) => lines.length > 0).length;
  const asking = slides.questions.filter((question) => /\?|:\s*$/.test(stemText(question.stem))).length;
  return slides.questions.length >= 3 && slides.questions.length >= filled * 0.6 && asking >= slides.questions.length * 0.5;
}

/**
 * The document as a deck, or undefined when it is not one: a page holding
 * several questions means running text, which the ordinary parser reads better.
 */
export function readSlideDeck(pages: readonly string[]): SlideDeck | undefined {
  const slides = readSlides(pages);
  const { questions } = slides;
  if (slides.crowded.length > 0 || questions.length === 0) return undefined;
  const paired = isPaired(questions);
  if (!paired && !isQuestionPerSlide(slides)) return undefined;

  // The deck's own numbers are kept only when every slide has one and they
  // climb. A deck that restarts its numbering in each section is renumbered.
  const ownNumbers = questions.every((question, index) => (
    question.ownNumber !== undefined && (index === 0 || question.ownNumber > questions[index - 1].ownNumber!)
  ));

  const blocks: string[] = [];
  const read: DeckQuestion[] = [];
  questions.forEach((question, index) => {
    const number = ownNumbers ? question.ownNumber! : index + 1;
    // What follows the question, in page order: an explanation on its own
    // slide, what an answer slide adds (lines that are mostly new wording: a
    // stem line that breaks in a different place is not an addition), and its
    // explanation slides.
    const extra = [
      ...question.own.map((line) => ({ page: question.page, line })),
      ...question.answers.flatMap((slide) => slide.lines
        .filter((line) => {
          const words = wordsIn(line);
          return words.length > 0 && words.filter((word) => !question.words.has(word)).length / words.length >= 0.5 && !OPTION_LINE.test(line);
        })
        .map((line) => ({ page: slide.page, line }))),
      ...question.explanations.flatMap((slide) => slide.lines.map((line) => ({ page: slide.page, line }))),
    ].sort((a, b) => a.page - b.page);
    const answerLines = extra.filter((entry) => entry.line.length <= 90 && ANSWER_LINE.test(entry.line));
    const prose = extra.filter((entry) => !answerLines.includes(entry));
    // An option the answer slide marks in its text replaces the unmarked one,
    // so the parser reads the mark by its own rule and takes it off the option.
    const marked = new Map<string, { line: string; page: number }>();
    for (const slide of question.answers) {
      for (const line of slide.lines) {
        const letter = optionLetter(line);
        if (letter && MARKED_OPTION.test(line) && !marked.has(letter)) marked.set(letter, { line, page: slide.page });
      }
    }
    const options = question.options.map((line) => {
      const letter = optionLetter(line);
      const mark = letter ? marked.get(letter) : undefined;
      return mark && !MARKED_OPTION.test(line) ? mark.line : line;
    });
    blocks.push([
      // Loose text is put with the question, before the options, on one line:
      // left after them it would be read as part of the last option.
      `${number}. ${[stemText(question.stem), ...question.loose].join(" ")}`,
      ...joinNumberedLines(options),
      ...answerLines.map((entry) => entry.line),
      ...(prose.length ? [`Explanation: ${prose.map((entry) => entry.line).join(" ").replace(/^(?:explanation|rationale|discussion)\s*[:\-–]?\s*/i, "")}`] : []),
    ].join("\n"));
    read.push({
      questionPage: question.page,
      continuationPages: question.continuation,
      answerPages: question.answers.map((slide) => slide.page),
      explanationPages: question.explanations.map((slide) => slide.page),
      number,
      optionsFirst: question.optionsFirst,
      looseTail: question.loose.length > 0,
      scattered: question.scattered,
      answerLinePage: answerLines[0]?.page ?? [...marked.values()][0]?.page,
      explanationPage: prose[0]?.page,
    });
  });

  const keyLines = slides.keyPages.flatMap((page) => slides.cleaned[page - 1]).filter((line) => KEY_LINE.test(line));
  const listed = keyNumbers(keyLines);
  const keyMatch = !keyLines.length ? undefined
    : ownNumbers ? "numbers" as const
    : listed.length === questions.length && listed.every((value, index) => value === index + 1) ? "order" as const
    : undefined;
  return {
    text: blocks.join("\n\n"),
    keyText: keyMatch ? ["Answer key", ...keyLines].join("\n") : undefined,
    keyMatch,
    questions: read,
    classified: slides.classified,
    paired,
    ownNumbers,
    answerKeyPages: slides.keyPages,
    runningLinesDropped: slides.dropped,
    lines: slides.cleaned,
  };
}
