// ===========================================================================
// Is a question ready for scored practice, does it need a person to look at
// it, or can it not be settled from what was imported?
//
// One answer per question. Only a doubt that bears on whether the question
// can be answered and marked correctly holds it back. Anything else is an
// advisory: shown, and never a reason to keep the question out.
//
// The import screens and the local build report read the same verdict.
// ===========================================================================
import type { AnswerEvidence, IssueCode, IssueSeverity, PackageIssue, PackageQuestion } from "./package";
import { FLAG_SEVERITY } from "./validate";

export type Readiness = "ready" | "needs-review" | "unresolved";

export interface ReadinessVerdict {
  readiness: Readiness;
  /** What keeps it out of scored practice. Empty when it is ready. */
  reasons: string[];
  /** Warnings that do not hold the question back. Plain information is not repeated here. */
  advisories: string[];
}

/**
 * The owner's rule (JD, 2026-10-08). A question is held back by an answer
 * that is not verified, by essential content that is missing, by doubt over
 * which question or set something belongs to, by a picture it needs that
 * could not be tied to it, and by anything that could give the answer away.
 * It is not held back by a difference of formatting, by a note on its filing
 * that can be put right later, or by a harmless oddity of type.
 *
 * So this lists the codes that are advisory. A warning with any other code
 * holds the question back, and so does a code nobody has classified yet.
 */
const ADVISORY: ReadonlySet<IssueCode> = new Set<IssueCode>([
  // Formatting: the picture is the question's, only its place among the lines is unsure.
  "media_position_uncertain",
  "media_cropped",
  "rich_text_escaped",
  // Filing and bookkeeping that can be put right without touching the question.
  "possible_duplicate",
  "scope_mismatch",
  "unknown_field",
  "unknown_flag",
  "tracked_changes",
  // Not needed to answer the question.
  "missing_explanation",
  "asset_reference_broken",
]);

/** Where a key may come from and count as verified. A key worked out from a marked slide or from the wording of an explanation is not. */
const VERIFIED_EVIDENCE: ReadonlySet<AnswerEvidence> = new Set<AnswerEvidence>(["printed-key", "reviewer"]);

const UNVERIFIED_KEY: Record<string, string> = {
  "answer-reveal-slide": "The key was read from a slide that marks the answer, not from a printed key. Check it against the slide.",
  explanation: "The key was worked out from the wording of the explanation, not from a printed key. Check it against the source.",
  none: "The package does not say where the key came from. Check it against the source.",
};

interface Entry {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
}

export function questionReadiness(question: PackageQuestion, issues: readonly PackageIssue[]): ReadinessVerdict {
  // A flag is on the question itself. The package checks repeat it as an issue: each is counted once.
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const take = (entry: Entry): void => {
    const key = `${entry.code}|${entry.message}`;
    if (!seen.has(key)) entries.push(entry);
    seen.add(key);
  };
  for (const issue of issues) if (issue.questionId === question.id) take({ severity: issue.severity, code: issue.code, message: issue.message });
  for (const flag of question.flags ?? []) take({ severity: FLAG_SEVERITY[flag.type] ?? "warning", code: flag.type, message: flag.message });

  const errors = entries.filter((entry) => entry.severity === "error");
  // "No key" and "the key needs review" are settled below, from the key itself.
  const keyDoubt = entries.filter((entry) => entry.code === "answer_needs_review");
  const others = entries.filter((entry) => entry.severity !== "error" && entry.code !== "answer_needs_review" && entry.code !== "missing_answer_key");
  const blocking = others.filter((entry) => entry.severity === "warning" && !ADVISORY.has(entry.code)).map((entry) => entry.message);
  const advisories = others.filter((entry) => entry.severity === "warning" && ADVISORY.has(entry.code)).map((entry) => entry.message);

  // It cannot be run as it stands.
  if (errors.length) return { readiness: "unresolved", reasons: errors.map((entry) => entry.message), advisories };

  if (!question.correctAnswer) {
    // The source shows an answer in a form that was kept for a person to read: that is review.
    // No answer anywhere that could be read: there is nothing to review against.
    return keyDoubt.length
      ? { readiness: "needs-review", reasons: [...keyDoubt.map((entry) => entry.message), ...blocking], advisories }
      : { readiness: "unresolved", reasons: ["No answer for this question could be read from the source.", ...blocking], advisories };
  }

  const evidence = question.correctAnswer.evidence;
  const reasons = [
    ...keyDoubt.map((entry) => entry.message),
    ...(evidence && VERIFIED_EVIDENCE.has(evidence) ? [] : [UNVERIFIED_KEY[evidence ?? "none"]]),
    ...blocking,
  ];
  return reasons.length ? { readiness: "needs-review", reasons, advisories } : { readiness: "ready", reasons: [], advisories };
}

/**
 * A person has looked at the source and says which choice is right. The key is recorded as
 * the reviewer's and the note that asked for the review is cleared. Only a person's action
 * calls this: a mark on a slide, a guess from an explanation or a proposal from a program is
 * not a person. Run the package checks again afterwards, since they describe the old question.
 */
export function withReviewedAnswer(question: PackageQuestion, label: string): PackageQuestion {
  if (!question.choices.some((choice) => choice.label === label)) throw new Error(`"${label}" is not one of the choices of ${question.id}.`);
  const { flags, ...rest } = question;
  const kept = (flags ?? []).filter((flag) => flag.type !== "answer_needs_review");
  return { ...rest, correctAnswer: { labels: [label], evidence: "reviewer" }, ...(kept.length ? { flags: kept } : {}) };
}

export function countReadiness(questions: readonly PackageQuestion[], issues: readonly PackageIssue[]): Record<Readiness, number> {
  const counts: Record<Readiness, number> = { ready: 0, "needs-review": 0, unresolved: 0 };
  for (const question of questions) counts[questionReadiness(question, issues).readiness] += 1;
  return counts;
}
