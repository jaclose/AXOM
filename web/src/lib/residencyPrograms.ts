/**
 * Residency (GME) program dataset for the Application Checker.
 *
 * Identity comes from the ACGME public program listing (10-digit ProgramCode,
 * specialty, sponsor, location, accreditation status, length of training,
 * positions filled). Everything that the listing does NOT contain — Step
 * minimums, visa sponsorship, signals, graduation-year limits — stays
 * "Unknown" until a sourced capture supplies it. Nothing here predicts match
 * outcomes. Pure module: shared by the app and the Node import pipeline.
 */

export const RESIDENCY_DATASET_SCHEMA_VERSION = 1;
export const UNKNOWN = "Unknown";

export type ResidencyVerification = "official-listing" | "partial" | "verified" | "conflicting";

export interface ResidencySource {
  url: string;
  title?: string;
  retrievedAt: string;
}

export interface ResidencyRequirements {
  step2Minimum: string;
  comlexAccepted: string;
  visaSponsorship: string;
  yearsSinceGraduation: string;
  signals: string;
}

export interface ResidencyProgram {
  id: string;
  acgmeProgramId: string;
  programName: string;
  specialty: string;
  specialtyCode?: string;
  isSubspecialty: boolean;
  sponsorName?: string;
  sponsorCode?: string;
  city?: string;
  state?: string;
  accreditationStatus?: string;
  trainingYears?: number;
  positionsFilled?: number;
  academicYear?: string;
  website?: string;
  requirements: ResidencyRequirements;
  verification: ResidencyVerification;
  sources: ResidencySource[];
}

export interface ResidencyDataset {
  schemaVersion: 1;
  pathway: "residency";
  generatedAt: string;
  academicYear?: string;
  recordCount: number;
  programs: ResidencyProgram[];
}

export interface ResidencyIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export type ResidencyParseResult =
  | { ok: true; dataset: ResidencyDataset; issues: ResidencyIssue[] }
  | { ok: false; issues: ResidencyIssue[] };

const VERIFICATIONS = new Set<ResidencyVerification>(["official-listing", "partial", "verified", "conflicting"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 200): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function integer(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

/** Zero-pad numeric codes the way ACGME publishes them (spreadsheets drop leading zeros). */
export function padCode(value: unknown, width: number): string | undefined {
  const raw = text(value, 40)?.replace(/\.0+$/, "");
  if (!raw || !/^\d+$/.test(raw) || raw.length > width) return undefined;
  return raw.padStart(width, "0");
}

function validSource(value: unknown, now: number): ResidencySource | undefined {
  const source = record(value);
  const url = text(source.url, 600);
  const retrievedAt = text(source.retrievedAt, 40);
  if (!url || !/^https?:\/\//i.test(url) || !retrievedAt) return undefined;
  const time = Date.parse(retrievedAt);
  if (!Number.isFinite(time) || time > now + 86_400_000) return undefined;
  return { url, title: text(source.title, 160), retrievedAt };
}

function requirements(value: unknown): ResidencyRequirements {
  const raw = record(value);
  const field = (key: keyof ResidencyRequirements) => text(raw[key], 200) ?? UNKNOWN;
  return {
    step2Minimum: field("step2Minimum"),
    comlexAccepted: field("comlexAccepted"),
    visaSponsorship: field("visaSponsorship"),
    yearsSinceGraduation: field("yearsSinceGraduation"),
    signals: field("signals"),
  };
}

export function parseResidencyDataset(value: unknown, now: Date = new Date()): ResidencyParseResult {
  const issues: ResidencyIssue[] = [];
  const envelope = record(value);
  if (envelope.schemaVersion !== RESIDENCY_DATASET_SCHEMA_VERSION) {
    return { ok: false, issues: [{ severity: "error", path: "schemaVersion", message: "Unsupported residency dataset version." }] };
  }
  if (!Array.isArray(envelope.programs)) {
    return { ok: false, issues: [{ severity: "error", path: "programs", message: "Residency dataset has no programs array." }] };
  }
  const seen = new Set<string>();
  const programs: ResidencyProgram[] = [];
  envelope.programs.forEach((candidate, index) => {
    const raw = record(candidate);
    const path = `programs[${index}]`;
    const acgmeProgramId = padCode(raw.acgmeProgramId, 10);
    const programName = text(raw.programName);
    const specialty = text(raw.specialty, 120);
    if (!acgmeProgramId || !programName || !specialty) {
      issues.push({ severity: "error", path, message: "Program needs a 10-digit ACGME program code, a name, and a specialty; row skipped." });
      return;
    }
    const id = `acgme-${acgmeProgramId}`;
    if (seen.has(id)) {
      issues.push({ severity: "warning", path, message: `Duplicate ACGME program ${acgmeProgramId}; later row skipped.` });
      return;
    }
    const sources = (Array.isArray(raw.sources) ? raw.sources : []).map((source) => validSource(source, now.getTime())).filter((source): source is ResidencySource => Boolean(source));
    if (!sources.length) {
      issues.push({ severity: "error", path, message: "Program has no valid source with a retrieval date; row skipped." });
      return;
    }
    seen.add(id);
    const verification = VERIFICATIONS.has(raw.verification as ResidencyVerification) ? raw.verification as ResidencyVerification : "official-listing";
    const website = text(raw.website, 600);
    programs.push({
      id,
      acgmeProgramId,
      programName,
      specialty,
      specialtyCode: padCode(raw.specialtyCode, 3),
      isSubspecialty: raw.isSubspecialty === true,
      sponsorName: text(raw.sponsorName),
      sponsorCode: padCode(raw.sponsorCode, 6),
      city: text(raw.city, 80),
      state: text(raw.state, 80),
      accreditationStatus: text(raw.accreditationStatus, 120),
      trainingYears: integer(raw.trainingYears),
      positionsFilled: integer(raw.positionsFilled),
      academicYear: text(raw.academicYear, 20),
      website: website && /^https?:\/\//i.test(website) ? website : undefined,
      requirements: requirements(raw.requirements),
      verification,
      sources,
    });
  });
  if (typeof envelope.recordCount === "number" && envelope.recordCount !== envelope.programs.length) {
    issues.push({ severity: "warning", path: "recordCount", message: `recordCount ${envelope.recordCount} does not match ${envelope.programs.length} submitted rows.` });
  }
  return {
    ok: true,
    issues,
    dataset: {
      schemaVersion: 1,
      pathway: "residency",
      generatedAt: text(envelope.generatedAt, 40) ?? now.toISOString(),
      academicYear: text(envelope.academicYear, 20),
      recordCount: programs.length,
      programs,
    },
  };
}

/**
 * Convert rows from ACGME's "ProgramListingAY…" file (header names per the
 * ACGME Data Resources dictionary) into dataset programs. Requirement fields
 * start as "Unknown": the listing does not contain them.
 */
export function programsFromAcgmeRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  source: ResidencySource,
): { programs: ResidencyProgram[]; skipped: number } {
  const programs: ResidencyProgram[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const get = (key: string) => {
      const match = Object.keys(row).find((header) => header.replace(/\s+/g, "").toLowerCase() === key.toLowerCase());
      return match ? row[match] : undefined;
    };
    const acgmeProgramId = padCode(get("ProgramCode"), 10);
    const programName = text(get("ProgramName"));
    const specialty = text(get("SpecialtyName"), 120);
    if (!acgmeProgramId || !programName || !specialty || seen.has(acgmeProgramId)) {
      skipped += 1;
      continue;
    }
    seen.add(acgmeProgramId);
    const subspecialty = text(get("IsSubspecialty"), 5);
    programs.push({
      id: `acgme-${acgmeProgramId}`,
      acgmeProgramId,
      programName,
      specialty,
      specialtyCode: padCode(get("SpecialtyNumericCode"), 3),
      isSubspecialty: subspecialty === "1" || subspecialty?.toLowerCase() === "true",
      sponsorName: text(get("SponsorName")),
      sponsorCode: padCode(get("SponsorCode"), 6),
      city: text(get("ProgramCity"), 80),
      state: text(get("ProgramStateName"), 80),
      accreditationStatus: text(get("ProgramAccreditationName"), 120),
      trainingYears: integer(get("ProgramLengthofTraining")),
      positionsFilled: integer(get("PositionsFilledTotal")),
      academicYear: text(get("AcademicYearRange"), 20),
      requirements: requirements({}),
      verification: "official-listing",
      sources: [source],
    });
  }
  return { programs, skipped };
}

export function buildResidencyDataset(programs: ResidencyProgram[], generatedAt: string): ResidencyDataset {
  const years = [...new Set(programs.map((program) => program.academicYear).filter(Boolean))];
  return {
    schemaVersion: 1,
    pathway: "residency",
    generatedAt,
    academicYear: years.length === 1 ? years[0] : undefined,
    recordCount: programs.length,
    programs: [...programs].sort((a, b) => a.specialty.localeCompare(b.specialty) || a.programName.localeCompare(b.programName)),
  };
}

export interface ResidencyFilters {
  query: string;
  specialty: string;
  state: string;
  coreOnly: boolean;
  savedIds?: ReadonlySet<string>;
}

export function filterResidencyPrograms(programs: readonly ResidencyProgram[], filters: ResidencyFilters): ResidencyProgram[] {
  const needle = filters.query.trim().toLowerCase();
  return programs.filter((program) => (
    (!filters.coreOnly || !program.isSubspecialty)
    && (!filters.specialty || program.specialty === filters.specialty)
    && (!filters.state || program.state === filters.state)
    && (!filters.savedIds || filters.savedIds.has(program.id))
    && (!needle || [program.programName, program.sponsorName, program.city, program.state, program.specialty, program.acgmeProgramId]
      .some((value) => value?.toLowerCase().includes(needle)))
  ));
}
