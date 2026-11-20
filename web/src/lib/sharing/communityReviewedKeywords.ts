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
// remain intact in the stored subject tag. Deprecated bidi format controls
// and Arabic Letter Mark are stripped only from the comparison copy.
const HIDDEN_KEYWORD_REFERENCE_MARKS = /(?:\u00AD|\u034F|\u061C|\p{Variation_Selector}|[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF])/gu;
// A single proposed subject tag must not contain a second comma/semicolon-
// separated tag or an embedded line. Publisher text inputs split these
// delimiters before review, but AI JSON keyword arrays do not. Otherwise a
// subject phrase could conceal a rights/source/moderation claim after a separator.
// Control characters are never meaningful clinical subject-tag separators.
const COMPOUND_KEYWORD_SEPARATORS = /[,;\p{Cc}\u2028\u2029]/u;
function keywordSafetyText(value: string): string {
  return value.normalize("NFKC").replace(HIDDEN_KEYWORD_REFERENCE_MARKS, "").trim();
}

/** Some imported clinical text and public source links contain HTML-escaped
 * contact details. Decode only a bounded, comparison-only copy; never alter
 * authored content, citations, review evidence or published history.
 * Named entities are intentionally restricted to contact-relevant syntax. */
const CONTACT_HTML_ENTITIES: Record<string, string> = {
  amp: "&", commat: "@", period: ".", colon: ":", plus: "+", sol: "/",
  lpar: "(", rpar: ")", hyphen: "-", nbsp: " ", tab: " ", newline: " ",
};
function decodeContactHtmlEntities(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));|&([a-z][a-z0-9]+);/gi,
    (raw, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (name) return CONTACT_HTML_ENTITIES[name.toLowerCase()] ?? raw;
      const codepoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return codepoint >= 0x20 && codepoint <= 0x10ffff
        && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
        ? String.fromCodePoint(codepoint) : raw;
    });
}

/** Public citation and rich-text fields may conceal contact details through
 * percent escapes, HTML entities, or both, including nested escapes.
 * Normalize a bounded comparison-only copy before external AI inference,
 * keyword review, submission or pending moderation approval. A malformed
 * neighboring percent escape must not conceal a valid contact. */
function contactSafetyText(value: string): string {
  let candidate = keywordSafetyText(value);
  for (let depth = 0; depth < 3; depth += 1) {
    // Percent escapes are UTF-8 bytes, not independent Latin-1 characters.
    // Decode runs before NFKC so encoded fullwidth @, colon, dot and slash
    // cannot bypass privacy, citation or publication-evidence gates.
    // Malformed bytes are omitted only from this comparison copy, never source.
    const percentDecoded = candidate.replace(/(?:%[0-9a-f]{2})+/gi, (encoded: string) => {
      const bytes = Uint8Array.from(
        (encoded.match(/%[0-9a-f]{2}/gi) ?? [])
          .map(chunk => Number.parseInt(chunk.slice(1), 16)),
      );
      return new TextDecoder("utf-8").decode(bytes).replace(/\uFFFD/g, "");
    });
    const decoded = decodeContactHtmlEntities(percentDecoded);
    if (decoded === candidate) break;
    candidate = keywordSafetyText(decoded);
  }
  return candidate;
}

/** Comparison-only interpretation shared with outbound AI privacy checks.
 * Decodes bounded percent/HTML encodings without modifying source evidence. */
export function communityEvidenceSafetyText(value: string | undefined): string {
  return contactSafetyText(value ?? "");
}

/** Shared citation boundary for publisher keywords and generated teaching.
 * Scan a normalization-only copy; never modify author source or review evidence. */
export function containsUnverifiedCommunityCitation(value: string): boolean {
  // Encoded URLs can be displayed as live citations after rich-text rendering.
  // Use the same bounded comparison-only decoding as the contact-data gate.
  const candidate = contactSafetyText(value);
  // AI-generated HTTPS/HTTP links are unverified citations regardless of TLD.
  // A narrow domain allowlist missed plausible-looking .health/.dev sources.
  // This scans a copy only; the real source citation remains separately reviewed.
  return /https?:\/\//i.test(candidate) || UNVERIFIED_PUBLIC_CITATION.test(candidate);
}

// Source rights, key review and publication status belong to immutable review
// evidence, not free-text keyword suggestions or AI teaching prose. One shared
// comparison-only scanner keeps both admission paths aligned.
const UNVERIFIED_COMMUNITY_ATTESTATION = /(?:^|[^\p{L}\p{N}])(?:source(?:\s+(?:evidence|material|document|citation|reference))?|rights?|licen[sc]e|provenance|publication|moderation|academic\s+review|clinical\s+review|answer(?:[-\s]+key)?)[\s-]*(?::|=|\b(?:is|was|are|were|has\s+been|have\s+been)\b)?\s*(?:verified|validated|approved|cleared|confirmed|reviewed|licensed|granted|completed?)\b|\b(?:i|we)\s+(?:have\s+)?(?:reviewed|verified|checked|validated|confirmed)\s+(?:the\s+)?(?:original\s+)?(?:source|reference|citation|rights|licen[sc]e)\b|\b(?:approved|cleared|licensed|verified)\s+for\s+(?:community\s+)?publication\b|\b(?:reviewed|approved|verified|validated)\s+by\s+(?:faculty|(?:an?\s+)?(?:academic|clinical)\s+reviewer|(?:a\s+)?clinician|the\s+moderator)\b/iu;

export function containsUnverifiedCommunityAttestation(value: string): boolean {
  return UNVERIFIED_COMMUNITY_ATTESTATION.test(contactSafetyText(value));
}

// Public keyword proposals and outgoing AI text must use the same bounded
// contact-data checks. Inspect NFKC-normalized copies only; keep original
// questions, author tags, evidence and human moderation records unchanged.
// These cues do not replace independent privacy and rights review.
const PRIVATE_COMMUNITY_EMAIL = /(?:^|[^a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const PRIVATE_COMMUNITY_PHONE = /(?:^|[^a-z0-9])(?:phone(?:\s*(?:number|no\.?))?|telephone|tel\.?|mobile(?:\s*(?:number|no\.?))?|cell(?:phone)?(?:\s*(?:number|no\.?))?|contact(?:\s*(?:number|no\.?))?|call(?:\s+me)?(?:\s+at)?)\s*(?::|#|=|is)?\s*(\+?[\d(][\d().\s-]{6,30}\d)/gi;

export function containsPrivateCommunityEmail(value: string | undefined): boolean {
  return PRIVATE_COMMUNITY_EMAIL.test(contactSafetyText(value ?? ""));
}

export function containsPrivateCommunityPhone(value: string | undefined): boolean {
  return [...contactSafetyText(value ?? "").matchAll(PRIVATE_COMMUNITY_PHONE)]
    .some(match => {
      const digits = match[1].replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    });
}

export function isCommunitySubjectKeyword(value: string): boolean {
  // Review what encoded references would mean when interpreted, without
  // modifying the author-supplied tag or any immutable source evidence.
  const candidate = contactSafetyText(value);
  return Boolean(candidate)
    && !COMPOUND_KEYWORD_SEPARATORS.test(candidate)
    && !RESERVED_PUBLICATION_KEYWORD.test(candidate)
    && !/https?:\/\//i.test(candidate)
    && !UNVERIFIED_PUBLIC_CITATION.test(candidate)
    && !containsUnverifiedCommunityAttestation(candidate)
    && !containsPrivateCommunityEmail(candidate)
    && !containsPrivateCommunityPhone(candidate)
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
  // The keyword editor separates tags on semicolons, which also terminate
  // HTML entities. Validate a decoded comparison of the *whole* input first,
  // or source&#58;approved becomes two harmless-looking subject fragments.
  // Keep stored author text and the original delimiter behavior unchanged.
  const raw = keywordSafetyText(reviewedInput);
  const decoded = contactSafetyText(reviewedInput);
  if (decoded !== raw && (
    RESERVED_PUBLICATION_KEYWORD.test(decoded)
    || containsUnverifiedCommunityAttestation(decoded)
    || containsUnverifiedCommunityCitation(decoded)
    || containsPrivateCommunityEmail(decoded)
    || containsPrivateCommunityPhone(decoded)
    || hasPrivateDeviceCitation(decoded)
  )) throw new Error("Reviewed keywords must be subject phrases, not publication metadata, citations or private references.");
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
