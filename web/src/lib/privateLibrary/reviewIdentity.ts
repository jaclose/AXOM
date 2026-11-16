import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "./types";

const checksumPattern = /^[a-f0-9]{64}$/;

export function preparedBankContains(question: QuestionRecord, bank: PreparedBank, checksum: string): boolean {
  const content = question.content;
  if (!content || content.provenance.sourceChecksum?.replace(/^sha256:/, "") !== checksum) return false;
  const member = bank.pkg.questions.find(candidate => candidate.id === content.id);
  return Boolean(member && (content.bankId ?? bank.pkg.manifest.bank.id) === (member.bankId ?? bank.pkg.manifest.bank.id));
}

export function preparedReviewChecksum(bank: PreparedBank, document?: SourceDocument): string | undefined {
  const checksums = new Set(bank.pkg.questions.map(question => question.provenance.sourceChecksum?.replace(/^sha256:/, "")));
  if (checksums.size === 1) {
    const checksum = [...checksums][0];
    if (checksum && checksumPattern.test(checksum)) return checksum;
  }
  if (checksums.size > 1) return undefined;
  return document?.id.match(/^private-review-([a-f0-9]{64})(?:-bank-|$)/)?.[1]
    ?? document?.checksum?.replace(/^sha256:/, "");
}

export function bankReviewDocumentId(checksum: string, bankId: string): string {
  return `private-review-${checksum}-bank-${encodeURIComponent(bankId)}`;
}

/** Metadata lookup only; opening a review still runs the full bank validator. */
export function reviewBankId(document: SourceDocument): string | undefined {
  try {
    const value: unknown = JSON.parse(document.rawText);
    if (!value || typeof value !== "object" || !("pkg" in value)) return undefined;
    const pkg = value.pkg;
    if (!pkg || typeof pkg !== "object" || !("manifest" in pkg)) return undefined;
    const manifest = pkg.manifest;
    if (!manifest || typeof manifest !== "object" || !("bank" in manifest)) return undefined;
    const bank = manifest.bank;
    return bank && typeof bank === "object" && "id" in bank && typeof bank.id === "string" ? bank.id : undefined;
  } catch { return undefined; }
}

export function preparedSourceReview(documents: readonly SourceDocument[], source: Pick<PrivateLibraryCatalog["sources"][number], "checksum" | "bankId">): SourceDocument | undefined {
  const prefix = `private-review-${source.checksum}`;
  const candidates = documents.filter(document => document.fileType === PRIVATE_REVIEW_DOCUMENT
    && (document.id === prefix || document.id.startsWith(`${prefix}-bank-`))
    && (!source.bankId || reviewBankId(document) === source.bankId));
  // A legacy catalog must never arbitrarily pick a sibling bank's review.
  return candidates.length === 1 ? candidates[0] : undefined;
}
