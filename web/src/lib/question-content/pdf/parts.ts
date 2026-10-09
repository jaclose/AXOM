// ===========================================================================
// A file can hold more than one set of questions, each numbered from 1: a
// biostatistics set and an epidemiology set in one document. Read as one
// stream, question 3 of one set and question 3 of the other look like a
// clash, and an answer key numbered 1 to 6 has two possible owners.
//
// This splits the text into its parts before the parser sees it, and gives a
// separate answer section to the one part it can belong to. It reads only
// the shape of lines: a number, a choice letter, the word "answer". It never
// decides what an answer is. The parser does that, from what is printed.
// ===========================================================================
import { parseAnswerSections } from "../../questionParse";

export interface TextPart {
  /** Page texts, in step with the file's pages: "" for a page this part has nothing on. */
  pages: string[];
  /** The short line printed just above the part's first question, when there is one. */
  title?: string;
  /** What was done with a separate answer section, when the part has one. */
  answerSectionNote?: string;
}

interface Line {
  page: number;
  text: string;
}

/** The heading the parser reads an answer section under. */
export const ANSWER_SECTION_HEADING = "Answers and Explanations:";

const NUMBERED = /^\s*(\d{1,3})[.)]\s+\S/;
const NUMBERED_ANSWER = /^\s*(\d{1,3})[.)]\s*(?:the\s+)?(?:correct\s+)?(?:answer|ans)\b\s*(?:is\b)?\s*[:.\-–]?/i;
const INLINE_ANSWER = /^\s*(?:the\s+)?(?:correct\s+)?(?:answer|ans)\b\s*(?:is\b)?\s*[:\-–]/i;
const CHOICE = /^\s*\(?[A-Ha-h][.)]\s+\S/;
const SAYS_ANSWERS = /\banswers?\b/i;

/** A line short and plain enough to be a heading: not a choice, a numbered line, an answer or a sentence. */
const headingLike = (text: string): boolean =>
  text.length > 0 && text.length <= 80 && !CHOICE.test(text) && !NUMBERED.test(text) && !INLINE_ANSWER.test(text) && !/AXOMANCHOR\d{4}X/.test(text);

/** The number of the question that starts on this line: a numbered line with at least two lettered choices before the next one. */
function questionStartingAt(lines: readonly Line[], at: number): number | undefined {
  const match = NUMBERED.exec(lines[at].text);
  if (!match || NUMBERED_ANSWER.test(lines[at].text)) return undefined;
  let choices = 0;
  for (let index = at + 1; index < Math.min(lines.length, at + 60); index += 1) {
    if (CHOICE.test(lines[index].text)) choices += 1;
    else if (NUMBERED.test(lines[index].text) && choices < 2) return undefined;
    if (choices >= 2) return Number(match[1]);
  }
  return undefined;
}

interface AnswerSection {
  /** First line, heading included. */
  from: number;
  /** The line of entry 1. */
  first: number;
  /** One past the last line. */
  to: number;
  /** The entry numbers, 1 upward with none missing. */
  numbers: number[];
}

/** Runs of numbered answers ("1. Answer: B") that begin at 1, with what is printed between them and the heading above. */
function answerSections(lines: readonly Line[]): AnswerSection[] {
  const sections: AnswerSection[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const first = NUMBERED_ANSWER.exec(lines[at].text);
    if (!first || Number(first[1]) !== 1) continue;
    const numbers = [1];
    let to = at + 1;
    for (; to < lines.length; to += 1) {
      const next = NUMBERED_ANSWER.exec(lines[to].text);
      if (next) {
        if (Number(next[1]) !== numbers[numbers.length - 1] + 1) break;
        numbers.push(Number(next[1]));
      } else if (questionStartingAt(lines, to) !== undefined) break;
    }
    if (numbers.length >= 2) {
      // The heading: the highest of the few short lines above that says "answers", and what sits under it.
      let from = at;
      let seen = 0;
      for (let above = at - 1; above >= 0 && seen < 3; above -= 1) {
        const text = lines[above].text.trim();
        if (!text) continue;
        if (!headingLike(text)) break;
        seen += 1;
        if (SAYS_ANSWERS.test(text)) from = above;
      }
      sections.push({ from, first: at, to, numbers });
    }
    at = to - 1;
  }
  return sections;
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

export function splitParts(pageTexts: readonly string[]): TextPart[] {
  const lines: Line[] = pageTexts.flatMap((text, page) => text.split("\n").map((line) => ({ page, text: line })));
  const starts = lines.flatMap((_, at) => {
    const number = questionStartingAt(lines, at);
    return number === undefined ? [] : [{ at, number }];
  });

  // A part begins where the numbering goes back to 1 after at least two questions.
  const partStarts: number[] = [];
  let sinceStart = 0;
  for (const start of starts) {
    if (start.number === 1 && (partStarts.length === 0 || sinceStart >= 2)) {
      partStarts.push(start.at);
      sinceStart = 0;
    }
    sinceStart += 1;
  }
  const count = Math.max(1, partStarts.length);
  // What comes before the first question (a title, instructions) stays with the first part.
  const owner = lines.map((_, at) => partStarts.reduce((part, start, index) => (at >= start ? index : part), 0));

  // The line just above a later part's first question heads that part. Left with the part before
  // it, it would read as the tail of that part's last choice.
  const titles = new Map<number, string>();
  for (let part = 0; part < partStarts.length; part += 1) {
    for (let above = partStarts[part] - 1; above >= 0; above -= 1) {
      const text = lines[above].text.trim();
      if (!text) continue;
      if (headingLike(text) && !/[.?!]$/.test(text) && !SAYS_ANSWERS.test(text)) {
        titles.set(part, text);
        if (part > 0) owner[above] = part;
      }
      break;
    }
  }

  const notes = new Map<number, string>();
  const rewrite = new Map<number, string>();
  const given = new Set<number>();
  const textOf = (part: number): string => lines.flatMap((line, at) => (owner[at] === part ? [rewrite.get(at) ?? line.text] : [])).join("\n");
  const inlineAnswers = (part: number, outside?: AnswerSection): boolean =>
    lines.some((line, at) => owner[at] === part && !(outside && at >= outside.from && at < outside.to) && INLINE_ANSWER.test(line.text));

  for (const section of answerSections(lines)) {
    const holder = owner[section.first];
    if (holder < 0) continue;
    const inside = (at: number): boolean => at >= section.from && at < section.to;
    let part = 0;
    if (count > 1) {
      // It belongs to the one set that has exactly these question numbers and no answers of its own.
      const numbersOf = (candidate: number): number[] => starts.filter((start) => owner[start.at] === candidate && !inside(start.at)).map((start) => start.number);
      const fits = Array.from({ length: count }, (_, candidate) => candidate).filter((candidate) => !inlineAnswers(candidate, section) && sameNumbers(numbersOf(candidate), section.numbers));
      if (fits.length !== 1) {
        // A key that fits no set, or more than one, must not be read as anyone's key.
        for (let at = section.from; at < section.to; at += 1) owner[at] = -1;
        notes.set(holder, fits.length === 0
          ? `A separate section of ${section.numbers.length} numbered answers matches no set of questions by number. It was not applied.`
          : `A separate section of ${section.numbers.length} numbered answers could belong to more than one set of questions. It was not applied to either.`);
        continue;
      }
      part = fits[0];
    }
    for (let at = section.from; at < section.to; at += 1) owner[at] = part;
    given.add(part);
    // The parser reads an answer section only under a heading it knows. If it cannot read this
    // one as printed, the heading is put in the parser's words. The entries are not touched.
    const printed = lines.slice(section.from, section.to).map((line) => line.text).join("\n");
    const entries = lines.slice(section.first, section.to).map((line) => line.text).join("\n");
    const reads = (text: string): boolean => parseAnswerSections(`\n${text}`).entries.size >= section.numbers.length;
    const moved = part !== holder ? ` It is printed after another set, and is the only set it fits: the same ${section.numbers.length} numbers, and no answers of its own.` : "";
    if (reads(printed)) {
      if (count > 1) notes.set(part, `Its answers are a separate section of ${section.numbers.length}, numbered to match.${moved}`);
    } else if (reads(`${ANSWER_SECTION_HEADING}\n${entries}`)) {
      for (let at = section.from; at < section.first; at += 1) rewrite.set(at, "");
      rewrite.set(section.first, `${ANSWER_SECTION_HEADING}\n${lines[section.first].text}`);
      notes.set(part, `Its answers are a separate section of ${section.numbers.length}, numbered to match, under a heading the parser does not know. The heading was read as "${ANSWER_SECTION_HEADING}".${moved}`);
    } else {
      notes.set(part, `A separate section of ${section.numbers.length} numbered answers could not be read by the parser. Its answers were not applied.`);
    }
  }

  // A key in any other shape, printed after the last set, is read by the parser as the last
  // set's. That is only safe when every set before it has answers of its own.
  const last = count - 1;
  if (count > 1 && !given.has(last)) {
    const text = textOf(last);
    const read = parseAnswerSections(text);
    const answered = (part: number): boolean => given.has(part) || inlineAnswers(part) || parseAnswerSections(textOf(part)).entries.size > 0;
    const open = Array.from({ length: last }, (_, part) => part).filter((part) => !answered(part));
    if (read.entries.size > 0 && open.length > 0) {
      const mine = lines.flatMap((_, at) => (owner[at] === last ? [at] : []));
      // The parser keeps what is above the section's heading. Everything from the heading on is the section.
      const kept = text.startsWith(read.body) ? (read.body.match(/\n/g) ?? []).length : undefined;
      const cut = kept === undefined ? mine.filter((at) => /^\s*answers?\s*[:\-–]/i.test(lines[at].text)) : mine.slice(kept);
      for (const at of cut) owner[at] = -1;
      notes.set(last, `An answer section of ${read.entries.size} is printed after the last set, and ${open.length === 1 ? "an earlier set has" : "earlier sets have"} no answers of ${open.length === 1 ? "its" : "their"} own. It could belong to more than one set, so it was not applied.`);
    }
  }

  // One set, nothing moved and nothing reworded: the text goes on exactly as it came.
  if (count === 1 && rewrite.size === 0) return [{ pages: [...pageTexts], ...(notes.has(0) ? { answerSectionNote: notes.get(0)! } : {}) }];
  return Array.from({ length: count }, (_, part) => {
    const pages = pageTexts.map((_, page) =>
      lines.flatMap((line, at) => (line.page === page && owner[at] === part ? [rewrite.get(at) ?? line.text] : [])).join("\n"));
    const title = titles.get(part);
    const note = notes.get(part);
    return { pages, ...(title ? { title } : {}), ...(note ? { answerSectionNote: note } : {}) };
  });
}
