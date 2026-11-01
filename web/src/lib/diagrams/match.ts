import { questionMappingStatus, type QuestionRecord } from "../questions";
import { AXOM_DIAGRAMS, type AxomDiagram } from "./registry";

const clueGroups = [
  { id: "rhinorrhea", nasal: true, pattern: /\b(?:rhinorrh?ea|runny nose|nasal discharge)\b/gi },
  { id: "sneezing", nasal: true, pattern: /\b(?:sneez(?:e|es|ing)|sneezing)\b/gi },
  { id: "congestion", nasal: true, pattern: /\b(?:nasal congestion|stuffy nose|congested nose)\b/gi },
  { id: "cough", nasal: false, pattern: /\bcough(?:s|ing)?\b/gi },
  { id: "sore-throat", nasal: false, pattern: /\bsore throat\b/gi },
  { id: "fever", nasal: false, pattern: /\b(?:fever|febrile)\b/gi },
] as const;

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

/**
 * A keyed answer anchors the teaching link. Symptoms alone never identify a
 * pathogen, and a held or uncertain key cannot display this diagram.
 */
export function matchAxomDiagram(question: QuestionRecord): AxomDiagram | undefined {
  if (questionMappingStatus(question) !== "ready" || hasExclusion(question.stem)) return undefined;
  const keyedOption = question.options.find((option) => option.key === question.correctKey);
  if (!keyedOption) return undefined;
  const answer = normalized(keyedOption.text);
  const diagram = AXOM_DIAGRAMS.find((entry) => entry.answerAliases.some((alias) => normalized(alias) === answer));
  if (!diagram) return undefined;

  const found = clueGroups.filter((group) => {
    for (const match of question.stem.matchAll(group.pattern)) {
      if (!isNegated(question.stem, match.index)) return true;
    }
    return false;
  });
  return found.length >= 2 && found.some((group) => group.nasal) ? diagram : undefined;
}
