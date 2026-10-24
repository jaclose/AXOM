import { assessBank } from "./assessBank";
import type { ImportPackage, PackageIssue } from "./package";
import { withReviewedAnswer } from "./readiness";
import { unresolvedExtractionIssues } from "./reviewEdits";

/** Only slide-marked single-choice keys that would become fully ready after
 * a human confirms the displayed source are eligible for the compact queue.
 * An inferred explanation key, absent source page, missing media, ambiguity,
 * or other hold cannot be fast-tracked. */
export function eligibleSlideReviewKeys(
  pkg: ImportPackage,
  issues: readonly PackageIssue[],
  files: readonly { name: string }[],
  confirmed: ReadonlySet<string>,
  hasOriginalSource: boolean,
): Map<string, string> {
  const candidates = new Map<string, string>();
  if (!hasOriginalSource) return candidates;
  const before = assessBank(pkg, unresolvedExtractionIssues(issues, confirmed), files);
  for (const question of pkg.questions) {
    const key = question.correctAnswer;
    if (before.verdicts.get(question.id)?.readiness !== "needs-review"
      || key?.evidence !== "answer-reveal-slide" || key.labels.length !== 1
      || !question.source.page || question.source.page < 1
      || !question.assets.some(asset => asset.role === "answer_reveal" && files.some(file => file.name === asset.filename))
      || !question.choices.some(choice => choice.label === key.labels[0])) continue;
    candidates.set(question.id, key.labels[0]);
  }
  if (!candidates.size) return candidates;
  const projected: ImportPackage = { ...pkg, questions: pkg.questions.map(q => {
    const label = candidates.get(q.id);
    return label ? withReviewedAnswer(q, label) : q;
  }) };
  const after = assessBank(projected,
    unresolvedExtractionIssues(issues, new Set([...confirmed, ...candidates.keys()])), files);
  for (const id of candidates.keys()) if (after.verdicts.get(id)?.readiness !== "ready") candidates.delete(id);
  return candidates;
}