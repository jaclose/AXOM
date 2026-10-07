// ===========================================================================
// What a deck's own answer and explanation slides teach about a question.
//
// lib/deckPages reads a deck by its slides and knows, for each question,
// which later slides print it again and which explain it. Review decks often
// lay those slides out in sections: why the answer is right, why each other
// option is not, and one line to carry forward. This reads those sections
// into a source analysis.
//
// It reads headed sections only. A slide of unheaded prose is already the
// question's explanation after import, and guessing a rule out of prose would
// put words in the source's mouth. It never reads or changes an answer key.
// What it produces is a proposal: the learner reviews it before it teaches.
// ===========================================================================
import { readSlideDeck, type DeckQuestion } from "../deckPages";
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import { questionSourceFingerprint } from "./analysis";
import { ANALYSIS_LIMITS, type DistractorNote, type QuestionAnalysis, type SourceTrace } from "./types";

export interface SlideTeaching {
  /** The teaching slide's own title. */
  concept?: string;
  explanation?: string;
  rule?: string;
  distractors: DistractorNote[];
  lecture?: string;
}

type Section = "why" | "others" | "rule" | "answer" | "skip";

/**
 * Section titles as review decks write them, longest first so "why not the
 * others" is not read as "why". A title of several words is taken wherever it
 * opens a line. A single common word ("why", "answer") also opens ordinary
 * sentences, so it counts as a title only when it stands alone, is followed
 * by a colon or dash, or is set in capitals.
 */
const HEADINGS: ReadonlyArray<readonly [label: string, section: Section, distinct: boolean]> = [
  ["why not the others", "others", true], ["why the others are wrong", "others", true], ["why the other options are wrong", "others", true],
  ["why it's right", "why", true], ["why it is right", "why", true], ["why this is right", "why", true],
  ["if the stem changes", "skip", true], ["conceptual framework", "skip", true],
  ["high-yield", "rule", true], ["high yield", "rule", true], ["carry this", "rule", true], ["take-home", "rule", true],
  ["take home", "rule", true], ["key point", "rule", true],
  ["the others", "others", false], ["other options", "others", false], ["the rule", "rule", false], ["hook", "rule", false],
  ["explanation", "why", false], ["rationale", "why", false], ["answer", "answer", false], ["why", "why", false],
];

/** A title set in spaced capitals ("W H Y") comes out of a PDF with gaps between its letters. */
function headingPattern(label: string): RegExp {
  const letters = [...label.replace(/ /g, "")].map((char) => (char === "'" ? "['’]?" : char === "-" ? "[-–\\s]?" : char));
  return new RegExp(`^[✓✔■▪•\\s]*(${letters.join("[ \\t]*")})([ \\t]*[:–-][ \\t]*|[ \\t]+|$)(.*)$`, "i");
}
const HEADING_PATTERNS = HEADINGS.map(([label, section, distinct]) => ({ section, distinct, pattern: headingPattern(label) }));
const BOTH_COLUMNS = /^why(?:it['’]?sright|itisright)?why(?:not)?theothers/;

/** The section a line opens, and what shares the line with its title. */
function headingOf(line: string): { section: Section; tail: string } | undefined {
  for (const { section, distinct, pattern } of HEADING_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const [, title, separator, tail] = match;
    const alone = !tail.trim();
    const marked = /[:–-]/.test(separator);
    const capitals = title === title.toUpperCase() && /[A-Z]/.test(title);
    if (distinct || alone || marked || capitals) return { section, tail: tail.trim() };
  }
  return undefined;
}

const squash = (line: string) => line.toLowerCase().replace(/[\s·•]+/g, "");
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const LECTURE = /^(?:l\s*e\s*c\s*t\s*u\s*r\s*e|d\s*l\s*a)\s*\d/i;
const QUESTION_LABEL = /^q(?:uestion)?\s*(?:\d\s*){1,4}(?:[·•.:)\-–]\s*|\s+|$)/i;
const OPTION_LEAD = /^([A-Ha-h])(?:[.)·:]\s*|\s+)(\S.*)$/;
const BULLET = /^[■▪•✓✔]\s*/;

interface TeachingPage { page: number; lines: readonly string[]; kind: "answer" | "explanation" }

/**
 * The teaching sections on a question's answer and explanation slides. Only
 * another option of this question can be a distractor: never its answer, and
 * never a letter the question does not have.
 */
export function readSlideTeaching(
  pages: readonly TeachingPage[],
  question: Pick<QuestionRecord, "options" | "correctKey">,
): SlideTeaching {
  const keys = new Set(question.options.map((option) => option.key.toUpperCase()));
  const answerKey = question.correctKey?.toUpperCase();
  const why: string[] = [];
  const rule: string[] = [];
  const distractors = new Map<string, string[]>();
  let concept: string | undefined;
  let lecture: string | undefined;

  for (const page of pages) {
    const lines = page.lines.map((line) => line.trim()).filter(Boolean).map((line, index) => {
      // "Q12 · Why it's right": the label goes, and what follows it is read as the line.
      const label = index === 0 ? QUESTION_LABEL.exec(line) : null;
      return label ? line.slice(label[0].length).trim() : line;
    }).filter(Boolean);
    for (const line of lines) if (LECTURE.test(line)) lecture ??= collapse(line).slice(0, ANALYSIS_LIMITS.lecture);

    const opens = (line: string) => BOTH_COLUMNS.test(squash(line)) || Boolean(headingOf(line));
    const first = lines.findIndex(opens);
    if (first < 0) continue;
    // Above the first section title of an explanation slide sits the slide's own title.
    // An answer slide prints the question there instead, so nothing above is read.
    if (page.kind === "explanation" && !concept) {
      const title = lines.slice(0, first).find((line) => !LECTURE.test(line) && line.length <= 90 && !/^\d+$/.test(line) && !line.endsWith("?"));
      if (title) concept = title.slice(0, ANALYSIS_LIMITS.concept);
    }

    let section: Section = "skip";
    let current: string | undefined;
    let bothColumns = false;
    for (const raw of lines.slice(first)) {
      if (LECTURE.test(raw)) continue;
      let line = raw;
      if (BOTH_COLUMNS.test(squash(line))) {
        // Two columns under one line of titles: lettered lines are the other options, the rest is why it is right.
        section = "why";
        bothColumns = true;
        current = undefined;
        continue;
      }
      const heading = headingOf(line);
      if (heading) {
        section = heading.section;
        current = undefined;
        bothColumns = false;
        if (!heading.tail) continue;
        line = heading.tail;
      }
      const lead = OPTION_LEAD.exec(line);
      const letter = lead?.[1].toUpperCase();
      const lettered = Boolean(letter && keys.has(letter));
      if ((section === "others" || (section === "why" && bothColumns)) && lettered) {
        // A line for the answer itself, under "why not the others", is not a distractor: it ends the one before.
        current = letter === answerKey ? undefined : letter;
        if (current) distractors.set(current, [...(distractors.get(current) ?? []), lead![2]]);
      } else if (section === "others" && current) {
        distractors.get(current)?.push(line);
      } else if (section === "why") {
        current = undefined;
        why.push(line.replace(BULLET, ""));
      } else if (section === "rule") {
        rule.push(line.replace(BULLET, ""));
      }
    }
  }

  const explanation = collapse(why.join(" ")).slice(0, ANALYSIS_LIMITS.explanation);
  const ruleText = collapse([...new Set(rule)].join(" ")).slice(0, ANALYSIS_LIMITS.rule);
  return {
    ...(concept ? { concept } : {}),
    ...(explanation ? { explanation } : {}),
    ...(ruleText ? { rule: ruleText } : {}),
    distractors: [...distractors.entries()]
      .map(([key, lines]) => ({ key, whyWrong: collapse(lines.join(" ")).slice(0, ANALYSIS_LIMITS.listItem * 2) }))
      .filter((note) => note.whyWrong),
    ...(lecture ? { lecture } : {}),
  };
}

type DeckPlace = Pick<DeckQuestion, "questionPage" | "answerPages" | "explanationPages">;

/**
 * A document's pages read as a deck, once. The teaching block asks again on
 * every render, and reading a few hundred slides each time would be felt.
 * A stored document's page list is never changed in place, so the list itself
 * is the key; when the document is replaced, the old reading goes with it.
 */
const DECKS = new WeakMap<readonly string[], ReturnType<typeof readSlideDeck> | null>();
function deckOf(pages: readonly string[]) {
  let deck = DECKS.get(pages);
  if (deck === undefined) {
    deck = readSlideDeck(pages) ?? null;
    DECKS.set(pages, deck);
  }
  return deck ?? undefined;
}

/**
 * Source analyses a stored deck can offer for the questions that came from
 * it, as proposals. A question is matched to its slide by its page. Nothing is
 * offered for a question that already has a source analysis that still fits
 * (reviewed, waiting or rejected: the learner has it in hand), for one whose
 * page holds two questions, or when the slides add no rule and no reason
 * against another option.
 */
export function sourceTeachingProposals(
  document: Pick<SourceDocument, "id" | "checksum" | "pageTexts">,
  questions: readonly QuestionRecord[],
  now: string,
): QuestionAnalysis[] {
  const pages = document.pageTexts;
  if (!pages?.length) return [];
  const deck = deckOf(pages);
  if (!deck) return [];
  const places = new Map<number, DeckPlace | null>();
  for (const place of deck.questions) places.set(place.questionPage, places.has(place.questionPage) ? null : place);
  const perPage = new Map<number, number>();
  const own = questions.filter((question) => question.sourceDocumentId === document.id && question.sourcePage);
  for (const question of own) perPage.set(question.sourcePage!, (perPage.get(question.sourcePage!) ?? 0) + 1);

  return own.flatMap((question) => {
    const place = places.get(question.sourcePage!);
    if (!place || perPage.get(question.sourcePage!) !== 1) return [];
    const fingerprint = questionSourceFingerprint(question, document);
    if ((question.analyses ?? []).some((analysis) => analysis.origin === "source" && analysis.sourceFingerprint === fingerprint)) return [];
    const teachingPages: TeachingPage[] = [
      ...place.answerPages.map((page) => ({ page, kind: "answer" as const })),
      ...place.explanationPages.map((page) => ({ page, kind: "explanation" as const })),
    ].sort((a, b) => a.page - b.page).map((entry) => ({ ...entry, lines: deck.lines[entry.page - 1] ?? [] }));
    if (!teachingPages.length) return [];
    const teaching = readSlideTeaching(teachingPages, question);
    if (!teaching.rule && teaching.distractors.length === 0) return [];
    // The question's own explanation is already on the question: it is not repeated here.
    const explanation = teaching.explanation && collapse(question.explanation ?? "") !== teaching.explanation ? teaching.explanation : undefined;
    const cited: SourceTrace[] = [
      { documentId: document.id, page: place.questionPage, role: "question" },
      ...teachingPages.map((entry): SourceTrace => ({ documentId: document.id, page: entry.page, role: entry.kind === "answer" ? "answer" : "teaching" })),
    ];
    const references = cited.slice(0, ANALYSIS_LIMITS.references);
    return [{
      // One source analysis per question: reading the deck again replaces the proposal it made before.
      id: `source-${question.id}`,
      questionId: question.id,
      sourceFingerprint: fingerprint,
      version: 1,
      origin: "source",
      status: "proposed",
      concept: teaching.concept ?? question.topic ?? `Question ${question.questionNumber ?? place.questionPage}`,
      ...(teaching.rule ? { rule: teaching.rule } : {}),
      ...(explanation ? { explanation } : {}),
      decisiveClues: [],
      mechanism: [],
      distractors: teaching.distractors,
      ...(teaching.lecture ? { lecture: teaching.lecture } : {}),
      references,
      generatedAt: now,
    } satisfies QuestionAnalysis];
  });
}
