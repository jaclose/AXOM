import type {
  CheckOutcome,
  CompetitivenessBand,
  EligibilityStatus,
  MetricComparison,
  RequirementCheck,
} from "../../lib/applicationChecker";
import { researchValue, type SchoolResearchFact } from "../../lib/applicationResearch";
import type { ReportedStatisticBasis } from "../../lib/applicationSchools";

export type TagTone = "cyan" | "green" | "gold" | "purple" | "neutral" | "orange" | "red";

/** Card-level check result. Text always accompanies the color. */
export const CHECK_STATUS: Record<EligibilityStatus, { label: string; tone: TagTone }> = {
  "possible-blocker": { label: "Possible blocker", tone: "orange" },
  "needs-review": { label: "Needs review", tone: "cyan" },
  "no-blockers-found": { label: "No blockers found", tone: "green" },
  "not-enough-information": { label: "Not enough information", tone: "neutral" },
};

export const CHECK_STATUS_ORDER: readonly EligibilityStatus[] = [
  "possible-blocker", "needs-review", "no-blockers-found", "not-enough-information",
];

/** Visual tone of one requirement row; paired with the outcome label, never used alone. */
export type OutcomeTone = "blocker" | "shortfall" | "review" | "unknown" | "ok" | "info";

export function outcomeLabel(check: Pick<RequirementCheck, "outcome" | "blocking" | "kind">): string {
  switch (check.outcome) {
    case "meets": return "Meets captured rule";
    case "on-track": return "On track";
    case "does-not-meet": return check.blocking ? "Possible blocker" : "Does not meet";
    case "below-recommended": return "Below recommended";
    case "needs-review": return "Needs review";
    case "missing-profile": return "Needs your details";
    case "missing-evidence": return "Not captured";
    case "not-applicable": return check.kind === "deadline" ? "Date to confirm" : "Not applicable";
    default: return "Needs review";
  }
}

export function outcomeTone(check: Pick<RequirementCheck, "outcome" | "blocking">): OutcomeTone {
  switch (check.outcome) {
    case "does-not-meet": return check.blocking ? "blocker" : "shortfall";
    case "below-recommended": return "shortfall";
    case "needs-review": return "review";
    case "missing-profile": case "missing-evidence": return "unknown";
    case "meets": case "on-track": return "ok";
    default: return "info";
  }
}

const ATTENTION: Record<CheckOutcome, number> = {
  "does-not-meet": 1, "needs-review": 2, "below-recommended": 3, "missing-profile": 4,
  "missing-evidence": 5, "on-track": 6, meets: 7, "not-applicable": 8,
};

/** Blockers first, then rows that need the learner's attention; stable within a group. */
export function byAttention(a: RequirementCheck, b: RequirementCheck): number {
  const rank = (check: RequirementCheck) => check.blocking ? 0 : ATTENTION[check.outcome] ?? 9;
  return rank(a) - rank(b);
}

export const CAPTURE_LABEL: Record<SchoolResearchFact["captureStatus"], string> = {
  "official-capture": "Official-page capture",
  "unverified-capture": "Unverified capture",
};

export const STAT_BASIS_LABEL: Record<ReportedStatisticBasis, string> = {
  "official-capture": "Official-page capture",
  "unverified-capture": "Unverified capture",
  "third-party": "Third-party figure",
};

export const BAND_TEXT: Record<CompetitivenessBand | "mixed", string> = {
  below: "below", near: "near", "at-or-above": "at or above", mixed: "mixed",
};

export const METRIC_LABEL: Record<MetricComparison["metric"], string> = {
  gpa: "GPA", "science-gpa": "Science GPA", mcat: "MCAT",
};

export function formatMetric(metric: MetricComparison["metric"], value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return metric === "mcat" ? String(value) : value.toFixed(2);
}

export function formatDelta(metric: MetricComparison["metric"], delta: number | undefined): string {
  if (delta === undefined || !Number.isFinite(delta)) return "";
  const size = metric === "mcat" ? String(Math.abs(delta)) : Math.abs(delta).toFixed(2);
  return delta > 0 ? `+${size}` : delta < 0 ? `−${size}` : "±0";
}

/** Research dates are date-only captures encoded at UTC midnight; keep the source calendar date. */
export function formatDate(value: string | undefined): string {
  const date = new Date(value ?? "");
  return Number.isNaN(date.valueOf()) ? "date unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

/** yyyy-MM → "Apr 2026". */
export function formatYearMonth(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? "");
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return Number.isNaN(date.valueOf()) ? undefined : new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Verbatim source text with the recorded-search sentinels spelled out. */
export function sourceText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "No text was captured.";
  if (/^NF\b/.test(trimmed)) return trimmed === "NF" ? "Not found during the recorded search" : trimmed;
  return researchValue(trimmed);
}

/**
 * The engine's estimate explanation ends with a disclaimer that names the
 * very thing the product never offers. AXOM states the same limit without it.
 */
export function estimateExplanation(text: string): string {
  return text.replace(/not an admissions probability or requirement/i, "not a prediction of admission and not a requirement");
}
