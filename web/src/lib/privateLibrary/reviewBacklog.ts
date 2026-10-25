import type { SourceDocument } from "../library";
import { assessBank } from "../question-content/assessBank";
import { readPreparedBank } from "./install";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "./types";

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
  bank: PreparedBank;
  document: SourceDocument;
  index: number;
}

function sourceIdentity(document: SourceDocument, bank: PreparedBank): string {
  const provenanceChecksums = new Set(bank.pkg.questions.flatMap(question => {
    const checksum = question.provenance.sourceChecksum?.replace(/^sha256:/, "");
    return checksum && /^[a-f0-9]{64}$/.test(checksum) ? [checksum] : [];
  }));
  if (provenanceChecksums.size === 1) return `source:${[...provenanceChecksums][0]}`;

  const documentChecksum = document.checksum?.replace(/^sha256:/, "");
  if (documentChecksum && /^[a-f0-9]{64}$/.test(documentChecksum)) return `document:${documentChecksum}`;

  const reviewId = document.id.match(/^private-review-([a-f0-9]{64})$/)?.[1];
  if (reviewId) return `source:${reviewId}`;

  // Older review records can lack a source checksum. Their bank id and source
  // filename are still stable within the private-library contract.
  return `bank:${bank.pkg.manifest.bank.id}|${bank.pkg.manifest.source.filename}`;
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
    let bank: PreparedBank;
    try {
      bank = readPreparedBank(JSON.parse(document.rawText));
    } catch {
      invalidDocuments += 1;
      return;
    }

    const identity = sourceIdentity(document, bank);
    const current = selected.get(identity);
    if (!current) {
      selected.set(identity, { bank, document, index });
      return;
    }
    duplicateDocuments += 1;
    const incoming = { bank, document, index };
    if (preferIncoming(current, incoming)) selected.set(identity, incoming);
  });

  let needsReview = 0;
  let unresolved = 0;
  let unreadable = 0;
  for (const { bank } of selected.values()) {
    const declaredAssets = bank.pkg.questions.flatMap(question => question.assets.map(asset => ({
      name: asset.filename,
      ...(typeof asset.byteSize === "number" ? { size: asset.byteSize } : {}),
    })));
    const counts = assessBank(bank.pkg, bank.issues, declaredAssets).counts;
    needsReview += counts["needs-review"];
    unresolved += counts.unresolved;
    const unreadableRows = bank.unreadableQuestions;
    if (typeof unreadableRows === "number" && Number.isSafeInteger(unreadableRows) && unreadableRows > 0) {
      unreadable += unreadableRows;
    }
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
