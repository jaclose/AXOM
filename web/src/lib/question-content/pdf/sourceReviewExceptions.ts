// Source-specific review exceptions for exact, SHA-256 identified originals.
// This ledger contains no original question wording, answer explanations,
// media bytes or student identifiers. New findings require independent review.
// It supplements the deterministic PDF parser; it NEVER edits an answer.
import type { PackageQuestion, PackageIssue } from "../package";

export interface SourceReviewException {
  set: number;
  questionNumber: number;
  reason: string;
  /** Optional expected candidate key, used as an alert rather than an override. */
  sourceKey?: string;
}
export interface SourceReviewLedger {
  sourceChecksum: string;
  expectedQuestions: number;
  review: readonly SourceReviewException[];
  /** Clarifies where the review evidence came from, not an institution endorsement. */
  reviewedAgainst: string;
}
export interface SourceReviewApplication {
  questions: PackageQuestion[];
  issues: PackageIssue[];
  annotated: number;
  notes: string[];
}

/** Existing private native-bank review identified exactly these three
 * answer/explanation inconsistencies in the unchanged original source.
 * The original PDF remains private. This metadata never publishes its text.
 */
export const CONFIRMED_SOURCE_REVIEWS: readonly SourceReviewLedger[] = [
  {
    sourceChecksum: "sha256:f899b4ac414130cf48307486db2ee7b6039aee6e25aae2304bdfe8d43834c7a0",
    expectedQuestions: 15,
    reviewedAgainst: "Canonical GOER source bank reviewed 2026-10-14 (private original PDF)",
    review: [
      { set: 1, questionNumber: 1, sourceKey: "D",
        reason: "Previously verified source inconsistency: the explanation's signed arithmetic disagrees with its stated result. Check the original before scoring." },
      { set: 1, questionNumber: 4, sourceKey: "A",
        reason: "Previously verified source inconsistency: probability-threshold statements conflict within the source explanation. Check the original before scoring." },
      { set: 2, questionNumber: 7, sourceKey: "D",
        reason: "Previously verified source inconsistency: the explanation uses a narrower clinical outcome than the stem/table. Check the original before scoring." },
    ],
  },
];

const sourceIdentity = (item: { source: { set?: number; questionNumber?: number } }) =>
  `${item.source.set ?? 0}:${item.source.questionNumber ?? 0}`;

/**
 * Annotate discrepancies that manual review already found for an EXACT
 * original hash. Never copy a key, change options or infer the correct answer.
 * If the known source's question structure changes unexpectedly, fail closed:
 * require re-review of the whole bank rather than silently dropping an erratum.
 */
export function applyReviewedSourceExceptions(
  questions: readonly PackageQuestion[],
  sourceChecksum: string,
  references: readonly SourceReviewLedger[] = CONFIRMED_SOURCE_REVIEWS,
): SourceReviewApplication {
  const existing = references.filter(entry => entry.sourceChecksum === sourceChecksum);
  if (!existing.length) return { questions: [...questions], issues: [], annotated: 0, notes: [] };
  if (existing.length > 1) {
    return { questions: [...questions], issues: [{ severity: "error", code: "invalid_package",
      message: "Conflicting source-review ledgers exist for this SHA-256. Resolve the provenance before importing." }],
      annotated: 0, notes: [] };
  }
  const reference = existing[0];
  const counts = new Map<string, number>();
  for (const question of questions) {
    const id = sourceIdentity(question);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const invalid = reference.review.filter(entry => counts.get(`${entry.set}:${entry.questionNumber}`) !== 1);
  if (questions.length !== reference.expectedQuestions || invalid.length ||
      questions.some(question => (counts.get(sourceIdentity(question)) ?? 0) !== 1)) {
    return { questions: questions.map(question => ({ ...question, flags: [
      ...(question.flags ?? []).filter(flag => flag.type !== "answer_needs_review" ||
        !flag.message.startsWith("An existing review ledger")),
      { type: "answer_needs_review", message: "An existing review ledger no longer matches the PDF's extracted question boundaries. Reconcile the original before scored practice." },
    ] })), issues: [{ severity: "error", code: "invalid_package",
      message: "Known source integrity check failed: parsed question boundaries do not match the reviewed source ledger. Import requires full source reconciliation." }],
      annotated: 0, notes: [] };
  }
  const byId = new Map(reference.review.map(entry => [`${entry.set}:${entry.questionNumber}`, entry]));
  let annotated = 0;
  const transformed = questions.map(question => {
    const entry = byId.get(sourceIdentity(question));
    if (!entry) return question;
    annotated += 1;
    const flags = [...(question.flags ?? [])];
    if (!flags.some(flag => flag.type === "source_inconsistency" && flag.message === entry.reason)) {
      flags.push({ type: "source_inconsistency", message: entry.reason });
    }
    if (entry.sourceKey && !question.correctAnswer?.labels.includes(entry.sourceKey)) {
      const mismatch = `The original-source review records a different answer-label candidate for set ${entry.set}, question ${entry.questionNumber}. Neither key has been automatically replaced; confirm both sources.`;
      if (!flags.some(flag => flag.type === "source_inconsistency" && flag.message === mismatch))
        flags.push({ type: "source_inconsistency", message: mismatch });
    }
    return { ...question, flags };
  });
  return {
    questions: transformed,
    issues: [],
    annotated,
    notes: [`${annotated} existing source-review inconsistencies were restored using the exact original SHA-256; source answers are unchanged and must be confirmed by a reviewer.`],
  };
}
