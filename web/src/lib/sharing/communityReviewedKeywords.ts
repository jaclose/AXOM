import { normalizeTag } from "../questionTags";
import { hasPrivateDeviceCitation } from "./questionSetShare";

/** Rights, source review and visual intent are evidence, not AI-generated subject tags.
 * Preserve existing author tags, but reject new keyword proposals that claim a
 * publication or moderation state, carry a citation, or embed private references. */
const RESERVED_PUBLICATION_KEYWORD = /^(?:visual|source|rights?|licen[sc]e|provenance|review|moderation|approval|publication|answer(?:-?key)?|correct(?:-?key)?)\s*:/i;

export function isCommunitySubjectKeyword(value: string): boolean {
  const candidate = value.trim();
  return Boolean(candidate)
    && !RESERVED_PUBLICATION_KEYWORD.test(candidate)
    && !/https?:\/\//i.test(candidate)
    && !hasPrivateDeviceCitation(candidate);
}

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
    if (!isCommunitySubjectKeyword(term)) {
      throw new Error("Reviewed keywords must be subject phrases, not publication metadata, citations or private references.");
    }
    if (result.length >= 100) throw new Error("This question already has the maximum 100 tags.");
    result.push(tag);
    seen.add(tag);
  }
  return result;
}
