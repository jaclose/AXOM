import { normalizeResearchFacts, researchFactRevision, type SchoolResearchFact } from "./applicationResearch.ts";

export type SchoolVerificationStatus = "verified" | "incomplete" | "unknown" | "needs-refresh" | "conflicting";
export type DatasetIssueSeverity = "error" | "warning";

export interface ApplicationSchoolSource {
  url: string;
  title?: string;
  retrievedAt: string;
}

export interface ApplicationSchoolConflict {
  existing: string;
  incoming: string;
}

/** Research roster segment. Unknown upstream segments normalize to "OTHER". */
export type SchoolSegment = "US_MD" | "US_DO" | "PUERTO_RICO" | "CARIBBEAN_INTL" | "CANADA_MD" | "OTHER";

/** Evidence basis for numbers that describe applicants/classes rather than rules. */
export type ReportedStatisticBasis = "official-capture" | "unverified-capture" | "third-party";

/**
 * A number someone reported about an admitted or enrolled class (average,
 * median, "competitive" figure). Context for estimates, never a requirement.
 */
export interface ReportedStatistic {
  /** `${table}.${field}`, e.g. `admissions_requirements_raw.avg_gpa`. */
  id: string;
  label: string;
  metric: "gpa" | "science-gpa" | "mcat";
  kind: "average" | "competitive";
  /** Original source text, verbatim. */
  value: string;
  /** Leading plausible number in `value`, when there is one. */
  number?: number;
  /** True when the source text is approximate, a range, open-ended (+, >), or a median. */
  approximate?: boolean;
  /**
   * The text describes a threshold, minimum, recommended figure, scholarship
   * cutoff, open-ended or range floor — not a class statistic. Never a benchmark.
   */
  floorLike?: boolean;
  url: string;
  capturedAt: string;
  basis: ReportedStatisticBasis;
}

export type EstimateActivity =
  | "research" | "clinicalVolunteer" | "nonclinicalVolunteer" | "shadowing"
  | "paidClinical" | "paidNonclinical" | "leadership";

export interface EstimateHourRange {
  /** Original range text, verbatim (may include notes). */
  text: string;
  min?: number;
  max?: number;
  /** "800-2000+" style ranges with no stated upper bound. */
  openEnded?: boolean;
}

export interface EstimatedScore {
  value: number;
  /** Original basis text, verbatim. */
  basis: string;
  /** Basis says the number is a floor/minimum, not a competitive benchmark. */
  floorBased: boolean;
  /** Basis says the number was borrowed from same-tier peer schools. */
  peerFallback: boolean;
}

/**
 * Research-team estimates for a school. Always labeled as estimates in the
 * product and never used as requirements or eligibility rules.
 */
export interface SchoolEstimates {
  tier?: string;
  tierRationale?: string;
  competitiveGpa?: EstimatedScore;
  competitiveMcat?: EstimatedScore;
  /** LizzyM-style composite from the research file, shown as context only. */
  indexScore?: { value: number; interpretation?: string };
  hours: Partial<Record<EstimateActivity, EstimateHourRange>>;
  confidence: "low" | "moderate" | "high" | "unknown";
  disclaimer: string;
  sourcesReferenced?: string;
  estimatedAt: string;
}

/** Research-team risk flag (e.g. Caribbean schools). A judgment, not an official rating. */
export interface SchoolRiskFlag {
  tier: string;
  notes?: string;
  url: string;
  capturedAt: string;
  captureStatus: "official-capture" | "unverified-capture";
}

export interface ApplicationSchool {
  id: string;
  canonicalName: string;
  name: string;
  alternateNames?: string[];
  segment?: SchoolSegment;
  programType?: string;
  degree?: string;
  location?: string;
  website?: string;
  applicationPlatform?: string;
  prerequisiteCategories?: string[];
  mcatPolicy?: string;
  casperPolicy?: string;
  previewPolicy?: string;
  letters?: string;
  deadline?: string;
  tuition?: string;
  classSize?: number;
  missionNotes?: string;
  verificationStatus: SchoolVerificationStatus;
  sources: ApplicationSchoolSource[];
  /** Field-level evidence remains bounded and auditable without wrapping every primitive. */
  fieldProvenance?: Record<string, ApplicationSchoolSource[]>;
  /** Conflicts are preserved instead of silently choosing a scraper value. */
  conflicts?: Record<string, ApplicationSchoolConflict>;
  updatedAt?: string;
  researchFacts?: SchoolResearchFact[];
  /** Class statistics; context for estimates, never requirements. */
  reportedStats?: ReportedStatistic[];
  estimates?: SchoolEstimates;
  riskFlag?: SchoolRiskFlag;
}

export interface ApplicationSchoolDataset {
  schemaVersion: 2;
  generatedAt: string;
  sourcePipelineVersion?: string;
  recordCount: number;
  successfulRecords: number;
  incompleteRecords: number;
  rejectedRecords: number;
  schools: ApplicationSchool[];
}

export interface DatasetIssue {
  path: string;
  message: string;
  severity: DatasetIssueSeverity;
}

export type DatasetResult =
  | { ok: true; dataset: ApplicationSchoolDataset; issues: DatasetIssue[] }
  | { ok: false; issues: DatasetIssue[] };

export interface DatasetMergeResult {
  dataset: ApplicationSchoolDataset;
  conflicts: number;
  warnings: string[];
}

export interface ApplicationSchoolFactChange {
  schoolId: string;
  factId: string;
  fields: (keyof SchoolResearchFact)[];
  before: SchoolResearchFact;
  after: SchoolResearchFact;
}

/** A reported statistic added, removed or changed between runs (e.g. a basis downgrade or a new floorLike flag). */
export interface ApplicationSchoolStatChange {
  schoolId: string;
  statId: string;
  change: "added" | "removed" | "changed";
  /** Changed fields; empty for added or removed statistics. */
  fields: (keyof ReportedStatistic)[];
}

/** What an incoming run would change; `reviewChecksReopened` counts learner checks it invalidates. */
export interface ApplicationSchoolDatasetDiff {
  addedSchools: string[];
  removedSchools: string[];
  changedFacts: ApplicationSchoolFactChange[];
  addedFacts: { schoolId: string; factId: string }[];
  removedFacts: { schoolId: string; factId: string }[];
  /** School IDs whose research-team estimates were added, removed or changed. */
  estimateChanges: string[];
  statChanges: ApplicationSchoolStatChange[];
  reviewChecksReopened: number;
}

const STATUSES = new Set<SchoolVerificationStatus>(["verified", "incomplete", "unknown", "needs-refresh", "conflicting"]);
const ALLOWED_PROGRAMS = new Set(["md", "do", "md/do", "residency", "phd", "masters", "pa", "nursing", "other"]);
const MATERIAL_FIELDS = [
  "segment", "programType", "degree", "location", "website", "applicationPlatform", "prerequisiteCategories",
  "mcatPolicy", "casperPolicy", "previewPolicy", "letters", "deadline", "tuition", "classSize", "missionNotes",
] as const;
const SEGMENTS = new Set<SchoolSegment>(["US_MD", "US_DO", "PUERTO_RICO", "CARIBBEAN_INTL", "CANADA_MD", "OTHER"]);
const STAT_METRICS = new Set<ReportedStatistic["metric"]>(["gpa", "science-gpa", "mcat"]);
const STAT_KINDS = new Set<ReportedStatistic["kind"]>(["average", "competitive"]);
const STAT_BASES = new Set<ReportedStatisticBasis>(["official-capture", "unverified-capture", "third-party"]);
const ACTIVITIES: readonly EstimateActivity[] = ["research", "clinicalVolunteer", "nonclinicalVolunteer", "shadowing", "paidClinical", "paidNonclinical", "leadership"];
const CONFIDENCE = new Set<SchoolEstimates["confidence"]>(["low", "moderate", "high", "unknown"]);
const PLAUSIBLE = { gpa: [2, 4], "science-gpa": [2, 4], mcat: [472, 528], index: [0.1, 100], hours: [0, 20_000] } as const;
const FACT_FIELDS = ["label", "value", "url", "capturedAt", "captureStatus"] as const;
const STAT_FIELDS = ["label", "metric", "kind", "value", "number", "approximate", "floorLike", "url", "capturedAt", "basis"] as const;
/** Same wording rules as the Phase 1 adapter: a threshold, recommended figure, open-ended value or range is not a class statistic. */
const FLOOR_LIKE_TEXT = /threshold|minimum|\bmin\b|recommended|required|scholarship|typical|accepted range|\+|>|≥|range/i;
const VALUE_RANGE = /\d\s*[-–]\s*\d/;
/** "2024-25 entering" names a class year, not a value range. */
const YEAR_RANGE = /\b(?:19|20)\d{2}\s*[-–]\s*\d{2,4}\b/g;
const THIRD_PARTY_TEXT = /third[- ]party|aggregator/i;

/**
 * Validate scraper output. Schema v1 is accepted and deterministically upgraded
 * to v2; bad rows are rejected individually so a partial run remains useful.
 */
export function parseApplicationSchoolDataset(input: unknown, now = new Date()): DatasetResult {
  const issues: DatasetIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [issue("$", "Dataset must be an object.")] };
  const version = input.schemaVersion;
  if (version !== 1 && version !== 2) return { ok: false, issues: [issue("schemaVersion", "Expected schema version 1 or 2.")] };
  if (!isNonEmptyString(input.generatedAt)) return { ok: false, issues: [issue("generatedAt", "A source generation timestamp is required.")] };
  const generatedAt = input.generatedAt;
  if (!isValidTimestamp(generatedAt)) issues.push(issue("generatedAt", "Generation timestamp is not valid ISO date-time."));
  else if (new Date(generatedAt).getTime() > now.getTime() + 60_000) issues.push(issue("generatedAt", "Generation timestamp is in the future."));
  if (!Array.isArray(input.schools)) return { ok: false, issues: [issue("schools", "Schools must be an array.")] };

  const ids = new Set<string>();
  const rawIds = new Set<string>();
  const canonicalNames = new Map<string, number>();
  const schools: ApplicationSchool[] = [];
  for (const [index, raw] of input.schools.entries()) {
    const path = `schools[${index}]`;
    const rawId = isRecord(raw) ? stringValue(raw.id) ?? stringValue(raw.schoolId) : undefined;
    const duplicateRawId = Boolean(rawId && rawIds.has(rawId));
    if (rawId) rawIds.add(rawId);
    const normalized = normalizeSchool(raw, path, now, issues);
    if (!normalized) continue;
    if (duplicateRawId || ids.has(normalized.id)) {
      issues.push(issue(`${path}.id`, `Duplicate school ID: ${normalized.id}`));
      continue;
    }
    const canonicalKey = normalizeName(normalized.canonicalName);
    if (canonicalNames.has(canonicalKey)) {
      issues.push(issue(`${path}.canonicalName`, `Duplicate canonical school name; compare with row ${canonicalNames.get(canonicalKey)! + 1}.`, "warning"));
    } else canonicalNames.set(canonicalKey, index);
    ids.add(normalized.id);
    schools.push(normalized);
  }

  const metadataRecordCount = numberValue(input.recordCount);
  if (metadataRecordCount !== undefined && metadataRecordCount !== input.schools.length) {
    issues.push(issue("recordCount", `Expected ${input.schools.length} records but metadata says ${metadataRecordCount}.`, "warning"));
  }
  const dataset: ApplicationSchoolDataset = {
    schemaVersion: 2,
    generatedAt,
    sourcePipelineVersion: stringValue(input.sourcePipelineVersion),
    recordCount: input.schools.length,
    successfulRecords: schools.length,
    incompleteRecords: schools.filter((school) => school.verificationStatus === "incomplete").length,
    rejectedRecords: input.schools.length - schools.length,
    schools,
  };
  return { ok: true, dataset, issues };
}

/** Merge an incremental scraper run without deleting known fields or hiding conflicts. */
export function mergeApplicationSchoolDatasets(base: ApplicationSchoolDataset, incoming: ApplicationSchoolDataset): DatasetMergeResult {
  const merged = new Map(base.schools.map((school) => [school.id, cloneSchool(school)]));
  const byCanonical = new Map(base.schools.map((school) => [normalizeName(school.canonicalName), school.id]));
  let conflicts = 0;
  const warnings: string[] = [];
  // Only conflicts the base did not already carry are counted and reported.
  const noteNewConflicts = (name: string, before: ApplicationSchool["conflicts"], after: ApplicationSchool["conflicts"]) => {
    const added = Object.keys(after ?? {}).filter(key => !Object.hasOwn(before ?? {}, key));
    if (!added.length) return;
    conflicts += added.length;
    warnings.push(`${name}: ${added.join(", ")} needs review.`);
  };
  for (const candidate of incoming.schools) {
    const matchId = merged.has(candidate.id) ? candidate.id : byCanonical.get(normalizeName(candidate.canonicalName));
    if (!matchId) {
      const added = cloneSchool(candidate);
      if (added.researchFacts) added.researchFacts = added.researchFacts.filter(isInstitutionalFact);
      merged.set(candidate.id, added);
      byCanonical.set(normalizeName(candidate.canonicalName), candidate.id);
      noteNewConflicts(candidate.name, undefined, candidate.conflicts);
      continue;
    }
    const current = merged.get(matchId)!;
    const next = mergeSchool(current, candidate);
    noteNewConflicts(candidate.name, current.conflicts, next.conflicts);
    merged.set(matchId, next);
  }
  const schools = [...merged.values()];
  return {
    dataset: {
      schemaVersion: 2,
      generatedAt: incoming.generatedAt > base.generatedAt ? incoming.generatedAt : base.generatedAt,
      sourcePipelineVersion: incoming.sourcePipelineVersion ?? base.sourcePipelineVersion,
      recordCount: schools.length,
      successfulRecords: schools.length,
      incompleteRecords: schools.filter((school) => school.verificationStatus === "incomplete").length,
      rejectedRecords: 0,
      schools,
    },
    conflicts,
    warnings,
  };
}

function normalizeSchool(raw: unknown, path: string, now: Date, issues: DatasetIssue[]): ApplicationSchool | null {
  if (!isRecord(raw)) { issues.push(issue(path, "School must be an object.")); return null; }
  const id = stringValue(raw.id) ?? stringValue(raw.schoolId);
  const canonicalName = stringValue(raw.canonicalName) ?? stringValue(raw.name);
  if (!id || !canonicalName) { issues.push(issue(path, "School ID and canonical name are required.")); return null; }
  const verificationStatus = raw.verificationStatus as SchoolVerificationStatus;
  if (!STATUSES.has(verificationStatus)) { issues.push(issue(`${path}.verificationStatus`, "Verification status is invalid.")); return null; }
  const sourceRows = Array.isArray(raw.sources) ? raw.sources : [];
  const sources = sourceRows.flatMap((source, sourceIndex): ApplicationSchoolSource[] => {
    if (!isRecord(source) || !isHttpUrl(source.url) || !isNonEmptyString(source.retrievedAt)) {
      issues.push(issue(`${path}.sources[${sourceIndex}]`, "Source URL and retrieval timestamp are required."));
      return [];
    }
    if (!isValidTimestamp(source.retrievedAt)) {
      issues.push(issue(`${path}.sources[${sourceIndex}].retrievedAt`, "Source retrieval timestamp is invalid."));
      return [];
    }
    if (new Date(source.retrievedAt).getTime() > now.getTime() + 60_000) {
      issues.push(issue(`${path}.sources[${sourceIndex}].retrievedAt`, "Source retrieval timestamp is in the future."));
      return [];
    }
    if (now.getTime() - new Date(source.retrievedAt).getTime() > 366 * 24 * 60 * 60 * 1000) {
      issues.push(issue(`${path}.sources[${sourceIndex}].retrievedAt`, "Source is older than one year and needs refresh.", "warning"));
    }
    return [{ url: source.url, title: stringValue(source.title), retrievedAt: source.retrievedAt }];
  });
  if (verificationStatus === "verified" && sources.length === 0) {
    issues.push(issue(`${path}.sources`, "Verified schools require a valid source URL and retrieval timestamp."));
    return null;
  }
  const classSize = numberValue(raw.classSize);
  if (classSize !== undefined && (!Number.isInteger(classSize) || classSize < 0)) {
    issues.push(issue(`${path}.classSize`, "Class size must be a non-negative integer."));
    return null;
  }
  const programType = stringValue(raw.programType)?.toLowerCase();
  if (programType && !ALLOWED_PROGRAMS.has(programType)) issues.push(issue(`${path}.programType`, `Unsupported program type: ${programType}.`, "warning"));
  const deadline = stringValue(raw.deadline);
  if (deadline && !isPlausibleDeadline(deadline)) issues.push(issue(`${path}.deadline`, "Deadline is not a recognizable date or status.", "warning"));
  const website = stringValue(raw.website);
  if (website && !isHttpUrl(website)) issues.push(issue(`${path}.website`, "Website must be an HTTP(S) URL.", "warning"));
  const stale = sources.some((source) => now.getTime() - new Date(source.retrievedAt).getTime() > 366 * 24 * 60 * 60 * 1000);
  const status = stale && verificationStatus === "verified" ? "needs-refresh" : verificationStatus;
  const researchFacts = normalizeResearchFacts(raw.researchFacts, now);
  if (raw.researchFacts !== undefined && (!Array.isArray(raw.researchFacts) || researchFacts.length !== raw.researchFacts.length)) {
    issues.push(issue(`${path}.researchFacts`, "Invalid or unsafe research fields were rejected; review the source export.", "warning"));
  }
  const warn = (field: string, message: string) => issues.push(issue(`${path}.${field}`, message, "warning"));
  return {
    id,
    canonicalName,
    name: stringValue(raw.name) ?? canonicalName,
    alternateNames: stringArray(raw.alternateNames),
    segment: segmentValue(raw.segment),
    programType,
    degree: stringValue(raw.degree),
    location: stringValue(raw.location),
    website: website && isHttpUrl(website) ? website : undefined,
    applicationPlatform: stringValue(raw.applicationPlatform),
    prerequisiteCategories: stringArray(raw.prerequisiteCategories),
    mcatPolicy: stringValue(raw.mcatPolicy),
    casperPolicy: stringValue(raw.casperPolicy),
    previewPolicy: stringValue(raw.previewPolicy),
    letters: stringValue(raw.letters),
    deadline,
    tuition: stringValue(raw.tuition),
    classSize,
    missionNotes: stringValue(raw.missionNotes),
    verificationStatus: status,
    sources,
    fieldProvenance: fieldProvenance(raw.fieldProvenance),
    conflicts: conflictsValue(raw.conflicts),
    updatedAt: stringValue(raw.updatedAt),
    researchFacts,
    reportedStats: normalizeReportedStats(raw.reportedStats, now, warn),
    estimates: normalizeEstimates(raw.estimates, now, warn),
    riskFlag: normalizeRiskFlag(raw.riskFlag, now, warn),
  };
}

function segmentValue(value: unknown): SchoolSegment | undefined {
  const segment = stringValue(value)?.toUpperCase();
  return segment ? SEGMENTS.has(segment as SchoolSegment) ? segment as SchoolSegment : "OTHER" : undefined;
}

/**
 * Same link/date safety as research facts; an implausible number is dropped, the text kept.
 * `floorLike` is boolean-only and, like estimate flags, can only become more cautious: the
 * source wording sets it even when an older export omitted it.
 */
function normalizeReportedStats(value: unknown, now: Date, warn: (field: string, message: string) => void): ReportedStatistic[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) { warn("reportedStats", "Reported statistics must be an array; they were dropped."); return undefined; }
  let rejected = 0;
  let future = 0;
  let droppedNumbers = 0;
  let badFlags = 0;
  const stats = value.flatMap((raw): ReportedStatistic[] => {
    if (!isRecord(raw) || ![raw.id, raw.label, raw.value].every(isNonEmptyString) || !STAT_METRICS.has(raw.metric) || !STAT_KINDS.has(raw.kind)
      || !STAT_BASES.has(raw.basis) || !isHttpUrl(raw.url) || !isNonEmptyString(raw.capturedAt) || !isValidTimestamp(raw.capturedAt)) { rejected += 1; return []; }
    if (!isPastTimestamp(raw.capturedAt, now)) { future += 1; return []; }
    const metric = raw.metric as ReportedStatistic["metric"];
    const number = raw.number === undefined ? undefined : plausible(raw.number, PLAUSIBLE[metric]);
    if (raw.number !== undefined && number === undefined) droppedNumbers += 1;
    const badFlag = raw.floorLike !== undefined && raw.floorLike !== null && typeof raw.floorLike !== "boolean";
    if (badFlag) badFlags += 1;
    const floorLike = raw.floorLike === true || badFlag || isFloorLikeStatText(raw.value);
    return [{
      id: raw.id, label: raw.label, metric, kind: raw.kind, value: raw.value,
      ...(number !== undefined && { number }), ...(raw.approximate === true && { approximate: true }), ...(floorLike && { floorLike: true }),
      url: raw.url, capturedAt: raw.capturedAt, basis: raw.basis,
    }];
  });
  if (rejected) warn("reportedStats", `${rejected} reported statistic(s) with an unsafe link, invalid date or unknown basis were rejected.`);
  if (future) warn("reportedStats", `${future} reported statistic(s) dated in the future were rejected.`);
  if (droppedNumbers) warn("reportedStats", `${droppedNumbers} implausible reported number(s) were dropped; the source text is kept.`);
  if (badFlags) warn("reportedStats", `${badFlags} reported statistic(s) had a non-boolean floorLike flag; they are treated as floor-like.`);
  return stats;
}

function isFloorLikeStatText(value: string) {
  return FLOOR_LIKE_TEXT.test(value) || VALUE_RANGE.test(value.replace(YEAR_RANGE, ""));
}

/** Estimates need a verbatim disclaimer and an estimate date; anything implausible is dropped, never clamped. */
function normalizeEstimates(value: unknown, now: Date, warn: (field: string, message: string) => void): SchoolEstimates | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isNonEmptyString(value.disclaimer) || !isPastTimestamp(value.estimatedAt, now)) {
    warn("estimates", "Estimates without a disclaimer and a valid, past estimate date were dropped.");
    return undefined;
  }
  const dropped: string[] = [];
  const score = (key: "competitiveGpa" | "competitiveMcat", bounds: readonly [number, number]): EstimatedScore | undefined => {
    const raw = value[key];
    if (raw === undefined) return undefined;
    const number = isRecord(raw) ? plausible(raw.value, bounds) : undefined;
    if (!isRecord(raw) || number === undefined || !isNonEmptyString(raw.basis)) { dropped.push(key); return undefined; }
    // Derived flags can only make an estimate more cautious, never less.
    return { value: number, basis: raw.basis, floorBased: raw.floorBased === true || /floor|minimum/i.test(raw.basis),
      peerFallback: raw.peerFallback === true || /PEER_FALLBACK/i.test(raw.basis) };
  };
  const competitiveGpa = score("competitiveGpa", PLAUSIBLE.gpa);
  const competitiveMcat = score("competitiveMcat", PLAUSIBLE.mcat);
  let indexScore: SchoolEstimates["indexScore"];
  if (value.indexScore !== undefined) {
    const number = isRecord(value.indexScore) ? plausible(value.indexScore.value, PLAUSIBLE.index) : undefined;
    if (number === undefined) dropped.push("indexScore");
    else indexScore = { value: number, ...(stringValue(value.indexScore.interpretation) && { interpretation: stringValue(value.indexScore.interpretation) }) };
  }
  const hours: SchoolEstimates["hours"] = {};
  const rawHours = isRecord(value.hours) ? value.hours : {};
  if (value.hours !== undefined && !isRecord(value.hours)) dropped.push("hours");
  for (const key of Object.keys(rawHours)) if (!ACTIVITIES.includes(key as EstimateActivity)) dropped.push(`hours.${key}`);
  for (const activity of ACTIVITIES) {
    const raw = rawHours[activity];
    if (raw === undefined) continue;
    if (!isRecord(raw) || !isNonEmptyString(raw.text)) { dropped.push(`hours.${activity}`); continue; }
    const min = raw.min === undefined ? undefined : plausible(raw.min, PLAUSIBLE.hours);
    const max = raw.max === undefined ? undefined : plausible(raw.max, PLAUSIBLE.hours);
    const valid = (raw.min === undefined || min !== undefined) && (raw.max === undefined || max !== undefined) && (min === undefined || max === undefined || min <= max);
    if (!valid) dropped.push(`hours.${activity}`);
    hours[activity] = { text: raw.text, ...(valid && min !== undefined && { min }), ...(valid && max !== undefined && { max }), ...(valid && raw.openEnded === true && { openEnded: true }) };
  }
  if (dropped.length) warn("estimates", `Implausible estimate values were dropped: ${dropped.join(", ")}.`);
  return {
    ...(stringValue(value.tier) && { tier: stringValue(value.tier) }),
    ...(stringValue(value.tierRationale) && { tierRationale: stringValue(value.tierRationale) }),
    ...(competitiveGpa && { competitiveGpa }), ...(competitiveMcat && { competitiveMcat }), ...(indexScore && { indexScore }),
    hours,
    confidence: CONFIDENCE.has(value.confidence) ? value.confidence : "unknown",
    disclaimer: value.disclaimer,
    ...(stringValue(value.sourcesReferenced) && { sourcesReferenced: stringValue(value.sourcesReferenced) }),
    estimatedAt: value.estimatedAt,
  };
}

function normalizeRiskFlag(value: unknown, now: Date, warn: (field: string, message: string) => void): SchoolRiskFlag | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isNonEmptyString(value.tier) || !isHttpUrl(value.url) || !isPastTimestamp(value.capturedAt, now)) {
    warn("riskFlag", "Risk flag with an unsafe link or invalid date was dropped.");
    return undefined;
  }
  return { tier: value.tier, ...(stringValue(value.notes) && { notes: stringValue(value.notes) }), url: value.url, capturedAt: value.capturedAt,
    captureStatus: value.captureStatus === "official-capture" ? "official-capture" : "unverified-capture" };
}

function mergeSchool(base: ApplicationSchool, incoming: ApplicationSchool): ApplicationSchool {
  const next = cloneSchool(base);
  // Review-queue conflicts exported with either run stay visible; incoming wording wins for the same key.
  const conflicts = { ...(base.conflicts ?? {}), ...(incoming.conflicts ?? {}) };
  for (const field of MATERIAL_FIELDS) {
    const existing = next[field];
    const candidate = incoming[field];
    if (isMissingField(candidate)) continue;
    if (isMissingField(existing)) {
      (next as unknown as Record<string, unknown>)[field] = candidate;
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
      conflicts[field] = { existing: JSON.stringify(existing), incoming: JSON.stringify(candidate) };
    }
  }
  next.sources = dedupeSources([...next.sources, ...incoming.sources]);
  next.fieldProvenance = mergeProvenance(next.fieldProvenance, incoming.fieldProvenance);
  next.conflicts = Object.keys(conflicts).length ? conflicts : undefined;
  if (next.conflicts) next.verificationStatus = "conflicting";
  else if (next.verificationStatus !== "verified" && incoming.verificationStatus === "verified") next.verificationStatus = "verified";
  next.updatedAt = newerDate(base.updatedAt, incoming.updatedAt);
  // Older runs (e.g. phase1-research-adapter-v1) still carry facts the current adapter excludes as third-party.
  const facts = new Map((base.researchFacts ?? []).filter(isInstitutionalFact).map(fact => [fact.id, fact]));
  for (const fact of (incoming.researchFacts ?? []).filter(isInstitutionalFact)) {
    const existing = facts.get(fact.id);
    if (!existing) facts.set(fact.id, fact);
    else if (existing.value !== fact.value) {
      next.conflicts = { ...next.conflicts, [fact.id]: { existing: existing.value, incoming: fact.value } };
      next.verificationStatus = "conflicting";
    } else if (fact.capturedAt > existing.capturedAt) facts.set(fact.id, fact);
  }
  next.researchFacts = [...facts.values()];
  // Statistics, estimates and risk flags are context, so a refresh replaces them without flipping verification status.
  const stats = new Map((base.reportedStats ?? []).map(stat => [stat.id, stat]));
  for (const stat of incoming.reportedStats ?? []) if (!stats.has(stat.id) || notOlder(stat.capturedAt, stats.get(stat.id)!.capturedAt)) stats.set(stat.id, stat);
  next.reportedStats = stats.size ? [...stats.values()] : undefined;
  next.estimates = newerRecord(base.estimates, incoming.estimates, estimates => estimates.estimatedAt);
  next.riskFlag = newerRecord(base.riskFlag, incoming.riskFlag, flag => flag.capturedAt);
  return next;
}

/** Compare two dataset runs by school ID (canonical-name fallback, like merge) without mutating either. */
export function diffApplicationSchoolDatasets(base: ApplicationSchoolDataset, incoming: ApplicationSchoolDataset): ApplicationSchoolDatasetDiff {
  const baseById = new Map(base.schools.map(school => [school.id, school]));
  const byCanonical = new Map(base.schools.map(school => [normalizeName(school.canonicalName), school.id]));
  const matched = new Set<string>();
  const diff: ApplicationSchoolDatasetDiff = { addedSchools: [], removedSchools: [], changedFacts: [], addedFacts: [], removedFacts: [], estimateChanges: [], statChanges: [], reviewChecksReopened: 0 };
  for (const candidate of incoming.schools) {
    const schoolId = baseById.has(candidate.id) ? candidate.id : byCanonical.get(normalizeName(candidate.canonicalName));
    if (!schoolId || matched.has(schoolId)) { diff.addedSchools.push(candidate.id); continue; }
    matched.add(schoolId);
    const previous = baseById.get(schoolId)!;
    const before = new Map((previous.researchFacts ?? []).map(fact => [fact.id, fact]));
    const after = new Map((candidate.researchFacts ?? []).map(fact => [fact.id, fact]));
    for (const [factId, fact] of after) {
      const old = before.get(factId);
      if (!old) { diff.addedFacts.push({ schoolId, factId }); continue; }
      const fields = FACT_FIELDS.filter(field => old[field] !== fact[field]);
      if (fields.length) diff.changedFacts.push({ schoolId, factId, fields, before: old, after: fact });
    }
    for (const factId of before.keys()) if (!after.has(factId)) diff.removedFacts.push({ schoolId, factId });
    if (JSON.stringify(previous.estimates ?? null) !== JSON.stringify(candidate.estimates ?? null)) diff.estimateChanges.push(schoolId);
    const statsBefore = new Map((previous.reportedStats ?? []).map(stat => [stat.id, stat]));
    const statsAfter = new Map((candidate.reportedStats ?? []).map(stat => [stat.id, stat]));
    for (const [statId, stat] of statsAfter) {
      const old = statsBefore.get(statId);
      if (!old) { diff.statChanges.push({ schoolId, statId, change: "added", fields: [] }); continue; }
      const fields = STAT_FIELDS.filter(field => old[field] !== stat[field]);
      if (fields.length) diff.statChanges.push({ schoolId, statId, change: "changed", fields });
    }
    for (const statId of statsBefore.keys()) if (!statsAfter.has(statId)) diff.statChanges.push({ schoolId, statId, change: "removed", fields: [] });
  }
  diff.removedSchools = base.schools.filter(school => !matched.has(school.id)).map(school => school.id);
  diff.reviewChecksReopened = diff.changedFacts.filter(change => researchFactRevision(change.before) !== researchFactRevision(change.after)).length;
  return diff;
}

/** Text that names a third party or aggregator is not institutional evidence and never survives a merge. */
function isInstitutionalFact(fact: SchoolResearchFact) { return !THIRD_PARTY_TEXT.test(fact.value); }
function cloneSchool(school: ApplicationSchool): ApplicationSchool { return JSON.parse(JSON.stringify(school)) as ApplicationSchool; }
function mergeProvenance(base: ApplicationSchool["fieldProvenance"], incoming: ApplicationSchool["fieldProvenance"]) {
  if (!base && !incoming) return undefined;
  const result: Record<string, ApplicationSchoolSource[]> = {};
  for (const [field, sources] of Object.entries(base ?? {})) result[field] = dedupeSources(sources);
  for (const [field, sources] of Object.entries(incoming ?? {})) result[field] = dedupeSources([...(result[field] ?? []), ...sources]);
  return result;
}
function dedupeSources(sources: ApplicationSchoolSource[]) { return [...new Map(sources.map((source) => [`${source.url}|${source.retrievedAt}`, source])).values()]; }
function newerDate(a?: string, b?: string) { return !a ? b : !b ? a : a > b ? a : b; }
/** Ties go to the incoming run: a same-day re-run is a correction. */
function notOlder(incoming: string, existing: string) { return Date.parse(incoming) >= Date.parse(existing); }
function newerRecord<T>(base: T | undefined, incoming: T | undefined, date: (value: T) => string) { return !base ? incoming : !incoming ? base : notOlder(date(incoming), date(base)) ? incoming : base; }
function plausible(value: unknown, [min, max]: readonly [number, number]) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined; }
function isPastTimestamp(value: unknown, now: Date): value is string { return isNonEmptyString(value) && isValidTimestamp(value) && Date.parse(value) <= now.getTime(); }
function isMissingField(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && /^(unknown|not reported|not-reported|tbd)$/i.test(value.trim());
}
function fieldProvenance(value: unknown): Record<string, ApplicationSchoolSource[]> | undefined { return isRecord(value) ? value as Record<string, ApplicationSchoolSource[]> : undefined; }
function conflictsValue(value: unknown): Record<string, ApplicationSchoolConflict> | undefined { return isRecord(value) ? value as Record<string, ApplicationSchoolConflict> : undefined; }
function normalizeName(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function stringValue(value: unknown): string | undefined { return isNonEmptyString(value) ? value.trim() : undefined; }
function stringArray(value: unknown): string[] | undefined { if (!Array.isArray(value)) return undefined; const values = value.filter(isNonEmptyString).map((entry) => entry.trim()); return values.length ? values : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isValidTimestamp(value: string) { return !Number.isNaN(Date.parse(value)) && /T\d{2}:\d{2}/.test(value); }
function isPlausibleDeadline(value: string) { return /rolling|unknown|tbd|not applicable|n\/a/i.test(value) || !Number.isNaN(Date.parse(value)); }
function isHttpUrl(value: unknown): value is string { if (!isNonEmptyString(value)) return false; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function issue(path: string, message: string, severity: DatasetIssueSeverity = "error"): DatasetIssue { return { path, message, severity }; }
