import type { QuestionRecord } from "../questions";
import { questionPracticeReadiness } from "../questionFilters";

/** A saved set can outlive local question bytes after an interrupted or stale-tab
 * restore. That is missing content, NOT failed medical answer/source review.
 * Publication remains blocked for both states until the exact records return.
 */
export function summarizeQuestionSetSubmissionReadiness(
  members: readonly (QuestionRecord | undefined)[],
): { missing: number; held: number; ready: number } {
  let missing = 0;
  let held = 0;
  let ready = 0;
  for (const question of members) {
    if (!question) missing += 1;
    else if (questionPracticeReadiness(question) !== "ready") held += 1;
    else ready += 1;
  }
  return { missing, held, ready };
}
