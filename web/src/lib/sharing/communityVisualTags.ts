import type { SharedQuestionSetSnapshot } from "./questionSetShare";

/** Visual intent tags are suggestions for a future licensed-media/AXOM-diagram
 * pipeline, never evidence that an image exists or that medical claims are true.
 * Keep snapshot v1 compatible: only existing, validated tag fields are used. */
const RULES = [
  { tag: "visual:histology", test: /\b(histolog(?:y|ic|ical)|microscop(?:y|ic)|h&e|hematoxylin|eosin|biops(?:y|ies)|slide|stain(?:ing|ed)?|glomerul(?:us|i)|epitheli(?:um|al))\b/i },
  { tag: "visual:anatomy", test: /\b(anatom(?:y|ical)|arter(?:y|ies)|veins?|nerve|plexus|muscle|ligament|tendon|foramen|cranial|vertebra|cross.section)\b/i },
  { tag: "visual:pathology", test: /\b(patholog(?:y|ic)|necros(?:is|tic)|infarct|tumou?r|carcinoma|adenoma|dysplasia|fibrosis|granuloma|atheroscleros(?:is|tic)|plaque)\b/i },
  { tag: "visual:microbiology", test: /\b(bacteri(?:a|al|um)|fung(?:us|al|i)|hyphae|parasite|protozoa|gram.positive|gram.negative|acid.fast|culture)\b/i },
  { tag: "visual:mechanism", test: /\b(mechanism|pathway|receptor|enzyme|cascade|signall?ing|feedback|pharmacodynam(?:ic|ics)|inhibit(?:or|ion)|agonist|antagonist)\b/i },
  { tag: "visual:gross", test: /\b(gross specimen|gross appearance|macroscop(?:y|ic)|autopsy|resected specimen)\b/i },
] as const;

const MAX_TAGS = 100;

/** Deterministic, bounded and privacy-preserving: only explicitly shared text
 * is considered; never inspect source documents, attempts or private notes. */
export function suggestCommunityVisualTags(text: string): string[] {
  return RULES.filter(rule => rule.test.test(text.slice(0, 16000))).map(rule => rule.tag);
}

function mergeTags(existing: readonly string[], suggested: readonly string[]): string[] {
  const result = [...existing];
  for (const tag of suggested) {
    if (result.length >= MAX_TAGS) break;
    if (!result.some(value => value.toLowerCase() === tag.toLowerCase())) result.push(tag);
  }
  return result;
}

/** Preserve v1 schema and immutable source questions. Visual tags travel with
 * community submissions and can later be mapped to curated asset catalogs. */
export function enrichCommunitySnapshotVisualTags(snapshot: SharedQuestionSetSnapshot): SharedQuestionSetSnapshot {
  const questions = snapshot.questions.map(question => {
    const text = [question.stem, question.system, question.topic, question.objective,
      question.category, question.subcategory, ...question.tags].filter(Boolean).join(" ");
    return { ...question, tags: mergeTags(question.tags, suggestCommunityVisualTags(text)) };
  });
  const aggregate = [...new Set(questions.flatMap(question => question.tags.filter(tag => tag.startsWith("visual:"))))];
  return { ...snapshot, questions, tags: mergeTags(snapshot.tags, aggregate) };
}
