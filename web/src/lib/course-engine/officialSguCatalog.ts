import type { CurriculumTemplate } from "../curricula";
import type { Course, Term } from "../types";
import { canonicalModuleKey } from "./vocabulary";

/**
 * Metadata from SGU's publicly available course descriptions, checked
 * 2026-10-14. Durations are official OVERVIEW information; sequential module
 * offsets are derived, NOT an authoritative cohort timetable or dated event.
 * This read-only evidence must never rename an existing student's records.
 */
export interface OfficialSguModuleEvidence {
  code: string;
  fullName: string;
  durationWeeks: number;
  /** Derived from module order + duration; never auto-install schedule rows. */
  derivedWeekStart: number;
  derivedWeekEnd: number;
  matchedAXOMModule?: string;
  moduleMapping: "exact" | "review-required";
}
export interface OfficialSguCourseEvidence {
  term: "Term 4" | "Term 5";
  officialCourseCode: "PCM 500" | "PCM 501";
  appOutlineCourseCodes: string[];
  savedWorkspaceCourseCodes: string[];
  totalWeeks: number;
  effectiveFrom: "Fall 2025";
  reviewedAsOf: "2026-10-14";
  officialCatalogUrl: string;
  modules: OfficialSguModuleEvidence[];
  /** The present AXOM outline uses PPM500/501 and a Term5 NMI spelling. */
  migrationReviewRequired: boolean;
  note: string;
}
const DEFINITIONS = [
  {
    term: "Term 4" as const, officialCourseCode: "PCM 500" as const,
    totalWeeks: 20, officialCatalogUrl: "https://catalog.sgu.edu/principles-of-clinical-medicine/pcm-500",
    modules: [
      { code: "FTCM", fullName: "Foundations to Clinical Medicine", durationWeeks: 4 },
      { code: "NCRS", fullName: "Neurological, Cardiovascular, and Renal Systems", durationWeeks: 6 },
      { code: "RHPS", fullName: "Respiratory, Hematopoietic, and Pediatric Systems", durationWeeks: 4 },
      { code: "DERS", fullName: "Digestive, Endocrine, and Reproductive Systems", durationWeeks: 6 },
    ],
  },
  {
    term: "Term 5" as const, officialCourseCode: "PCM 501" as const,
    totalWeeks: 16, officialCatalogUrl: "https://catalog.sgu.edu/principles-of-clinical-medicine/pcm-501",
    modules: [
      { code: "MI", fullName: "Musculoskeletal and Infections", durationWeeks: 4 },
      { code: "CPRH", fullName: "Cardiology, Pulmonary, Renal, and Hematology", durationWeeks: 4 },
      { code: "GOER", fullName: "Gastroenterology, Obstetrics, Endocrine, and Reproductive", durationWeeks: 4 },
      { code: "DNPR", fullName: "Dermatology, Neurology, Psychiatry, and Rheumatology", durationWeeks: 4 },
    ],
  },
] as const;

const termKey = (term: string): string => {
  const match = term.match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : term.toLowerCase().replace(/[^a-z0-9]+/g, "");
};
const courseKey = (code: string): string => code.replace(/^\d{1,2}\s+(?=[a-z])/i, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "");

export function officialSguClinicalCourseEvidence(
  curriculum: CurriculumTemplate,
  workspace: { terms: readonly Term[]; courses: readonly Course[] },
): OfficialSguCourseEvidence[] {
  return DEFINITIONS.map((definition) => {
    const outline = curriculum.terms.find((term) => termKey(term.name) === termKey(definition.term));
    const outlineModules = outline?.courses.flatMap((course) => course.modules) ?? [];
    const appOutlineCourseCodes = outline?.courses.map((course) => course.code) ?? [];
    const termIds = new Set(workspace.terms.filter((term) => termKey(term.name) === termKey(definition.term)).map((term) => term.id));
    const savedWorkspaceCourseCodes = [...new Set(workspace.courses.filter((course) => termIds.has(course.termId)).map((course) => course.code))];
    let cumulative = 0;
    const modules: OfficialSguModuleEvidence[] = definition.modules.map((source) => {
      const first = cumulative + 1;
      cumulative += source.durationWeeks;
      const matches = outlineModules.filter((module) => canonicalModuleKey(module) === canonicalModuleKey(source.code));
      return {
        ...source, derivedWeekStart: first, derivedWeekEnd: cumulative,
        ...(matches.length === 1 ? { matchedAXOMModule: matches[0] } : {}),
        moduleMapping: matches.length === 1 ? "exact" as const : "review-required" as const,
      };
    });
    if (cumulative !== definition.totalWeeks) throw new Error("SGU catalog outline durations do not conserve the published total.");
    const codeMatches = appOutlineCourseCodes.length === 1
      && courseKey(appOutlineCourseCodes[0]) === courseKey(definition.officialCourseCode);
    return {
      term: definition.term,
      officialCourseCode: definition.officialCourseCode,
      appOutlineCourseCodes,
      savedWorkspaceCourseCodes,
      totalWeeks: definition.totalWeeks,
      effectiveFrom: "Fall 2025" as const,
      reviewedAsOf: "2026-10-14" as const,
      officialCatalogUrl: definition.officialCatalogUrl,
      modules,
      migrationReviewRequired: !codeMatches || modules.some((entry) => entry.moduleMapping !== "exact")
        || savedWorkspaceCourseCodes.some((entry) => courseKey(entry) !== courseKey(definition.officialCourseCode)),
      note: "Published course durations only. Derived module windows are sequence estimates, not verified activity lists, exact term-week positions, dates, enrollment, or cloud receipts.",
    };
  });
}
