import {
  applicationCycleLabel, CITIZENSHIP_OPTIONS, COURSE_CATEGORIES, ESTIMATE_ACTIVITIES, isApplicationProfileEmpty, resolveRegion,
  type ApplicationProfile, type ApplicationRegion, type CitizenshipStatus, type CourseCategory, type CourseworkEntry,
} from "./applicationProfile.ts";
import type {
  ApplicationSchool, EstimateActivity, EstimatedScore, EstimateHourRange, ReportedStatistic, ReportedStatisticBasis, SchoolEstimates,
} from "./applicationSchools.ts";
import {
  deriveRequirements, inferEvidenceCycle, type RequirementEvidence, type RequirementKind, type StructuredRequirement, type ThresholdVariant,
} from "./applicationRequirements.ts";

/**
 * meets             — profile satisfies the rule as captured.
 * on-track          — not yet satisfied, but planned/in progress before the rule's deadline.
 * does-not-meet     — profile fails a hard (or resolved conditional) rule.
 * below-recommended — profile falls short of a recommended / preferred / early-decision-only figure.
 * needs-review      — evidence or profile combination AXOM cannot decide (exceptions, other cycle, ambiguous text).
 * missing-profile   — the learner has not entered what this rule needs.
 * missing-evidence  — the school's evidence is a sentinel / not captured.
 * not-applicable    — the rule does not apply to this learner, or evidence states no minimum.
 */
export type CheckOutcome =
  | "meets" | "on-track" | "does-not-meet" | "below-recommended"
  | "needs-review" | "missing-profile" | "missing-evidence" | "not-applicable";

export interface RequirementCheck {
  requirementId: string;
  kind: RequirementKind;
  title: string;
  outcome: CheckOutcome;
  /** True only for does-not-meet on a hard or resolved-conditional rule. */
  blocking: boolean;
  /** Plain-language reason, including the numbers compared. */
  explanation: string;
  yourValue?: string;
  schoolValue?: string;
  /** All evidence is unverified-capture (never an official-page capture). */
  unverifiedEvidence: boolean;
  evidence: RequirementEvidence[];
  /** Present when the evidence addresses an earlier cycle than the learner's plan. */
  cycleNote?: string;
}

export type EligibilityStatus = "possible-blocker" | "needs-review" | "no-blockers-found" | "not-enough-information";

export interface EligibilitySummary {
  status: EligibilityStatus;
  /** One sentence. Never says "eligible" or promises admission. */
  headline: string;
  blockers: number;
  reviews: number;
  meets: number;
  /** Checks with missing-profile or missing-evidence outcomes. */
  unknown: number;
  /** Checks that reached a decision (meets/on-track/does-not-meet/below-recommended/not-applicable). */
  decided: number;
  total: number;
}

export interface CycleAssessment {
  plannedMatriculationYear?: number;
  /** Latest matriculation year the school's evidence addresses. */
  evidenceYear?: number;
  status: "current" | "earlier-cycle" | "later-cycle" | "unknown";
  note: string;
}

export type CompetitivenessBand = "below" | "near" | "at-or-above";

export type BenchmarkBasis = ReportedStatisticBasis | "estimate" | "peer-estimate";

export interface MetricComparison {
  metric: "gpa" | "science-gpa" | "mcat";
  yours?: number;
  benchmark?: number;
  /** e.g. "Reported median (official page capture, Jul 2026)" or "Research estimate (moderate confidence)". */
  benchmarkLabel: string;
  benchmarkBasis?: BenchmarkBasis;
  delta?: number;
  band?: CompetitivenessBand;
}

export interface CompetitivenessEstimate {
  /** Undefined when no comparison could be made. */
  band?: CompetitivenessBand | "mixed";
  comparisons: MetricComparison[];
  tier?: string;
  confidence: SchoolEstimates["confidence"];
  /** Always states that this is an estimate and not an admissions probability. */
  explanation: string;
}

export interface ActivityComparison {
  activity: EstimateActivity;
  label: string;
  yours?: number;
  range: EstimateHourRange;
  position?: "below-range" | "within-range" | "above-range";
}

export interface SchoolCheckResult {
  schoolId: string;
  checks: RequirementCheck[];
  eligibility: EligibilitySummary;
  cycle: CycleAssessment;
  competitiveness?: CompetitivenessEstimate;
  activities: ActivityComparison[];
}

export interface CheckContext {
  now: Date;
}

// ---------------------------------------------------------------------------
// Shared helpers

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SENTINEL = /^(NOT_PUBLICLY_DISCLOSED|NOT_FOUND_AFTER_OFFICIAL_SEARCH|REQUIRES_MANUAL_VERIFICATION|CONFLICTING_SOURCES|NF)\b/;
const NORTH_AMERICAN = new Set<CitizenshipStatus>(["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen"]);
const EMPTY_PROFILE: ApplicationProfile = { coursework: {}, activityHours: {} };
const FORBIDDEN_HEADLINE = /eligib|qualify|guarantee|chance|%/i;
const COMPETITIVENESS_DISCLAIMER =
  "Estimate from captured class statistics and research-team estimates — not an admissions probability or requirement.";

const isSentinel = (value: string) => !value.trim() || SENTINEL.test(value.trim());
const formatGpa = (value: number) => value.toFixed(2);
const formatScore = (value: number) => String(value);
/** Months since year 0, so month arithmetic stays exact (month is 1–12). */
const monthIndex = (year: number, month: number) => year * 12 + month - 1;
const formatMonth = (index: number) => `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const quoteList = (items: readonly string[]) => items.map(item => `"${item}"`).join("; ");
const citizenshipLabel = (status: CitizenshipStatus | undefined) =>
  CITIZENSHIP_OPTIONS.find(option => option.id === status)?.label ?? "not entered";
const citizenshipList = (statuses: readonly CitizenshipStatus[]) => statuses.map(citizenshipLabel).join(", ");
/** "Other international applicants", not "Other international applicant applicants". */
const applicantsLabel = (status: CitizenshipStatus | undefined) => `${citizenshipLabel(status).replace(/ applicant$/, "")} applicants`;
const categoryLabel = (category: CourseCategory) => COURSE_CATEGORIES.find(entry => entry.id === category)?.label ?? category;

function parseYearMonth(value: string | undefined): { year: number; month: number } | undefined {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? "");
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : undefined;
}

/** yyyy-MM or yyyy-MM-dd; a bare month reads as its first day (earliest) or last day (latest). */
function parseDay(value: string | undefined, edge: "start" | "end") {
  const month = parseYearMonth(value);
  if (!month) return undefined;
  const lastDay = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const explicit = /^\d{4}-\d{2}-(\d{2})/.exec(value ?? "")?.[1];
  const day = explicit ? Math.min(Number(explicit), lastDay) : edge === "start" ? 1 : lastDay;
  return { index: monthIndex(month.year, month.month), day, lastDay, label: `${MONTHS[month.month - 1]} ${day}, ${month.year}` };
}

const OUTCOME_RANK: Record<CheckOutcome, number> = {
  "not-applicable": 0, meets: 1, "on-track": 2, "below-recommended": 3,
  "missing-evidence": 4, "missing-profile": 5, "needs-review": 6, "does-not-meet": 7,
};

const CHECK_TITLES: Record<RequirementKind, string> = {
  "gpa-minimum": "Cumulative GPA minimum", "science-gpa-minimum": "Science GPA minimum", "mcat-minimum": "MCAT minimum",
  "mcat-required": "MCAT requirement", "mcat-recency": "MCAT test date window", citizenship: "Citizenship and visa status",
  "state-residency": "State residency", degree: "Bachelor's degree", coursework: "Coursework",
  "prerequisite-grades": "Prerequisite grades", "online-coursework": "Online coursework",
  "community-college": "Community college coursework", "ap-credit": "AP/IB credit", deadline: "Primary application deadline",
};

function courseworkCategory(requirement: Pick<StructuredRequirement, "id" | "coursework">): CourseCategory | undefined {
  const id = requirement.coursework?.category ?? requirement.id.split(":")[1];
  return COURSE_CATEGORIES.find(entry => entry.id === id)?.id;
}

/** Display title for a requirement ("General chemistry coursework", "MCAT minimum"…). */
export function requirementTitle(requirement: Pick<StructuredRequirement, "id" | "kind" | "coursework">): string {
  if (requirement.kind !== "coursework") return CHECK_TITLES[requirement.kind] ?? "Requirement";
  const category = courseworkCategory(requirement);
  return category ? `${categoryLabel(category)} coursework` : CHECK_TITLES.coursework;
}

/** Matriculation year a fact addresses — the single implementation lives in applicationRequirements.ts. */
export const evidenceCycleForFact = inferEvidenceCycle;

/** Earliest cycle any of the rule's evidence addresses (explicit `cycleYear` included). */
function requirementEvidenceYear(requirement: StructuredRequirement): number | undefined {
  const years = requirement.evidence
    .map(item => evidenceCycleForFact({ value: item.rawValue, capturedAt: item.capturedAt }))
    .filter((year): year is number => year !== undefined);
  if (requirement.cycleYear !== undefined) years.push(requirement.cycleYear);
  return years.length ? Math.min(...years) : undefined;
}

function schoolRegionOf(location: string | undefined): ApplicationRegion | undefined {
  const direct = resolveRegion(location);
  if (direct || !location) return direct;
  const names = new Set(location.split(/[,/;]/).map(part => resolveRegion(part)?.name).filter(Boolean));
  return names.size === 1 ? resolveRegion([...names][0]) : undefined;
}

// ---------------------------------------------------------------------------
// Evaluation

interface Verdict {
  outcome: CheckOutcome;
  explanation: string;
  blocking?: boolean;
  yourValue?: string;
  schoolValue?: string;
}

interface Context {
  profile: ApplicationProfile;
  now: Date;
  /** Planned matriculation year (M). */
  year?: number;
  learnerRegion?: ApplicationRegion;
  schoolRegion?: ApplicationRegion;
}

/** Sentinel evidence is "not found"; readable-but-unparsed text needs a human. */
function unreadable(requirement: StructuredRequirement): Verdict {
  return requirement.evidence.every(item => isSentinel(item.rawValue ?? ""))
    ? { outcome: "missing-evidence", explanation: "The school's evidence for this rule was not found or not disclosed in the captured research." }
    : { outcome: "needs-review", explanation: "AXOM could not read a rule from this text; review the source." };
}

/** Coursework and coursework-policy rules report unreadable text as missing evidence (spec), but say which it was. */
function missingEvidence(requirement: StructuredRequirement, rule: string): Verdict {
  const verdict = unreadable(requirement);
  return verdict.outcome === "missing-evidence" ? verdict
    : { outcome: "missing-evidence", explanation: `AXOM could not read the ${rule} from this text, so there is nothing to compare yet; review the source.` };
}

/** The worse outcome leads; both explanations are kept. */
function mergeVerdicts(base: Verdict, extra: Verdict): Verdict {
  const [lead, other] = OUTCOME_RANK[extra.outcome] > OUTCOME_RANK[base.outcome] ? [extra, base] : [base, extra];
  return { ...lead, explanation: `${lead.explanation} ${other.explanation}` };
}

const withNote = (verdict: Verdict, note: string): Verdict => ({ ...verdict, explanation: `${verdict.explanation} ${note}` });

type NumericKind = "gpa-minimum" | "science-gpa-minimum" | "mcat-minimum";
const NUMERIC: Record<NumericKind, { field: "cumulativeGpa" | "scienceGpa" | "mcatTotal"; noun: string; format: (value: number) => string }> = {
  "gpa-minimum": { field: "cumulativeGpa", noun: "cumulative GPA", format: formatGpa },
  "science-gpa-minimum": { field: "scienceGpa", noun: "science GPA", format: formatGpa },
  "mcat-minimum": { field: "mcatTotal", noun: "MCAT total", format: formatScore },
};

const VARIANT_WORDS: Record<ThresholdVariant["condition"], string> = {
  "in-state": "in-state minimum", "out-of-state": "out-of-state minimum", "early-decision": "Early Decision minimum",
  screening: "screening threshold", "north-american": "minimum for North American applicants", other: "conditional minimum",
};
const figureLabel = (variant: ThresholdVariant, format: (value: number) => string) =>
  `${format(variant.threshold)} ${VARIANT_WORDS[variant.condition] ?? VARIANT_WORDS.other}`;

type Applies = "yes" | "no" | "needs-profile" | "unresolved";

function variantApplies(variant: ThresholdVariant, ctx: Context): Applies {
  switch (variant.condition) {
    case "in-state": case "out-of-state": {
      if (!ctx.learnerRegion) return "needs-profile";
      if (!ctx.schoolRegion) return "unresolved";
      const inState = ctx.learnerRegion.name === ctx.schoolRegion.name;
      return inState === (variant.condition === "in-state") ? "yes" : "no";
    }
    case "north-american":
      if (!ctx.profile.citizenship) return "needs-profile";
      return NORTH_AMERICAN.has(ctx.profile.citizenship) ? "yes" : "no";
    case "screening": case "early-decision": return "yes";
    default: return "unresolved";
  }
}

function failedVariantText(variant: ThresholdVariant, ctx: Context, noun: string, yours: string, figure: string): string {
  switch (variant.condition) {
    case "screening":
      return `Your ${noun} of ${yours} is below the ${figure}; the school uses this screening threshold to decide who moves to the next stage.`;
    case "in-state":
      return `As a ${ctx.learnerRegion?.name} resident applying in-state, the ${figure} applies; your ${noun} of ${yours} is below it.`;
    case "out-of-state":
      return `As an out-of-state applicant (${ctx.learnerRegion?.name}), the ${figure} applies; your ${noun} of ${yours} is below it.`;
    default:
      return `The ${figure} applies to you (${citizenshipLabel(ctx.profile.citizenship)}); your ${noun} of ${yours} is below it.`;
  }
}

function conditionalMinimum(requirement: StructuredRequirement, ctx: Context, kind: NumericKind, yours: number | undefined): Verdict {
  const { noun, format } = NUMERIC[kind];
  const figures: ThresholdVariant[] = [...(requirement.variants ?? [])];
  if (requirement.threshold !== undefined && !figures.some(variant => variant.threshold === requirement.threshold)) {
    figures.push({ condition: "other", threshold: requirement.threshold, text: requirement.exceptions.join("; ") });
  }
  if (!figures.length) {
    return { outcome: "needs-review", explanation: "The captured rule depends on a condition, but AXOM could not read a number from it; review the source." };
  }
  const listed = figures.map(variant => figureLabel(variant, format)).join("; ");
  if (yours === undefined) {
    return { outcome: "missing-profile", explanation: `Add your ${noun} to compare it with the listed figures (${listed}).`, schoolValue: listed };
  }
  const yourValue = format(yours);
  const assessed = figures.map(variant => ({ variant, applies: variantApplies(variant, ctx), met: yours >= variant.threshold }));
  const failing = assessed.find(entry => entry.applies === "yes" && !entry.met && entry.variant.condition !== "early-decision");
  if (failing) {
    const figure = figureLabel(failing.variant, format);
    return { outcome: "does-not-meet", blocking: true, explanation: failedVariantText(failing.variant, ctx, noun, yourValue, figure), yourValue, schoolValue: figure };
  }
  const unresolved = assessed.filter(entry => (entry.applies === "needs-profile" || entry.applies === "unresolved") && !entry.met);
  if (unresolved.length) {
    const figure = unresolved.map(entry => figureLabel(entry.variant, format)).join("; ");
    if (unresolved.every(entry => entry.applies === "needs-profile")) {
      const missing = unresolved.some(entry => entry.variant.condition === "north-american") ? "citizenship status" : "state of residence";
      return {
        outcome: "missing-profile", yourValue, schoolValue: listed,
        explanation: `Add your ${missing} to tell which figure applies; your ${noun} of ${yourValue} is below the ${figure}.`,
      };
    }
    const sourceText = unresolved.map(entry => entry.variant.text).filter(Boolean);
    return {
      outcome: "needs-review", yourValue, schoolValue: figure,
      explanation: `AXOM could not tell whether the ${figure} applies to you${sourceText.length ? ` (${quoteList(sourceText)})` : ""}; your ${noun} of ${yourValue} is below it.`,
    };
  }
  const early = assessed.find(entry => entry.variant.condition === "early-decision");
  const regular = assessed.filter(entry => entry !== early);
  if (regular.length && regular.every(entry => entry.applies === "no")) {
    const figure = regular.map(entry => figureLabel(entry.variant, format)).join("; ");
    if (regular.every(entry => entry.variant.condition === "north-american")) {
      return {
        outcome: "not-applicable", yourValue, schoolValue: figure,
        explanation: `The ${figure} does not apply to you (${citizenshipLabel(ctx.profile.citizenship)}).`,
      };
    }
    return {
      outcome: "needs-review", yourValue, schoolValue: figure,
      explanation: `The captured figure (${figure}) does not apply to you, and no figure for your situation was captured; your ${noun} is ${yourValue} — review the source.`,
    };
  }
  if (early && !early.met) {
    const figure = figureLabel(early.variant, format);
    return {
      outcome: "below-recommended", yourValue, schoolValue: figure,
      explanation: `Your ${noun} of ${yourValue} is below the ${figure}, which applies only if you apply Early Decision.`,
    };
  }
  const earlyNote = early ? ` The ${figureLabel(early.variant, format)} applies only if you apply Early Decision.` : "";
  const governing = regular.filter(entry => entry.applies === "yes");
  // Figures AXOM could not resolve are all met at this point, so the learner clears whichever one applies.
  const open = regular.filter(entry => entry.applies === "needs-profile" || entry.applies === "unresolved");
  const cleared = (governing.length ? governing : open).map(entry => figureLabel(entry.variant, format)).join("; ");
  if (governing.length) return { outcome: "meets", yourValue, schoolValue: cleared, explanation: `Your ${noun} of ${yourValue} meets the ${cleared}.${earlyNote}` };
  if (open.length) {
    return { outcome: "meets", yourValue, schoolValue: cleared,
      explanation: `Your ${noun} of ${yourValue} is at or above every figure that might apply (${cleared}).${earlyNote}` };
  }
  const figure = figureLabel(early!.variant, format);
  return { outcome: "meets", yourValue, schoolValue: figure,
    explanation: `Your ${noun} of ${yourValue} meets the ${figure}, which applies only if you apply Early Decision.` };
}

function numericMinimum(requirement: StructuredRequirement, ctx: Context, kind: NumericKind): Verdict {
  const { field, noun, format } = NUMERIC[kind];
  const yours = ctx.profile[field];
  const yourValue = yours === undefined ? undefined : format(yours);
  switch (requirement.strength) {
    case "unknown": return unreadable(requirement);
    case "none-stated":
      return { outcome: "not-applicable", yourValue, schoolValue: "No published minimum",
        explanation: "No published minimum in the captured evidence — not a waiver of holistic review." };
    case "not-required":
      return { outcome: "not-applicable", yourValue, schoolValue: "Not required",
        explanation: kind === "mcat-minimum"
          ? "The captured evidence says the MCAT is not required or not scored here, so there is no minimum score to compare."
          : "The captured evidence says this minimum is not required." };
    case "conditional": return conditionalMinimum(requirement, ctx, kind, yours);
  }
  if (requirement.threshold === undefined) {
    return { outcome: "needs-review", yourValue, explanation: "AXOM could not read a numeric minimum from this text; review the source." };
  }
  const hard = requirement.strength === "hard";
  const threshold = format(requirement.threshold);
  const schoolValue = `${threshold} ${hard ? "minimum" : "recommended minimum"}`;
  if (yours === undefined) return { outcome: "missing-profile", schoolValue, explanation: `Add your ${noun} to compare it with the ${schoolValue}.` };
  if (yours >= requirement.threshold) {
    return { outcome: "meets", yourValue, schoolValue,
      explanation: `Your ${noun} of ${yourValue} meets the ${hard ? "minimum" : "recommended minimum"} of ${threshold}.` };
  }
  return hard
    ? { outcome: "does-not-meet", blocking: true, yourValue, schoolValue, explanation: `Your ${noun} of ${yourValue} is below the hard minimum of ${threshold}.` }
    : { outcome: "below-recommended", yourValue, schoolValue,
      explanation: `Your ${noun} of ${yourValue} is below the recommended ${threshold}; this is a stated preference, not a cutoff.` };
}

/** Section floors and attempt limits bind like the total when the rule is hard (or a screening threshold). */
function applyMcatLimits(requirement: StructuredRequirement, ctx: Context, verdict: Verdict): Verdict {
  const strict = requirement.strength === "hard" || (requirement.variants ?? []).some(variant => variant.condition === "screening");
  const shortfall = (explanation: string, yourValue: string, schoolValue: string): Verdict => strict
    ? { outcome: "does-not-meet", blocking: true, explanation, yourValue, schoolValue }
    : { outcome: requirement.strength === "recommended" ? "below-recommended" : "needs-review", explanation, yourValue, schoolValue };
  let result = verdict;
  const { sectionFloor, maxAttempts } = requirement;
  if (sectionFloor !== undefined) {
    const lowest = ctx.profile.mcatLowestSection;
    if (lowest === undefined) result = withNote(result, `The school also lists no section below ${sectionFloor}; add your lowest section score to check it.`);
    else if (lowest < sectionFloor) {
      result = mergeVerdicts(result, shortfall(`Your lowest section score of ${lowest} is below the section floor of ${sectionFloor}.`,
        `Lowest section ${lowest}`, `No section below ${sectionFloor}`));
    } else result = withNote(result, `Your lowest section score of ${lowest} clears the section floor of ${sectionFloor}.`);
  }
  if (maxAttempts !== undefined) {
    const attempts = ctx.profile.mcatAttempts;
    if (attempts === undefined) result = withNote(result, `The school considers at most ${maxAttempts} attempts; add your attempt count to check it.`);
    else if (attempts > maxAttempts) {
      result = mergeVerdicts(result, shortfall(`You entered ${plural(attempts, "MCAT attempt")}; the school considers at most ${maxAttempts}.`,
        plural(attempts, "attempt"), `At most ${plural(maxAttempts, "attempt")}`));
    } else result = withNote(result, `You entered ${plural(attempts, "attempt")}, within the limit of ${maxAttempts}.`);
  }
  return result;
}

/** No school can use a score from after January of the matriculation year. */
const latestUsableTest = (year: number) => monthIndex(year, 1);

function isPlannedTest(test: { year: number; month: number }, now: Date) {
  return Date.UTC(test.year, test.month - 1, 1) > now.getTime();
}

function mcatRequired(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  if (requirement.strength === "not-required") {
    return { outcome: "not-applicable", schoolValue: "Not required", explanation: "The captured evidence says the MCAT is not required here." };
  }
  if (requirement.strength === "none-stated") {
    return { outcome: "not-applicable", schoolValue: "No MCAT statement", explanation: "The captured evidence makes no statement about requiring the MCAT." };
  }
  const citizenship = ctx.profile.citizenship;
  const requiredFor = requirement.requiredFor ?? [];
  const optionalFor = requirement.optionalFor ?? [];
  let schoolValue = requiredFor.length ? `Required for ${citizenshipList(requiredFor)}` : "Required";
  if (optionalFor.length) schoolValue += `; optional for ${citizenshipList(optionalFor)}`;
  if (requiredFor.length || optionalFor.length) {
    if (!citizenship) {
      return { outcome: "missing-profile", schoolValue, explanation: "Add your citizenship status — the captured evidence treats applicant groups differently for the MCAT." };
    }
    if (optionalFor.includes(citizenship)) {
      return { outcome: "not-applicable", yourValue: citizenshipLabel(citizenship), schoolValue,
        explanation: `The captured evidence says the MCAT is optional or not required for ${applicantsLabel(citizenship)}.` };
    }
    if (requiredFor.length && !requiredFor.includes(citizenship)) {
      return { outcome: "needs-review", yourValue: citizenshipLabel(citizenship), schoolValue,
        explanation: `The captured evidence names the MCAT requirement for ${citizenshipList(requiredFor)}; it does not say how ${applicantsLabel(citizenship)} are treated.` };
    }
  } else if (requirement.strength === "conditional") {
    return { outcome: "needs-review", schoolValue: "Depends on a stated condition",
      explanation: "The captured evidence makes the MCAT requirement depend on a condition AXOM cannot check; review the source." };
  }
  const recommended = requirement.strength === "recommended";
  if (recommended) schoolValue = "Recommended";
  // Exempting other groups is not the same as stating a requirement for yours.
  const verb = recommended ? "recommends" : !requiredFor.length && optionalFor.length ? "expects" : "requires";
  const total = ctx.profile.mcatTotal;
  if (total !== undefined) {
    return { outcome: "meets", yourValue: `Total ${total}`, schoolValue, explanation: `You entered an MCAT total of ${total}; the school ${verb} an MCAT.` };
  }
  const test = parseYearMonth(ctx.profile.mcatTestDate);
  if (test && isPlannedTest(test, ctx.now)) {
    const index = monthIndex(test.year, test.month);
    const month = formatMonth(index);
    if (ctx.year && index > latestUsableTest(ctx.year)) {
      return { outcome: "needs-review", yourValue: `Planned ${month}`, schoolValue,
        explanation: `You plan to test in ${month}, after ${formatMonth(latestUsableTest(ctx.year))} — later than schools accept scores for ${ctx.year} entry.` };
    }
    return { outcome: "on-track", yourValue: `Planned ${month}`, schoolValue, explanation: `You plan to test in ${month}; the school ${verb} an MCAT.` };
  }
  if (recommended) {
    return { outcome: "missing-profile", schoolValue, explanation: "The school recommends an MCAT; add your score or planned test date." };
  }
  return test
    ? { outcome: "missing-profile", yourValue: `Tested ${formatMonth(monthIndex(test.year, test.month))}`, schoolValue,
      explanation: "The MCAT is required; you entered a past test date without a score — add your score." }
    : { outcome: "missing-profile", schoolValue, explanation: "The MCAT is required; add your score or planned test date." };
}

type WindowStatus = "inside" | "outside" | "close";
interface WindowResult { status: WindowStatus; text: string }

function recencyLabel(requirement: StructuredRequirement, year: number | undefined): string {
  const parts: string[] = [];
  const window = requirement.testWindow;
  if (window && (window.earliest || window.latest)) {
    const earliest = parseDay(window.earliest, "start"), latest = parseDay(window.latest, "end");
    const range = earliest && latest ? `${earliest.label} – ${latest.label}` : earliest ? `On or after ${earliest.label}` : `By ${latest?.label}`;
    parts.push(window.matriculationYear ? `${range} (${window.matriculationYear} entry)` : range);
  }
  const month = requirement.latestTestMonthBeforeMatriculation;
  if (month !== undefined && month >= 1 && month <= 12) {
    parts.push(year ? `By ${MONTHS[month - 1]} ${year - 1}` : `By ${MONTHS[month - 1]} of the year before entry`);
  }
  if (requirement.recency) {
    const anchor = requirement.recency.anchor === "application" ? "application" : "matriculation";
    parts.push(`Within ${plural(requirement.recency.years, "year")} of ${anchor}`);
  }
  return parts.join("; ") || "Test-date rule";
}

function compareWindow(test: number, testLabel: string, window: NonNullable<StructuredRequirement["testWindow"]>, year: number): WindowResult {
  const earliest = parseDay(window.earliest, "start"), latest = parseDay(window.latest, "end");
  if (earliest && test < earliest.index) return { status: "outside", text: `Your test date (${testLabel}) is before the earliest accepted date, ${earliest.label}.` };
  if (latest && test > latest.index) return { status: "outside", text: `Your test date (${testLabel}) is after the latest accepted date, ${latest.label}.` };
  const edge = earliest && test === earliest.index && earliest.day > 1 ? earliest : latest && test === latest.index && latest.day < latest.lastDay ? latest : undefined;
  if (edge) return { status: "close", text: `Your test month (${testLabel}) is the same month as the ${edge.label} cutoff; check your exact test day.` };
  const range = [earliest?.label, latest?.label].filter(Boolean).join(" – ");
  return { status: "inside", text: `Your test date (${testLabel}) falls inside the ${year} window (${range}).` };
}

function mcatRecency(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  if (requirement.strength === "none-stated" || requirement.strength === "not-required") {
    return { outcome: "not-applicable", explanation: "The captured evidence states no MCAT test-date window." };
  }
  const window = parseDay(requirement.testWindow?.earliest, "start") || parseDay(requirement.testWindow?.latest, "end") ? requirement.testWindow : undefined;
  const latestMonth = requirement.latestTestMonthBeforeMatriculation;
  const hasLatestMonth = latestMonth !== undefined && latestMonth >= 1 && latestMonth <= 12;
  const recency = requirement.recency && requirement.recency.years > 0 ? requirement.recency : undefined;
  const year = ctx.year;
  const schoolValue = recencyLabel(requirement, year);
  if (!window && !hasLatestMonth && !recency) {
    return { outcome: "needs-review", schoolValue, explanation: "AXOM could not read a test-date window from this text; review the source." };
  }
  const test = parseYearMonth(ctx.profile.mcatTestDate);
  if (!test || !year) {
    const missing = [!test && "MCAT test date (taken or planned)", !year && "planned matriculation year"].filter(Boolean).join(" and ");
    return { outcome: "missing-profile", schoolValue, explanation: `Add your ${missing} to compare with this test-date rule.` };
  }
  const testIndex = monthIndex(test.year, test.month);
  const planned = isPlannedTest(test, ctx.now);
  const testLabel = `${formatMonth(testIndex)}${planned ? ", planned" : ""}`;
  const yourValue = planned ? `Planned ${formatMonth(testIndex)}` : formatMonth(testIndex);
  const results: WindowResult[] = [];
  const notes: string[] = [];
  if (testIndex > latestUsableTest(year)) {
    results.push({ status: "outside",
      text: `Your test date (${testLabel}) is after ${formatMonth(latestUsableTest(year))}, too late for ${year} entry.` });
  }
  if (window) {
    const windowYear = window.matriculationYear ?? requirementEvidenceYear(requirement);
    if (windowYear === year) results.push(compareWindow(testIndex, testLabel, window, year));
    else {
      const cycle = windowYear ? `the ${windowYear} entering class` : "an unstated entering class";
      if (hasLatestMonth || recency) notes.push(`The captured date window addresses ${cycle}, so AXOM compared the stated rule instead.`);
      else results.push({ status: "close", text: `This test-date window was published for ${cycle}, not your ${year} cycle; confirm the current window with the school.` });
    }
  }
  if (hasLatestMonth) {
    const latest = monthIndex(year - 1, latestMonth);
    results.push(testIndex <= latest
      ? { status: "inside", text: `Your test date (${testLabel}) is no later than ${formatMonth(latest)}, the latest the school accepts for ${year} entry.` }
      : { status: "outside", text: `Your test date (${testLabel}) is after ${formatMonth(latest)}, the latest the school accepts for ${year} entry.` });
  }
  if (recency) {
    const years = recency.years;
    const anchor = recency.anchor === "application" ? monthIndex(year - 1, 6) : monthIndex(year, 8);
    const anchorLabel = recency.anchor === "application" ? `the ${formatMonth(anchor)} application` : `${formatMonth(anchor)} matriculation`;
    const earliest = anchor - Math.round(12 * years);
    const span = `A ${years}-year window counted back from ${anchorLabel} starts around ${formatMonth(earliest)}`;
    if (testIndex >= earliest + 6) results.push({ status: "inside", text: `${span}; your test date (${testLabel}) is inside it.` });
    else if (testIndex < earliest - 6) results.push({ status: "outside", text: `${span}; your test date (${testLabel}) falls before it.` });
    else {
      results.push({ status: "close",
        text: `Your test date (${testLabel}) is close to the ${years}-year cutoff (around ${formatMonth(earliest)}); schools count this differently — confirm with the school.` });
    }
  }
  const worst = results.find(result => result.status === "outside") ?? results.find(result => result.status === "close");
  const explanation = [...(worst ? [worst.text] : results.map(result => result.text)), ...notes].join(" ");
  if (!worst) return { outcome: planned ? "on-track" : "meets", yourValue, schoolValue, explanation };
  if (worst.status === "close") return { outcome: "needs-review", yourValue, schoolValue, explanation };
  if (requirement.strength === "hard") return { outcome: "does-not-meet", blocking: true, yourValue, schoolValue, explanation };
  return { outcome: requirement.strength === "recommended" ? "below-recommended" : "needs-review", yourValue, schoolValue, explanation };
}

function citizenshipCheck(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  if (requirement.strength === "none-stated" || requirement.strength === "not-required") {
    return { outcome: "not-applicable", explanation: "No citizenship restriction stated in the captured evidence." };
  }
  const policy = requirement.citizenship;
  if (!policy) return { outcome: "needs-review", explanation: "AXOM could not read which applicant groups this policy accepts; review the source." };
  const schoolValue = policy.accepted.length ? `Accepts ${citizenshipList(policy.accepted)}` : "Accepted groups not stated";
  const status = ctx.profile.citizenship;
  if (!status) return { outcome: "missing-profile", schoolValue, explanation: "Add your citizenship or visa status to compare with this policy." };
  const yourValue = citizenshipLabel(status);
  const applicants = applicantsLabel(status);
  if (policy.excluded.includes(status)) {
    return { outcome: "does-not-meet", blocking: true, yourValue, schoolValue,
      explanation: `The captured policy does not accept ${applicants}; it lists ${policy.accepted.length ? citizenshipList(policy.accepted) : "no accepted groups"}.` };
  }
  if (policy.accepted.includes(status)) {
    const conditional = requirement.strength === "conditional" ? " The policy carries a condition — read the qualifier below." : "";
    return { outcome: "meets", yourValue, schoolValue, explanation: `The captured policy accepts ${applicants}.${conditional}` };
  }
  return { outcome: "needs-review", yourValue, schoolValue, explanation: `The captured policy does not say how ${applicants} are treated.` };
}

function residencyCheck(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  const residency = requirement.residency;
  if (requirement.strength === "none-stated" || requirement.strength === "not-required" || residency?.mode === "none") {
    return { outcome: "not-applicable", schoolValue: "No state preference", explanation: "No state preference stated in the captured evidence." };
  }
  if (!residency) return { outcome: "needs-review", explanation: "AXOM could not read a residency rule from this text; review the source." };
  const named = residency.preferredRegions.map(name => resolveRegion(name)).filter((region): region is ApplicationRegion => Boolean(region));
  const regions = named.length ? named : ctx.schoolRegion ? [ctx.schoolRegion] : [];
  if (!regions.length) {
    return { outcome: "needs-review", explanation: "The captured text names a residency rule AXOM could not match to a state or province; review the source." };
  }
  const names = regions.map(region => region.name).join(", ");
  const restricted = residency.mode === "restricted";
  const schoolValue = restricted ? `Residents of ${names} only` : `Prefers residents of ${names}`;
  if (!ctx.learnerRegion) return { outcome: "missing-profile", schoolValue, explanation: "Add your state or province of residence to compare with this residency policy." };
  const yourValue = ctx.learnerRegion.name;
  if (regions.some(region => region.name === yourValue)) {
    return { outcome: "meets", yourValue, schoolValue,
      explanation: restricted ? `The school limits admission to residents of ${names}; you entered ${yourValue}.` : `In-state preference applies to you: the school prefers residents of ${names}.` };
  }
  if (restricted) {
    return { outcome: "does-not-meet", blocking: true, yourValue, schoolValue,
      explanation: `The captured policy limits admission to residents of ${names}; you entered ${yourValue}.` };
  }
  return { outcome: "below-recommended", yourValue, schoolValue,
    explanation: `The school prefers residents of ${names}; out-of-state applicants may need ties (you entered ${yourValue}).` };
}

const DEGREE_STATUS_LABELS = { completed: "Completed", "in-progress": "In progress", "not-started": "Not started" } as const;

function degreeCheck(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  if (requirement.strength === "none-stated" || requirement.strength === "not-required") {
    return { outcome: "not-applicable", explanation: "The captured evidence states no degree requirement." };
  }
  const degree = requirement.degree;
  if (!degree) return { outcome: "needs-review", explanation: "AXOM could not read a degree rule from this text; review the source." };
  if (!degree.bachelorsRequired && degree.minimumSemesterHours !== undefined) return semesterHoursCheck(degree.minimumSemesterHours, ctx);
  return bachelorsCheck(requirement, ctx, degree.bachelorsRequired && requirement.strength !== "recommended");
}

function bachelorsCheck(requirement: StructuredRequirement, ctx: Context, required: boolean): Verdict {
  const by = requirement.degree?.completedBy ?? "unspecified";
  const year = ctx.year;
  const status = ctx.profile.degreeStatus;
  const schoolValue = !required ? "Bachelor's preferred" : by === "application" ? "Bachelor's by application" : "Bachelor's by matriculation";
  const expected = parseYearMonth(ctx.profile.degreeExpectedDate);
  const expectedIndex = expected ? monthIndex(expected.year, expected.month) : undefined;
  const yourValue = status ? `${DEGREE_STATUS_LABELS[status]}${expectedIndex !== undefined && status !== "not-started" ? `, ${formatMonth(expectedIndex)}` : ""}` : undefined;
  const short = (explanation: string): Verdict => required
    ? { outcome: "does-not-meet", blocking: true, yourValue, schoolValue, explanation }
    : { outcome: "below-recommended", yourValue, schoolValue, explanation: `${explanation} The school states a preference, not a requirement.` };
  if (!status) return { outcome: "missing-profile", schoolValue, explanation: "Add your degree status to compare with this rule." };
  if (status === "completed") return { outcome: "meets", yourValue, schoolValue, explanation: "You entered a completed bachelor's degree." };
  if (!year) return { outcome: "missing-profile", yourValue, schoolValue, explanation: "Add your planned matriculation year to compare your degree timing." };
  // Degree must be conferred by July of M (matriculation) or June of M−1 (application).
  const cutoff = by === "application" ? monthIndex(year - 1, 6) : monthIndex(year, 7);
  const cutoffLabel = `${formatMonth(cutoff)} (${by === "application" ? "application" : `before ${year} matriculation`})`;
  if (status === "in-progress") {
    if (expectedIndex === undefined) {
      return { outcome: "needs-review", yourValue, schoolValue, explanation: `Your degree is in progress; add your expected graduation date to compare with the ${cutoffLabel} cutoff.` };
    }
    return expectedIndex <= cutoff
      ? { outcome: "on-track", yourValue, schoolValue, explanation: `Your degree is expected ${formatMonth(expectedIndex)}, by the ${cutoffLabel} cutoff.` }
      : short(`Your degree is expected ${formatMonth(expectedIndex)}, after the ${cutoffLabel} cutoff.`);
  }
  const yearsLeft = (Date.UTC(year, 7, 1) - ctx.now.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return yearsLeft <= 2
    ? short(`You have not started a bachelor's degree and plan to matriculate in ${year}, less than two years away.`)
    : { outcome: "on-track", yourValue, schoolValue, explanation: `You have not started a bachelor's degree; more than two years remain before ${year} matriculation.` };
}

function semesterHoursCheck(minimum: number, ctx: Context): Verdict {
  const schoolValue = `${minimum} semester hours`;
  const status = ctx.profile.degreeStatus;
  const hours = ctx.profile.semesterHoursCompleted;
  if (status === "completed") {
    return { outcome: "meets", yourValue: "Degree completed", schoolValue, explanation: `You entered a completed bachelor's degree, which covers the ${minimum}-semester-hour minimum.` };
  }
  if (hours === undefined) return { outcome: "missing-profile", schoolValue, explanation: `Add your completed semester hours to compare with the ${minimum}-hour minimum.` };
  const yourValue = `${hours} semester hours`;
  if (hours >= minimum) return { outcome: "meets", yourValue, schoolValue, explanation: `You have completed ${hours} semester hours; the school lists ${minimum}.` };
  return status === "in-progress"
    ? { outcome: "on-track", yourValue, schoolValue, explanation: `You have ${hours} of the ${minimum} semester hours the school lists, and your degree is in progress.` }
    : { outcome: "below-recommended", yourValue, schoolValue, explanation: `You have ${hours} of the ${minimum} semester hours the school lists.` };
}

const COURSE_STATUS_LABELS = { completed: "Completed", "in-progress": "In progress", planned: "Planned", "not-planned": "Not planned" } as const;

function courseworkCheck(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return missingEvidence(requirement, "course requirement");
  if (requirement.strength === "none-stated") return { outcome: "not-applicable", explanation: "No specific course requirement in the captured evidence." };
  if (requirement.strength === "not-required") return { outcome: "not-applicable", explanation: "The captured evidence says this coursework is not required." };
  const category = courseworkCategory(requirement);
  if (!category) return { outcome: "needs-review", explanation: "AXOM could not match this coursework rule to a course category; review the source." };
  const label = categoryLabel(category).toLowerCase();
  const hours = requirement.coursework?.semesterHours;
  const lab = requirement.coursework?.lab ? " with lab" : "";
  const recommended = requirement.strength === "recommended";
  const schoolValue = recommended ? "Recommended" : hours !== undefined ? `${hours} semester hours${lab}` : `Required${lab}`;
  const entry: CourseworkEntry | undefined = ctx.profile.coursework?.[category];
  if (!entry) return { outcome: "missing-profile", schoolValue, explanation: `Add your ${label} coursework status to compare with this rule.` };
  const yourValue = `${COURSE_STATUS_LABELS[entry.status]}${entry.semesterHours !== undefined ? `, ${entry.semesterHours} semester hours` : ""}`;
  if (entry.status === "not-planned") {
    if (recommended) return { outcome: "below-recommended", yourValue, schoolValue, explanation: `The school recommends ${label}; you marked it not planned.` };
    return requirement.strength === "hard"
      ? { outcome: "does-not-meet", blocking: true, yourValue, schoolValue, explanation: `The school lists ${label} as required (${schoolValue}); you marked it not planned.` }
      : { outcome: "needs-review", yourValue, schoolValue, explanation: `The school lists ${label} under a condition AXOM cannot check; you marked it not planned.` };
  }
  if (entry.status !== "completed") {
    return { outcome: "on-track", yourValue, schoolValue,
      explanation: `You marked ${label} as ${COURSE_STATUS_LABELS[entry.status].toLowerCase()}; it needs to be complete before the school's prerequisite deadline.` };
  }
  if (recommended || hours === undefined) {
    return { outcome: "meets", yourValue, schoolValue, explanation: `You completed ${label}; the school lists it as ${recommended ? "recommended" : "required"}.` };
  }
  if (entry.semesterHours === undefined) {
    return { outcome: "missing-profile", yourValue, schoolValue, explanation: `Add your ${label} semester hours to compare with the ${hours} the school lists.` };
  }
  return entry.semesterHours >= hours
    ? { outcome: "meets", yourValue, schoolValue, explanation: `You entered ${entry.semesterHours} semester hours of ${label}; the school lists ${hours}.` }
    : { outcome: "needs-review", yourValue, schoolValue, explanation: `You entered ${entry.semesterHours} semester hours of ${label}; the school lists ${hours}.` };
}

type PolicyKind = "prerequisite-grades" | "online-coursework" | "community-college" | "ap-credit";
const POLICY_FLAGS: Record<PolicyKind, { flag: "passFail" | "online" | "communityCollege" | "apCredit"; noun: string; rule: string }> = {
  "prerequisite-grades": { flag: "passFail", noun: "pass/fail", rule: "pass/fail grading policy" },
  "online-coursework": { flag: "online", noun: "online", rule: "online coursework policy" },
  "community-college": { flag: "communityCollege", noun: "community college", rule: "community college policy" },
  "ap-credit": { flag: "apCredit", noun: "AP/IB credit", rule: "AP/IB credit policy" },
};
const STANCE_LABELS = { accepted: "accepted", "not-accepted": "not accepted", limited: "limited", unknown: "not stated" } as const;

function policyCheck(requirement: StructuredRequirement, ctx: Context, kind: PolicyKind): Verdict {
  const { flag, noun, rule } = POLICY_FLAGS[kind];
  const stance = (kind === "prerequisite-grades" ? requirement.passFail : requirement.acceptance) ?? "unknown";
  const stanceText = `${noun[0].toUpperCase()}${noun.slice(1)} ${STANCE_LABELS[stance] ?? STANCE_LABELS.unknown}`;
  const schoolValue = requirement.minimumGrade ? `Minimum grade ${requirement.minimumGrade}; ${stanceText.toLowerCase()}` : stanceText;
  const flagged = COURSE_CATEGORIES.filter(({ id }) => ctx.profile.coursework?.[id]?.[flag]).map(({ label }) => label.toLowerCase());
  if (!Object.keys(ctx.profile.coursework ?? {}).length) {
    return { outcome: "missing-profile", schoolValue, explanation: `Add your coursework to check this ${rule}.` };
  }
  if (!flagged.length) {
    return { outcome: "not-applicable", schoolValue, explanation: `You have not marked any ${noun} coursework, so this policy does not affect you.` };
  }
  const yourValue = `${noun[0].toUpperCase()}${noun.slice(1)}: ${flagged.join(", ")}`;
  if (requirement.strength === "unknown" || stance === "unknown") {
    return kind === "prerequisite-grades" && requirement.minimumGrade
      ? { outcome: "missing-evidence", yourValue, schoolValue,
        explanation: `The captured text sets a minimum grade of ${requirement.minimumGrade} but does not say whether pass/fail coursework counts; you marked ${flagged.join(", ")}.` }
      : { ...missingEvidence(requirement, rule), yourValue, schoolValue };
  }
  if (stance === "not-accepted") {
    return { outcome: "does-not-meet", yourValue, schoolValue,
      explanation: `The captured policy does not accept ${noun} coursework toward prerequisites; you marked ${flagged.join(", ")}. This is not a hard stop — a course can be retaken or replaced.` };
  }
  if (stance === "limited") {
    return { outcome: "needs-review", yourValue, schoolValue,
      explanation: `The captured policy accepts ${noun} coursework only in limited cases; check whether it covers your ${flagged.join(", ")}.` };
  }
  return { outcome: "meets", yourValue, schoolValue, explanation: `The captured policy accepts ${noun} coursework (you marked ${flagged.join(", ")}).` };
}

function deadlineCheck(requirement: StructuredRequirement, ctx: Context): Verdict {
  if (requirement.strength === "unknown") return unreadable(requirement);
  const deadline = requirement.deadline;
  if (!deadline) return unreadable(requirement);
  if (deadline.rolling) return { outcome: "not-applicable", schoolValue: "Rolling", explanation: "Rolling admissions — earlier submission is usually safer; confirm dates with the school." };
  if (!(deadline.month >= 1 && deadline.month <= 12 && deadline.day >= 1 && deadline.day <= 31)) return unreadable(requirement);
  const year = ctx.year;
  const monthDay = `${MONTHS[deadline.month - 1]} ${deadline.day}`;
  if (!year && deadline.explicitYear === undefined) {
    return { outcome: "missing-profile", schoolValue: monthDay, explanation: "Add your planned matriculation year to place this deadline in your cycle." };
  }
  // Jun–Dec deadlines fall in the calendar year the cycle opens (M−1); Jan–May in M.
  const expectedYear = year ? (deadline.month >= 6 ? year - 1 : year) : undefined;
  const dueYear = deadline.explicitYear ?? expectedYear!;
  const due = `${monthDay}, ${dueYear}`;
  if (expectedYear !== undefined && deadline.explicitYear !== undefined && deadline.explicitYear !== expectedYear) {
    return { outcome: "needs-review", schoolValue: due,
      explanation: `This date (${due}) was published for another cycle; confirm the deadline for your ${year} cycle with the school.` };
  }
  // Deadlines run to the end of the day anywhere in the U.S. (UTC−10).
  const endOfDay = Date.UTC(dueYear, deadline.month - 1, deadline.day, 23 + 10, 59, 59, 999);
  return ctx.now.getTime() > endOfDay
    ? { outcome: "needs-review", schoolValue: due, explanation: `The ${due} deadline appears to have passed for your cycle; confirm with the school.` }
    : { outcome: "not-applicable", schoolValue: due, explanation: `Due ${due} (confirm).` };
}

function verdictFor(requirement: StructuredRequirement, ctx: Context): Verdict {
  switch (requirement.kind) {
    case "gpa-minimum": case "science-gpa-minimum": return numericMinimum(requirement, ctx, requirement.kind);
    case "mcat-minimum": return applyMcatLimits(requirement, ctx, numericMinimum(requirement, ctx, "mcat-minimum"));
    case "mcat-required": return mcatRequired(requirement, ctx);
    case "mcat-recency": return mcatRecency(requirement, ctx);
    case "citizenship": return citizenshipCheck(requirement, ctx);
    case "state-residency": return residencyCheck(requirement, ctx);
    case "degree": return degreeCheck(requirement, ctx);
    case "coursework": return courseworkCheck(requirement, ctx);
    case "prerequisite-grades": case "online-coursework": case "community-college": case "ap-credit":
      return policyCheck(requirement, ctx, requirement.kind);
    case "deadline": return deadlineCheck(requirement, ctx);
    default: return { outcome: "needs-review", explanation: "AXOM does not evaluate this kind of rule yet; review the source." };
  }
}

function toCheck(requirement: StructuredRequirement, ctx: Context): RequirementCheck {
  const evidence = Array.isArray(requirement.evidence) ? requirement.evidence : [];
  const exceptions = Array.isArray(requirement.exceptions) ? requirement.exceptions.filter(Boolean) : [];
  const safe = { ...requirement, evidence, exceptions };
  let verdict: Verdict;
  try {
    verdict = verdictFor(safe, ctx);
  } catch {
    verdict = { outcome: "needs-review", explanation: "AXOM could not evaluate this rule; review the source." };
  }
  // requirement_type is the research team's classification, not the rule's own evidence.
  const primary = evidence.filter(item => !item.factId?.endsWith(".requirement_type"));
  const unverifiedEvidence = primary.length > 0 && primary.every(item => item.captureStatus === "unverified-capture");
  let explanation = verdict.explanation;
  if (exceptions.length) explanation += ` Qualifier to read: ${quoteList(exceptions)}.`;
  if (unverifiedEvidence) explanation += " Read from an unverified capture — confirm on the school's official page.";
  const evidenceYear = requirementEvidenceYear(safe);
  const check: RequirementCheck = {
    requirementId: requirement.id,
    kind: requirement.kind,
    title: requirementTitle(safe),
    outcome: verdict.outcome,
    blocking: verdict.outcome === "does-not-meet" && verdict.blocking === true,
    explanation,
    unverifiedEvidence,
    evidence,
  };
  if (verdict.yourValue !== undefined) check.yourValue = verdict.yourValue;
  if (verdict.schoolValue !== undefined) check.schoolValue = verdict.schoolValue;
  if (ctx.year && evidenceYear !== undefined && evidenceYear < ctx.year) {
    check.cycleNote = `Evidence describes the ${evidenceYear} entering class; confirm this rule for your ${ctx.year} cycle.`;
  }
  return check;
}

function assessCycle(school: ApplicationSchool, requirements: readonly StructuredRequirement[], year: number | undefined): CycleAssessment {
  const facts = [
    ...(school.researchFacts ?? []).map(fact => ({ value: fact.value, capturedAt: fact.capturedAt })),
    ...requirements.flatMap(requirement => (requirement.evidence ?? []).map(item => ({ value: item.rawValue, capturedAt: item.capturedAt }))),
  ];
  const years = facts.map(evidenceCycleForFact).filter((value): value is number => value !== undefined);
  const evidenceYear = years.length ? Math.max(...years) : undefined;
  const base = { ...(year ? { plannedMatriculationYear: year } : {}), ...(evidenceYear !== undefined ? { evidenceYear } : {}) };
  if (!year) return { ...base, status: "unknown", note: "Add your planned matriculation year to compare the evidence with your cycle." };
  if (evidenceYear === undefined) return { ...base, status: "unknown", note: "The captured evidence carries no date AXOM can place in a cycle." };
  if (year > evidenceYear) {
    return { ...base, status: "earlier-cycle", note: `Evidence describes the ${evidenceYear} entering class; confirm requirements for your ${year} cycle.` };
  }
  if (year < evidenceYear) {
    return { ...base, status: "later-cycle", note: `Evidence describes the ${evidenceYear} entering class, later than your ${year} plan; rules for your cycle may have differed.` };
  }
  return { ...base, status: "current", note: `Evidence addresses your cycle (${applicationCycleLabel(year)}).` };
}

const DECIDED: ReadonlySet<CheckOutcome> = new Set(["meets", "on-track", "does-not-meet", "below-recommended", "not-applicable"]);
const safeHeadline = (headline: string, fallback: string) => FORBIDDEN_HEADLINE.test(headline) ? fallback : headline;

function summarize(checks: readonly RequirementCheck[], cycle: CycleAssessment, hasProfile: boolean): EligibilitySummary {
  const blockingChecks = checks.filter(check => check.blocking);
  const counts = {
    blockers: blockingChecks.length,
    // A non-blocking shortfall (e.g. a course taken pass/fail) still needs the learner's attention.
    reviews: checks.filter(check => check.outcome === "needs-review" || (check.outcome === "does-not-meet" && !check.blocking)).length,
    meets: checks.filter(check => check.outcome === "meets").length,
    unknown: checks.filter(check => check.outcome === "missing-profile" || check.outcome === "missing-evidence").length,
    // Deadlines are informational; they never settle a requirement area.
    decided: checks.filter(check => DECIDED.has(check.outcome) && check.kind !== "deadline").length,
    total: checks.length,
  };
  if (!hasProfile) return { status: "not-enough-information", headline: "Add your application profile to run the checks.", ...counts };
  if (!checks.length) return { status: "not-enough-information", headline: "No requirement evidence has been collected for this school yet.", ...counts };
  if (blockingChecks.length) {
    const first = blockingChecks[0];
    const source = first.unverifiedEvidence ? " (from an unverified capture)" : "";
    const more = blockingChecks.length > 1 ? `, plus ${plural(blockingChecks.length - 1, "more possible blocker")}` : "";
    const detail = first.yourValue && first.schoolValue ? `: you entered ${first.yourValue} vs. ${first.schoolValue}` : "";
    return {
      status: "possible-blocker", ...counts,
      headline: safeHeadline(`Possible blocker — ${first.title}${detail}${source}${more}.`, `Possible blocker — ${first.title}${source}${more}.`),
    };
  }
  const earlier = cycle.status === "earlier-cycle";
  if (counts.reviews || earlier) {
    const cycleText = earlier ? `the captured evidence describes the ${cycle.evidenceYear} entering class rather than your ${cycle.plannedMatriculationYear} cycle` : "";
    const firstReview = checks.find(check => check.outcome === "needs-review" || (check.outcome === "does-not-meet" && !check.blocking))?.title;
    if (!counts.reviews && !counts.decided) {
      return { status: "not-enough-information", ...counts,
        headline: safeHeadline(`Not enough information yet, and ${cycleText} — add profile details and confirm requirements with the school.`,
          "Not enough information yet — add profile details and confirm requirements with the school.") };
    }
    const reviewText = counts.reviews === 1 ? `${firstReview} needs` : `${counts.reviews} requirement areas, starting with ${firstReview}, need`;
    const headline = counts.reviews
      ? `${reviewText} a closer look${earlier ? `, and ${cycleText}` : ""} — review before relying on these checks.`
      : `No blockers found, but ${cycleText} — confirm requirements with the school.`;
    return { status: "needs-review", ...counts, headline: safeHeadline(headline, "Some requirement areas need a closer look before you rely on these checks.") };
  }
  if (!counts.decided) {
    return { status: "not-enough-information", ...counts,
      headline: "Not enough information to settle any captured requirement area yet — add profile details or check the sources." };
  }
  return { status: "no-blockers-found", ...counts,
    headline: `No blockers found in ${counts.decided} of ${counts.total} captured requirement areas — confirm with the school.` };
}

/** Evaluate already-derived requirements. Pure; never throws. */
export function evaluateRequirements(
  school: ApplicationSchool,
  requirements: readonly StructuredRequirement[],
  profile: ApplicationProfile | undefined,
  context: CheckContext,
): SchoolCheckResult {
  const hasProfile = !isApplicationProfileEmpty(profile);
  const learner = hasProfile ? profile! : EMPTY_PROFILE;
  const now = context?.now instanceof Date && Number.isFinite(context.now.getTime()) ? context.now : new Date();
  const ctx: Context = {
    profile: { ...learner, coursework: learner.coursework ?? {}, activityHours: learner.activityHours ?? {} },
    now,
    year: learner.plannedMatriculationYear,
    learnerRegion: resolveRegion(learner.stateOfResidence),
    schoolRegion: schoolRegionOf(school.location),
  };
  const rules = (Array.isArray(requirements) ? requirements : []).filter(rule => rule && typeof rule === "object");
  const checks = rules.map(rule => toCheck(rule, ctx));
  const cycle = assessCycle(school, rules, ctx.year);
  const result: SchoolCheckResult = {
    schoolId: school.id,
    checks,
    eligibility: summarize(checks, cycle, hasProfile),
    cycle,
    activities: compareActivities(school, profile),
  };
  const competitiveness = estimateCompetitiveness(school, profile);
  if (competitiveness) result.competitiveness = competitiveness;
  return result;
}

/** deriveRequirements + evaluateRequirements. */
export function checkSchool(
  school: ApplicationSchool,
  profile: ApplicationProfile | undefined,
  context: CheckContext,
): SchoolCheckResult {
  return evaluateRequirements(school, deriveRequirements(school), profile, context);
}

// ---------------------------------------------------------------------------
// Estimates

type Metric = MetricComparison["metric"];
const METRIC_LABELS: Record<Metric, string> = { gpa: "GPA", "science-gpa": "Science GPA", mcat: "MCAT" };
const NEAR_WINDOW: Record<Metric, number> = { gpa: 0.15, "science-gpa": 0.15, mcat: 3 };
const BASIS_LABELS: Record<ReportedStatisticBasis, string> = {
  "official-capture": "official page capture", "unverified-capture": "unverified capture", "third-party": "third-party source",
};
const BAND_TEXT: Record<CompetitivenessBand, string> = { below: "below", near: "near", "at-or-above": "at or above" };
const SHORT_MONTHS = MONTHS.map(month => month.slice(0, 3));

/** GPA: within 0.15 below is "near"; MCAT: within 3 points below is "near". */
export function competitivenessBand(metric: Metric, delta: number): CompetitivenessBand {
  if (delta >= 0) return "at-or-above";
  return delta >= -NEAR_WINDOW[metric] ? "near" : "below";
}

interface Benchmark { value: number; label: string; basis: BenchmarkBasis }

function statBenchmark(stats: readonly ReportedStatistic[], metric: Metric, kind: ReportedStatistic["kind"], basis: ReportedStatisticBasis, minimums: ReadonlySet<number>): Benchmark | undefined {
  const stat = stats.find(entry => entry?.metric === metric && entry.kind === kind && entry.basis === basis && !entry.floorLike
    && typeof entry.number === "number" && Number.isFinite(entry.number) && !minimums.has(entry.number));
  if (!stat) return undefined;
  const word = kind === "competitive" ? "competitive figure" : /median/i.test(stat.value ?? "") ? "median" : "average";
  const captured = parseYearMonth(stat.capturedAt);
  const when = captured ? `, ${SHORT_MONTHS[captured.month - 1]} ${captured.year}` : "";
  return { value: stat.number!, basis, label: `Reported ${word} (${BASIS_LABELS[basis]}${when})` };
}

function estimateBenchmark(score: EstimatedScore | undefined, basis: "estimate" | "peer-estimate", confidence: SchoolEstimates["confidence"], minimums: ReadonlySet<number>): Benchmark | undefined {
  if (!score || score.floorBased || !Number.isFinite(score.value) || minimums.has(score.value)) return undefined;
  if (Boolean(score.peerFallback) !== (basis === "peer-estimate")) return undefined;
  const confidenceText = confidence === "unknown" ? "confidence not stated" : `${confidence} confidence`;
  return { value: score.value, basis, label: `${basis === "estimate" ? "Research estimate" : "Peer-school estimate"} (${confidenceText})` };
}

/**
 * Official class average first, then the research team's own (non-floor,
 * non-peer) estimate, then other reported figures by evidence quality, then
 * peer-school estimates. Floor-based estimates are minimums, never benchmarks.
 */
function pickBenchmark(school: ApplicationSchool, metric: Metric, minimums: ReadonlySet<number>): Benchmark | undefined {
  const stats = Array.isArray(school.reportedStats) ? school.reportedStats : [];
  const estimate = metric === "gpa" ? school.estimates?.competitiveGpa : metric === "mcat" ? school.estimates?.competitiveMcat : undefined;
  const confidence = school.estimates?.confidence ?? "unknown";
  return statBenchmark(stats, metric, "average", "official-capture", minimums)
    ?? estimateBenchmark(estimate, "estimate", confidence, minimums)
    ?? statBenchmark(stats, metric, "average", "unverified-capture", minimums)
    ?? statBenchmark(stats, metric, "competitive", "official-capture", minimums)
    ?? statBenchmark(stats, metric, "competitive", "unverified-capture", minimums)
    ?? statBenchmark(stats, metric, "average", "third-party", minimums)
    ?? statBenchmark(stats, metric, "competitive", "third-party", minimums)
    ?? estimateBenchmark(estimate, "peer-estimate", confidence, minimums);
}

/** Figures the school states as minimums or thresholds; a benchmark equal to one is a floor, not a class statistic. */
function statedMinimums(school: ApplicationSchool, metric: Metric): Set<number> {
  const kind = metric === "gpa" ? "gpa-minimum" : metric === "science-gpa" ? "science-gpa-minimum" : "mcat-minimum";
  const figures = new Set<number>();
  for (const rule of deriveRequirements(school)) {
    if (rule.kind !== kind) continue;
    if (rule.threshold !== undefined) figures.add(rule.threshold);
    for (const variant of rule.variants ?? []) figures.add(variant.threshold);
  }
  return figures;
}

export function estimateCompetitiveness(
  school: ApplicationSchool,
  profile: ApplicationProfile | undefined,
): CompetitivenessEstimate | undefined {
  const hasStats = Array.isArray(school.reportedStats) && school.reportedStats.length > 0;
  if (!school.estimates && !hasStats) return undefined;
  const yoursFor: Record<Metric, number | undefined> = { gpa: profile?.cumulativeGpa, "science-gpa": profile?.scienceGpa, mcat: profile?.mcatTotal };
  const comparisons: MetricComparison[] = [];
  for (const metric of ["gpa", "science-gpa", "mcat"] as const) {
    const benchmark = pickBenchmark(school, metric, statedMinimums(school, metric));
    if (!benchmark) continue;
    const comparison: MetricComparison = { metric, benchmark: benchmark.value, benchmarkLabel: benchmark.label, benchmarkBasis: benchmark.basis };
    const yours = yoursFor[metric];
    if (typeof yours === "number" && Number.isFinite(yours)) {
      // Rounded so 3.45 − 3.60 reads as −0.15 (near), not −0.1500000000000004 (below).
      const delta = metric === "mcat" ? Math.round((yours - benchmark.value) * 10) / 10 : Math.round((yours - benchmark.value) * 100) / 100;
      Object.assign(comparison, { yours, delta, band: competitivenessBand(metric, delta) });
    }
    comparisons.push(comparison);
  }
  const bands = comparisons.map(comparison => comparison.band).filter((band): band is CompetitivenessBand => band !== undefined);
  const band = !bands.length ? undefined : bands.every(entry => entry === bands[0]) ? bands[0] : bands.includes("below") ? "mixed" : "near";
  const format = (metric: Metric, value: number) => metric === "mcat" ? formatScore(value) : formatGpa(value);
  const compared = comparisons.filter(comparison => comparison.band)
    .map(comparison => `${METRIC_LABELS[comparison.metric]} ${format(comparison.metric, comparison.yours!)} vs. ${format(comparison.metric, comparison.benchmark!)} (${BAND_TEXT[comparison.band!]})`);
  const lead = compared.length ? `Compared: ${compared.join("; ")}.`
    : comparisons.length ? "Add your GPA and MCAT to compare with these benchmarks."
      : "No class statistic or competitive estimate is available to compare; floor-based figures are minimums, not benchmarks.";
  const estimate: CompetitivenessEstimate = {
    comparisons,
    confidence: school.estimates?.confidence ?? "unknown",
    explanation: `${lead} ${COMPETITIVENESS_DISCLAIMER}`,
  };
  if (band) estimate.band = band;
  if (school.estimates?.tier) estimate.tier = school.estimates.tier;
  return estimate;
}

export function compareActivities(
  school: ApplicationSchool,
  profile: ApplicationProfile | undefined,
): ActivityComparison[] {
  const hours = school.estimates?.hours;
  if (!hours) return [];
  return ESTIMATE_ACTIVITIES.flatMap(({ id, label }): ActivityComparison[] => {
    const range = hours[id];
    if (!range) return [];
    const comparison: ActivityComparison = { activity: id, label, range };
    const yours = profile?.activityHours?.[id];
    if (typeof yours !== "number" || !Number.isFinite(yours)) return [comparison];
    comparison.yours = yours;
    if (range.min === undefined) return [comparison];
    comparison.position = yours < range.min ? "below-range"
      : range.max !== undefined && !range.openEnded && yours > range.max ? "above-range" : "within-range";
    return [comparison];
  });
}
