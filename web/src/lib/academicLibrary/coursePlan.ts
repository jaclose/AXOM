import { parseCourseTemplate, type CourseTemplateSection } from "../course-engine/templateParse";
import { canonicalModuleKey } from "../course-engine/vocabulary";
import type { ReviewedFiling } from "../privateLibrary/types";

/**
 * One academic collection holds every reviewed plan section of one module
 * (for example "Lectures + DLAs" and "Small groups"). The revision's
 * template_text keeps each section's exact text, joined by a line that no
 * valid section can contain: a line starting with "@" must be known source
 * metadata, and a section with any unread line is never uploaded. A course
 * with one section stays byte-identical to its template file, and each
 * section keeps the content-addressed identity of its saved template.
 */
export const ACADEMIC_PLAN_SECTION_BREAK = "\n@@ AXOM course plan section @@\n";
/** academic_revisions.template_text limit. */
export const MAX_ACADEMIC_PLAN_BYTES = 262_144;

/** A reviewer's confirmation of the term for plan sections that do not state one. */
export interface AcademicPlanTerm {
  term: ReviewedFiling["term"];
  evidence: "human-reviewed";
}

/** No plan section states the term and no reviewer confirmed one. Callers may
 * ask a reviewer for the term and prepare the course again with it. */
export class AcademicPlanTermRequiredError extends Error {
  /** The module label of the plan's first section. */
  readonly module: string;
  constructor(module: string) {
    super("This course plan does not name its term. Confirm its term, or start its first line with the term, for example \"T1 - FTM 1 - Lectures\".");
    this.name = "AcademicPlanTermRequiredError";
    this.module = module;
  }
}

export interface AcademicCoursePlan {
  term: ReviewedFiling["term"];
  /** The first section's spelling; every section shares its canonical key. */
  module: string;
  sections: CourseTemplateSection[];
  /** Exact revision text for template_text. */
  text: string;
  /** False when no section names the term and a reviewer confirmed it. */
  termStated: boolean;
  academicTerm?: string;
  cohort?: string;
  /** The latest source revision any section declares. */
  sourceRevision?: string;
}

export function reviewedTermNumber(term: string | undefined): number | undefined {
  const match = term?.match(/^Term ([1-5])$/);
  return match ? Number(match[1]) : undefined;
}

/** Canonical module identity for a reviewed label, or undefined when the label is unsafe. */
export function moduleIdentity(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const module = value.trim();
  if (!module || module.length > 80 || /[/\\]/.test(module)
    || [...module].some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || code === 0x2028 || code === 0x2029;
    })) return undefined;
  const identity = canonicalModuleKey(module);
  return identity || undefined;
}

export function joinAcademicPlanSections(texts: readonly string[]): string {
  if (!texts.length) throw new Error("A course plan needs at least one section.");
  return texts.join(ACADEMIC_PLAN_SECTION_BREAK);
}

export function splitAcademicPlanSections(text: string): string[] {
  return text.split(ACADEMIC_PLAN_SECTION_BREAK);
}

/**
 * Validate the sections of one course and derive its classification. Throws
 * with a reviewer-facing reason; nothing is guessed. Sections must agree on
 * module, any stated term, academic term and cohort, and two sections may
 * not share a title (they would be versions of one section).
 */
export function academicCoursePlan(texts: readonly string[], confirmed?: AcademicPlanTerm): AcademicCoursePlan {
  if (!texts.length) throw new Error("A course plan needs at least one section.");
  const sections = texts.map(text => parseCourseTemplate(text));
  for (const section of sections) {
    if (section.problems.length || !section.items.length || !moduleIdentity(section.module))
      throw new Error("Review the course plan: every section needs a module heading and readable activities before uploading.");
  }
  const module = moduleIdentity(sections[0].module);
  if (sections.some(section => moduleIdentity(section.module) !== module))
    throw new Error("These course plan sections name different modules. Publish one module per course.");
  const stated = [...new Set(sections.flatMap(section => section.term === undefined ? [] : [section.term]))];
  if (stated.some(term => !reviewedTermNumber(term)) || stated.length > 1)
    throw new Error("The course plan sections state different or unsupported terms. Each course needs one Term 1-5.");
  if (confirmed && (confirmed.evidence !== "human-reviewed" || !reviewedTermNumber(confirmed.term)))
    throw new Error("A confirmed course term must be a reviewed Term 1-5.");
  if (stated.length && confirmed && confirmed.term !== stated[0])
    throw new Error(`The course plan states ${stated[0]}, which differs from the confirmed ${confirmed.term}.`);
  const term = (stated[0] ?? confirmed?.term) as ReviewedFiling["term"] | undefined;
  if (!term) throw new AcademicPlanTermRequiredError(sections[0].module.trim());
  const value = (pick: (section: CourseTemplateSection) => string | undefined) => new Set(sections.map(pick));
  const academicTerms = value(section => section.context?.academicTerm);
  const cohorts = value(section => section.context?.cohort);
  if (academicTerms.size > 1 || cohorts.size > 1)
    throw new Error("The course plan sections disagree about their academic term or cohort. Align their @academic-term and @cohort lines.");
  const titles = sections.map(section => section.title.trim().toLocaleLowerCase("en"));
  if (new Set(titles).size !== titles.length)
    throw new Error("Two course plan sections share a title, so they look like versions of one section. Keep the current version only.");
  const text = joinAcademicPlanSections(texts);
  if (new TextEncoder().encode(text).length > MAX_ACADEMIC_PLAN_BYTES)
    throw new Error("This course plan is larger than 256 KB. Split it into separate courses.");
  const revisions = sections.flatMap(section => section.context?.sourceRevision ? [section.context.sourceRevision] : []).sort();
  const academicTerm = [...academicTerms][0];
  const cohort = [...cohorts][0];
  return {
    term, module: sections[0].module, sections, text, termStated: stated.length > 0,
    ...(academicTerm !== undefined ? { academicTerm } : {}),
    ...(cohort !== undefined ? { cohort } : {}),
    ...(revisions.length ? { sourceRevision: revisions.at(-1) } : {}),
  };
}
