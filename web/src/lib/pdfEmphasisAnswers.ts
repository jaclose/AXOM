// ===========================================================================
// Answer keys printed only as typography.
//
// Some "(Answers)" handouts set the correct choice in bold and print nothing
// else; review decks repeat each question slide with the correct choice
// recoloured (green beside grey or red siblings). The text layer the parser
// reads drops both signals. This pass reads them from the PDF's drawing
// operators and keys a question only when:
//   - exactly one of its printed choices is bold, or alone in its colour, and
//   - the whole document follows that convention: several sets mark one
//     choice, almost none mark more than one, a colour convention uses one
//     highlight colour, and keys the document also prints as text agree.
// Anything less leaves the question unkeyed. Nothing is inferred from meaning.
// ===========================================================================
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { multiply, type Matrix } from "./pdfMarkedAnswers";
import { refreshDraftConfidence, type ParsedQuestionDraft } from "./questionParse";
import { INFERRED_OR_AMBIGUOUS_ANSWER_RULES } from "./questionImportTrust";

type PdfJs = typeof import("pdfjs-dist");
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;

/** One printed choice line: its letter, its own words, and how they were set. */
export interface PrintedChoice { key: string; text: string; bold: boolean; color: string }
/** Consecutively lettered choices as printed, with the words just above them. */
export interface PrintedChoiceSet { page: number; lead: string; choices: PrintedChoice[] }
export type EmphasisKind = "bold" | "color";
/** How consistently a document uses one kind of emphasis to mark a single choice. */
export interface EmphasisTally {
  kind: EmphasisKind;
  /** Sets of three or more choices with exactly one marked choice. */
  marked: number;
  /** Sets of three or more choices where several, but not all, choices are marked. */
  conflicting: number;
  /** Share of marked sets that use the most common highlight colour (colour only). */
  highlightShare: number;
  /** Questions with an explicitly printed text key that the marks agree or disagree with. */
  agree: number;
  disagree: number;
}
export interface EmphasisResult { notes: string[]; keyed: number; conflicts: number; tallies: EmphasisTally[]; accepted: EmphasisKind[] }

interface Run { order: number; x: number; y: number; size: number; text: string; font: string; color: string }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const OPTION_LABEL = /^\s*\(?([A-Ja-j])\s*[.):]\s*/;
const BOLD_FONT = /bold|black|heavy|semibold|demi/i;
const MIXED = "mixed";
/** A document must mark one choice in at least this many sets to be trusted. */
const MIN_MARKED = 3;
const MISSING_KEY = "No correct answer was reliably detected";

const squash = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const toMatrix = (value: unknown): Matrix | undefined => {
  const numbers = Array.from((value ?? []) as ArrayLike<number>);
  return numbers.length === 6 && numbers.every(Number.isFinite) ? numbers as Matrix : undefined;
};

function glyphText(glyphs: unknown): string {
  if (!Array.isArray(glyphs)) return "";
  let text = "";
  for (const glyph of glyphs) {
    if (glyph && typeof glyph === "object" && "unicode" in glyph) text += String((glyph as { unicode?: unknown }).unicode ?? "");
  }
  return text;
}

/** Every shown string on a page with its baseline, size, font and fill colour. */
async function readPageRuns(pdfjs: PdfJs, page: PdfPage): Promise<Run[]> {
  const { OPS } = pdfjs;
  const list = await page.getOperatorList();
  const runs: Run[] = [];
  const stack: Array<{ ctm: Matrix; color: string; font: string; fontSize: number; leading: number }> = [];
  let ctm = IDENTITY, color = "#000000", font = "", fontSize = 1, leading = 0;
  let lineMatrix = IDENTITY, textMatrix = IDENTITY;
  const moveLine = (tx: number, ty: number) => { lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, tx, ty]); textMatrix = lineMatrix; };
  const show = (glyphs: unknown) => {
    const text = glyphText(glyphs);
    if (!text.trim()) return;
    const device = multiply(ctm, textMatrix);
    runs.push({ order: runs.length, x: device[4], y: device[5], size: Math.hypot(device[2], device[3]) * fontSize, text, font, color });
  };
  for (let index = 0; index < list.fnArray.length; index++) {
    const op = list.fnArray[index], args = list.argsArray[index] ?? [];
    if (op === OPS.save) stack.push({ ctm, color, font, fontSize, leading });
    else if (op === OPS.restore) ({ ctm, color, font, fontSize, leading } = stack.pop() ?? { ctm, color, font, fontSize, leading });
    else if (op === OPS.transform) ctm = multiply(ctm, toMatrix(args) ?? IDENTITY);
    else if (op === OPS.paintFormXObjectBegin) { stack.push({ ctm, color, font, fontSize, leading }); ctm = multiply(ctm, toMatrix(args[0]) ?? IDENTITY); }
    else if (op === OPS.paintFormXObjectEnd) ({ ctm, color, font, fontSize, leading } = stack.pop() ?? { ctm, color, font, fontSize, leading });
    else if (op === OPS.setFillRGBColor) color = String(args[0]).toLowerCase();
    else if (op === OPS.setFont) { font = String(args[0]); fontSize = Number(args[1]) || 1; }
    else if (op === OPS.beginText) { lineMatrix = IDENTITY; textMatrix = IDENTITY; }
    else if (op === OPS.setTextMatrix) { lineMatrix = toMatrix(args.length === 1 ? args[0] : args) ?? IDENTITY; textMatrix = lineMatrix; }
    else if (op === OPS.moveText) moveLine(Number(args[0]) || 0, Number(args[1]) || 0);
    else if (op === OPS.setLeadingMoveText) { leading = -(Number(args[1]) || 0); moveLine(Number(args[0]) || 0, Number(args[1]) || 0); }
    else if (op === OPS.setLeading) leading = Number(args[0]) || 0;
    else if (op === OPS.nextLine) moveLine(0, -leading);
    else if (op === OPS.showText || op === OPS.showSpacedText) show(args[0]);
    else if (op === OPS.nextLineShowText) { moveLine(0, -leading); show(args[0]); }
    else if (op === OPS.nextLineSetSpacingShowText) { moveLine(0, -leading); show(args[2]); }
  }
  return runs;
}

/** Runs sharing a baseline, top of the page first, each line read left to right. */
function linesOf(runs: readonly Run[]): Run[][] {
  const lines: Run[][] = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y || a.order - b.order)) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - run.y) <= Math.max(2, 0.4 * Math.max(line[0].size, run.size))) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x || a.order - b.order));
}

function choiceOf(line: readonly Run[], isBold: (font: string) => boolean): PrintedChoice | undefined {
  const label = line.map((run) => run.text).join("").match(OPTION_LABEL);
  if (!label) return undefined;
  const body: Run[] = [];
  let consumed = 0;
  for (const run of line) {
    const start = consumed;
    consumed += run.text.length;
    if (consumed <= label[0].length) continue;
    const own = start >= label[0].length ? run.text : run.text.slice(label[0].length - start);
    if (/[\p{L}\p{N}]/u.test(own)) body.push({ ...run, text: own });
  }
  if (!body.length) return undefined;
  const colors = new Set(body.map((run) => run.color));
  return {
    key: label[1].toUpperCase(),
    text: body.map((run) => run.text).join(" ").replace(/\s+/g, " ").trim(),
    bold: body.every((run) => isBold(run.font)),
    color: colors.size === 1 ? [...colors][0] : MIXED,
  };
}

/** Read every lettered choice set in a PDF with each choice's weight and colour. */
export async function readPrintedChoiceSets(buffer: ArrayBuffer, pdfjsOverride?: PdfJs, workerSrcOverride?: string): Promise<PrintedChoiceSet[]> {
  const pdfjs = pdfjsOverride ?? await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrcOverride ?? browserPdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) });
  const sets: PrintedChoiceSet[] = [];
  const boldFonts = new Map<string, boolean>();
  try {
    const doc = await task.promise;
    let current: PrintedChoiceSet | undefined;
    const close = () => {
      if (current && current.choices.length >= 2) sets.push(current);
      current = undefined;
    };
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const runs = await readPageRuns(pdfjs, page);
      const isBold = (font: string) => {
        if (!boldFonts.has(font)) {
          let face: { name?: string; bold?: boolean; black?: boolean } | undefined;
          try { face = page.commonObjs.get(font) as typeof face; } catch { face = undefined; }
          boldFonts.set(font, Boolean(face?.bold || face?.black || BOLD_FONT.test(face?.name ?? "")));
        }
        return boldFonts.get(font) ?? false;
      };
      let lead: string[] = [];
      for (const line of linesOf(runs)) {
        const choice = choiceOf(line, isBold);
        if (!choice) {
          lead = [...lead.slice(-1), line.map((run) => run.text).join(" ")];
          continue;
        }
        const previous = current?.choices.at(-1)?.key;
        if (choice.key === "A") {
          close();
          current = { page: number, lead: squash(lead.join(" ")), choices: [choice] };
        } else if (current && previous && choice.key.charCodeAt(0) === previous.charCodeAt(0) + 1) current.choices.push(choice);
        else close();
        lead = [];
      }
      page.cleanup();
    }
    close();
  } finally {
    await task.destroy();
  }
  return sets;
}

/** The one choice a set marks with `kind`, "conflict" when several are marked. */
export function markedChoice(set: PrintedChoiceSet, kind: EmphasisKind): string | "conflict" | undefined {
  if (kind === "bold") {
    const bold = set.choices.filter((choice) => choice.bold);
    if (bold.length === 1) return bold[0].key;
    return bold.length > 1 && bold.length < set.choices.length ? "conflict" : undefined;
  }
  if (set.choices.some((choice) => choice.color === MIXED)) return undefined;
  const counts = new Map<string, number>();
  for (const choice of set.choices) counts.set(choice.color, (counts.get(choice.color) ?? 0) + 1);
  if (counts.size === 1) return undefined;
  const odd = set.choices.filter((choice) => counts.get(choice.color) === 1);
  return counts.size === 2 && odd.length === 1 && set.choices.length >= 3 ? odd[0].key : "conflict";
}

/** The colour that marks the answer in a set already known to mark one choice. */
const highlightOf = (set: PrintedChoiceSet, key: string) => set.choices.find((choice) => choice.key === key)?.color ?? "";

/** Whether a document's marks are consistent enough to serve as its answer key. */
export function conventionHolds(tally: EmphasisTally): boolean {
  return tally.marked >= MIN_MARKED
    && tally.conflicting * 20 <= tally.marked
    && (tally.kind === "bold" || tally.highlightShare >= 0.9)
    && (tally.disagree === 0 || tally.disagree * 20 <= tally.agree);
}

function choicesMatch(set: PrintedChoiceSet, draft: ParsedQuestionDraft): boolean {
  if (set.choices.length !== draft.options.length) return false;
  return draft.options.every((option, index) => {
    const printed = set.choices[index];
    if (printed.key !== option.key.toUpperCase()) return false;
    const left = squash(printed.text), right = squash(option.text);
    const [short, long] = left.length <= right.length ? [left, right] : [right, left];
    return Boolean(short) && (short === long || (short.length >= 4 && long.startsWith(short)));
  });
}

/** Printed sets that are this draft's choices. Identical choice lists elsewhere
 * in the document must also share the words printed above them. */
function printingsOf(draft: ParsedQuestionDraft, sets: readonly PrintedChoiceSet[]): PrintedChoiceSet[] {
  const matching = sets.filter((set) => choicesMatch(set, draft));
  if (matching.length <= 2) return matching;
  const stem = squash(draft.stem);
  return matching.filter((set) => set.lead.length >= 12 && stem.includes(set.lead.slice(-30)));
}

const addRule = (draft: ParsedQuestionDraft, rule: string) => {
  draft.parserRuleIds = [...new Set([...(draft.parserRuleIds ?? []), rule])];
};

/** Apply a document's typographic answer marks to its drafts (mutates drafts). */
export function applyEmphasisAnswers(drafts: ParsedQuestionDraft[], sets: readonly PrintedChoiceSet[]): EmphasisResult {
  const kinds: EmphasisKind[] = ["bold", "color"];
  const printings = new Map(drafts.map((draft) => [draft, draft.options.length >= 2 ? printingsOf(draft, sets) : []]));
  const marksOf = (draft: ParsedQuestionDraft, kind: EmphasisKind) => (printings.get(draft) ?? [])
    .flatMap((set) => { const key = markedChoice(set, kind); return key && key !== "conflict" ? [{ key, set }] : []; });

  const tallies = kinds.map((kind): EmphasisTally => {
    const marked: PrintedChoiceSet[] = [];
    let conflicting = 0;
    for (const set of sets) {
      if (set.choices.length < 3) continue;
      const key = markedChoice(set, kind);
      if (key === "conflict") conflicting++;
      else if (key) marked.push(set);
    }
    const highlights = new Map<string, number>();
    for (const set of marked) {
      const color = highlightOf(set, markedChoice(set, kind) as string);
      highlights.set(color, (highlights.get(color) ?? 0) + 1);
    }
    // A key inferred from explanation prose is weaker evidence than the marks,
    // so only explicitly printed keys vouch for or against the convention.
    let agree = 0, disagree = 0;
    for (const draft of drafts) {
      if (!draft.correctKey || (draft.parserRuleIds ?? []).some((rule) => INFERRED_OR_AMBIGUOUS_ANSWER_RULES.has(rule))) continue;
      const keys = new Set(marksOf(draft, kind).map((mark) => mark.key));
      if (keys.size !== 1) continue;
      if (keys.has(draft.correctKey.toUpperCase())) agree++;
      else disagree++;
    }
    return { kind, marked: marked.length, conflicting, highlightShare: marked.length ? Math.max(...highlights.values()) / marked.length : 0, agree, disagree };
  });
  const accepted = tallies.filter(conventionHolds).map((tally) => tally.kind);
  if (!accepted.length) return { notes: [], keyed: 0, conflicts: 0, tallies, accepted };

  let keyed = 0, conflicts = 0;
  const keyedBy = new Map<EmphasisKind, number>();
  for (const draft of drafts) {
    const marks = accepted.flatMap((kind) => marksOf(draft, kind).map((mark) => ({ ...mark, kind })));
    if (!marks.length) continue;
    const keys = new Set(marks.map((mark) => mark.key));
    const existing = draft.correctKey?.toUpperCase();
    if (keys.size > 1 || (existing && !keys.has(existing))) {
      conflicts++;
      addRule(draft, "conflict.pdf-emphasis");
      draft.needsReview = true;
      draft.warnings.push(existing
        ? `The printed answer ${existing} is not the choice the document marks in bold or colour (${[...keys].join(", ")}). Check the source.`
        : `The document marks different choices (${[...keys].join(", ")}) in its printings of this question. Check the source.`);
      continue;
    }
    if (existing) continue;
    const [{ key, set, kind }] = marks;
    const tally = tallies.find((entry) => entry.kind === kind)!;
    const evidence = `Option ${key} is the only ${kind === "bold" ? "bold" : "differently coloured"} choice on page ${set.page}; `
      + `this document marks one choice that way in ${tally.marked} question sets.`;
    draft.correctKey = key;
    draft.correctAnswerText = draft.options.find((option) => option.key.toUpperCase() === key)?.text;
    draft.answerDetectionConfidence = Math.max(draft.answerDetectionConfidence ?? 0, 0.9);
    draft.answerEvidence = draft.answerEvidence ?? evidence;
    draft.answerEvidenceSnippet = evidence;
    draft.answerEvidencePage = set.page;
    draft.warnings = draft.warnings.filter((warning) => !warning.startsWith(MISSING_KEY));
    addRule(draft, `answer.pdf-emphasis-${kind}`);
    // The missing key is usually a draft's only doubt; anything else keeps review.
    const ownDoubt = (draft.parserRuleIds ?? []).some((rule) => rule.startsWith("conflict.") || rule.includes("ambiguous") || rule.includes("malformed"))
      || draft.warnings.length > 0;
    if (!ownDoubt) draft.needsReview = false;
    refreshDraftConfidence(draft);
    keyed++;
    keyedBy.set(kind, (keyedBy.get(kind) ?? 0) + 1);
  }
  const notes = [...keyedBy].map(([kind, count]) => {
    const tally = tallies.find((entry) => entry.kind === kind)!;
    return `${count} answer ${count === 1 ? "key was" : "keys were"} read from ${kind === "bold" ? "bold" : "highlight-coloured"} choices. `
      + `This document marks exactly one choice that way in ${tally.marked} question sets.`;
  });
  if (conflicts) notes.push(`${conflicts} ${conflicts === 1 ? "question has" : "questions have"} bold or coloured marks that disagree with another printing or the printed answer. Check them against the source.`);
  return { notes, keyed, conflicts, tallies, accepted };
}

/** Read bold or colour-marked answers from a PDF into drafts that lack a key. */
export async function proposePdfEmphasisAnswers(
  buffer: ArrayBuffer, drafts: ParsedQuestionDraft[], pdfjsOverride?: PdfJs, workerSrcOverride?: string,
): Promise<string[]> {
  if (!drafts.some((draft) => draft.options.length >= 2 && !draft.correctKey)) return [];
  try {
    return applyEmphasisAnswers(drafts, await readPrintedChoiceSets(buffer, pdfjsOverride, workerSrcOverride)).notes;
  } catch {
    return ["Bold or coloured answer marks could not be read. Check unresolved answers against the source."];
  }
}
