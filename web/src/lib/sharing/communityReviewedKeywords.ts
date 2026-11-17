import { normalizeTag } from "../questionTags";
import { hasPrivateDeviceCitation } from "./questionSetShare";

/** Rights, source review and visual intent are evidence, not AI-generated subject tags.
 * Preserve existing author tags, but reject new keyword proposals that claim a
 * publication or moderation state, carry a citation, or embed private references. */
// Detect embedded evidence claims after ordinary text or punctuation, not
// only at the beginning of a tag. Subject keywords cannot certify rights.
const RESERVED_PUBLICATION_KEYWORD = /(?:^|[^\p{L}\p{N}_])(?:visual|source|rights?|licen[sc]e|provenance|review|moderation|approval|publication|answer(?:-?key)?|correct(?:-?key)?)\s*:/iu;
// Public citation identifiers belong in separately verified provenance, not in
// subject keyword suggestions. A model response has a parallel rejection gate,
// but publisher-entered reviewed keywords must not bypass that boundary.
// Keep domains bounded to common reference host TLDs to avoid rejecting
// clinical abbreviations (for example E. coli) as fabricated citations.
const UNVERIFIED_PUBLIC_CITATION = /\b(?:www\.[a-z0-9-]+\.[a-z]{2,}|(?:[a-z0-9-]+\.)+(?:com|edu|gov|net|org|io)\b|(?:doi\s*[:=]?\s*)?10\.\d{4,9}\/[^\s)\]}>]+|pmid\s*[:#]?\s*\d{1,9}\b|(?:pmcid\s*[:#]?\s*)?PMC\d+\b)/i;

// Validate a separate comparison copy: invisible Unicode marks can split
// "rights:approved" or "file://", and compatibility-width characters can
// disguise a rights claim or source URL. Do not rewrite authored keywords or
// the original source record. Legitimate joining marks in non-Latin subjects
// remain intact in the stored subject tag.
const HIDDEN_KEYWORD_REFERENCE_MARKS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
// A single proposed subject tag must not contain a second comma/semicolon-
// separated tag or an embedded line. Publisher text inputs split these
// delimiters before review, but AI JSON keyword arrays do not. Otherwise a
// subject phrase could conceal a rights/source/moderation claim after a separator.
// Control characters are never meaningful clinical subject-tag separators.
const COMPOUND_KEYWORD_SEPARATORS = /[,;\p{Cc}\u2028\u2029]/u;
function keywordSafetyText(value: string): string {
  return value.normalize("NFKC").replace(HIDDEN_KEYWORD_REFERENCE_MARKS, "").trim();
}

/** Shared citation boundary for publisher keywords and generated teaching.
 * Scan a normalization-only copy; never modify author source or review evidence. */
export function containsUnverifiedCommunityCitation(value: string): boolean {
  const candidate = keywordSafetyText(value);
  // AI-generated HTTPS/HTTP links are unverified citations regardless of TLD.
  // A narrow domain allowlist missed plausible-looking .health/.dev sources.
  // This scans a copy only; the real source citation remains separately reviewed.
  return /https?:\/\//i.test(candidate) || UNVERIFIED_PUBLIC_CITATION.test(candidate);
}

export function isCommunitySubjectKeyword(value: string): boolean {
  const candidate = keywordSafetyText(value);
  return Boolean(candidate)
    && !COMPOUND_KEYWORD_SEPARATORS.test(candidate)
    && !RESERVED_PUBLICATION_KEYWORD.test(candidate)
    && !/https?:\/\//i.test(candidate)
    && !UNVERIFIED_PUBLIC_CITATION.test(candidate)
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
