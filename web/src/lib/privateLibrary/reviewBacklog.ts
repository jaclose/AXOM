import type { SourceDocument } from "../library";
import { assessBank } from "../question-content/assessBank";
import { readPreparedBank } from "./install";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "./types";
import { preparedReviewChecksum } from "./reviewIdentity";

export interface PrivateReviewBacklog {
  /** Every retained row that is excluded from scored practice. */
  held: number;
  needsReview: number;
  unresolved: number;
  /** Rows preserved outside the parsed question list because their source shape was unreadable. */
  unreadable: number;
  sources: number;
  invalidDocuments: number;
  duplicateDocuments: number;
}

interface ReviewCandidate {
  review: AssessedReview;
  document: SourceDocument;
  index: number;
}

interface AssessedReview {
  readonly identity: string;
  readonly needsReview: number;
  readonly unresolved: number;
  readonly unreadable: number;
}

interface CachedReview {
  readonly rawText: string;
  readonly id: string;
  readonly checksum: SourceDocument["checksum"];
  readonly review: AssessedReview | null;
}

// Document objects belong to the active workspace. Weak keys neither retain a
// departed account's corpus nor reuse a result just because its IDs match.
const assessedReviews = new WeakMap<SourceDocument, CachedReview>();

function sourceIdentity(document: SourceDocument, bank: PreparedBank): string {
  const checksum = preparedReviewChecksum(bank, document);
  if (checksum) return JSON.stringify([checksum, bank.pkg.manifest.bank.id]);
  // Older review records can lack a source checksum. Their bank id and source
  // filename are still stable within the private-library contract.
  return `bank:${bank.pkg.manifest.bank.id}|${bank.pkg.manifest.source.filename}`;
}

function assessDocument(document: SourceDocument): AssessedReview | null {
  const cached = assessedReviews.get(document);
  if (cached && cached.rawText === document.rawText && cached.id === document.id && cached.checksum === document.checksum) return cached.review;

  let review: AssessedReview | null = null;
  try {
    const bank = readPreparedBank(JSON.parse(document.rawText));
    const declaredAssets = bank.pkg.questions.flatMap(question => question.assets.map(asset => ({
      name: asset.filename,
      ...(typeof asset.byteSize === "number" ? { size: asset.byteSize } : {}),
    })));
    const counts = assessBank(bank.pkg, bank.issues, declaredAssets).counts;
    const unreadable = bank.unreadableQuestions;
    review = {
      identity: sourceIdentity(document, bank),
      needsReview: counts["needs-review"],
      unresolved: counts.unresolved,
      unreadable: typeof unreadable === "number" && Number.isSafeInteger(unreadable) && unreadable > 0 ? unreadable : 0,
    };
  } catch {
    // Retain a failed validation until the actual document changes, too.
  }
  assessedReviews.set(document, { rawText: document.rawText, id: document.id, checksum: document.checksum, review });
  return review;
}

function uploadedAt(candidate: ReviewCandidate): number {
  const value = Date.parse(candidate.document.uploadedAt);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function preferIncoming(current: ReviewCandidate, incoming: ReviewCandidate): boolean {
  const currentTime = uploadedAt(current);
  const incomingTime = uploadedAt(incoming);
  return incomingTime > currentTime || (incomingTime === currentTime && incoming.index > current.index);
}

/**
 * Reassess the retained private-bank reviews instead of trusting a catalog
 * snapshot. Reviewer edits therefore change this count immediately, while a
 * damaged document remains isolated and cannot hide the valid review queue.
 */
export function summarizePrivateReviewBacklog(documents: readonly SourceDocument[] = []): PrivateReviewBacklog {
  const selected = new Map<string, ReviewCandidate>();
  let invalidDocuments = 0;
  let duplicateDocuments = 0;

  documents.forEach((document, index) => {
    if (document.fileType !== PRIVATE_REVIEW_DOCUMENT) return;
    const review = assessDocument(document);
    if (!review) {
      invalidDocuments += 1;
      return;
    }

    const { identity } = review;
    const current = selected.get(identity);
    if (!current) {
      selected.set(identity, { review, document, index });
      return;
    }
    duplicateDocuments += 1;
    const incoming = { review, document, index };
    if (preferIncoming(current, incoming)) selected.set(identity, incoming);
  });

  let needsReview = 0;
  let unresolved = 0;
  let unreadable = 0;
  for (const { review } of selected.values()) {
    needsReview += review.needsReview;
    unresolved += review.unresolved;
    unreadable += review.unreadable;
  }

  return {
    held: needsReview + unresolved + unreadable,
    needsReview,
    unresolved,
    unreadable,
    sources: selected.size,
    invalidDocuments,
    duplicateDocuments,
  };
}
