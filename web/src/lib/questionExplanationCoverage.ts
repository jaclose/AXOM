import { blockToPlainText, type QuestionBlock } from "./question-content/blocks";

/** Observe explanation prose without treating a key or a source notice as a
 * rationale. This does not verify medical accuracy or change stored evidence. */
export function hasExplanationProse(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return value.split(/\r?\n/).some(raw => {
    const line = raw.trim()
      .replace(/^PowerPoint slide note \d+ explicitly marks \(?[A-J]\)?\.[ \t]*/i, "");
    if (!line) return false;
    if (/^\[Image(?::[^\]]*)?\]$/i.test(line)) return false;
    if (/^(?:source|reference|citation)\s*:/i.test(line)) return false;
    if (/^(?:(?:the\s+)?(?:correct|right)\s+)?(?:answer|ans|key)\s*(?:is\s*|:\s*)?\(?[A-J]\)?[.!;:]?$/i.test(line)) return false;
    if (/^(?:The supplied notes do not provide a teaching rationale|No (?:teaching )?(?:explanation|rationale)(?: (?:is |was )?(?:provided|supplied|recorded|available))?|(?:Explanation|Rationale) (?:pending|missing))\.?$/i.test(line)) return false;
    return true;
  });
}

export function hasExplanationBlocks(blocks: readonly QuestionBlock[] | undefined): boolean {
  return hasExplanationProse(blocks?.filter(block => block.type !== "image" && block.type !== "divider")
    .map(blockToPlainText).join("\n\n"));
}

/** Observe the main field that text snapshots actually contain. Missing-source
 * flags may be stale, so they never override edited prose. */
export function hasMainExplanation(question: { explanation?: string }): boolean {
  return hasExplanationProse(question.explanation);
}
