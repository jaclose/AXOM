import type { EstimateActivity } from "./applicationSchools.ts";
import type { PremedExperienceEntry, PremedExperienceKind } from "./types.ts";

/**
 * Learner-entered application facts. Every field is optional: `undefined`
 * means "not entered", which the checker reports as unknown — never as a pass.
 */
export type CitizenshipStatus =
  | "us-citizen" | "us-permanent-resident" | "daca" | "undocumented" | "canadian-citizen" | "international";

export type DegreeStatus = "completed" | "in-progress" | "not-started";

export type CourseCategory =
  | "biology" | "generalChemistry" | "organicChemistry" | "biochemistry"
  | "physics" | "mathStatistics" | "english" | "behavioralScience";

export type CourseStatus = "completed" | "in-progress" | "planned" | "not-planned";

export interface CourseworkEntry {
  status: CourseStatus;
  /** Semester hours (quarter hours × 2/3 are the learner's responsibility). */
  semesterHours?: number;
  /** Any part taken pass/fail. */
  passFail?: boolean;
  /** Any part taken online. */
  online?: boolean;
  /** Any part taken at a community college. */
  communityCollege?: boolean;
  /** Any part satisfied with AP/IB credit. */
  apCredit?: boolean;
}

export interface ApplicationProfile {
  /** Fall matriculation year, e.g. 2027 means applying in the 2026–27 cycle. */
  plannedMatriculationYear?: number;
  /** AMCAS/AACOMAS-style 4.0 scale. */
  cumulativeGpa?: number;
  /** BCPM / science GPA on a 4.0 scale. */
  scienceGpa?: number;
  /** 472–528. */
  mcatTotal?: number;
  /** yyyy-MM of the scored (or planned) MCAT sitting used for applications. */
  mcatTestDate?: string;
  /** Lowest section score (118–132), for "no section below N" rules. */
  mcatLowestSection?: number;
  mcatAttempts?: number;
  citizenship?: CitizenshipStatus;
  /** Canonical name from APPLICATION_REGIONS (US states, DC, territories, Canadian provinces). */
  stateOfResidence?: string;
  degreeStatus?: DegreeStatus;
  /** yyyy-MM the bachelor's degree was or will be conferred. */
  degreeExpectedDate?: string;
  /** Total undergraduate semester hours completed. */
  semesterHoursCompleted?: number;
  coursework: Partial<Record<CourseCategory, CourseworkEntry>>;
  /** Learner-confirmed hours per estimate category. */
  activityHours: Partial<Record<EstimateActivity, number>>;
  updatedAt?: string;
}

export const COURSE_CATEGORIES: readonly { id: CourseCategory; label: string }[] = [
  { id: "biology", label: "Biology" },
  { id: "generalChemistry", label: "General chemistry" },
  { id: "organicChemistry", label: "Organic chemistry" },
  { id: "biochemistry", label: "Biochemistry" },
  { id: "physics", label: "Physics" },
  { id: "mathStatistics", label: "Math and statistics" },
  { id: "english", label: "English" },
  { id: "behavioralScience", label: "Behavioral science" },
];

export const ESTIMATE_ACTIVITIES: readonly { id: EstimateActivity; label: string }[] = [
  { id: "research", label: "Research" },
  { id: "clinicalVolunteer", label: "Clinical volunteering" },
  { id: "nonclinicalVolunteer", label: "Non-clinical volunteering" },
  { id: "shadowing", label: "Shadowing" },
  { id: "paidClinical", label: "Paid clinical work" },
  { id: "paidNonclinical", label: "Paid non-clinical work" },
  { id: "leadership", label: "Leadership" },
];

export const CITIZENSHIP_OPTIONS: readonly { id: CitizenshipStatus; label: string }[] = [
  { id: "us-citizen", label: "U.S. citizen or national" },
  { id: "us-permanent-resident", label: "U.S. permanent resident" },
  { id: "daca", label: "DACA recipient" },
  { id: "undocumented", label: "Undocumented (no DACA)" },
  { id: "canadian-citizen", label: "Canadian citizen" },
  { id: "international", label: "Other international applicant" },
];

/**
 * US states, DC, US territories and Canadian provinces/territories.
 * `name` matches the roster's `state_or_country` spelling for US schools.
 */
export interface ApplicationRegion { code: string; name: string; country: "US" | "CA" }

const US_REGIONS: readonly [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["DC", "District of Columbia"], ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"],
  ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
];
const CA_REGIONS: readonly [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

export const APPLICATION_REGIONS: readonly ApplicationRegion[] = [
  ...US_REGIONS.map(([code, name]) => ({ code, name, country: "US" as const })),
  ...CA_REGIONS.map(([code, name]) => ({ code, name, country: "CA" as const })),
];

// No bare "virgin islands": the roster also lists the British Virgin Islands.
const REGION_ALIASES: Record<string, string> = {
  "washington dc": "DC", "washington district of columbia": "DC",
  "united states virgin islands": "VI", "virgin islands of the united states": "VI", "virgin islands us": "VI", "usvi": "VI",
  "cnmi": "MP", "northern marianas": "MP",
  "newfoundland": "NL", "pei": "PE", "nwt": "NT", "yukon territory": "YT",
};

const regionKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[.'’ʻ`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const REGION_INDEX = new Map<string, ApplicationRegion>();
for (const region of APPLICATION_REGIONS) {
  REGION_INDEX.set(region.code.toLowerCase(), region);
  REGION_INDEX.set(regionKey(region.name), region);
}
for (const [alias, code] of Object.entries(REGION_ALIASES)) {
  const region = REGION_INDEX.get(code.toLowerCase());
  if (region) REGION_INDEX.set(alias, region);
}

const COUNTRY_SUFFIX = / (usa|us|united states(?: of america)?|canada)$/;

export function resolveRegion(value: string | undefined): ApplicationRegion | undefined {
  if (typeof value !== "string") return undefined;
  const key = regionKey(value);
  const direct = REGION_INDEX.get(key);
  if (direct || !key) return direct;
  // Only surrounding wording ("the State of New York", "Texas, USA") is dropped — never a partial name match.
  const country = COUNTRY_SUFFIX.exec(key)?.[1];
  const core = key.replace(COUNTRY_SUFFIX, "")
    .replace(/^(the )?((state|commonwealth|province|territory) of (the )?)?/, "").replace(/ (state|province)$/, "");
  const region = core === key ? undefined : REGION_INDEX.get(core);
  if (!region || (country && region.country !== (country === "canada" ? "CA" : "US"))) return undefined;
  return region;
}

const DEGREE_STATUSES: readonly DegreeStatus[] = ["completed", "in-progress", "not-started"];
const COURSE_STATUSES: readonly CourseStatus[] = ["completed", "in-progress", "planned", "not-planned"];
const COURSE_FLAGS = ["passFail", "online", "communityCollege", "apCredit"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
  (options as readonly unknown[]).includes(value) ? value as T : undefined;
const inRange = (value: unknown, min: number, max: number, integer = false): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
    ? value : undefined;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
// Kept as entered: rounding 3.499 up to 3.50 would clear a 3.50 minimum the learner does not meet.
const gpa = (value: unknown) => inRange(value, 0, 4);
const yearMonth = (value: unknown) =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(value) ? value.slice(0, 7) : undefined;
const isoTimestamp = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;

function normalizeCourseworkEntry(value: unknown): CourseworkEntry | undefined {
  if (!isRecord(value)) return undefined;
  const status = oneOf(value.status, COURSE_STATUSES);
  if (!status) return undefined;
  const entry: CourseworkEntry = { status };
  const semesterHours = inRange(value.semesterHours, 0, 400);
  if (semesterHours !== undefined) entry.semesterHours = semesterHours;
  for (const flag of COURSE_FLAGS) {
    const flagValue = value[flag];
    if (typeof flagValue === "boolean") entry[flag] = flagValue;
  }
  return entry;
}

/** Returns undefined for input that carries no usable profile data. */
export function normalizeApplicationProfile(value: unknown): ApplicationProfile | undefined {
  if (!isRecord(value)) return undefined;
  const coursework: ApplicationProfile["coursework"] = {};
  const rawCoursework = isRecord(value.coursework) ? value.coursework : {};
  for (const { id } of COURSE_CATEGORIES) {
    const entry = normalizeCourseworkEntry(rawCoursework[id]);
    if (entry) coursework[id] = entry;
  }
  const activityHours: ApplicationProfile["activityHours"] = {};
  const rawHours = isRecord(value.activityHours) ? value.activityHours : {};
  for (const { id } of ESTIMATE_ACTIVITIES) {
    const hours = inRange(rawHours[id], 0, 20000);
    if (hours !== undefined) activityHours[id] = hours;
  }
  const fields: Omit<ApplicationProfile, "coursework" | "activityHours"> = {
    plannedMatriculationYear: inRange(value.plannedMatriculationYear, 2020, 2040, true),
    cumulativeGpa: gpa(value.cumulativeGpa),
    scienceGpa: gpa(value.scienceGpa),
    mcatTotal: inRange(value.mcatTotal, 472, 528, true),
    mcatTestDate: yearMonth(value.mcatTestDate),
    mcatLowestSection: inRange(value.mcatLowestSection, 118, 132, true),
    mcatAttempts: inRange(value.mcatAttempts, 1, 10, true),
    citizenship: oneOf(value.citizenship, CITIZENSHIP_OPTIONS.map(option => option.id)),
    stateOfResidence: typeof value.stateOfResidence === "string" ? resolveRegion(value.stateOfResidence)?.name : undefined,
    degreeStatus: oneOf(value.degreeStatus, DEGREE_STATUSES),
    degreeExpectedDate: yearMonth(value.degreeExpectedDate),
    semesterHoursCompleted: inRange(value.semesterHoursCompleted, 0, 400),
    updatedAt: isoTimestamp(value.updatedAt),
  };
  const profile = {
    ...Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)),
    coursework, activityHours,
  } as ApplicationProfile;
  return isApplicationProfileEmpty(profile) ? undefined : profile;
}

/** `updatedAt` alone, or empty coursework / activity maps, is not profile data. */
export function isApplicationProfileEmpty(profile: ApplicationProfile | undefined): boolean {
  if (!profile) return true;
  return Object.entries(profile).every(([key, value]) => key === "updatedAt" || value === undefined
    || (isRecord(value) && Object.values(value).every(entry => entry === undefined)));
}

/** "2026–27 cycle · entering 2027" */
export function applicationCycleLabel(plannedMatriculationYear: number): string {
  const opens = plannedMatriculationYear - 1;
  return `${opens}–${String(plannedMatriculationYear % 100).padStart(2, "0")} cycle · entering ${plannedMatriculationYear}`;
}

const LOG_ACTIVITIES: Partial<Record<PremedExperienceKind, EstimateActivity>> = {
  Research: "research", Shadowing: "shadowing", Leadership: "leadership", Service: "nonclinicalVolunteer",
};

/**
 * Hours from the Pre-Med Experience Log that map unambiguously onto estimate
 * categories. Clinical hours are returned separately because the log does not
 * distinguish paid from volunteer clinical work.
 */
export function experienceLogHours(entries: readonly PremedExperienceEntry[]): {
  mapped: Partial<Record<EstimateActivity, number>>;
  clinicalUnsplit: number;
} {
  const mapped: Partial<Record<EstimateActivity, number>> = {};
  let clinicalUnsplit = 0;
  for (const entry of entries) {
    if (typeof entry?.hours !== "number" || !Number.isFinite(entry.hours) || entry.hours < 0) continue;
    if (entry.kind === "Clinical") clinicalUnsplit += entry.hours;
    const activity = LOG_ACTIVITIES[entry.kind];
    if (activity) mapped[activity] = (mapped[activity] ?? 0) + entry.hours;
  }
  for (const [activity, hours] of Object.entries(mapped) as [EstimateActivity, number][]) mapped[activity] = round(hours, 1);
  return { mapped, clinicalUnsplit: round(clinicalUnsplit, 1) };
}
