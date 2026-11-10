import { normalizeTag } from "../questionTags";

/**
 * AI keyword proposals remain private until the publisher explicitly reviews
 * and opts in. Preserve existing author tags verbatim; never silently truncate
 * a term, displace an authored tag, or exceed the public 100-tag bound.
 *
 * This is NOT a source review, a medical accuracy attestation, or a grant of
 * rights to redistribute the underlying question.
 */
export function mergeReviewedCommunityKeywords(
  existing: readonly string[],
  reviewedInput: string,
): string[] {
  if (reviewedInput.length > 512) throw new Error("Reviewed keywords exceed the input limit.");
  const terms = reviewedInput.split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
  if (terms.length > 8) throw new Error("Review at most eight keywords for each question.");

  const result = [...existing];
  const seen = new Set(existing.map(normalizeTag));
  for (const term of terms) {
    if ([...term].length > 64) throw new Error("A reviewed keyword exceeds 64 characters.");
    const tag = normalizeTag(term);
    if (!tag || seen.has(tag)) continue;
    if (result.length >= 100) throw new Error("This question already has the maximum 100 tags.");
    result.push(tag);
    seen.add(tag);
  }
  return result;
}
