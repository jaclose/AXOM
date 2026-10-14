import type { CurriculumTemplate } from "../curricula";
import type { CurriculumCoverage } from "./curriculumCoverage";
import { canonicalModuleKey } from "./vocabulary";

/**
 * Metadata-only curriculum skeleton for permissioned exchange.
 *
 * This contains only the built-in course outline and numerical coverage
 * summaries. It MUST NOT contain uploaded lecture titles, source files,
 * question stems/keys, personal notes, student progress, or user identifiers.
 * Creating this manifest neither publishes anything nor establishes rights.
 */
export interface AcademicTemplateCatalog {
  format: "axom-academic-template-catalog";
  version: 1;
  curriculumId: string;
  curriculumLabel: string;
  distribution: {
    intendedAudience: "authorized-students";
    publicationStatus: "not-published";
    rightsStatus: "not-verified";
    sharingPolicy: "license-and-access-review-required";
    includesSourceDocuments: false;
    includesQuestionContent: false;
    includesUserProgress: false;
  };
  terms: Array<{
    name: string;
    courses: Array<{
      code: string;
      name: string;
      modules: Array<{
        key: string;
        name: string;
        evidence: "private-template-present" | "outline-only";
        savedTemplateFiles: number;
        knownTemplateActivityRows: number;
        expectedOfficialActivityRows: null;
        /** Week numbers explicitly stated in locally saved template rows. */
        sourceStatedWeeks: number[];
        /** Week numbers assigned by a heuristic, never officially verified. */
        provisionalWeeks: number[];
        unresolvedActivityRows: number;
      }>;
    }>;
  }>;
}

const termIdentity = (term: string): string => {
  const match = term.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : term.trim().toLowerCase();
};
const courseKey = (code: string) => code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export function buildAcademicTemplateCatalog(
  curriculum: CurriculumTemplate, coverage: CurriculumCoverage,
): AcademicTemplateCatalog {
  // Fail closed if the manifest builder received a coverage audit for another
  // outline. An unverified/incomplete school catalogue must remain honest.
  const schoolTerms = curriculum.terms.filter((term) => /^Term\s+[1-5]$/i.test(term.name));
  const expectedModules = schoolTerms.reduce((count, term) =>
    count + term.courses.reduce((sum, course) => sum + course.modules.length, 0), 0);
  if (expectedModules !== coverage.totalModules
    || schoolTerms.length !== coverage.terms.length) {
    throw new Error("Curriculum coverage does not match this academic outline.");
  }

  return {
    format: "axom-academic-template-catalog",
    version: 1,
    curriculumId: curriculum.id,
    curriculumLabel: curriculum.label,
    distribution: {
      intendedAudience: "authorized-students",
      publicationStatus: "not-published",
      rightsStatus: "not-verified",
      sharingPolicy: "license-and-access-review-required",
      includesSourceDocuments: false,
      includesQuestionContent: false,
      includesUserProgress: false,
    },
    terms: schoolTerms.map((term) => {
      const coveredTerm = coverage.terms.find((candidate) =>
        termIdentity(candidate.term) === termIdentity(term.name));
      return {
        name: term.name,
        courses: term.courses.map((course) => ({
          code: course.code,
          name: course.name,
          modules: course.modules.map((module) => {
            const covered = coveredTerm?.modules.find((candidate) =>
              courseKey(candidate.courseCode) === courseKey(course.code)
              && canonicalModuleKey(candidate.module) === canonicalModuleKey(module));
            return {
              key: `${termIdentity(term.name)}/${courseKey(course.code)}/${canonicalModuleKey(module)}`,
              name: module,
              evidence: covered?.templateFiles ? "private-template-present" as const : "outline-only" as const,
              savedTemplateFiles: covered?.templateFiles ?? 0,
              knownTemplateActivityRows: covered?.availableTemplateItems ?? 0,
              expectedOfficialActivityRows: null,
              sourceStatedWeeks: covered?.statedWeeks ?? [],
              provisionalWeeks: covered?.inferredWeeks ?? [],
              unresolvedActivityRows: covered?.unscheduledItems ?? 0,
            };
          }),
        })),
      };
    }),
  };
}
