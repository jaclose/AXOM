import { questionMappingStatus, type QuestionRecord } from "../questions";
import { sha256 } from "@noble/hashes/sha2.js";
import { AXOM_DIAGRAMS, type AxomDiagram } from "./registry";

const clueGroups = [
  { id: "rhinorrhea", nasal: true, pattern: /\b(?:rhinorrh?ea|runny nose|nasal discharge)\b/gi },
  { id: "sneezing", nasal: true, pattern: /\b(?:sneez(?:e|es|ing)|sneezing)\b/gi },
  { id: "congestion", nasal: true, pattern: /\b(?:nasal congestion|stuffy nose|congested nose)\b/gi },
  { id: "cough", nasal: false, pattern: /\bcough(?:s|ing)?\b/gi },
  { id: "sore-throat", nasal: false, pattern: /\bsore throat\b/gi },
  { id: "fever", nasal: false, pattern: /\b(?:fever|febrile)\b/gi },
] as const;

/** Only these source-checked question revisions may use the indexed teaching art. */
export interface ReviewedDiagramRule {
  diagramId: string;
  questionIdShaPrefix: string;
  term: number;
  module: string;
  topic: string;
  answer: readonly RegExp[];
  stemClues: readonly [RegExp, RegExp];
  exclusion?: RegExp;
}

export const REVIEWED_DIAGRAM_RULES: readonly ReviewedDiagramRule[] = [
  {
    diagramId: "brachial-plexus-posterior-cord", questionIdShaPrefix: "b5f071613552",
    term: 1, module: "MSK", topic: "Brachial plexus",
    answer: [/\bposterior\s+cord\b/i],
    stemClues: [/\bbrachial\s+plexus\b/gi, /\bwrist\b/gi],
    exclusion: /\b(?:(?:not|without|excluded|ruled\s+out)\s+(?:the\s+)?posterior\s+cord|posterior\s+cord\s+(?:(?:is|was)\s+)?(?:ruled\s+out|excluded|negative))\b/i,
  },
  {
    diagramId: "neuromuscular-transmission-presynaptic", questionIdShaPrefix: "71a26cc9147f",
    term: 1, module: "MSK", topic: "Neuromuscular transmission",
    answer: [/\bpresynaptic\b/i, /\bcalcium\b/i, /\bacetylcholine\b/i],
    stemClues: [/\brepeat(?:ed)?\s+(?:muscle\s+)?contractions?\b/gi, /\b(?:improv(?:e|es|ed|ement)|facilitat(?:ion|es|ed))\b/gi],
    exclusion: /\b(?:(?:not|without|excluded|ruled\s+out)\s+(?:a\s+)?presynaptic|presynaptic\s+(?:(?:is|was)\s+)?(?:ruled\s+out|excluded|negative))\b/i,
  },
  {
    diagramId: "posterior-abdominal-wall-genitofemoral", questionIdShaPrefix: "304d23ad7c03",
    term: 1, module: "MSK", topic: "Posterior abdominal wall",
    answer: [/\bgenitofemoral\b/i],
    stemClues: [/\banterior\s+surface\s+of\s+(?:the\s+)?psoas\b/gi, /\b(?:cremasteric|upper\s+anterior\s+thigh)\b/gi],
    exclusion: /\b(?:(?:not|without|excluded|ruled\s+out)\s+(?:the\s+)?genitofemoral|genitofemoral\s+(?:(?:is|was)\s+)?(?:ruled\s+out|excluded|negative))\b/i,
  },
  {
    diagramId: "repeat-disorders-dmpk", questionIdShaPrefix: "2da5114d5e66",
    term: 1, module: "MSK", topic: "Repeat disorders",
    answer: [/\bctg\b/i, /\bdmpk\b/i, /\b3\s*[-‐‑]?\s*(?:prime|['′’])\s*(?:untranslated|utr)\b/i],
    stemClues: [/\bhandgrip\b/gi, /\b(?:cataracts?|cardiac\s+conduction)\b/gi],
    exclusion: /\b(?:(?:not|without|excluded|ruled\s+out)\s+(?:a\s+)?(?:dmpk|ctg)|(?:dmpk|ctg)\s+(?:(?:is|was)\s+)?(?:ruled\s+out|excluded|negative))\b/i,
  },
];

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A short, local negation window; punctuation and contrast words end the scope. */
function isNegated(stem: string, start: number): boolean {
  const prefix = stem.slice(Math.max(0, start - 75), start).split(/[.;:!?\n]|\b(?:but|however|although|yet)\b/i).at(-1) ?? "";
  const words = prefix.trim().split(/\s+/).slice(-5).join(" ");
  return /\b(?:no|without|denies?|denied|absent|absence of|negative for|not|lacks?)\b/i.test(words);
}

function hasExclusion(stem: string): boolean {
  return /\b(?:rhinovirus|human rhinovirus)\s+(?:(?:is|was)\s+)?(?:ruled out|excluded|negative)\b/i.test(stem)
    || /\b(?:negative for|not|no evidence of|without)\s+(?:human\s+)?rhinovirus\b/i.test(stem);
}

function hasPositiveClue(stem: string, pattern: RegExp): boolean {
  for (const match of stem.matchAll(pattern)) {
    if (!isNegated(stem, match.index)) return true;
  }
  return false;
}

function questionIdShaPrefix(id: string): string {
  return [...sha256(new TextEncoder().encode(id))]
    .slice(0, 6).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Pure evidence gate, also exercised with synthetic question IDs in tests. */
export function matchesReviewedDiagramEvidence(question: QuestionRecord, rule: ReviewedDiagramRule): boolean {
  if (questionMappingStatus(question) !== "ready" || !question.content?.id
    || question.content.term !== rule.term
    || normalized(question.module ?? "") !== normalized(rule.module)
    || normalized(question.topic ?? "") !== normalized(rule.topic)
    || questionIdShaPrefix(question.content.id) !== rule.questionIdShaPrefix
    || (rule.exclusion && rule.exclusion.test(question.stem))) return false;
  const keyedOption = question.options.find((option) => option.key === question.correctKey);
  if (!keyedOption || !rule.answer.every((pattern) => pattern.test(keyedOption.text))) return false;
  return rule.stemClues.every((pattern) => hasPositiveClue(question.stem, pattern));
}

/**
 * A keyed answer anchors the teaching link. Symptoms alone never identify a
 * pathogen, and a held or uncertain key cannot display this diagram.
 */
export function matchAxomDiagram(question: QuestionRecord): AxomDiagram | undefined {
  if (questionMappingStatus(question) !== "ready") return undefined;
  const keyedOption = question.options.find((option) => option.key === question.correctKey);
  if (!keyedOption) return undefined;
  const answer = normalized(keyedOption.text);
  // Other registry entries must get their own reviewed clue rule and artwork.
  const diagram = AXOM_DIAGRAMS.find((entry) => entry.id === "rhinovirus-common-cold");
  if (diagram?.answerAliases.some((alias) => normalized(alias) === answer) && !hasExclusion(question.stem)) {
    const found = clueGroups.filter((group) => hasPositiveClue(question.stem, group.pattern));
    if (found.length >= 2 && found.some((group) => group.nasal)) return diagram;
  }
  const rule = REVIEWED_DIAGRAM_RULES.find((entry) => matchesReviewedDiagramEvidence(question, entry));
  return rule && AXOM_DIAGRAMS.find((entry) => entry.id === rule.diagramId);
}
