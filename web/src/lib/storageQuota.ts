/** Recognize exhausted device persistence, even when a backup fallback wraps
 * the original failure. Provider request limits are not local storage errors. */
export function isBrowserStorageQuotaFailure(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length && seen.size < 16) {
    const current = pending.pop();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    const record = typeof current === "object" ? current as {
      name?: unknown; message?: unknown; cause?: unknown; errors?: unknown;
    } : undefined;
    const name = typeof record?.name === "string" ? record.name : "";
    const message = typeof record?.message === "string" ? record.message
      : typeof current === "string" ? current : "";
    if (name === "QuotaExceededError"
      || /QuotaExceededError|(?:browser|device|disk)\s+(?:storage\s+)?(?:is\s+)?full|(?:workspace|storage|backup)\s+exceeded\s+(?:the\s+)?quota/i.test(message)) return true;
    if (record?.cause != null) pending.push(record.cause);
    if (Array.isArray(record?.errors)) pending.push(...record.errors);
  }
  return false;
}
