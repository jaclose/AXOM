import type { CurriculumTemplate } from "../curricula";
import type { SourceDocument } from "../library";
import type { TrackerItem } from "../types";
import { buildQuestionAvailabilityIndex, questionAvailabilityModuleKey, type QuestionAvailabilityInput } from "./moduleQuestionAvailability";
import { courseTemplateVersions, savedCourseTemplates } from "./templateLibrary";
import { normalizedTemplateIdentity, planCourseTemplate, type CourseTemplateSection } from "./templateParse";
import { canonicalModuleKey } from "./vocabulary";

export interface CurriculumModuleCoverage {
  term: string;
  courseCode: string;
  courseName: string;
  module: string;
  templateFiles: number;
  /** Rows present in the saved, current version of this module's templates. */
  availableTemplateItems: number;
  /** Rows from saved templates represented in the tracker's current state. */
  installedTemplateItems: number;
  /** Available template rows not found in the tracker (not all expected school tasks). */
  notInstalled: number;
  installedRows: number;
  duplicateRows: number;
  /** Explicitly stated week numbers; not proof that the source is authoritative. */
  statedWeeks: number[];
  inferredWeeks: number[];
  unscheduledItems: number;
  sourceProblems: string[];
  /** Only on-device question records and saved sets; not claims of source-original availability. */
  questionCollections: number;
  storedQuestions: number;
  readyQuestions: number;
  reviewQuestions: number;
  missingQuestionReferences: number;
  indexedQuestionWeeks: number[];
  unresolvedQuestionWeeks: number;
  /** Term/module was identified by a unique course-outline match, not official registration. */
  mapping: "outline-match" | "ambiguous" | "no-template";
}

export interface CurriculumTermCoverage {
  term: string;
  modules: CurriculumModuleCoverage[];
  modulesWithTemplates: number;
  sourceItems: number;
  installedTemplateItems: number;
  notInstalled: number;
  inferredWeeks: number;
  questionCollections: number;
  readyQuestions: number;
  unresolvedQuestionWeeks: number;
}

export interface CurriculumCoverage {
  terms: CurriculumTermCoverage[];
  totalModules: number;
  modulesWithTemplates: number;
  sourceTemplateFiles: number;
  sourceItems: number;
  installedTemplateItems: number;
  notInstalled: number;
  installedRows: number;
  /** Student-owned or ambiguously filed tracker rows not attributable to any unique SGU module. */
  unmappedTrackerRows: number;
  unmappedTemplateModules: string[];
  unassignedQuestionCollections: number;
  unassignedQuestions: number;
}

const normalizedTerm = (term: string): string => {
  const match = term.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : term.trim().toLowerCase();
};
const normalizedCourse = (course: string): string =>
  course.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Explicit course paths win. An old Term/Module path is only attributable
 * when exactly one course owns that module in this term. An arbitrary path
 * suffix (Unsorted, Custom, etc.) does not become the module itself.
 */
function belongsToCourse(
  row: TrackerItem, term: CurriculumTemplate["terms"][number],
  courseCode: string, module: string, moduleOwnersInTerm: number,
): boolean {
  const segments = row.path.split("/").map((part) => part.trim()).filter(Boolean);
  if (segments.length < 2 || normalizedTerm(segments[0]) !== normalizedTerm(term.name)) return false;
  const explicitCourse = segments.length >= 3
    ? term.courses.find((course) =>
      normalizedCourse(course.code) === normalizedCourse(segments[1])
      && course.modules.some((known) => canonicalModuleKey(known) === canonicalModuleKey(segments[2])))
    : undefined;
  const rowModule = explicitCourse ? segments[2] : segments[1];
  if (canonicalModuleKey(rowModule) !== canonicalModuleKey(module)) return false;
  return explicitCourse
    ? normalizedCourse(explicitCourse.code) === normalizedCourse(courseCode)
    : moduleOwnersInTerm === 1;
}

/** A read-only audit; this never creates a task or invents a missing lecture. */
export function buildCurriculumCoverage(
  curriculum: CurriculumTemplate,
  documents: readonly SourceDocument[],
  tracker: readonly TrackerItem[],
  questionData?: Omit<QuestionAvailabilityInput, "curriculum">,
): CurriculumCoverage {
  const availability = questionData ? buildQuestionAvailabilityIndex({ curriculum, ...questionData }) : undefined;
  // Only current revisions from the existing document vault count. Historical
  // versions remain accessible but must not inflate a curriculum denominator.
  const active = courseTemplateVersions(savedCourseTemplates(documents)).map((versions) => versions[0]);
  const templateModules = new Map<string, CourseTemplateSection[]>();
  for (const { section } of active) {
    const key = canonicalModuleKey(section.module);
    templateModules.set(key, [...(templateModules.get(key) ?? []), section]);
  }
  const curriculumModules = curriculum.terms
    .filter((term) => /^Term\s+[1-5]$/i.test(term.name))
    .flatMap((term) => term.courses.flatMap((course) => course.modules.map((module) => ({
      term: term.name, course, module, key: canonicalModuleKey(module),
    }))));
  const owners = new Map<string, typeof curriculumModules>();
  for (const entry of curriculumModules) {
    owners.set(entry.key, [...(owners.get(entry.key) ?? []), entry]);
  }
  const mappedTemplateModuleKeys = new Set<string>();
  const accountedTrackerIds = new Set<string>();
  const terms: CurriculumTermCoverage[] = [];

  for (const term of curriculum.terms.filter((entry) => /^Term\s+[1-5]$/i.test(entry.name))) {
    const modules: CurriculumModuleCoverage[] = [];
    for (const course of term.courses) {
      for (const module of course.modules) {
        const key = canonicalModuleKey(module);
        const moduleOwners = owners.get(key) ?? [];
        const termOwners = moduleOwners.filter((entry) =>
          normalizedTerm(entry.term) === normalizedTerm(term.name));
        const sourceSections = templateModules.get(key) ?? [];
        // An undated module-only file is safe to assign only when the outline
        // has one owner. A source with its own explicit term can disambiguate
        // different terms, but not two courses within that same term.
        const sections = sourceSections.filter((section) => termOwners.length === 1
          && (section.term
            ? normalizedTerm(section.term) === normalizedTerm(term.name)
            : moduleOwners.length === 1));
        const ambiguous = sourceSections.length > 0 && sections.length === 0
          && termOwners.length > 0 && moduleOwners.length > 1
          && sourceSections.some((section) => !section.term
            || normalizedTerm(section.term) === normalizedTerm(term.name));
        if (sections.length) mappedTemplateModuleKeys.add(key);
        const plan = sections.length
          ? planCourseTemplate(sections, { term: term.name, course: course.code, moduleName: module })
          : undefined;
        const existing = tracker.filter((row) =>
          belongsToCourse(row, term, course.code, module, termOwners.length));
        for (const row of existing) accountedTrackerIds.add(row.id);
        const indexedQuestions = availability?.byModule.get(
          questionAvailabilityModuleKey(term.name, module, course.code))
          ?? (termOwners.length === 1
            ? availability?.byModule.get(questionAvailabilityModuleKey(term.name, module))
            : undefined);
        const identityModule = plan?.module ?? module;
        const keys = new Set(existing.flatMap((row) => row.templateKey ? [normalizedTemplateIdentity(row.templateKey, identityModule)] : []));
        const places = new Set(existing.map((row) => `${row.path.toLowerCase()}|${row.label.toLowerCase()}`));
        const available = plan?.items ?? [];
        const installedTemplateItems = available.filter((row) =>
          keys.has(normalizedTemplateIdentity(row.templateKey, identityModule)) || places.has(`${row.path.toLowerCase()}|${row.label.toLowerCase()}`)).length;
        const counts = new Map<string, number>();
        for (const row of existing) {
          const identity = row.templateKey ?? `${row.path.toLowerCase()}|${row.label.toLowerCase()}`;
          counts.set(identity, (counts.get(identity) ?? 0) + 1);
        }
        modules.push({
          term: term.name, courseCode: course.code, courseName: course.name, module,
          templateFiles: sections.length,
          availableTemplateItems: available.length,
          installedTemplateItems,
          notInstalled: available.length - installedTemplateItems,
          installedRows: existing.length,
          duplicateRows: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
          statedWeeks: [...new Set(available.filter((row) => row.weekBasis === "stated").flatMap((row) => row.week ? [row.week] : []))].sort((a, b) => a - b),
          inferredWeeks: [...new Set(available.filter((row) => row.weekBasis === "spread" || row.weekBasis === "group-order").flatMap((row) => row.week ? [row.week] : []))].sort((a, b) => a - b),
          unscheduledItems: available.filter((row) => row.week === undefined).length,
          sourceProblems: plan?.problems ?? [],
          questionCollections: indexedQuestions?.collections ?? 0,
          storedQuestions: indexedQuestions?.storedQuestions ?? 0,
          readyQuestions: indexedQuestions?.readyQuestions ?? 0,
          reviewQuestions: indexedQuestions?.reviewQuestions ?? 0,
          missingQuestionReferences: indexedQuestions?.missingReferencedQuestions ?? 0,
          indexedQuestionWeeks: indexedQuestions?.indexedWeeks ?? [],
          unresolvedQuestionWeeks: indexedQuestions?.unresolvedWeekQuestions ?? 0,
          mapping: ambiguous ? "ambiguous" : sections.length ? "outline-match" : "no-template",
        });
      }
    }
    terms.push({
      term: term.name, modules,
      modulesWithTemplates: modules.filter((row) => row.templateFiles > 0).length,
      sourceItems: modules.reduce((sum, row) => sum + row.availableTemplateItems, 0),
      installedTemplateItems: modules.reduce((sum, row) => sum + row.installedTemplateItems, 0),
      notInstalled: modules.reduce((sum, row) => sum + row.notInstalled, 0),
      inferredWeeks: modules.reduce((sum, row) => sum + row.inferredWeeks.length, 0),
      questionCollections: modules.reduce((sum, row) => sum + row.questionCollections, 0),
      readyQuestions: modules.reduce((sum, row) => sum + row.readyQuestions, 0),
      unresolvedQuestionWeeks: modules.reduce((sum, row) => sum + row.unresolvedQuestionWeeks, 0),
    });
  }
  return {
    terms,
    totalModules: curriculumModules.length,
    modulesWithTemplates: terms.reduce((sum, term) => sum + term.modulesWithTemplates, 0),
    sourceTemplateFiles: active.length,
    sourceItems: terms.reduce((sum, term) => sum + term.sourceItems, 0),
    installedTemplateItems: terms.reduce((sum, term) => sum + term.installedTemplateItems, 0),
    notInstalled: terms.reduce((sum, term) => sum + term.notInstalled, 0),
    installedRows: terms.reduce((sum, term) => sum + term.modules.reduce((count, row) => count + row.installedRows, 0), 0),
    unmappedTrackerRows: tracker.filter((row) => !accountedTrackerIds.has(row.id)).length,
    unmappedTemplateModules: [...templateModules].filter(([key]) =>
      !mappedTemplateModuleKeys.has(key))
      .map(([, sections]) => sections[0].module).sort(),
    unassignedQuestionCollections: availability?.unassignedCollections ?? 0,
    unassignedQuestions: availability?.unassignedQuestions ?? 0,
  };
}
