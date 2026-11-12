import { normalizeTag } from "../questionTags";
import { planMedicalVisual } from "./publicationHints";
import type { SharedQuestionSetSnapshot } from "../sharing/questionSetShare";

/**
 * Persist only text-derived diagram intent in the existing public Question Set
 * snapshot (v1). No asset identifiers, answer inferences, generated images,
 * source files, or rights/medical-review assertions are added here.
 */
const MAX_TAGS = 100;
const INTENT_PREFIX = "visual:intent:";
const KEYWORD_PREFIX = "visual:keyword:";

function appendBoundedTag(target: string[], raw: string): void {
  // Never truncate an anatomical or pathological term into an ambiguous label.
  if (raw.length > 64 || target.length >= MAX_TAGS) return;
  const tag = normalizeTag(raw);
  if (!tag || target.some(existing => normalizeTag(existing) === tag)) return;
  target.push(tag);
}

/**
 * Use the same explicit-vocabulary planner shown in the publisher UI.
 * Make its classification discoverable in published QBank snapshots without
 * mutating the learner's private questions, and without changing the schema.
 * This is not permission to fetch, display, or redistribute clinical imagery.
 */
export function enrichPublicQuestionSetVisualTags(
  snapshot: SharedQuestionSetSnapshot,
): SharedQuestionSetSnapshot {
  const setTags = [...snapshot.tags];
  const questions = snapshot.questions.map(question => {
    // Public visual hints can appear before an answer is revealed. Topic,
    // category, system and authored tags may encode the correct answer even
    // when the question stem does not. Derive NEW hint tags only from stem
    // vocabulary the learner already sees; preserve author tags unchanged.
    const plan = planMedicalVisual({ stem: question.stem, tags: [] });
    if (plan.kind === "none") return question;

    const tags = [...question.tags];
    const intent = `${INTENT_PREFIX}${plan.kind}`;
    appendBoundedTag(tags, intent);
    appendBoundedTag(setTags, intent);
    for (const keyword of plan.keywords) appendBoundedTag(tags, `${KEYWORD_PREFIX}${keyword}`);

    return { ...question, tags };
  });
  return { ...snapshot, tags: setTags, questions };
}
