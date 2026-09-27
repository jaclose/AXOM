export interface SchoolResearchFact {
  id: string;
  label: string;
  value: string;
  url: string;
  capturedAt: string;
  captureStatus: "official-capture" | "unverified-capture";
}

export interface ApplicationResearchEntry {
  schoolId: string;
  shortlisted: boolean;
  /** Research confirmation, not an eligibility or admission decision. */
  reviewedFacts: Record<string, string>;
}

export function normalizeApplicationResearch(value: unknown): ApplicationResearchEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, ApplicationResearchEntry>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.schoolId !== "string" || !raw.schoolId.trim()) continue;
    const reviewedFacts = Object.fromEntries(Object.entries(raw.reviewedFacts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    entries.set(raw.schoolId, { schoolId: raw.schoolId, shortlisted: raw.shortlisted === true, reviewedFacts });
  }
  return [...entries.values()];
}

/** Changed evidence reopens review instead of inheriting a stale check. */
export function researchFactRevision(fact: SchoolResearchFact): string {
  return JSON.stringify([fact.value, fact.url, fact.capturedAt, fact.captureStatus]);
}

export function researchValue(value: string): string {
  const missing: Record<string, string> = {
    NOT_PUBLICLY_DISCLOSED: "Not publicly reported in this capture",
    NOT_FOUND_AFTER_OFFICIAL_SEARCH: "Not found during the recorded search",
    REQUIRES_MANUAL_VERIFICATION: "Needs manual verification",
    CONFLICTING_SOURCES: "Conflicting sources — review required",
  };
  return missing[value] ?? value;
}

export function normalizeResearchFacts(value: unknown, now: Date): SchoolResearchFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): SchoolResearchFact[] => {
    if (!raw || typeof raw !== "object" || ![raw.id, raw.label, raw.value, raw.url, raw.capturedAt].every(v => typeof v === "string" && v.trim())) return [];
    try {
      const url = new URL(raw.url);
      const time = Date.parse(raw.capturedAt);
      if (!["https:", "http:"].includes(url.protocol) || !Number.isFinite(time) || time > now.getTime()) return [];
      return [{ id: raw.id, label: raw.label, value: raw.value, url: raw.url, capturedAt: raw.capturedAt,
        captureStatus: raw.captureStatus === "official-capture" ? "official-capture" : "unverified-capture" }];
    } catch { return []; }
  });
}
