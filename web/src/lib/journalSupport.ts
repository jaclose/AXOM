/**
 * Journal-only support signal. This deliberately reads only first-person text
 * the learner typed into reflection fields. It does not inspect course notes,
 * questions, imports, or Day at a Glance evidence and it makes no diagnosis.
 */
const PERSONAL_SAFETY_PATTERNS = [
  /\b(?:kill|harm|hurt)\s+myself\b/i,
  /\b(?:end|take)\s+my\s+(?:own\s+)?life\b/i,
  /\bi\s+(?:do\s+not|don['’]?t|dont)\s+want\s+to\s+(?:live|be\s+alive|exist)\b/i,
  /\bi\s+(?:wish|hope)\s+i\s+(?:was|were)\s+dead\b/i,
  /\bi(?:['’]?m|\s+am|\s+feel(?:ing)?)\s+(?:feeling\s+)?suicidal\b/i,
  /\bi(?:['’]?d|\s+would)\s+be\s+better\s+off\s+(?:dead|not\s+here|not\s+alive)\b/i,
  /\b(?:everyone|they|my\s+family|you)\s+would\s+be\s+better\s+off\s+without\s+me\b/i,
  /\bi\s+(?:can\s*not|cannot|can['’]?t|cant)\s+keep\s+living\b/i,
  /\bi\s+(?:keep\s+)?think(?:ing)?\s+(?:about|of)\s+(?:suicide|dying|being\s+dead)\b/i,
] as const;

export function journalReflectionNeedsSupport(fields: readonly string[]): boolean {
  return fields.some((field) => {
    const text = field.trim();
    return text.length > 0 && PERSONAL_SAFETY_PATTERNS.some((pattern) => pattern.test(text));
  });
}
