import {
  DEFAULT_STUDY_WORKFLOW,
  toggleStudyMethod,
  type PracticeTiming,
  type StudyMethodId,
  type StudyWorkflowPreferences,
} from "./studyPreferences";

/**
 * Deterministic reading of the learner's own "how I study" words.
 *
 * Contract (docs/feature-development/2026-09-22/DEFERRED.md, Onboarding):
 * - fixed keyword and pattern rules only: no AI, network, randomness or clock;
 * - the original text is never modified; evidence is an exact substring of it;
 * - the result is a preview. Every suggestion must be confirmed by the learner
 *   and nothing is applied automatically;
 * - anything that is already true in the workflow is never suggested.
 */

export type StudySuggestionKind = "enable-method" | "lecture-passes" | "review-after-days" | "method-timing";

export interface StudySuggestion {
  /** Stable identity: the same text and workflow always produce the same ids. */
  id: string;
  kind: StudySuggestionKind;
  methodId?: StudyMethodId;
  /** Lecture passes or review days for numeric kinds; the timing for method-timing. */
  value?: number | PracticeTiming;
  /** A plain sentence describing exactly what Apply changes. */
  label: string;
  /** The exact, unmodified phrase from the learner's text that matched. */
  evidence: string;
}

export const MAX_STUDY_SUGGESTIONS = 8;
/** Mirrors the Settings limits (normalizeStudyWorkflow clamps to the same range). */
export const LECTURE_PASS_LIMITS = { min: 1, max: 6 } as const;
export const REVIEW_DAY_LIMITS = { min: 1, max: 14 } as const;
/** Method + timing evidence is shown together only while it stays short. */
const MAX_COMBINED_EVIDENCE = 60;
/** Negation words must sit within this many words before the phrase. */
const NEGATION_WINDOW_WORDS = 6;
/** Context (negation, review words, lecture words) is read within this many
 * characters of a phrase, which also keeps very long text linear. */
const CONTEXT_WINDOW = 160;
/** A timing phrase attaches only to a method mentioned this close to it. */
const MAX_ATTACH_DISTANCE = 120;

const METHOD_PHRASE: Record<StudyMethodId, string> = {
  "lecture-passes": "lecture passes",
  "practice-questions": "question-based practice",
  anki: "Anki",
  quizlet: "Quizlet",
  noji: "Noji",
  remnote: "RemNote",
  notes: "notes / concept notes",
  "teach-aloud": "teaching aloud (Feynman)",
  recall: "recall sessions",
  "external-resource": "external resources",
  custom: "your other method",
};

const TIMING_PHRASE: Record<PracticeTiming, string> = {
  before: "before learning",
  "after-first-pass": "after the first pass",
  "after-learning": "after learning",
  "near-exam": "near an exam",
  ongoing: "throughout the course",
};

const TIMINGS = new Set<PracticeTiming>(["before", "after-first-pass", "after-learning", "near-exam", "ongoing"]);

/** Whitespace inside a phrase never crosses a line break. */
function rx(pattern: RegExp): RegExp {
  return new RegExp(pattern.source.replace(/\\s/g, "[^\\S\\r\\n]"), pattern.flags);
}

// Order matters only for ties: an earlier rule wins an identical span.
const METHOD_RULES: ReadonlyArray<{ methodId: StudyMethodId | null; pattern: RegExp }> = [
  { methodId: "anki", pattern: rx(/\b(?:anki(?:droid|web|hub)?|anking)\b/gi) },
  { methodId: "quizlet", pattern: rx(/\bquizlet\b/gi) },
  { methodId: "noji", pattern: rx(/\bnoji\b/gi) },
  { methodId: "remnote", pattern: rx(/\brem\s?note\b/gi) },
  {
    methodId: "practice-questions",
    pattern: rx(/\b(?:u\s?world|amboss|q-?banks?|question\s?banks?|truelearn|practice\s+(?:questions?|qs|problems?|exams?|tests?)|(?:do|doing|did)\s+(?:(?:practice|some|more|lots\s+of|a\s+lot\s+of)\s+)?(?:questions|qs))\b/gi),
  },
  {
    methodId: "external-resource",
    pattern: rx(/\b(?:boards?\s*(?:and|&|n)\s*beyond|b\s?&\s?b|bnb|pathoma|sketchy(?:\s?(?:micro|pharm|path))?|first\s?aid|you\s?tube|osmosis|ninja\s+nerd|lecturio|khan\s+academy|dirty\s+medicine|picmonic)\b/gi),
  },
  { methodId: "notes", pattern: rx(/\b(?:notes|note[- ]?taking|notion|obsidian|onenote|goodnotes|notability)\b/gi) },
  {
    methodId: "teach-aloud",
    // "teach myself" is self-study, so only teaching someone else counts.
    pattern: rx(/\b(?:teaching|teach[- ]back|teach\s+(?:it|them|others|someone|people|back)|teach\s+(?:(?:my|the|a|an|to)\s+)?(?:friends?|classmates?|roommates?|partners?|study\s+group|group|material|concepts?|topics?|content|siblings?|family|students?)|feynman(?:\s+technique)?|(?:explain|explaining|talk|talking|say|saying)\s+(?:(?:it|them|things|topics|concepts|everything)\s+)?(?:out\s+loud|aloud)|explain(?:ing)?\s+(?:(?:it|them|things|topics|concepts|everything)\s+)?to\s+(?:others|someone|people|friends?|classmates?|my\s+(?:friends?|classmates?|roommates?|partners?|study\s+group|family)))\b/gi),
  },
  { methodId: "recall", pattern: rx(/\b(?:active\s+recall|blurt(?:ing)?|free\s+recall|recall\s+sessions?|retrieval\s+practice|brain\s?dumps?)\b/gi) },
  { methodId: "lecture-passes", pattern: rx(/\blecture\s+pass(?:es)?\b/gi) },
  // Generic flashcards name no specific app. They still anchor nearby timing
  // phrases so that "flashcards every day" is never attached to another app.
  { methodId: null, pattern: rx(/\bflash\s?-?cards?\b/gi) },
];

/** "Anki cards", "Quizlet sets" and "Noji decks" are one mention. */
const METHOD_SUFFIX = rx(/\s+(?:flash\s?-?cards?|cards?|decks?|sets?)\b/y);

const COUNT = "once|twice|thrice|\\d{1,3}\\s*(?:x|times)\\b|(?:one|two|three|four|five|six|seven|eight|nine|ten)\\s+times";
const QUALIFIER = "(?:\\s+(?:at\\s+least|about|around|roughly|usually|normally|typically|generally|always))?";
const PASS_RULES: RegExp[] = [
  new RegExp(`\\b(?:re-?)?(?:watch|view|listen\\s+to|go\\s+(?:through|over)|run\\s+through|review)\\s+(?:(?:the|my|each|every|all|all\\s+the|most|a)\\s+)?(?:lectures?|lecture\\s+(?:videos?|recordings?)|recordings?)${QUALIFIER}\\s+(${COUNT})`, "gi"),
  /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:lecture\s+)?(?:passes|pass-throughs|run-throughs)\b/gi,
].map(rx);
/** "watch them twice" counts only when the same sentence is about lectures. */
const PASS_PRONOUN_RULE = rx(new RegExp(`\\b(?:re-?)?watch\\s+(?:them|it|each\\s+one|everything)${QUALIFIER}\\s+(${COUNT})`, "gi"));
const LECTURE_CONTEXT = /\blectures?\b/i;
/** A frequency ("twice a week") or playback speed ("2x speed") is not a pass count. */
const NOT_A_PASS_COUNT = /^\s*(?:speed|faster|(?:a|per|each|every)\s+(?:day|week|month)|an?\s+hour|daily|weekly)/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, once: 1, two: 2, twice: 2, couple: 2, other: 2, three: 3, thrice: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};
const SPACING_NUMBER = "\\d{1,3}|a\\s+couple(?:\\s+of)?|couple\\s+of|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen";
const SPACING_RULES: ReadonlyArray<{ pattern: RegExp; needsReviewContext: boolean }> = [
  { pattern: rx(/\bevery\s+(other|\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\s+(days?|weeks?)\b/gi), needsReviewContext: false },
  { pattern: rx(new RegExp(`\\b(?:after|in|within)\\s+(${SPACING_NUMBER})\\s+(days?|weeks?|months?)\\b`, "gi")), needsReviewContext: true },
  { pattern: rx(new RegExp(`\\b(${SPACING_NUMBER})\\s+(days?|weeks?|months?)\\s+later\\b`, "gi")), needsReviewContext: true },
  { pattern: rx(/\b(?:the\s+)?next\s+(day|week)\b/gi), needsReviewContext: true },
  { pattern: rx(/\b(?:every|each)\s+(week)\b|\b(weekly)\b/gi), needsReviewContext: true },
];
const REVIEW_CONTEXT = rx(/\b(?:review(?:s|ed|ing)?|revisit(?:s|ed|ing)?|revise|revising|go\s+(?:back|over)|come\s+back|re-?watch(?:es|ed|ing)?|re-?read(?:s|ing)?|recap|repeat|spaced|refresh|again)\b/i);

const TIMING_RULES: ReadonlyArray<{ timing: PracticeTiming; pattern: RegExp }> = [
  {
    timing: "near-exam",
    pattern: rx(/\b(?:(?:right|just|the\s+week)\s+before|before|leading\s+up\s+to|close\s+to|near|ahead\s+of|prior\s+to)\s+(?:(?:the|my|an?|each|every|our|big|final)\s+)*(?:exams?|tests?|boards|finals?|midterms?|quiz(?:zes)?|shelf(?:\s+exams?)?|nbmes?|step\s?[123]|comlex)\b|\bexam\s+(?:week|season|time|period|prep)\b|\b(?:during|in)\s+dedicated\b/gi),
  },
  {
    timing: "before",
    pattern: rx(/\b(?:before|prior\s+to|ahead\s+of)\s+(?:(?:the|each|every|my|a)\s+)?(?:lectures?|class(?:es)?)\b|\bpre-?(?:read(?:s|ing)?|lecture|view(?:s|ing)?|study(?:ing)?)\b|\bpreview(?:s|ing)?\b/gi),
  },
  {
    timing: "after-first-pass",
    pattern: rx(/\bafter\s+(?:(?:the|my|a|each|every)\s+)?(?:first\s+(?:pass|watch|read|viewing|time)|lectures?|class(?:es)?)\b|\bafter\s+watching(?:\s+(?:the|each|a|every))?(?:\s+lectures?)?\b/gi),
  },
  {
    timing: "after-learning",
    pattern: rx(/\bafter\s+(?:i(?:'ve|\s+have)?\s+)?(?:learn(?:ing|ed|t)?|cover(?:ing|ed)|finish(?:ing|ed)|study(?:ing)?|studied|master(?:ing|ed))\b(?:\s+(?:(?:the|a|each|every|my)\s+)?(?:material|topic|content|block|unit|system|chapter|module)s?\b)?|\bonce\s+i(?:'ve|\s+have)?\s+(?:learned|learnt|covered|finished|studied)\b|\bat\s+the\s+end\s+of\s+(?:the|each|every)\s+(?:week|block|unit|module|system|chapter)\b/gi),
  },
  {
    timing: "ongoing",
    pattern: rx(/\b(?:every\s?day|each\s+day|every\s+single\s+day|daily|throughout(?:\s+the\s+(?:course|semester|term|year|block))?|all\s+(?:semester|term|year|block|course)(?:\s+long)?|consistently|continuously|ongoing)\b/gi),
  },
];

/** Ends the reach of a preceding negation ("I don't use Quizlet, but I use Anki"). */
const NEGATION_SCOPE_BREAK = /[,:()\u2013\u2014]|\b(?:but|however|although|though|so|because|since|whereas|while|then|yet|and\s+(?:i|we|then|now))\b/gi;
const NEGATOR = /\b(?:not|no|never|don't|dont|do\s+not|doesn't|doesnt|does\s+not|didn't|didnt|did\s+not|won't|will\s+not|can't|cannot|no\s+longer|stopped|quit|without|avoid(?:ed)?|hate|dislike|instead\s+of|rather\s+than|nor|none)\b/i;
/** "not only Anki" and "don't just use Anki" affirm the method. */
const AFFIRMING_NEGATION = /\b(?:don't|dont|do\s+not|not)\s+(?:only|just)\b/gi;
/** "I'm used to Anki" is familiarity, not a past habit. */
const ACCUSTOMED = new Set(["am", "i'm", "im", "are", "we're", "is", "got", "get", "gets", "getting", "be", "been", "was", "were", "you're", "they're"]);
/** "Anki and Quizlet", "Anki, Noji or Quizlet": list items share one negation. */
const LIST_CONTINUATION = /^\s*,?\s*(?:(?:or|nor|and|&|plus)\s+)?$|^\s*\/\s*$/i;
/** Clause breaks used to prefer a timing phrase's own clause when attaching it. */
const ATTACH_BREAK = /[,:;()\u2013\u2014]|\b(?:and|or|but|however|although|though|so|because|since|whereas|while|then)\b/i;

interface Span { start: number; end: number; }
interface Mention extends Span { methodId: StudyMethodId | null; negated: boolean; }
interface Candidate { suggestion: StudySuggestion; position: number; rank: number; }

/**
 * Returns confirmation-only suggestions for `text`. Pure: neither argument is
 * modified, and identical input always yields identical output and ordering.
 */
export function interpretStudyText(text: string, workflow: StudyWorkflowPreferences): StudySuggestion[] {
  if (typeof text !== "string" || !text.trim()) return [];
  // Same-length copy so every index maps straight back to the original text.
  const search = text.replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'").replace(/\u00a0/g, " ");
  const breaks = sentenceBreaks(search);
  const mentions = findMentions(search, breaks);
  const candidates: Candidate[] = [];

  for (const mention of mentions) {
    if (!mention.methodId || mention.negated) continue;
    candidates.push({ suggestion: enableSuggestion(mention.methodId, text.slice(mention.start, mention.end)), position: mention.start, rank: 0 });
  }

  const passes = findPassCount(search, breaks);
  if (passes) {
    const evidence = text.slice(passes.start, passes.end);
    candidates.push({ suggestion: enableSuggestion("lecture-passes", evidence), position: passes.start, rank: 0 });
    candidates.push({ suggestion: numericSuggestion("lecture-passes", passes.value, passes.clamped, evidence), position: passes.start, rank: 1 });
  }

  const spacing = findReviewSpacing(search, breaks);
  if (spacing) {
    candidates.push({ suggestion: numericSuggestion("review-after-days", spacing.value, spacing.clamped, text.slice(spacing.evidence.start, spacing.evidence.end)), position: spacing.start, rank: 1 });
  }

  const timedMethods = new Set<StudyMethodId>();
  for (const phrase of findTimings(search, breaks)) {
    const anchor = nearestMention(search, breaks, mentions, phrase);
    // Generic flashcards and negated methods absorb the phrase: attaching it
    // to a farther method would be a guess.
    if (!anchor?.methodId || anchor.negated || timedMethods.has(anchor.methodId)) continue;
    timedMethods.add(anchor.methodId);
    const evidence = combinedEvidence(text, anchor, phrase);
    candidates.push({ suggestion: timingSuggestion(anchor.methodId, phrase.timing, evidence), position: anchor.start, rank: 1 });
  }

  // Sort before de-duplicating so the earliest evidence represents a method.
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => a.position - b.position || a.rank - b.rank || compareText(a.suggestion.id, b.suggestion.id))
    .filter(candidate => {
      if (seen.has(candidate.suggestion.id)) return false;
      seen.add(candidate.suggestion.id);
      return !alreadyTrue(candidate.suggestion, workflow);
    })
    .slice(0, MAX_STUDY_SUGGESTIONS)
    .map(candidate => candidate.suggestion);
}

/** Applies exactly one confirmed suggestion, preserving every other preference. */
export function applyStudySuggestion(workflow: StudyWorkflowPreferences, suggestion: StudySuggestion): StudyWorkflowPreferences {
  const { kind, methodId, value } = suggestion;
  if (kind === "enable-method") {
    if (!methodId || methodEnabled(workflow, methodId)) return workflow;
    // The shared toggle keeps labels, usage text and timings of every method.
    return toggleStudyMethod(workflow, methodId);
  }
  if (kind === "lecture-passes" && typeof value === "number") {
    return { ...workflow, configured: true, lecturePasses: clamp(value, LECTURE_PASS_LIMITS) };
  }
  if (kind === "review-after-days" && typeof value === "number") {
    return { ...workflow, configured: true, reviewAfterDays: clamp(value, REVIEW_DAY_LIMITS) };
  }
  if (kind === "method-timing" && methodId && typeof value === "string" && TIMINGS.has(value)) {
    const methods = workflow.methods ?? [];
    const next = methods.some(method => method.id === methodId)
      ? methods.map(method => method.id === methodId ? { ...method, timing: value } : method)
      : [...methods, { id: methodId, enabled: false, timing: value }];
    return { ...workflow, configured: true, methods: next };
  }
  return workflow;
}

/** "Apply all": the confirmed suggestions in their displayed order. */
export function applyStudySuggestions(workflow: StudyWorkflowPreferences, suggestions: readonly StudySuggestion[]): StudyWorkflowPreferences {
  return suggestions.reduce(applyStudySuggestion, workflow);
}

function enableSuggestion(methodId: StudyMethodId, evidence: string): StudySuggestion {
  return { id: `enable-method:${methodId}`, kind: "enable-method", methodId, label: `Turn on ${METHOD_PHRASE[methodId]}`, evidence };
}

function numericSuggestion(kind: "lecture-passes" | "review-after-days", value: number, clamped: boolean, evidence: string): StudySuggestion {
  const limit = clamped ? " (the most AXOM supports)" : "";
  const label = kind === "lecture-passes"
    ? `Set usual lecture passes to ${value}${limit}`
    : `Review again after ${value} day${value === 1 ? "" : "s"}${limit}`;
  return { id: `${kind}:${value}`, kind, value, label, evidence };
}

function timingSuggestion(methodId: StudyMethodId, timing: PracticeTiming, evidence: string): StudySuggestion {
  return {
    id: `method-timing:${methodId}:${timing}`,
    kind: "method-timing",
    methodId,
    value: timing,
    label: `Use ${METHOD_PHRASE[methodId]} ${TIMING_PHRASE[timing]}`,
    evidence,
  };
}

function alreadyTrue(suggestion: StudySuggestion, workflow: StudyWorkflowPreferences): boolean {
  switch (suggestion.kind) {
    case "enable-method": return suggestion.methodId ? methodEnabled(workflow, suggestion.methodId) : true;
    case "lecture-passes": return (workflow.lecturePasses ?? DEFAULT_STUDY_WORKFLOW.lecturePasses) === suggestion.value;
    case "review-after-days": return (workflow.reviewAfterDays ?? DEFAULT_STUDY_WORKFLOW.reviewAfterDays) === suggestion.value;
    case "method-timing": return workflow.methods?.find(method => method.id === suggestion.methodId)?.timing === suggestion.value;
  }
}

function methodEnabled(workflow: StudyWorkflowPreferences, methodId: StudyMethodId): boolean {
  return workflow.methods?.some(method => method.id === methodId && method.enabled) ?? false;
}

function clamp(value: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, Math.round(value)));
}

/** Indices that end a sentence. A period inside "1.5" or "e.g" does not. */
function sentenceBreaks(search: string): number[] {
  const breaks: number[] = [];
  for (let index = 0; index < search.length; index += 1) {
    const char = search[index];
    if (char === "\n" || char === "\r" || char === "!" || char === "?" || char === ";") breaks.push(index);
    else if (char === "." && !/\w/.test(search[index + 1] ?? "")) breaks.push(index);
  }
  return breaks;
}

function sentenceOf(breaks: number[], position: number): { index: number; start: number } {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (breaks[middle] < position) low = middle + 1;
    else high = middle;
  }
  return { index: low, start: low > 0 ? breaks[low - 1] + 1 : 0 };
}

/** Earliest match wins; a longer match wins a tie, then the earlier rule. */
function nonOverlapping<T extends Span>(spans: Array<T & { priority: number }>): T[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.priority - b.priority);
  const accepted: T[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start < lastEnd) continue;
    accepted.push(span);
    lastEnd = span.end;
  }
  return accepted;
}

function findMentions(search: string, breaks: number[]): Mention[] {
  const raw: Array<Span & { methodId: StudyMethodId | null; priority: number }> = [];
  METHOD_RULES.forEach(({ methodId, pattern }, priority) => {
    for (const match of search.matchAll(pattern)) {
      const start = match.index ?? 0;
      let end = start + match[0].length;
      if (methodId) {
        METHOD_SUFFIX.lastIndex = end;
        if (METHOD_SUFFIX.exec(search)) end = METHOD_SUFFIX.lastIndex;
      }
      raw.push({ start, end, methodId, priority });
    }
  });
  const mentions: Mention[] = [];
  for (const span of nonOverlapping(raw)) {
    const previous = mentions[mentions.length - 1];
    const sentence = sentenceOf(breaks, span.start);
    const continuesList = previous
      && sentenceOf(breaks, previous.start).index === sentence.index
      && LIST_CONTINUATION.test(search.slice(previous.end, span.start));
    const negated = continuesList ? previous.negated : isNegated(search, sentence.start, span.start);
    mentions.push({ start: span.start, end: span.end, methodId: span.methodId, negated });
  }
  return mentions;
}

function isNegated(search: string, sentenceStart: number, position: number): boolean {
  let scope = search.slice(Math.max(sentenceStart, position - CONTEXT_WINDOW), position);
  let cut = 0;
  for (const match of scope.matchAll(NEGATION_SCOPE_BREAK)) cut = (match.index ?? 0) + match[0].length;
  scope = scope.slice(cut);
  const words = scope.match(/\S+/g) ?? [];
  const tail = words.slice(-NEGATION_WINDOW_WORDS);
  if (NEGATOR.test(tail.join(" ").replace(AFFIRMING_NEGATION, " "))) return true;
  // "I used to use Quizlet" is a past habit; "I'm used to Anki" is not.
  return tail.some((word, index) => word.toLowerCase() === "used"
    && tail[index + 1]?.toLowerCase() === "to"
    && !ACCUSTOMED.has(tail[index - 1]?.toLowerCase() ?? ""));
}

function findPassCount(search: string, breaks: number[]): (Span & { value: number; clamped: boolean }) | undefined {
  const found: Array<Span & { value: number; priority: number }> = [];
  const consider = (match: RegExpMatchArray, priority: number) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (NOT_A_PASS_COUNT.test(search.slice(end, end + 16))) return;
    if (isNegated(search, sentenceOf(breaks, start).start, start)) return;
    const value = parseCount(match[1]);
    if (value !== undefined && value >= LECTURE_PASS_LIMITS.min) found.push({ start, end, value, priority });
  };
  PASS_RULES.forEach((pattern, priority) => { for (const match of search.matchAll(pattern)) consider(match, priority); });
  for (const match of search.matchAll(PASS_PRONOUN_RULE)) {
    const start = match.index ?? 0;
    if (LECTURE_CONTEXT.test(sentenceWindow(search, breaks, start, start + match[0].length).text)) consider(match, PASS_RULES.length);
  }
  const first = nonOverlapping(found)[0];
  if (!first) return undefined;
  const value = Math.min(first.value, LECTURE_PASS_LIMITS.max);
  return { start: first.start, end: first.end, value, clamped: value !== first.value };
}

function findReviewSpacing(search: string, breaks: number[]): { start: number; evidence: Span; value: number; clamped: boolean } | undefined {
  const found: Array<Span & { value: number; priority: number; evidence: Span }> = [];
  SPACING_RULES.forEach(({ pattern, needsReviewContext }, priority) => {
    for (const match of search.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const sentence = sentenceOf(breaks, start);
      if (isNegated(search, sentence.start, start)) continue;
      let evidence: Span = { start, end };
      if (needsReviewContext) {
        const window = sentenceWindow(search, breaks, start, end);
        const context = REVIEW_CONTEXT.exec(window.text);
        if (!context) continue;
        const contextSpan = { start: window.start + context.index, end: window.start + context.index + context[0].length };
        evidence = spanWithin({ start, end }, contextSpan);
      }
      const value = spacingDays(match);
      if (value !== undefined && value >= REVIEW_DAY_LIMITS.min) found.push({ start, end, value, priority, evidence });
    }
  });
  const first = nonOverlapping(found)[0];
  if (!first) return undefined;
  const value = Math.min(first.value, REVIEW_DAY_LIMITS.max);
  return { start: Math.min(first.start, first.evidence.start), evidence: first.evidence, value, clamped: value !== first.value };
}

function findTimings(search: string, breaks: number[]): Array<Span & { timing: PracticeTiming }> {
  const raw: Array<Span & { timing: PracticeTiming; priority: number }> = [];
  TIMING_RULES.forEach(({ timing, pattern }, priority) => {
    for (const match of search.matchAll(pattern)) {
      const start = match.index ?? 0;
      raw.push({ start, end: start + match[0].length, timing, priority });
    }
  });
  return nonOverlapping(raw).filter(phrase => !isNegated(search, sentenceOf(breaks, phrase.start).start, phrase.start));
}

/** The part of a span's sentence within CONTEXT_WINDOW characters of it. */
function sentenceWindow(search: string, breaks: number[], start: number, end: number): { start: number; text: string } {
  const sentence = sentenceOf(breaks, start);
  const from = Math.max(sentence.start, start - CONTEXT_WINDOW);
  const to = Math.min(breaks[sentence.index] ?? search.length, end + CONTEXT_WINDOW);
  return { start: from, text: search.slice(from, to) };
}

/**
 * The closest nearby mention in the same sentence, preferring one in the same
 * clause. Mentions are sorted by position, so only a small window is scanned.
 */
function nearestMention(search: string, breaks: number[], mentions: Mention[], phrase: Span): Mention | undefined {
  const sentence = sentenceOf(breaks, phrase.start).index;
  let low = 0;
  let high = mentions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (mentions[middle].end < phrase.start - MAX_ATTACH_DISTANCE) low = middle + 1;
    else high = middle;
  }
  let best: { mention: Mention; key: [number, number, number] } | undefined;
  for (let index = low; index < mentions.length && mentions[index].start <= phrase.end + MAX_ATTACH_DISTANCE; index += 1) {
    const mention = mentions[index];
    if (sentenceOf(breaks, mention.start).index !== sentence) continue;
    const before = mention.end <= phrase.start;
    const gap = before ? search.slice(mention.end, phrase.start) : search.slice(phrase.end, mention.start);
    if (gap.length > MAX_ATTACH_DISTANCE) continue;
    const key: [number, number, number] = [ATTACH_BREAK.test(gap) ? 1 : 0, gap.length, before ? 0 : 1];
    if (!best || compareKeys(key, best.key) < 0) best = { mention, key };
  }
  return best?.mention;
}

function compareKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Locale-independent, so ordering never depends on the device language. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function spanWithin(primary: Span, other: Span): Span {
  const start = Math.min(primary.start, other.start);
  const end = Math.max(primary.end, other.end);
  return end - start <= MAX_COMBINED_EVIDENCE ? { start, end } : primary;
}

function combinedEvidence(text: string, anchor: Span, phrase: Span): string {
  const span = spanWithin(phrase, anchor);
  return text.slice(span.start, span.end);
}

function parseCount(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const normalized = token.toLowerCase().replace(/\s*(?:x|times)$/, "").trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return NUMBER_WORDS[normalized];
}

function spacingDays(match: RegExpMatchArray): number | undefined {
  const groups = match.slice(1).filter((group): group is string => typeof group === "string");
  const unitToken = groups.find(group => /^(?:days?|weeks?|months?|day|week|weekly)$/i.test(group));
  const countToken = groups.find(group => group !== unitToken);
  const unit = (unitToken ?? "day").toLowerCase();
  const multiplier = unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : 1;
  if (!countToken) return multiplier;
  const words = countToken.toLowerCase().split(/\s+/);
  const count = /^\d+$/.test(words[0]) ? Number(words[0]) : words.includes("couple") ? 2 : NUMBER_WORDS[words[0]];
  return count === undefined ? undefined : count * multiplier;
}
