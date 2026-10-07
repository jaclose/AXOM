// ===========================================================================
// What a question asks for, read from its wording. Deterministic: the same
// text always gives the same reading, and every reading here is an inference
// from the words, not a fact about the question. Callers label it that way.
//
// The cue checks follow the item-writing flaws exam boards teach writers to
// avoid (a longest option that is the key, "all of the above", absolute
// terms, a stem word repeated in the answer). They matter to a learner because
// a bank full of them rewards test-wiseness instead of knowledge.
// ===========================================================================
import { questionMappingStatus, type QuestionRecord } from "../questions";

export type QuestionTask =
  | "recall" | "mechanism" | "diagnosis" | "treatment" | "prediction" | "comparison" | "interpretation" | "other";

export const QUESTION_TASK_LABEL: Record<QuestionTask, string> = {
  recall: "Recall",
  mechanism: "Mechanism",
  diagnosis: "Diagnosis",
  treatment: "Treatment",
  prediction: "Predicting a change",
  comparison: "Telling two things apart",
  interpretation: "Reading data or an image",
  other: "Other",
};

export type ItemCue =
  | "negative-stem"
  | "longest-option-is-answer"
  | "all-or-none-option"
  | "absolute-term-in-distractor"
  | "stem-word-in-answer"
  | "figure-missing";

export const ITEM_CUE_LABEL: Record<ItemCue, string> = {
  "negative-stem": "Asks for the exception (EXCEPT, NOT, LEAST)",
  "longest-option-is-answer": "The longest option is the answer",
  "all-or-none-option": "Has an \"all of the above\" or \"none of the above\" option",
  "absolute-term-in-distractor": "A wrong option uses \"always\" or \"never\"",
  "stem-word-in-answer": "The answer repeats a distinctive word from the stem",
  "figure-missing": "The stem points to a figure, but no image is attached",
};

export interface QuestionFeatures {
  task: QuestionTask;
  /** 1 answer directly, 2 one inference, 3 an unstated step in between. */
  reasoningDepth: 1 | 2 | 3;
  /** A patient, a setting and findings, rather than a bare question. */
  vignette: boolean;
  stemWords: number;
  /** Values and findings the stem makes the reader sift. */
  dataPoints: number;
  negativeStem: boolean;
  optionCount: number;
  /** 0..1: how much the options share words with each other. */
  optionSimilarity: number;
  referencesFigure: boolean;
  hasExhibit: boolean;
  cues: ItemCue[];
}

const VIGNETTE = /\b\d{1,3}[- ]?(?:year|month|week|day)s?[- ]old\b|\b(?:man|woman|boy|girl|infant|neonate|patient|child)\b[^.?]{0,120}\b(?:presents?|comes?|brought|complains?|is evaluated|is admitted|reports?)\b/i;
const NEGATIVE = /\b(?:EXCEPT|NOT|LEAST|FALSE|INCORRECT)\b|\bleast likely\b|\ball of the following except\b/;
const FIGURE = /\b(?:figure|image|photograph|radiograph|x-?ray|ecg|ekg|micrograph|histolog\w+ (?:slide|section)|shown (?:below|above|here)|pictured|arrow|labell?ed)\b/i;
const DATA_POINT = /\b\d+(?:\.\d+)?\s?(?:mg\/d[lL]|mmol\/L|mEq\/L|g\/d[lL]|mm ?Hg|\/min|bpm|°[CF]|%|U\/L|ng\/m[lL]|µ?[mg]\/L|mOsm\/kg|cells\/µ?L|mm3)\b/g;
const FINDING = /\b(?:shows?|reveals?|demonstrates?|is notable for|on examination|laboratory (?:studies|findings))\b/gi;

const TASK_PATTERNS: Array<[QuestionTask, RegExp]> = [
  ["treatment", /\b(?:next (?:best )?step|most appropriate (?:next step|management|treatment|therapy|pharmacotherapy|drug|intervention)|drug of choice|best (?:initial |next )?(?:treatment|management|therapy)|should be (?:administered|prescribed|given)|treatment of choice)\b/i],
  ["prediction", /\b(?:would (?:most likely )?(?:increase|decrease|result in|cause|be expected)|expected (?:to|change|finding)|most likely to (?:increase|decrease)|which (?:set of )?(?:changes|findings) (?:is|are|would)|what (?:happens|would happen) to)\b|[↑↓]/i],
  ["mechanism", /\b(?:mechanism(?: of action)?|pathophysiolog\w+|pathogenesis|underlying (?:cause|defect|mechanism)|acts? by|inhibits?|binds? to|is (?:due to|caused by) (?:a |an )?(?:defect|deficien\w+|mutation|absence))\b/i],
  ["comparison", /\b(?:differ(?:s|ence|entiates?)|distinguish\w*|in contrast to|compared (?:to|with)|unlike)\b/i],
  ["diagnosis", /\b(?:most likely (?:diagnosis|cause|condition|explanation|organism|pathogen)|what is the diagnosis|which (?:condition|disease|disorder|organism)|is most consistent with)\b/i],
  ["interpretation", /\b(?:the (?:graph|table|tracing|curve|figure|image) (?:shows?|above|below)|interpret\w*|is indicated by the (?:arrow|letter))\b/i],
];

const STOP_WORDS = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were which with most likely following patient".split(" "));

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) ?? [];
}

function contentWords(text: string): Set<string> {
  return new Set(words(text).filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** The sentence that poses the question: the last one, where exam stems put it. */
function leadIn(stem: string): string {
  const sentences = stem.split(/(?<=[.?!])\s+/).filter((sentence) => sentence.trim());
  return sentences.slice(-2).join(" ");
}

export function questionFeatures(question: QuestionRecord): QuestionFeatures {
  const stem = question.stem;
  const ask = leadIn(stem);
  const vignette = VIGNETTE.test(stem);
  const task = TASK_PATTERNS.find(([, pattern]) => pattern.test(ask))?.[0]
    ?? (!vignette && words(stem).length <= 40 ? "recall" : "other");
  // A vignette that asks for a drug, a mechanism or a change hides a step: the
  // diagnosis has to be made first and is never asked for.
  const reasoningDepth: 1 | 2 | 3 = vignette && (task === "treatment" || task === "mechanism" || task === "prediction")
    ? 3
    : vignette || task === "mechanism" || task === "comparison" || task === "prediction" || task === "interpretation" ? 2 : 1;

  const optionWords = question.options.map((option) => contentWords(option.text));
  let pairs = 0;
  let shared = 0;
  for (let left = 0; left < optionWords.length; left += 1) {
    for (let right = left + 1; right < optionWords.length; right += 1) {
      pairs += 1;
      shared += overlap(optionWords[left], optionWords[right]);
    }
  }

  const negativeStem = NEGATIVE.test(ask);
  const referencesFigure = FIGURE.test(stem);
  const hasExhibit = (question.attachments ?? []).some((attachment) => attachment.role === "exhibit");
  const correctKey = questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
  const answer = question.options.find((option) => option.key === correctKey);

  const cues: ItemCue[] = [];
  if (negativeStem) cues.push("negative-stem");
  if (question.options.some((option) => /\b(?:all|none) of the above\b/i.test(option.text))) cues.push("all-or-none-option");
  if (answer && question.options.length >= 3) {
    const others = question.options.filter((option) => option.key !== answer.key);
    const longestOther = Math.max(...others.map((option) => option.text.length));
    // Clearly longer, not a few characters: writers qualify the key and forget the rest.
    if (answer.text.length >= longestOther * 1.4 && answer.text.length - longestOther >= 12) cues.push("longest-option-is-answer");
    if (others.some((option) => /\b(?:always|never)\b/i.test(option.text))) {
      cues.push("absolute-term-in-distractor");
    }
    const stemWords = contentWords(stem);
    const distinctive = [...contentWords(answer.text)].filter((word) => word.length >= 7 && stemWords.has(word));
    const elsewhere = others.some((option) => distinctive.some((word) => contentWords(option.text).has(word)));
    if (distinctive.length > 0 && !elsewhere) cues.push("stem-word-in-answer");
  }
  if (referencesFigure && !hasExhibit) cues.push("figure-missing");

  return {
    task,
    reasoningDepth,
    vignette,
    stemWords: words(stem).length,
    dataPoints: (stem.match(DATA_POINT)?.length ?? 0) + (stem.match(FINDING)?.length ?? 0),
    negativeStem,
    optionCount: question.options.length,
    optionSimilarity: pairs ? Math.round((shared / pairs) * 100) / 100 : 0,
    referencesFigure,
    hasExhibit,
    cues,
  };
}
