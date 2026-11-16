import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../library";
import { bankReviewDocumentId, preparedSourceReview } from "./reviewIdentity";
import { PRIVATE_REVIEW_DOCUMENT } from "./types";

const checksum = "a".repeat(64);
const review = (id: string, bankId: string): SourceDocument => ({
  id, title: "Review", fileName: "source.pdf", fileType: PRIVATE_REVIEW_DOCUMENT,
  uploadedAt: "2026-11-16T00:00:00Z", rawText: JSON.stringify({ pkg: { manifest: { bank: { id: bankId } } } }),
  sizeBytes: 1, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
});

describe("prepared review identities", () => {
  it("retains a legacy review only for its exact bank and distinguishes encoded bank ids", () => {
    const legacy = review(`private-review-${checksum}`, "first");
    const sibling = review(bankReviewDocumentId(checksum, "sibling/bank"), "sibling/bank");
    expect(preparedSourceReview([legacy, sibling], { checksum, bankId: "first" })).toBe(legacy);
    expect(preparedSourceReview([legacy, sibling], { checksum, bankId: "sibling/bank" })).toBe(sibling);
    expect(bankReviewDocumentId(checksum, "sibling/bank")).not.toBe(bankReviewDocumentId(checksum, "sibling%2Fbank"));
  });
  it("does not guess which bank an older checksum-only catalog row meant", () => {
    const legacy = review(`private-review-${checksum}`, "first");
    const sibling = review(bankReviewDocumentId(checksum, "second"), "second");
    expect(preparedSourceReview([legacy, sibling], { checksum })).toBeUndefined();
    expect(preparedSourceReview([legacy], { checksum })).toBe(legacy);
    expect(preparedSourceReview([legacy, review(bankReviewDocumentId(checksum, "first"), "first")], { checksum, bankId: "first" })).toBeUndefined();
  });
});
