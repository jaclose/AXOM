// ===========================================================================
// Is a question ready to be studied from, does it need a person to look at
// it, or can it not be settled from what was imported?
//
// One answer per question, with the reasons in plain words. The import
// screens and the local build report read the same verdict.
// ===========================================================================
import type { PackageIssue, PackageQuestion, QuestionFlag } from "./package";

export type Readiness = "ready" | "needs-review" | "unresolved";

export interface ReadinessVerdict {
  readiness: Readiness;
  /** Why it is not ready. Empty when it is. */
  reasons: string[];
}

/**
 * Whether a flag on a question that has a printed key keeps it out of "ready".
 *
 * This is the bar for "ready", and it is the owner's to set. As written, every flag holds
 * a question back, so a keyed question with a possible duplicate, or with a picture whose
 * place is unsure, waits for a person. Return false for a flag type to let such a question
 * through as ready. `answer_needs_review` is not decided here: a question with no key is
 * never ready.
 */
function holdsBack(_flag: QuestionFlag): boolean {
  return true;
}

export function questionReadiness(question: PackageQuestion, issues: readonly PackageIssue[]): ReadinessVerdict {
  const own = issues.filter((issue) => issue.questionId === question.id);
  const errors = own.filter((issue) => issue.severity === "error");
  const flags = question.flags ?? [];
  const keyDoubt = flags.filter((flag) => flag.type === "answer_needs_review");

  // It cannot be run as it stands.
  if (errors.length) return { readiness: "unresolved", reasons: errors.map((issue) => issue.message) };
  if (!question.correctAnswer) {
    // The source shows an answer in a form that was kept for a person to read: that is review.
    // No answer anywhere that AXOM could read: nothing to review against.
    return keyDoubt.length
      ? { readiness: "needs-review", reasons: keyDoubt.map((flag) => flag.message) }
      : { readiness: "unresolved", reasons: ["No answer for this question could be read from the source."] };
  }
  // A printed key, and still something a person should look at.
  const doubts = [...flags.filter(holdsBack).map((flag) => flag.message), ...own.filter((issue) => issue.severity === "warning").map((issue) => issue.message)];
  return doubts.length ? { readiness: "needs-review", reasons: [...new Set(doubts)] } : { readiness: "ready", reasons: [] };
}

export function countReadiness(questions: readonly PackageQuestion[], issues: readonly PackageIssue[]): Record<Readiness, number> {
  const counts: Record<Readiness, number> = { ready: 0, "needs-review": 0, unresolved: 0 };
  for (const question of questions) counts[questionReadiness(question, issues).readiness] += 1;
  return counts;
}
