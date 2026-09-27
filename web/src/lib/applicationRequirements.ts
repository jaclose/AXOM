import { researchFactRevision, type SchoolResearchFact } from "./applicationResearch.ts";
import type { ApplicationSchool } from "./applicationSchools.ts";
import { resolveRegion, type CitizenshipStatus, type CourseCategory } from "./applicationProfile.ts";

/**
 * Structured requirement rules derived deterministically from captured
 * research text. The raw text always travels with the rule; when the text
 * cannot be read with confidence the rule says so instead of guessing.
 */
export type RequirementKind =
  | "gpa-minimum"
  | "science-gpa-minimum"
  | "mcat-minimum"
  | "mcat-required"
  | "mcat-recency"
  | "citizenship"
  | "state-residency"
  | "degree"
  | "coursework"
  | "prerequisite-grades"
  | "online-coursework"
  | "community-college"
  | "ap-credit"
  | "deadline";

/**
 * hard         — stated minimum / requirement.
 * recommended  — stated as preferred / recommended / competitive.
 * conditional  — depends on residency, program track, screening stage, etc. (see `variants`/`exceptions`).
 * none-stated  — evidence explicitly says there is no minimum / no specific requirement.
 * not-required — evidence explicitly says the item is not required (e.g. "MCAT not required").
 * unknown      — sentinel, missing or unreadable evidence.
 */
export type RequirementStrength = "hard" | "recommended" | "conditional" | "none-stated" | "not-required" | "unknown";

export interface RequirementEvidence {
  factId: string;
  /** researchFactRevision(fact) — changes when the evidence changes. */
  revision: string;
  label: string;
  rawValue: string;
  url: string;
  capturedAt: string;
  captureStatus: SchoolResearchFact["captureStatus"];
}

export type VariantCondition = "in-state" | "out-of-state" | "early-decision" | "screening" | "north-american" | "other";

export interface ThresholdVariant {
  condition: VariantCondition;
  threshold: number;
  /** The fragment of source text this variant was read from. */
  text: string;
}

export interface StructuredRequirement {
  /** Unique within a school: the kind, plus `:${category}` for coursework. */
  id: string;
  kind: RequirementKind;
  strength: RequirementStrength;
  /** Facts this rule was read from (at least one). The first is the primary fact. */
  evidence: RequirementEvidence[];
  /** Plain-language account of how AXOM read the evidence. Shown next to the raw text. */
  interpretation: string;
  /** Unconditional numeric minimum (GPA 0–4, MCAT 472–528). */
  threshold?: number;
  /** Conditional numeric thresholds (residency, early decision, screening stage…). */
  variants?: ThresholdVariant[];
  /** Applies to GPA rules: whether the evidence names cumulative, science or both. */
  gpaScope?: "cumulative" | "science" | "both";
  /** MCAT section floor, e.g. "no section below 124". */
  sectionFloor?: number;
  /** Maximum MCAT attempts considered, when stated. */
  maxAttempts?: number;
  /** "Within N years of matriculation/application". */
  recency?: { years: number; anchor: "matriculation" | "application" | "unspecified" };
  /** Explicit test-date window (yyyy-MM-dd); `matriculationYear` when the text names the entering class. */
  testWindow?: { earliest?: string; latest?: string; matriculationYear?: number };
  /** Latest acceptable test date relative to matriculation (e.g. "September of the year before"). */
  latestTestMonthBeforeMatriculation?: number;
  /** For mcat-required: which applicant groups the text says must submit an MCAT. */
  requiredFor?: CitizenshipStatus[];
  /** For mcat-required: groups the text says are exempt / optional. */
  optionalFor?: CitizenshipStatus[];
  citizenship?: { accepted: CitizenshipStatus[]; excluded: CitizenshipStatus[] };
  residency?: { preferredRegions: string[]; mode: "preference" | "restricted" | "none" };
  coursework?: { category: CourseCategory; semesterHours?: number; lab?: boolean };
  /** For prerequisite-grades: minimum letter grade and pass/fail stance. */
  minimumGrade?: string;
  passFail?: "accepted" | "not-accepted" | "limited" | "unknown";
  /** For online-coursework / community-college / ap-credit. */
  acceptance?: "accepted" | "not-accepted" | "limited" | "unknown";
  degree?: { bachelorsRequired: boolean; minimumSemesterHours?: number; completedBy?: "application" | "matriculation" | "unspecified" };
  /** For deadline: month (1–12) and day parsed from text; year resolved per cycle by the checker. */
  deadline?: { month: number; day: number; rolling: boolean; explicitYear?: number };
  /** Matriculation year the evidence explicitly addresses ("2027 entering class"). */
  cycleYear?: number;
  /** Qualifiers that must be read by a human ("case-by-case", "EDP", "except…"). Empty when none. */
  exceptions: string[];
}

// ---------------------------------------------------------------------------
// Evidence cycle

const CYCLE_PATTERNS: readonly [RegExp, (match: RegExpMatchArray) => number][] = [
  [/\b(20\d\d)\s*[-–—/]\s*(?:20)?(\d\d)\s+(?:application\s+|admissions?\s+)?cycle\b/gi, match => 2000 + Number(match[2])],
  [/\b(20\d\d)\s+(?:application\s+|admissions?\s+)?cycle\b/gi, match => Number(match[1])],
  [/\b(20\d\d)\s+entering\s+class\b/gi, match => Number(match[1])],
  [/\bentering\s+(?:class\s+(?:of\s+)?)?(?:in\s+)?(?:fall\s+)?(20\d\d)\b/gi, match => Number(match[1])],
  [/\b(20\d\d)\s+(?:entry|entrants|start|matriculation|enrollment|intake)\b/gi, match => Number(match[1])],
  [/\bfor\s+(?:the\s+)?(20\d\d)\s+class\b/gi, match => Number(match[1])],
  // "Class of 2030" names the graduating class of a four-year program.
  [/(?<!entering\s+)\bclass\s+of\s+(20\d\d)\b/gi, match => Number(match[1]) - 4],
];

/** Latest matriculation year the text names explicitly, if any. */
function explicitCycle(text: string): number | undefined {
  const years: number[] = [];
  for (const [pattern, read] of CYCLE_PATTERNS) for (const match of text.matchAll(pattern)) years.push(read(match));
  return years.length ? Math.max(...years) : undefined;
}

/**
 * Matriculation year a fact addresses: the latest entering class / cycle the
 * text names explicitly, else inferred from the capture date (captures from
 * May onward describe the cycle that matriculates the following year).
 */
export function inferEvidenceCycle(fact: Pick<SchoolResearchFact, "value" | "capturedAt">): number | undefined {
  const explicit = explicitCycle(typeof fact.value === "string" ? fact.value : "");
  if (explicit !== undefined) return explicit;
  const captured = /^(\d{4})-(\d{2})/.exec(typeof fact.capturedAt === "string" ? fact.capturedAt : "");
  if (!captured) return undefined;
  const year = Number(captured[1]), month = Number(captured[2]);
  if (month < 1 || month > 12) return undefined;
  return month >= 5 ? year + 1 : year;
}

// ---------------------------------------------------------------------------
// Shared reading helpers

const SENTINEL = /^(NOT_PUBLICLY_DISCLOSED|NOT_FOUND_AFTER_OFFICIAL_SEARCH|REQUIRES_MANUAL_VERIFICATION|CONFLICTING_SOURCES|NF)\b\s*/;
const ALL_STATUSES: readonly CitizenshipStatus[] = ["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen", "international"];
const NORTH_AMERICAN: readonly CitizenshipStatus[] = ["us-citizen", "us-permanent-resident", "daca", "undocumented", "canadian-citizen"];
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const COURSE_FIELDS: readonly [string, CourseCategory][] = [
  ["biology_hours", "biology"], ["gen_chem_hours", "generalChemistry"], ["orgo_hours", "organicChemistry"],
  ["biochem_hours", "biochemistry"], ["physics_hours", "physics"], ["math_stats_hours", "mathStatistics"],
  ["english_hours", "english"], ["behavioral_sci_hours", "behavioralScience"],
];
const COURSE_NAMES: Record<CourseCategory, string> = {
  biology: "biology", generalChemistry: "general chemistry", organicChemistry: "organic chemistry", biochemistry: "biochemistry",
  physics: "physics", mathStatistics: "math/statistics", english: "English", behavioralScience: "behavioral science",
};

interface Reading {
  /** The value is (or starts with) a research sentinel meaning "not found". */
  sentinel: boolean;
  /** Text to read; for "NF; …" style values, the remainder after the sentinel. */
  text: string;
  /** A parenthetical note attached to a sentinel, kept as an exception. */
  note?: string;
}

function read(value: string): Reading {
  const raw = value.trim();
  const match = SENTINEL.exec(raw);
  if (!match) return { sentinel: false, text: raw };
  const rest = raw.slice(match[0].length).replace(/^[;:,\s-]+/, "").trim();
  if (!rest) return { sentinel: true, text: "" };
  const note = /^\((.*)\)$/.exec(rest)?.[1];
  return note !== undefined ? { sentinel: true, text: "", note } : { sentinel: false, text: rest };
}

function evidenceOf(fact: SchoolResearchFact): RequirementEvidence {
  return {
    factId: fact.id, revision: researchFactRevision(fact), label: fact.label, rawValue: fact.value,
    url: fact.url, capturedAt: fact.capturedAt, captureStatus: fact.captureStatus,
  };
}

type Draft = Omit<StructuredRequirement, "id" | "kind" | "evidence" | "exceptions" | "interpretation"> & {
  interpretation: string;
  exceptions?: string[];
};

function rule(kind: RequirementKind, facts: readonly SchoolResearchFact[], draft: Draft, id: string = kind): StructuredRequirement {
  // Drop fragments already contained in a longer one ("U.S. institution" inside "regionally accredited U.S. institution").
  const trimmed = [...new Set((draft.exceptions ?? []).map(item => item.trim()).filter(Boolean))];
  const exceptions = trimmed.filter(item => !trimmed.some(other => other !== item && other.toLowerCase().includes(item.toLowerCase())));
  const cycleYear = facts.map(fact => explicitCycle(fact.value)).find((year): year is number => year !== undefined);
  const requirement: StructuredRequirement = { ...draft, id, kind, evidence: facts.map(evidenceOf), exceptions };
  if (cycleYear !== undefined && requirement.cycleYear === undefined) requirement.cycleYear = cycleYear;
  return requirement;
}

const unknownRule = (kind: RequirementKind, facts: readonly SchoolResearchFact[], reading: Reading, id?: string, extra: Partial<Draft> = {}) =>
  rule(kind, facts, {
    strength: "unknown",
    interpretation: reading.sentinel
      ? "The research capture recorded this as not found or not disclosed."
      : "AXOM could not read a rule from this text; review the source.",
    exceptions: reading.note ? [reading.note] : [],
    ...extra,
  }, id);

const parentheticals = (text: string) => [...text.matchAll(/\(([^)]*)\)/g)].map(match => match[1].trim());
const outsideParens = (text: string) => text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
const wordNumber = (value: string) => NUMBER_WORDS[value.toLowerCase()] ?? Number(value);
const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const formatNumber = (value: number, gpa: boolean) => (gpa ? value.toFixed(2) : String(value));

// ---------------------------------------------------------------------------
// Numeric minimums (GPA, science GPA, MCAT)

type NumericKind = "gpa-minimum" | "science-gpa-minimum" | "mcat-minimum";
type Flavor = "plain" | "recommended" | VariantCondition;

const NUMERIC_TOKEN: Record<"gpa" | "mcat", RegExp> = {
  gpa: /(?<![\d.])([1-4]\.\d{1,2})(?![\d.])/g,
  mcat: /(?<![\d.])(4[7-9]\d|5[0-2]\d)(?![\d.])/g,
};

/** Classify the qualifier that travels with one number. Condition words beat plain "min" labels. */
function flavorOf(qualifier: string): { flavor: Flavor; exception?: string } {
  const text = qualifier.toLowerCase();
  if (/non-?residents?|out-of-state|nonresident/.test(text)) return { flavor: "out-of-state" };
  if (/\bresidents?\b|in-state/.test(text)) return { flavor: "in-state" };
  if (/\bedp\b|early decision/.test(text)) return { flavor: "early-decision" };
  if (/north american/.test(text)) return { flavor: "north-american" };
  if (/secondary|screen|invite|interview/.test(text)) return { flavor: "screening" };
  const condition = /for \d+\s*-\s*\d+\s*cr[^),;]*|[^(),;]*track[^(),;]*|applicants? with[^),;]*/i.exec(qualifier);
  if (condition) return { flavor: "other", exception: condition[0].trim() };
  if (/recommend|prefer|competitive|typical|generally/.test(text)) return { flavor: "recommended" };
  return { flavor: "plain" };
}

/** Clause of the row's requirement_type text that mentions the same number, if any. */
function typeClause(typeText: string | undefined, value: number): string | undefined {
  if (!typeText) return undefined;
  return typeText.split(/[;(),+]|\s\/\s/).map(part => part.trim()).find(part =>
    [...part.matchAll(/(\d+(?:\.\d+)?)/g)].some(match => Math.abs(Number(match[1]) - value) < 1e-9));
}

function typeFlavor(typeText: string | undefined, value: number): Flavor | undefined {
  const clause = typeClause(typeText, value)?.toLowerCase();
  if (clause) {
    if (/secondary|screen|invite|interview/.test(clause)) return "screening";
    if (/recommend|prefer/.test(clause)) return "recommended";
    return "plain";
  }
  if (!typeText) return undefined;
  if (/\bhard/i.test(typeText)) return "plain";
  if (/recommend/i.test(typeText)) return "recommended";
  return undefined;
}

const NO_MINIMUM = /^(?:no\b|none\b|not specified\b|no published\b)/i;
const NOT_REQUIRED = /\bnot required\b|\bmcat optional\b|\boptional\b|\bno entrance exam\b|\bnot scored\b/i;

function numericRule(
  kind: NumericKind, fact: SchoolResearchFact, typeFact: SchoolResearchFact | undefined,
): StructuredRequirement {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule(kind, [fact], reading);
  const text = reading.text;
  const metric = kind === "mcat-minimum" ? "mcat" : "gpa";
  const gpa = metric === "gpa";
  const scope: StructuredRequirement["gpaScope"] = kind === "mcat-minimum" ? undefined
    : /(?:cum(?:ulative)?|overall|total)\s*&\s*(?:sci(?:ence)?|bcpm)/i.test(text) ? "both"
      : kind === "science-gpa-minimum" ? "science" : "cumulative";
  const noun = scope === "both" ? "cumulative and science GPA" : kind === "gpa-minimum" ? "cumulative GPA" : kind === "science-gpa-minimum" ? "science GPA" : "MCAT total";
  const scoped = (draft: Draft): Draft => (scope ? { ...draft, gpaScope: scope } : draft);
  const extras: Partial<Draft> = {};
  if (kind === "mcat-minimum") {
    const floor = /no\s+(?:sub)?section(?:\s+score)?\s+below\s+(1[12]\d|13[0-2])\b/i.exec(text);
    if (floor) extras.sectionFloor = Number(floor[1]);
    const attempts = /(?:max(?:imum)?\.?\s*|<=\s*|≤\s*|no more than\s+|up to\s+)(\d+)\s+attempts?/i.exec(text);
    if (attempts) extras.maxAttempts = Number(attempts[1]);
  }
  const tokens = [...text.matchAll(NUMERIC_TOKEN[metric])];
  // Year-like values ("as of 2019") never read as MCAT scores.
  const numbers = tokens.filter(match => !(metric === "mcat" && /^(19|20)\d\d$/.test(text.slice(match.index!, match.index! + 4))));
  if (!numbers.length) {
    if (NOT_REQUIRED.test(text) && kind === "mcat-minimum") {
      return rule(kind, [fact], { strength: "not-required", interpretation: "Read as: the MCAT is not required or not scored, so there is no minimum score." });
    }
    if (NO_MINIMUM.test(text) || /no (?:numeric )?(?:floor|minimum|cutoff)|no fixed cutoff|no rigid minimum/i.test(text)) {
      return rule(kind, [fact], scoped({ strength: "none-stated", interpretation: `Read as: no published ${noun} minimum.`, ...extras }));
    }
    return unknownRule(kind, [fact], reading, undefined, extras);
  }
  if (/scholarship/i.test(text) && !NOT_REQUIRED.test(text)) {
    return rule(kind, [fact], scoped({
      strength: "unknown", exceptions: ["the number is a scholarship threshold, not an admission minimum"], ...extras,
      interpretation: `No ${noun} admission minimum is stated; the number in the text is a scholarship threshold.`,
    }));
  }
  // A leading "None"/"No minimum" governs numbers that follow ("None (avg admitted 3.27)").
  if (NO_MINIMUM.test(text) && numbers[0].index! > 0) {
    return rule(kind, [fact], scoped({
      strength: "none-stated", interpretation: `Read as: no published ${noun} minimum; the number in the text is not a minimum.`, ...extras,
    }));
  }
  if (kind === "mcat-minimum" && /\bnot required\b|\boptional\b/i.test(text)) {
    return rule(kind, [fact], {
      strength: "not-required", exceptions: [outsideParens(text) === text ? "" : parentheticals(text).join("; ")],
      interpretation: "Read as: the MCAT is not required; the number in the text is not an admission minimum.",
    });
  }
  const approximate = /[~≈]\s*$/.test(text.slice(0, numbers[0].index!));
  const exceptions: string[] = [];
  const variants: ThresholdVariant[] = [];
  const figures = numbers.map((match, index) => {
    const value = Number(match[1]);
    const end = index + 1 < numbers.length ? numbers[index + 1].index! : text.length;
    // Everything up to the next figure qualifies this one ("3.3 (out-of-state), BCPM, for secondary invite").
    const segment = text.slice(match.index! + match[0].length, end);
    const flavored = flavorOf(segment);
    if (flavored.exception) exceptions.push(flavored.exception);
    return { value, flavor: flavored.flavor, fragment: text.slice(match.index!, end).replace(/[\s/;,]+$/, "").trim() };
  });
  for (const pattern of [/as of \d{4}/i, /for secondary invite/i, /regular-pool floor not published/i, /may still be considered/i, /generally required/i]) {
    const match = pattern.exec(text);
    if (match) exceptions.push(match[0]);
  }
  if (extras.maxAttempts !== undefined) exceptions.push(`at most ${extras.maxAttempts} attempts`);
  const plausible = (value: number) => (gpa ? value >= 2 && value <= 4 : value >= 472 && value <= 528);
  const usable = figures.filter(figure => plausible(figure.value));
  if (!usable.length) return unknownRule(kind, [fact], reading, undefined, { exceptions: [text] });

  const evidence = [fact];
  const conditional = usable.filter(figure => figure.flavor !== "plain" && figure.flavor !== "recommended");
  if (conditional.length) {
    for (const figure of conditional) {
      variants.push({ condition: figure.flavor as VariantCondition, threshold: figure.value, text: figure.fragment });
    }
    const words: Record<VariantCondition, string> = {
      "in-state": "in-state", "out-of-state": "out-of-state", "early-decision": "Early Decision only", screening: "screening threshold",
      "north-american": "North American applicants", other: exceptions[0] ?? "stated condition",
    };
    const listed = variants.map(variant => `${formatNumber(variant.threshold, gpa)} (${words[variant.condition]})`).join(", ");
    return rule(kind, evidence, scoped({
      strength: "conditional", variants, exceptions, ...extras,
      interpretation: `Read as a conditional ${noun} minimum: ${listed}. Which figure applies depends on the stated condition.`,
    }));
  }
  const figure = usable[0];
  let flavor: Flavor = approximate ? "recommended" : figure.flavor;
  if (approximate) exceptions.unshift(`approximate figure ("${figure.fragment}")`);
  if (flavor === "plain" && typeFact) {
    const fromType = typeFlavor(read(typeFact.value).text, figure.value);
    if (fromType === "screening") {
      evidence.push(typeFact);
      return rule(kind, evidence, scoped({
        strength: "conditional", exceptions, ...extras,
        variants: [{ condition: "screening", threshold: figure.value, text: typeClause(typeFact.value, figure.value) ?? figure.fragment }],
        interpretation: `Read as a ${noun} screening threshold of ${formatNumber(figure.value, gpa)}; the requirement type describes it as a screening stage.`,
      }));
    }
    if (fromType === "recommended") {
      evidence.push(typeFact);
      flavor = "recommended";
    }
  }
  const recommended = flavor === "recommended";
  return rule(kind, evidence, scoped({
    strength: recommended ? "recommended" : "hard", threshold: figure.value, exceptions, ...extras,
    interpretation: recommended
      ? `Read as a recommended ${noun} of ${formatNumber(figure.value, gpa)}, not a hard cutoff.`
      : `Read as a hard minimum ${noun} of ${formatNumber(figure.value, gpa)}.`,
  }));
}

// ---------------------------------------------------------------------------
// MCAT requirement and test dates

const GROUP_TEXT = /(?:mcat\s+(?:is\s+)?(?:required|collected)|required)\s+for\s+([^;)(]+)/i;

function applicantGroups(phrase: string): CitizenshipStatus[] {
  const text = phrase.toLowerCase();
  if (/north american/.test(text)) return [...NORTH_AMERICAN];
  const groups = new Set<CitizenshipStatus>();
  if (/u\.?s\.?|\bus\b|american/.test(text)) groups.add("us-citizen");
  if (/permanent resident|\/pr\b|\bpr\b|green card|u\.?s\.?[- ]based|u\.?s\.? applicants/.test(text)) groups.add("us-permanent-resident");
  if (/u\.?s\.?[- ]based|u\.?s\.? applicants/.test(text)) groups.add("us-citizen");
  if (/canad/.test(text)) groups.add("canadian-citizen");
  if (/daca/.test(text)) groups.add("daca");
  return [...groups];
}

function mcatRequiredRule(facts: readonly SchoolResearchFact[]): StructuredRequirement | undefined {
  const used: SchoolResearchFact[] = [];
  const requiredFor = new Set<CitizenshipStatus>();
  const optionalFor = new Set<CitizenshipStatus>();
  const exceptions: string[] = [];
  let requiredAll = false, notRequiredAll = false;
  for (const fact of facts) {
    const reading = read(fact.value);
    if (reading.sentinel || !reading.text) continue;
    const text = reading.text;
    const lower = text.toLowerCase();
    const mentionsMcat = /mcat|entrance exam/.test(lower) || fact.id.endsWith(".mcat_min");
    if (!mentionsMcat) continue;
    let contributed = false;
    const group = GROUP_TEXT.exec(text);
    if (group && /mcat/i.test(text.slice(0, group.index! + group[0].length))) {
      for (const status of applicantGroups(group[1])) requiredFor.add(status);
      contributed = true;
    }
    if (/north american applicants:[^;]*mcat/i.test(text)) { for (const status of NORTH_AMERICAN) requiredFor.add(status); contributed = true; }
    if (/(?:outside north america|non-north-american)[^;]*(?:not required|exempt)|non-north-american exempt/i.test(text)
      || /international applicants?[^;]*not required to submit mcat/i.test(text)) {
      optionalFor.add("international");
      contributed = true;
    }
    if (/canadian\/intl may submit|canadian or international applicants? may submit/i.test(text)) {
      optionalFor.add("canadian-citizen"); optionalFor.add("international");
      exceptions.push("Canadian and international applicants may submit other admission tests");
      contributed = true;
    }
    if (/collected[^;]*not (?:scored|considered)|collected, not considered/i.test(text)) {
      exceptions.push("MCAT collected but not scored in the admission decision");
      contributed = true;
    }
    if (/may be waived/i.test(text)) { exceptions.push(text); requiredAll = true; contributed = true; }
    if (/\bmcat required(?!\s+for)|competitive score required/i.test(text)) { requiredAll = true; contributed = true; }
    if (/\bmcat (?:is )?not required\b|\bmcat optional\b|^n\/a \(mcat optional\)|^not required \(no entrance exam\)|no entrance exam|\bmcat optional\b/i.test(text)
      || (fact.id.endsWith(".mcat_min") && /^(?:mcat )?not required\b/i.test(text))) {
      if (!group) notRequiredAll = true;
      contributed = true;
    }
    if (contributed) used.push(fact);
  }
  if (!used.length) return undefined;
  const groups = [...requiredFor].filter(status => !optionalFor.has(status));
  if (groups.length || optionalFor.size || requiredAll) {
    const who = groups.length ? `for ${groupLabel(groups)}` : "for all applicants";
    const exempt = optionalFor.size ? `; optional or not required for ${groupLabel([...optionalFor])}` : "";
    return rule("mcat-required", used, {
      strength: "hard", exceptions,
      ...(groups.length ? { requiredFor: groups } : {}), ...(optionalFor.size ? { optionalFor: [...optionalFor] } : {}),
      interpretation: `Read as: the MCAT is required ${who}${exempt}.`,
    });
  }
  if (notRequiredAll) {
    return rule("mcat-required", used, { strength: "not-required", exceptions, interpretation: "Read as: the MCAT is not required for admission." });
  }
  return undefined;
}

function groupLabel(groups: readonly CitizenshipStatus[]): string {
  if (NORTH_AMERICAN.every(status => groups.includes(status)) && groups.length === NORTH_AMERICAN.length) return "North American applicants";
  const names: Record<CitizenshipStatus, string> = {
    "us-citizen": "U.S. citizens", "us-permanent-resident": "U.S. permanent residents", daca: "DACA recipients",
    undocumented: "undocumented applicants", "canadian-citizen": "Canadian citizens", international: "international applicants",
  };
  return groups.map(status => names[status]).join(", ");
}

const DATE = `(?:${MONTH}\\s+(?:(\\d{1,2}),?\\s+)?)?(20\\d\\d)`;

function dateBound(month: string | undefined, day: string | undefined, year: string, edge: "start" | "end"): string {
  const y = Number(year);
  if (!month) return edge === "start" ? `${y}-01-01` : `${y}-12-31`;
  const m = monthNumber(month);
  const d = day ? Math.min(Number(day), lastDay(y, m)) : edge === "start" ? 1 : lastDay(y, m);
  return `${y}-${pad(m)}-${pad(d)}`;
}

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseTestWindow(text: string): { earliest?: string; latest?: string } {
  const window: { earliest?: string; latest?: string } = {};
  const range = new RegExp(`(?:between\\s+)?${DATE}\\s*(?:-|–|through|to|and)\\s*${DATE}`, "i").exec(text);
  if (range && !/applications? by\s*$/i.test(text.slice(0, range.index))) {
    window.earliest = dateBound(range[1], range[2], range[3], "start");
    window.latest = dateBound(range[4], range[5], range[6], "end");
  }
  const earliest = new RegExp(`(?:no earlier than|after|earliest\\s+(?:date\\s+)?(?:of\\s+)?)\\s+(?:calendar\\s+year\\s+)?${DATE}`, "i").exec(text)
    ?? new RegExp(`${DATE}\\s+earliest`, "i").exec(text);
  if (earliest && !window.earliest) window.earliest = dateBound(earliest[1], earliest[2], earliest[3], "start");
  const priorTo = /(?:scores?\s+)?prior to (20\d\d) not acceptable/i.exec(text);
  if (priorTo && !window.earliest) window.earliest = `${priorTo[1]}-01-01`;
  const latest = new RegExp(`(no later than|before)\\s+${DATE}`, "i").exec(text);
  if (latest && !window.latest) {
    // "before Aug 22, 2026" excludes that day; "no later than Sep 12 2026" includes it.
    window.latest = /^before$/i.test(latest[1]) && latest[3]
      ? dayBefore(dateBound(latest[2], latest[3], latest[4], "start"))
      : dateBound(latest[2], latest[3], latest[4], "end");
  }
  const latestWord = new RegExp(`${DATE}\\s+latest`, "i").exec(text);
  if (latestWord && !window.latest) window.latest = dateBound(latestWord[1], latestWord[2], latestWord[3], "end");
  return window;
}

function recencyRule(fact: SchoolResearchFact): StructuredRequirement | undefined {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule("mcat-recency", [fact], reading);
  const text = reading.text;
  if (/^n\/a\b.*optional|mcat optional|not required/i.test(text)) {
    return rule("mcat-recency", [fact], { strength: "not-required", interpretation: "Read as: the MCAT is optional, so no test-date window applies." });
  }
  const exceptions: string[] = [];
  const draft: Partial<Draft> = {};
  // "Within N years": skip phrases about prerequisites and approximate "(~3 yr)" notes.
  let skippedPrereq = false;
  const recencyPattern = /(?<![~≈]\s?)\b(?:within|no more than|no older than|past|last)\s+(?:the\s+)?(?:past\s+|last\s+)?(\d+|one|two|three|four|five|six)\s*(?:-\s*)?(?:calendar\s+)?(?:years?|yrs?)\b|(?<![~≈]\s?)\b(\d)-yr\b/gi;
  for (const match of text.matchAll(recencyPattern)) {
    const before = text.slice(0, match.index!);
    const clauseStart = Math.max(before.lastIndexOf(";"), before.lastIndexOf("("));
    const clause = before.slice(clauseStart + 1);
    if (/prereq/i.test(clause) && !/mcat/i.test(clause)) { skippedPrereq = true; continue; }
    const years = wordNumber(match[1] ?? match[2]);
    if (!(years >= 1 && years <= 6)) continue;
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 60).toLowerCase();
    const anchor = /^[^;]*?(matriculat|enrollment|entering|admission)/.test(after) ? "matriculation"
      : /^[^;]*?(application|preceding june)/.test(after) ? "application" : "unspecified";
    draft.recency = { years, anchor };
    break;
  }
  const window = parseTestWindow(text);
  if (window.earliest || window.latest) {
    const matriculationYear = explicitCycle(text);
    draft.testWindow = { ...window, ...(matriculationYear !== undefined ? { matriculationYear } : {}) };
    if (/released/i.test(text)) exceptions.push("dates refer to score release, not the test day");
  }
  const monthBefore = new RegExp(`(?:no later than|by)\\s+${MONTH}(?:\\s+\\d{1,2})?\\s+of the (?:calendar\\s+)?year (?:preceding|prior|before)`, "i").exec(text)
    ?? new RegExp(`${MONTH}\\s+of the year prior to (?:admission|matriculation)\\s+is the latest`, "i").exec(text);
  if (monthBefore) draft.latestTestMonthBeforeMatriculation = monthNumber(monthBefore[1]);
  const priorToJanuary = /prior to january of the entering year/i.exec(text);
  if (priorToJanuary) draft.latestTestMonthBeforeMatriculation = 12;
  const bareLatest = new RegExp(`no later than\\s+${MONTH}\\s+(\\d{1,2})(?!,?\\s*20\\d\\d)(?!\\s+of)`, "i").exec(text);
  if (bareLatest && draft.latestTestMonthBeforeMatriculation === undefined && !draft.testWindow?.latest) {
    draft.latestTestMonthBeforeMatriculation = monthNumber(bareLatest[1]);
    exceptions.push("year not stated; read as the year before matriculation");
  }
  if (/january of the admission year/i.test(text)) exceptions.push("MCAT no later than January of the admission year");
  const percentile = /no\s+subsection\s+below\s+(\d+)(?:st|nd|rd|th)\s+percentile/i.exec(text);
  if (percentile) exceptions.push(percentile[0]);
  if (/north american/i.test(text)) exceptions.push("applies to North American applicants");
  if (/accelerated/i.test(text)) exceptions.push("stated for the accelerated track");
  if (/preview/i.test(text)) exceptions.push("AAMC PREview also required");
  const pending = /pending fetch|not stated/i.test(text);
  if (!draft.recency && !draft.testWindow && draft.latestTestMonthBeforeMatriculation === undefined) {
    // Text about the MCAT that names no date rule ("MCAT may be waived…") is not a recency rule.
    if (skippedPrereq || !/\b(?:years?|yrs?|months?|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|20\d\d|older|recent)\w*/i.test(text)) return undefined;
    return unknownRule("mcat-recency", [fact], reading, undefined, { exceptions });
  }
  const soft = /advised|should be|recommended/i.test(text) && !/must/i.test(text);
  const conditional = pending || /accelerated/i.test(text);
  if (pending) exceptions.push("rule taken from another page pending fetch");
  const parts: string[] = [];
  if (draft.recency) {
    const anchor = draft.recency.anchor === "unspecified" ? "the test's use" : draft.recency.anchor;
    parts.push(`within ${draft.recency.years} year${draft.recency.years === 1 ? "" : "s"} of ${anchor}`);
  }
  if (draft.testWindow) {
    const range = [draft.testWindow.earliest && `from ${draft.testWindow.earliest}`, draft.testWindow.latest && `through ${draft.testWindow.latest}`].filter(Boolean).join(" ");
    parts.push(`a test-date window ${range}${draft.testWindow.matriculationYear ? ` for ${draft.testWindow.matriculationYear} entry` : ""}`);
  }
  if (draft.latestTestMonthBeforeMatriculation !== undefined) {
    parts.push(`no later than ${MONTHS[draft.latestTestMonthBeforeMatriculation - 1].replace(/^./, letter => letter.toUpperCase())} of the year before matriculation`);
  }
  return rule("mcat-recency", [fact], {
    ...draft,
    strength: conditional ? "conditional" : soft ? "recommended" : "hard",
    exceptions,
    interpretation: `Read as: MCAT ${parts.join("; ")}${soft ? " (advised, not a cutoff)" : ""}.`,
  });
}

// ---------------------------------------------------------------------------
// Citizenship and residency

const CITIZENSHIP_WORDS = /citizen|permanent resident|green card|daca|international|visa|undocumented|citizenship|\bworldwide\b/i;

function citizenshipRule(facts: readonly SchoolResearchFact[]): StructuredRequirement | undefined {
  const used: SchoolResearchFact[] = [];
  const sentinels: SchoolResearchFact[] = [];
  const accepted = new Set<CitizenshipStatus>();
  let exclusive = false, noRestriction = false, conditional = false, unreadable = false;
  const exceptions: string[] = [];
  for (const fact of facts) {
    const reading = read(fact.value);
    if (reading.sentinel) { sentinels.push(fact); continue; }
    // Clauses about the MCAT ("International applicants not required to submit MCAT") say nothing about admission.
    const text = reading.text.split(";").filter(clause => !/mcat/i.test(clause)).join(";").trim();
    const lower = text.toLowerCase();
    if (!text || !CITIZENSHIP_WORDS.test(text)) continue;
    used.push(fact);
    const before = accepted.size;
    if (/no (?:stated )?citizenship restriction/.test(lower)) {
      if (/verify|searched pages/.test(lower)) { exceptions.push(text); noRestriction = true; }
      else for (const status of ALL_STATUSES) accepted.add(status);
      if (/educated outside|required courses/.test(lower)) exceptions.push(text);
    }
    if (/(?<!not )open to (?:international|graduates of any)|visa-eligible international|international (?:applicants |students )?(?:are )?(?:eligible|accepted)|^international\b|international applicants(?:;|$)|^nf;? international/.test(lower)) {
      for (const status of ALL_STATUSES) accepted.add(status);
      if (/visa-eligible/.test(lower)) exceptions.push("international applicants must be visa-eligible");
      if (/u\.s\.-equivalent degree|wes|ece|financial documentation|toefl|ielts|english/.test(lower)) {
        const note = /\(([^)]*)\)/.exec(text)?.[1] ?? text;
        exceptions.push(note);
      }
    }
    if (/u\.?s\.?\s*(?:\/\s*canada\s+)?citizens?|\bus citizens?|current u\.s\. citizen|u\.s\. citizen or/.test(lower)) accepted.add("us-citizen");
    if (/permanent resident|green card/.test(lower)) accepted.add("us-permanent-resident");
    if (/u\.s\.\/canada citizens/.test(lower)) accepted.add("canadian-citizen");
    if (/daca/.test(lower) && !/no daca|not daca|excluding daca/.test(lower)) {
      accepted.add("daca");
      if (/may apply/.test(lower)) exceptions.push("DACA may apply — see the school's DACA policy");
    }
    if (/undocumented/.test(lower)) {
      accepted.add("undocumented");
      const note = /undocumented\s*\(([^)]*)\)/i.exec(text)?.[1];
      if (note) exceptions.push(`undocumented applicants: ${note}`);
    }
    if (/\bonly\b|required\b|does not admit international|not open to international/.test(lower) && /citizen|permanent resident/.test(lower)) exclusive = true;
    if (/does not admit international|not open to international/.test(lower)) exclusive = true;
    if (/must obtain permanent residency/.test(lower)) {
      conditional = true;
      accepted.add("us-citizen"); accepted.add("us-permanent-resident");
      exceptions.push("accepted students must obtain U.S. permanent residency before matriculation");
    }
    if (/must complete (?:>=\s*)?\d*\s*(?:credit hours )?(?:incl\. )?prereqs? at us\/canada|prereqs at us\/canada/.test(lower)) {
      exceptions.push("international applicants must complete prerequisites at U.S./Canadian institutions");
    }
    if (/non-pr international not addressed/.test(lower)) exceptions.push("non-permanent-resident international applicants not addressed");
    if (/addressed on separate|not fetched/.test(lower)) { unreadable = true; exceptions.push(text); }
    if (accepted.size === before && !noRestriction && !unreadable && !exclusive && !conditional) unreadable = true;
  }
  if (!used.length && !sentinels.length) return undefined;
  if (!used.length) return unknownRule("citizenship", sentinels, { sentinel: true, text: "" });
  const evidence = [...used, ...sentinels];
  if (!accepted.size) {
    if (noRestriction) {
      return rule("citizenship", evidence, { strength: "none-stated", exceptions, interpretation: "Read as: no citizenship restriction was found on the searched pages (verify)." });
    }
    return rule("citizenship", evidence, { strength: "unknown", exceptions, interpretation: "AXOM could not read which applicant groups this policy accepts; review the source." });
  }
  const acceptedList = ALL_STATUSES.filter(status => accepted.has(status));
  const excluded = exclusive ? ALL_STATUSES.filter(status => !accepted.has(status) && status !== "daca") : [];
  if (exclusive && !accepted.has("daca") && !/daca/i.test(evidence.map(fact => fact.value).join(" "))) {
    exceptions.push("DACA recipients are not mentioned; check the school's policy");
  }
  return rule("citizenship", evidence, {
    strength: conditional ? "conditional" : "hard", exceptions,
    citizenship: { accepted: acceptedList, excluded },
    interpretation: `Read as: accepts ${groupLabel(acceptedList)}${excluded.length ? `; does not accept ${groupLabel(excluded)}` : ""}.`,
  });
}

/** Resolve a captured phrase, dropping leading words ("Strong California" → California). */
function regionTail(phrase: string) {
  const words = phrase.trim().split(/\s+/);
  for (let start = 0; start < words.length; start++) {
    const region = resolveRegion(words.slice(start).join(" "));
    if (region) return region;
  }
  return undefined;
}

function regionsIn(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /preference for (?:legal )?residents of ([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*)/g,
    /preference for (?:legal )?([A-Z][\w. ]*?) residents/g,
    /([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*)[- ]resident preference/g,
    /([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*) residents (?:favored|given preference)/g,
    /must be ([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*) residents/g,
    /are ([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*) residents/g,
    /limited to residents of ([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const region = regionTail(match[1]);
      if (region) found.add(region.name);
    }
  }
  return [...found];
}

function residencyRule(stateFact: SchoolResearchFact | undefined, citizenshipFact: SchoolResearchFact | undefined): StructuredRequirement | undefined {
  const facts: SchoolResearchFact[] = [];
  const regions = new Set<string>();
  const exceptions: string[] = [];
  let mode: "preference" | "restricted" | "none" | undefined;
  let unknownReading: Reading | undefined;
  const citizenshipText = citizenshipFact ? read(citizenshipFact.value).text : "";
  const citizenshipRegions = citizenshipText ? regionsIn(citizenshipText) : [];
  if (stateFact) {
    const reading = read(stateFact.value);
    facts.push(stateFact);
    const text = reading.text;
    if (reading.sentinel) unknownReading = reading;
    else if (/no state residency preference|no residency requirement|open to all states|no [\w/ ]*quotas|^n\/a \(international\)|^international\b|^private\b|^[a-z]+ private\b/i.test(text)) {
      mode = "none";
      if (/mission|favors|funding|wiche|\(/i.test(text) && !/no residency requirement|no state residency preference/i.test(text)) exceptions.push(text);
    } else {
      for (const region of regionsIn(text)) regions.add(region);
      if (/(\d+)% of (?:the )?class must be/i.test(text)) exceptions.push(text);
      if (/ties/i.test(text)) exceptions.push(/(?:non-residents|out-of-state)[^;]*ties[^;]*/i.exec(text)?.[0] ?? text);
      if (/edp limited/i.test(text)) exceptions.push("residency limit stated for Early Decision (EDP) only");
      if (/~?\d+% enrolled are ([A-Z]{2}|[A-Z][a-z]+) residents/.test(text)) {
        const region = resolveRegion(/are ([A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)*) residents/.exec(text)?.[1]);
        if (region) { regions.add(region.name); exceptions.push("inferred from class composition, not a stated policy"); }
      }
      if (regions.size) mode = "preference";
      else unknownReading = { sentinel: false, text };
    }
  }
  if (citizenshipRegions.length) {
    facts.push(citizenshipFact!);
    for (const region of citizenshipRegions) regions.add(region);
    if (/ties|case-by-case/i.test(citizenshipText)) exceptions.push(/(?:non-residents|out-of-state)[^;]*/i.exec(citizenshipText)?.[0] ?? citizenshipText);
    if (/\d+% of (?:the )?class must be/i.test(citizenshipText)) exceptions.push(citizenshipText.replace(/^NF;\s*/i, ""));
    mode = "preference";
  }
  if (!facts.length) return undefined;
  if (mode === "preference") {
    const preferred = [...regions];
    return rule("state-residency", facts, {
      strength: "hard", residency: { preferredRegions: preferred, mode: "preference" }, exceptions,
      interpretation: `Read as: a preference for residents of ${preferred.join(", ")}; out-of-state applicants are not excluded.`,
    });
  }
  if (mode === "none") {
    return rule("state-residency", facts, {
      strength: "none-stated", residency: { preferredRegions: [], mode: "none" }, exceptions,
      interpretation: "Read as: no state residency preference.",
    });
  }
  return unknownRule("state-residency", facts, unknownReading ?? { sentinel: true, text: "" }, undefined,
    unknownReading && !unknownReading.sentinel ? { exceptions: [unknownReading.text] } : {});
}

// ---------------------------------------------------------------------------
// Degree and coursework

const HOURS = /(?:>=\s*|≥\s*|min(?:imum)?\s+)?(\d{2,3})\s*(?:undergrad(?:uate)?\s+)?(?:sem(?:ester)?\.?\s*)?(?:credit\s+hours|hrs|hours|units|credits?|cr)\b/i;

function degreeRule(fact: SchoolResearchFact): StructuredRequirement {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule("degree", [fact], reading);
  const text = reading.text;
  const lower = text.toLowerCase();
  const exceptions: string[] = [];
  const hours = HOURS.exec(text);
  const minimumSemesterHours = hours ? Number(hours[1]) : undefined;
  const mentionsDegree = /bachelor|baccalaureate|ba\/bs|\bbsc\b|undergraduate degree|degree (?:by|completed)/.test(lower);
  const either = /bachelor'?s?(?: degree)? or (?:>=|≥|minimum|min)?\s*\d|bachelor'?s? or minimum/.test(lower);
  const preferred = /(?:bachelor|baccalaureate|bsc)[^;]*(?:preferred|strongly recommended)|(?:preferred|strongly recommended)[^;]*(?:bachelor|baccalaureate|bsc)/.test(lower);
  const byApplication = /at application/.test(lower) && !/before matriculation|by matriculation/.test(lower);
  const completedBy = /matriculat|before (?:orientation|start)|by july 1/.test(lower) ? "matriculation" : byApplication ? "application" : "unspecified";
  for (const pattern of [/regionally accredited[^;,)]*/i, /\bu\.?s\.?(?:\/canad\w*| or canadian)?[^;,)]*(?:institution|college|university|accreditor)[^;,)]*/i,
    /online-only degrees not accepted/i, /non-us requires [^;,)]*/i, /\(north american applicants\)/i, /75% of credits may allow consideration/i,
    /3 academic years[^;]*/i, /pharmd/i]) {
    const match = pattern.exec(text);
    if (match) exceptions.push(match[0].replace(/[()]/g, "").trim());
  }
  if (!mentionsDegree && minimumSemesterHours === undefined) return unknownRule("degree", [fact], reading, undefined, { exceptions: [text] });
  if (!mentionsDegree || either || preferred) {
    if (minimumSemesterHours !== undefined) {
      return rule("degree", [fact], {
        strength: "hard", exceptions,
        degree: { bachelorsRequired: false, minimumSemesterHours, completedBy },
        interpretation: `Read as: at least ${minimumSemesterHours} semester hours${either ? " (or a bachelor's degree)" : ""}; a bachelor's degree is ${preferred ? "preferred" : "not strictly required"}.`,
      });
    }
    if (preferred) {
      return rule("degree", [fact], {
        strength: "recommended", exceptions, degree: { bachelorsRequired: false, completedBy },
        interpretation: "Read as: a bachelor's degree is preferred, not required.",
      });
    }
  }
  return rule("degree", [fact], {
    strength: "hard", exceptions,
    degree: { bachelorsRequired: true, ...(minimumSemesterHours !== undefined ? { minimumSemesterHours } : {}), completedBy },
    interpretation: `Read as: a bachelor's degree is required${completedBy === "matriculation" ? " before matriculation" : completedBy === "application" ? " by application" : ""}${minimumSemesterHours !== undefined ? `, with at least ${minimumSemesterHours} semester hours` : ""}.`,
  });
}

function courseworkRule(fact: SchoolResearchFact, category: CourseCategory): StructuredRequirement {
  const id = `coursework:${category}`;
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule("coursework", [fact], reading, id, { coursework: { category } });
  const text = reading.text;
  const lower = text.toLowerCase();
  const name = COURSE_NAMES[category];
  const exceptions: string[] = [];
  const lab = /w\/\s?labs?|with labs?|labs? required|\+\s*\d+\s*sem lab|sem coursework \+ \d+ sem lab|\d+ sem w\/ labs?/.test(lower)
    && !/lab (?:not required|recommended)|where avail/.test(lower);
  if (/where avail/.test(lower)) exceptions.push("lab where available");
  if (/typical do/.test(lower)) exceptions.push("described as the typical DO requirement rather than quoted from the school");
  for (const pattern of [/\bor\b[^;)]*/i, /may (?:replace|include)[^;)]*/i, /incl[^;)]*/i, /part of [^;)]*/i, /beyond [^;)]*/i, /upper-division[^;)]*/i,
    /writing-intensive/i, /e\.g\.[^;)]*/i, /required beginning [^;)]*/i]) {
    const match = pattern.exec(text);
    if (match) exceptions.push(match[0].trim());
  }
  const base = { coursework: { category } };
  const done = (draft: Draft) => rule("coursework", [fact], { ...draft, exceptions: [...exceptions, ...(draft.exceptions ?? [])] }, id);
  if (/^(?:no specific requirement|n\/a)|^not separately required|^\(may replace/i.test(text)) {
    return done({ ...base, strength: "none-stated", interpretation: `Read as: no specific ${name} requirement.` });
  }
  if (/^not required/i.test(text)) return done({ ...base, strength: "not-required", interpretation: `Read as: ${name} is not required.` });
  if (/^per (?:undergrad )?institution|^recommended\/required|^math\/statistics$|^incl\. in /i.test(text)) {
    return done({ ...base, strength: "unknown", exceptions: [text], interpretation: `AXOM could not read a specific ${name} rule from this text; review the source.` });
  }
  if (/required beginning/i.test(text)) {
    return done({ ...base, strength: "conditional", interpretation: `Read as: ${name} is recommended now and required for a later cycle.` });
  }
  // "Recommended…" as the course rule itself (a lab-only "recommended" note does not count).
  const courseText = lower.replace(/lab recommended, not required/, "");
  if (/recommended|valued/.test(courseText) && !/\brequired\b/.test(courseText)) {
    return done({ ...base, strength: "recommended", interpretation: `Read as: ${name} is recommended, not required.` });
  }
  const semesterHours = courseHours(text, lab);
  if (semesterHours) {
    return done({
      ...base, strength: "hard", coursework: { category, semesterHours: semesterHours.hours, ...(lab ? { lab } : {}) },
      interpretation: `Read as: ${name} required, ${semesterHours.note}${lab ? " with lab" : ""}.`,
    });
  }
  if (/required|prereq|^included in|^part of|typical do/i.test(text)) {
    return done({ ...base, strength: "hard", coursework: { category, ...(lab ? { lab } : {}) }, interpretation: `Read as: ${name} required (hours not stated).` });
  }
  return done({ ...base, strength: "unknown", exceptions: [text], interpretation: `AXOM could not read a specific ${name} rule from this text; review the source.` });
}

/** Semester hours from coursework text. Semester/course/year counts are converted and the conversion is stated. */
function courseHours(text: string, lab: boolean): { hours: number; note: string } | undefined {
  const lower = text.toLowerCase();
  const explicit = /\((\d+)(?:\s*-\s*\d+)?\s*sem(?:ester)?\s*(?:hrs|hours|units)\)/.exec(lower);
  if (explicit) return { hours: Number(explicit[1]), note: `${explicit[1]} semester hours` };
  const hoursFirst = /^(?:[a-z]+\s+)?(\d{1,2})(?:\s*(?:sem(?:ester)?\s*(?:hrs|hours|units|credits)|semester hours|sem\s*\/\s*\d+\s*qtr credits)|\s*(?:\(|$)|\s+(?:behavioral|biostat|[a-z/]+\s+sem hrs))/.exec(lower);
  if (hoursFirst && !/^\d+\s*(?:sem\b(?!\s*(?:hrs|hours|units|credits|\/\s*\d+\s*qtr credits))|courses?|yr|year)/.test(lower)) {
    const hours = Number(hoursFirst[1]);
    if (hours >= 2 && hours <= 16) return { hours, note: `${hours} semester hours` };
  }
  const humanities = /humanities (\d+) sem hrs/.exec(lower);
  if (humanities) return { hours: Number(humanities[1]), note: `${humanities[1]} semester hours (listed as humanities)` };
  const year = /^(\d)\s*(?:yr|year)s?\b/.exec(lower) ?? /^1 yr/.exec(lower);
  if (year) {
    const count = Number(year[1] ?? 1);
    const per = lab ? 4 : 3;
    return { hours: count * 2 * per, note: `${count === 1 ? "one year" : `${count} years`} read as about ${count * 2 * per} semester hours` };
  }
  const semesters = /^(\d)\s*sem\b(?!\s*(?:hrs|hours|units|credits|\/\s*\d+\s*qtr credits))/.exec(lower);
  if (semesters) {
    const count = Number(semesters[1]);
    const per = lab ? 4 : 3;
    return { hours: count * per, note: `${count} semester${count === 1 ? "" : "s"} read as about ${count * per} semester hours` };
  }
  const courses = /^(\d)\s+(?:[\w-]+\s+)?courses?\b/.exec(lower);
  if (courses) {
    const count = Number(courses[1]);
    return { hours: count * 3, note: `${count} course${count === 1 ? "" : "s"} read as about ${count * 3} semester hours` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Grade, online, community college and AP policies

function gradeRule(fact: SchoolResearchFact): StructuredRequirement {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule("prerequisite-grades", [fact], reading, undefined, { passFail: "unknown" });
  const text = reading.text;
  const lower = text.toLowerCase();
  const grade = /(?:grade of |minimum grade of |no grade lower than |no lower than |letter grade )?\b([A-D][+-]?)(?:\s*\(\d\.\d{2}\))?\s+or\s+(?:better|higher|above)|no grade lower than ([A-D][+-]?)\b|graded no lower than ([A-D][+-]?)\b/.exec(text);
  const minimumGrade = grade ? (grade[1] ?? grade[2] ?? grade[3]) : undefined;
  const passFail: StructuredRequirement["passFail"] = /pass\/no pass accepted|pass\/fail accepted(?![^;]*only)/.test(lower) && !/only/.test(lower) ? "accepted"
    : /only|except|unless|covid|spring 2020|preferred|should be letter/.test(lower) && /pass|p\/s|p\/f|letter/.test(lower) ? "limited"
      : /pass\/fail not accepted|letter grades? required(?![^;]*acceptable)/.test(lower) ? "not-accepted" : "unknown";
  if (!minimumGrade && passFail === "unknown") return unknownRule("prerequisite-grades", [fact], reading, undefined, { passFail: "unknown", exceptions: [text] });
  const exceptions = passFail === "limited" ? [text] : [];
  const stance = { accepted: "pass/fail accepted", "not-accepted": "pass/fail not accepted", limited: "pass/fail accepted only in limited cases", unknown: "pass/fail stance not stated" }[passFail];
  return rule("prerequisite-grades", [fact], {
    strength: "hard", passFail, exceptions, ...(minimumGrade ? { minimumGrade } : {}),
    interpretation: `Read as: ${minimumGrade ? `minimum prerequisite grade ${minimumGrade}; ` : ""}${stance}.`,
  });
}

function acceptanceRule(kind: "online-coursework" | "community-college" | "ap-credit", fact: SchoolResearchFact): StructuredRequirement {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule(kind, [fact], reading, undefined, { acceptance: "unknown" });
  const text = reading.text;
  const lower = text.toLowerCase();
  const noun = { "online-coursework": "online coursework", "community-college": "community college coursework", "ap-credit": "AP/IB credit" }[kind];
  const negative = /\bnot (?:counted|accepted)\b/.test(lower);
  const positive = /(?<!not )\baccepted\b|\bsatisfy\b/.test(lower);
  let acceptance: StructuredRequirement["acceptance"];
  if (negative) acceptance = positive ? "limited" : "not-accepted";
  else if (/\bif\b|\bonly\b|\bexcept\b|\bmax\b|\bmust\b|comparable|for chemistry and physics/.test(lower)) acceptance = "limited";
  else if (positive || /no preference/.test(lower)) acceptance = "accepted";
  else acceptance = "unknown";
  if (acceptance === "unknown") return unknownRule(kind, [fact], reading, undefined, { acceptance: "unknown", exceptions: [text] });
  return rule(kind, [fact], {
    strength: "hard", acceptance, exceptions: acceptance === "limited" ? [text] : [],
    interpretation: `Read as: ${noun} ${acceptance === "accepted" ? "is accepted" : acceptance === "limited" ? "is accepted only under stated conditions" : "is not accepted"}.`,
  });
}

// ---------------------------------------------------------------------------
// Deadline

function deadlineRule(fact: SchoolResearchFact): StructuredRequirement {
  const reading = read(fact.value);
  if (reading.sentinel || !reading.text) return unknownRule("deadline", [fact], reading);
  const text = reading.text;
  if (/^rolling/i.test(text)) {
    return rule("deadline", [fact], {
      strength: "hard", deadline: { month: 0, day: 0, rolling: true },
      exceptions: parentheticals(text), interpretation: "Read as: rolling admissions.",
    });
  }
  const iso = /\b(20\d\d)-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    return rule("deadline", [fact], {
      strength: "hard", deadline: { month: Number(iso[2]), day: Number(iso[3]), rolling: false, explicitYear: Number(iso[1]) },
      exceptions: parentheticals(text), interpretation: `Read as: primary deadline ${iso[0]}.`,
    });
  }
  const dated = new RegExp(`${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d\\d))?`, "i").exec(text);
  if (dated) {
    const month = monthNumber(dated[1]);
    const day = Number(dated[2]);
    const explicitYear = dated[3] ? Number(dated[3]) : undefined;
    if (month >= 1 && day >= 1 && day <= 31) {
      const exceptions = [...parentheticals(text).filter(note => !/^amcas$/i.test(note)), ...(/verified status/i.test(text) ? ["deadline is for a verified application status"] : [])];
      return rule("deadline", [fact], {
        strength: "hard", deadline: { month, day, rolling: false, ...(explicitYear ? { explicitYear } : {}) }, exceptions,
        interpretation: `Read as: primary deadline ${dated[1].replace(/^./, letter => letter.toUpperCase())} ${day}${explicitYear ? `, ${explicitYear}` : " (year resolved from your cycle)"}.`,
      });
    }
  }
  return unknownRule("deadline", [fact], reading, undefined, { exceptions: [text] });
}

// ---------------------------------------------------------------------------
// Entry point

/** Derive every rule the school's captured evidence supports. Never throws. */
export function deriveRequirements(school: ApplicationSchool): StructuredRequirement[] {
  try {
    const facts = new Map((Array.isArray(school?.researchFacts) ? school.researchFacts : [])
      .filter(fact => fact && typeof fact.id === "string" && typeof fact.value === "string")
      .map(fact => [fact.id, fact]));
    const get = (table: string, field: string) => facts.get(`${table}.${field}`);
    const admissions = (field: string) => get("admissions_requirements_raw", field);
    const process = (field: string) => get("application_process_raw", field);
    const coursework = (field: string) => get("coursework_policy_raw", field);
    const typeFact = admissions("requirement_type");
    const rules: StructuredRequirement[] = [];
    const push = (requirement: StructuredRequirement | undefined) => { if (requirement?.evidence.length) rules.push(requirement); };

    const gpa = admissions("min_gpa"); if (gpa) push(numericRule("gpa-minimum", gpa, typeFact));
    const science = admissions("min_science_gpa"); if (science) push(numericRule("science-gpa-minimum", science, typeFact));
    const mcat = admissions("mcat_min"); if (mcat) push(numericRule("mcat-minimum", mcat, typeFact));
    push(mcatRequiredRule([mcat, admissions("mcat_recency_policy"), admissions("mcat_competitive"), admissions("citizenship_policy"),
      process("international_policy"), typeFact].filter((fact): fact is SchoolResearchFact => Boolean(fact))));
    const recency = admissions("mcat_recency_policy"); if (recency) push(recencyRule(recency));
    push(citizenshipRule([admissions("citizenship_policy"), process("international_policy"), process("daca_policy")]
      .filter((fact): fact is SchoolResearchFact => Boolean(fact))));
    push(residencyRule(process("state_residency_rules"), admissions("citizenship_policy")));
    const degree = coursework("degree_requirement"); if (degree) push(degreeRule(degree));
    for (const [field, category] of COURSE_FIELDS) {
      const fact = coursework(field);
      if (fact) push(courseworkRule(fact, category));
    }
    const grades = coursework("pass_fail_policy"); if (grades) push(gradeRule(grades));
    const online = coursework("online_coursework_accepted"); if (online) push(acceptanceRule("online-coursework", online));
    const college = coursework("community_college_accepted"); if (college) push(acceptanceRule("community-college", college));
    const ap = coursework("ap_credit_policy"); if (ap) push(acceptanceRule("ap-credit", ap));
    const deadline = process("primary_deadline"); if (deadline) push(deadlineRule(deadline));
    return rules;
  } catch {
    return [];
  }
}
