import type { CurriculumTemplate } from "../curricula";
import type { SourceDocument } from "../library";
import type { Course, Term, TrackerItem, TrackerKind } from "../types";
import { TRACKER_KIND_FOR_ACTIVITY } from "./activity";
import { courseTemplateVersions, savedCourseTemplates, type SavedCourseTemplate } from "./templateLibrary";
import {
  planCourseTemplate, reconcileCourseTemplate,
  type CourseTemplatePlan, type CourseTemplateSection, type TemplateReconciliation,
} from "./templateParse";
import { canonicalModuleKey } from "./vocabulary";

/** The planner never installs a source it cannot attribute to a single course. */
export interface CurriculumTemplateInstallModule {
  term: string;
  courseCode: string;
  courseName: string;
  module: string;
  /** Actual existing learner-specific module spelling, when uniquely present. */
  path: string;
  sourceFiles: number;
  /** Private source document version anchors; never public catalog metadata. */
  sourceVersionIds: string[];
  sourceActivities: number;
  explicitWeeks: number;
  provisionalWeeks: number;
  unassignedWeeks: number;
  plan: CourseTemplatePlan;
  reconcile: TemplateReconciliation;
}
export interface CurriculumTemplateInstallIssue {
  sourceModule: string;
  sourceFiles: number;
  reason: string;
}
export interface CurriculumTemplateInstallPreview {
  /** Inferred weeks are always learner-confirmed or placed under Unscheduled. */
  placement: "unassigned" | "provisional";
  /** Empty school outline shells are optional and never imply source activities. */
  includeOutline: boolean;
  outlineModules: Array<{ term: string; courseCode: string; courseName: string; module: string }>;
  missingOutlineModules: number;
  activeSourceFiles: number;
  modules: CurriculumTemplateInstallModule[];
  issues: CurriculumTemplateInstallIssue[];
  sourceActivities: number;
  create: number;
  update: number;
  unchanged: number;
  reviewRequired: number;
  sourceStatedWeeks: number;
  provisionalWeeks: number;
  unassignedWeeks: number;
}

interface Workspace {
  terms: readonly Term[];
  courses: readonly Course[];
  tracker: readonly TrackerItem[];
}

export interface CohortTargetAssessment {
  status: "legacy-unversioned" | "matched-version" | "needs-review";
  cohortLabels: string[];
  includesUnknown: boolean;
}

/** Explicit source cohorts cannot target an unversioned course shell. */
export function assessCohortTarget(
  sections: readonly CourseTemplateSection[], approvedTargetCohort?: string,
): CohortTargetAssessment {
  const cohortLabels = [...new Set(sections.flatMap((section) => {
    const label = section.context?.cohort?.trim();
    return label ? [label] : [];
  }))];
  const includesUnknown = sections.some((section) => !section.context?.cohort?.trim());
  if (!cohortLabels.length) return { status: "legacy-unversioned", cohortLabels, includesUnknown };
  const approved = approvedTargetCohort?.trim();
  if (approved && !includesUnknown && cohortLabels.length === 1 && cohortLabels[0] === approved) {
    return { status: "matched-version", cohortLabels, includesUnknown };
  }
  return { status: "needs-review", cohortLabels, includesUnknown };
}

const normalizeTerm = (name: string): string | undefined => {
  const match = name.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? `term${Number(match[1])}` : undefined;
};
const codeKey = (value: string): string => value.trim().replace(/^\d{1,2}\s+(?=[a-z])/i, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Older AXOM shells say PPM500/501, whereas the SGU Fall 2025+ catalog says
 * PCM500/501. This equivalence is ONLY for locating an existing STRUCTURAL
 * course shell, never for auto-migrating QBank IDs, source files, or activity
 * provenance. A dual-code workspace remains an explicit review conflict.
 */
const sameCourseShell = (term: string, left: string, right: string): boolean => {
  const a = codeKey(left), b = codeKey(right);
  if (a === b) return true;
  const known = normalizeTerm(term) === "term4" ? ["ppm500", "pcm500"]
    : normalizeTerm(term) === "term5" ? ["ppm501", "pcm501"] : [];
  return known.includes(a) && known.includes(b);
};
const sameModuleShell = (term: string, left: string, right: string): boolean => {
  const a = canonicalModuleKey(left), b = canonicalModuleKey(right);
  return a === b || (normalizeTerm(term) === "term5"
    && ["mi", "nmi"].includes(a) && ["mi", "nmi"].includes(b));
};

export interface LegacyOwnerEvidence {
  kind: "unique-target" | "ambiguous" | "unknown";
  candidateCourseIds: string[];
}

/** Determine whether a course-less tracker row has exactly one possible owner. */
export function resolveLegacyOwnerEvidence({
  term, module, selectedCourseCode, terms, courses, tracker,
}: {
  term: string;
  module: string;
  selectedCourseCode: string;
  terms: readonly Term[];
  courses: readonly Course[];
  tracker: readonly TrackerItem[];
}): LegacyOwnerEvidence {
  const matchingTerms = terms.filter((entry) => normalizeTerm(entry.name) === normalizeTerm(term));
  const matchingTermIds = new Set(matchingTerms.map((entry) => entry.id));
  const candidates = new Map<string, { id: string; target: boolean }>();
  const selectedCourses = courses.filter((course) => matchingTermIds.has(course.termId)
    && sameCourseShell(term, course.code, selectedCourseCode));
  for (const course of courses) {
    if (!matchingTermIds.has(course.termId)
      || !course.modules.some((entry) => canonicalModuleKey(entry.name) === canonicalModuleKey(module))) continue;
    candidates.set(course.id, { id: course.id, target: sameCourseShell(term, course.code, selectedCourseCode) });
  }
  const prospectiveTarget = selectedCourses.length === 1
    ? selectedCourses[0].id : `course:${codeKey(selectedCourseCode)}`;
  candidates.set(prospectiveTarget, { id: prospectiveTarget, target: true });

  for (const row of tracker) {
    const parts = row.path.split("/").filter(Boolean);
    const suffix = parts.at(-1) ?? "";
    const hasWeek = /^(?:week\s*\d+|unscheduled)$/i.test(suffix);
    const moduleIndex = parts.length - (hasWeek ? 2 : 1);
    if (moduleIndex < 2
      || normalizeTerm(parts[0] ?? "") !== normalizeTerm(term)
      || canonicalModuleKey(parts[moduleIndex] ?? "") !== canonicalModuleKey(module)) continue;
    const coursePath = parts.slice(1, moduleIndex).join("/");
    const known = courses.find((course) => matchingTermIds.has(course.termId)
      && sameCourseShell(term, course.code, coursePath));
    const id = known?.id ?? `course:${codeKey(coursePath)}`;
    candidates.set(id, { id, target: sameCourseShell(term, coursePath, selectedCourseCode) });
  }
  const values = [...candidates.values()];
  if (!values.length) return { kind: "unknown", candidateCourseIds: [] };
  const uniqueTarget = values.length === 1 && values[0].target;
  return {
    kind: uniqueTarget ? "unique-target" : "ambiguous",
    candidateCourseIds: values.map((candidate) => candidate.id),
  };
}

function currentTemplateSections(documents: readonly SourceDocument[]): SavedCourseTemplate[] {
  return courseTemplateVersions(savedCourseTemplates(documents))
    .filter((versions) => versions.length)
    .map((versions) => versions[0])
    .filter(({ section }) => section.items.length > 0);
}

/**
 * Reusable source-evidenced preview over the EXISTING vault, not a second
 * tracker store. The official curriculum outline supplies module containers,
 * never missing activity rows or class dates. Caller confirms any heuristics.
 */
export function previewCurriculumTemplateInstallation(
  curriculum: CurriculumTemplate, documents: readonly SourceDocument[],
  workspace: Workspace, placement: "unassigned" | "provisional" = "unassigned",
  includeOutline = false,
): CurriculumTemplateInstallPreview {
  const active = currentTemplateSections(documents);
  const byModule = new Map<string, SavedCourseTemplate[]>();
  for (const source of active) {
    const key = canonicalModuleKey(source.section.module);
    byModule.set(key, [...(byModule.get(key) ?? []), source]);
  }
  const outline = curriculum.terms
    .filter((term) => /^Term\s+[1-5]$/i.test(term.name))
    .flatMap((term) => term.courses.flatMap((course) => course.modules.map((module) => ({
      term: term.name, code: course.code, name: course.name, module,
      key: canonicalModuleKey(module),
    }))));

  const modules: CurriculumTemplateInstallModule[] = [];
  const issues: CurriculumTemplateInstallIssue[] = [];
  for (const [key, sources] of byModule) {
    const sourceName = sources[0].section.module;
    const cohort = assessCohortTarget(sources.map((source) => source.section));
    if (cohort.status === "needs-review") {
      const identity = cohort.cohortLabels.length > 1
        ? `conflicting cohorts ${cohort.cohortLabels.join(", ")}`
        : cohort.includesUnknown
          ? `cohort ${cohort.cohortLabels[0]} mixed with source files that do not state a cohort`
          : `cohort ${cohort.cohortLabels[0]}`;
      issues.push({
        sourceModule: sourceName,
        sourceFiles: sources.length,
        reason: `Source identity declares ${identity}, but the destination course has no reviewed cohort binding. Choose a version-specific owner before installing.`,
      });
      continue;
    }
    const statedTerms = new Set<string>();
    const badSourceTerms: string[] = [];
    for (const source of sources) {
      for (const namedTerm of [source.section.term, source.section.context?.academicTerm]) {
        if (!namedTerm) continue;
        const normalized = normalizeTerm(namedTerm);
        if (normalized) statedTerms.add(normalized);
        else badSourceTerms.push(namedTerm);
      }
    }
    const owners = outline.filter((entry) => entry.key === key
      && (!statedTerms.size || statedTerms.has(normalizeTerm(entry.term) ?? "")));
    const problems = sources.flatMap((source) => source.section.problems);
    if (problems.length || badSourceTerms.length || statedTerms.size > 1 || owners.length !== 1) {
      issues.push({
        sourceModule: sourceName, sourceFiles: sources.length,
        reason: problems.length ? `Source parsing needs review: ${problems.slice(0, 2).join(" ")}`
          : badSourceTerms.length ? `Source academic term is not a supported Term 1–5 identity: ${badSourceTerms.join(", ")}.`
            : statedTerms.size > 1 ? "Conflicting explicit academic terms in sources."
              : owners.length === 0 ? "No unique match in the SGU academic outline."
                : "Multiple courses own this module; choose its term and course before installing.",
      });
      continue;
    }
    const owner = owners[0];
    const selectedTerm = workspace.terms.filter((term) => normalizeTerm(term.name) === normalizeTerm(owner.term));
    if (selectedTerm.length > 1) {
      issues.push({ sourceModule: sourceName, sourceFiles: sources.length, reason: "Duplicate term shells in this workspace; reconcile their course ownership first." });
      continue;
    }
    const term = selectedTerm[0]?.name ?? owner.term;
    // A missing term cannot borrow a similarly coded course from another
    // term. That would attach this student's new source to the wrong owner.
    const existingCourse = workspace.courses.filter((course) =>
      selectedTerm[0] && course.termId === selectedTerm[0].id
      && sameCourseShell(owner.term, course.code, owner.code));
    if (existingCourse.length > 1) {
      issues.push({ sourceModule: sourceName, sourceFiles: sources.length, reason: "Multiple existing course shells have the same curriculum code; resolve manually." });
      continue;
    }
    const course = existingCourse[0];
    const sameNamedModules = course?.modules.filter((module) => canonicalModuleKey(module.name) === key) ?? [];
    const disputedAlias = course?.modules.some((module) => sameModuleShell(term, module.name, owner.module)
      && canonicalModuleKey(module.name) !== key);
    if (disputedAlias) {
      issues.push({ sourceModule: sourceName, sourceFiles: sources.length,
        reason: "A different modern/legacy module alias already exists (for example MI versus NMI). Confirm the course identity before loading its source rows." });
      continue;
    }
    if (sameNamedModules.length > 1) {
      issues.push({ sourceModule: sourceName, sourceFiles: sources.length, reason: "Duplicate module aliases in the existing course; resolve manually." });
      continue;
    }
    const courseCode = course?.code ?? owner.code;
    const moduleName = sameNamedModules[0]?.name ?? owner.module;
    const basePlan = planCourseTemplate(sources.map((source) => source.section), {
      term, course: courseCode, moduleName,
    });
    if (basePlan.problems.length) {
      issues.push({ sourceModule: sourceName, sourceFiles: sources.length, reason: basePlan.problems.join(" ") });
      continue;
    }
    const plan: CourseTemplatePlan = placement === "provisional" ? basePlan : {
      ...basePlan,
      items: basePlan.items.map((item) => item.weekBasis === "stated" ? item : ({
        ...item, path: [term, courseCode, moduleName, "Unscheduled"].join("/"),
        week: undefined, weekSource: undefined,
      })),
    };
    const ownership = resolveLegacyOwnerEvidence({
      term, module: moduleName, selectedCourseCode: courseCode,
      terms: workspace.terms, courses: workspace.courses, tracker: workspace.tracker,
    });
    const reconcile = reconcileCourseTemplate(plan, workspace.tracker, {
      legacyCourseAdoption: ownership.kind === "unique-target" ? "confirmed-unique" : "review",
    });
    modules.push({
      term, courseCode, courseName: course?.name ?? owner.name, module: moduleName,
      path: [term, courseCode, moduleName].join("/"), sourceFiles: sources.length,
      sourceVersionIds: sources.map((source) => `${source.document.id}|${source.document.checksum ?? "no-source-sha"}`),
      sourceActivities: plan.items.length,
      explicitWeeks: plan.items.filter((item) => item.weekBasis === "stated").length,
      provisionalWeeks: plan.items.filter((item) => item.weekBasis !== "stated" && item.week !== undefined).length,
      unassignedWeeks: plan.items.filter((item) => item.week === undefined).length,
      plan, reconcile,
    });
  }
  const outlineModules = includeOutline ? outline.map(({ term, code, name, module }) => ({
    term, courseCode: code, courseName: name, module,
  })) : [];
  const missingOutlineModules = outlineModules.filter(({ term, courseCode, module }) => {
    const matchingTerms = workspace.terms.filter((item) => normalizeTerm(item.name) === normalizeTerm(term));
    const matchingCourses = workspace.courses.filter((course) => matchingTerms.some((t) => course.termId === t.id)
      && sameCourseShell(term, course.code, courseCode));
    return !matchingCourses.some((course) => course.modules.some((item) =>
      sameModuleShell(term, item.name, module)));
  }).length;
  const termSort = (name: string) => Number(normalizeTerm(name)?.replace("term", "") ?? 99);
  modules.sort((left, right) => termSort(left.term) - termSort(right.term)
    || left.courseCode.localeCompare(right.courseCode, undefined, { numeric: true })
    || left.module.localeCompare(right.module, undefined, { numeric: true }));
  return {
    placement, includeOutline, outlineModules, missingOutlineModules,
    activeSourceFiles: active.length, modules, issues,
    sourceActivities: modules.reduce((sum, module) => sum + module.sourceActivities, 0),
    create: modules.reduce((sum, module) => sum + module.reconcile.create.length, 0),
    update: modules.reduce((sum, module) => sum + module.reconcile.update.length, 0),
    unchanged: modules.reduce((sum, module) => sum + module.reconcile.unchanged, 0),
    reviewRequired: modules.reduce((sum, module) => sum + (module.reconcile.review?.length ?? 0), 0),
    sourceStatedWeeks: modules.reduce((sum, module) => sum + module.explicitWeeks, 0),
    provisionalWeeks: modules.reduce((sum, module) => sum + module.provisionalWeeks, 0),
    unassignedWeeks: modules.reduce((sum, module) => sum + module.unassignedWeeks, 0),
  };
}

/** Re-read the workspace immediately before commit and compare this signature. */
export function curriculumInstallationSignature(preview: CurriculumTemplateInstallPreview): string {
  return JSON.stringify({
    placement: preview.placement, includeOutline: preview.includeOutline,
    outlineModules: preview.outlineModules, missingOutlineModules: preview.missingOutlineModules,
    issues: preview.issues, files: preview.activeSourceFiles,
    modules: preview.modules.map((module) => [
      module.path, module.sourceVersionIds,
      module.plan.items.map((item) => [item.templateKey, item.path, item.label, item.weekSource]),
      module.reconcile.create.map((item) => item.templateKey),
      module.reconcile.update.map((item) => [item.id, item.path, item.label, item.weekSource]),
      module.reconcile.review?.map((issue) => [issue.item.templateKey, issue.candidateIds]),
    ]),
  });
}
export interface CurriculumTemplateCommit {
  terms: Term[];
  courses: Course[];
  tracker: TrackerItem[];
  createdRows: number;
  revisedRows: number;
  newTerms: number;
  newCourses: number;
  newModules: number;
}

export function applyCurriculumTemplateInstallation(
  workspace: Workspace, preview: CurriculumTemplateInstallPreview,
  makeId: () => string = () => crypto.randomUUID(), now = new Date().toISOString(),
): CurriculumTemplateCommit {
  if ((!preview.modules.length && !preview.includeOutline)
    || (!preview.create && !preview.update && !preview.missingOutlineModules)) {
    throw new Error("There are no new or revised activities or course outlines to install.");
  }
  const terms = [...workspace.terms];
  const courses = [...workspace.courses];
  const tracker = [...workspace.tracker];
  const indexes = new Map(tracker.map((row, index) => [row.id, index]));
  let createdRows = 0, revisedRows = 0, newTerms = 0, newCourses = 0, newModules = 0;
  for (const module of preview.modules) {
    const termKey = normalizeTerm(module.term);
    let term = terms.find((entry) => normalizeTerm(entry.name) === termKey);
    if (!term) { term = { id: makeId(), name: module.term }; terms.push(term); newTerms += 1; }
    let course = courses.find((entry) => entry.termId === term.id
      && sameCourseShell(module.term, entry.code, module.courseCode));
    if (!course) {
      course = { id: makeId(), termId: term.id, code: module.courseCode,
        name: module.courseName, files: 0, modules: [] };
      courses.push(course); newCourses += 1;
    }
    if (!course.modules.some((entry) => canonicalModuleKey(entry.name) === canonicalModuleKey(module.module))) {
      const patched = { ...course, modules: [...course.modules, { id: makeId(), name: module.module }] };
      courses.splice(courses.indexOf(course), 1, patched);
      newModules += 1;
    }
    for (const change of module.reconcile.update) {
      const index = indexes.get(change.id);
      if (index === undefined) throw new Error("An existing source activity changed during installation. Refresh the preview.");
      const source = tracker[index];
      tracker[index] = { ...source, path: change.path, label: change.label, weekSource: change.weekSource,
        ...(change.templateKey ? { templateKey: change.templateKey } : {}) };
      revisedRows += 1;
    }
    for (const item of module.reconcile.create) {
      const id = makeId();
      if (indexes.has(id)) throw new Error("Generated a duplicate source activity ID. Try again.");
      const kind: TrackerKind = TRACKER_KIND_FOR_ACTIVITY[item.activity];
      const created: TrackerItem = { id, path: item.path, label: item.label, kind,
        activity: item.activity, templateKey: item.templateKey, weekSource: item.weekSource,
        passes: 0, ankiPasses: 0, yield: "none", updated: now };
      indexes.set(id, tracker.length);
      tracker.push(created); createdRows += 1;
    }
  }
  // School outline shells are structural placeholders, never fabricated
  // lecture/activity rows. Preserve learner-owned terms and alternative names.
  if (preview.includeOutline) for (const target of preview.outlineModules) {
    const matchingTerms = terms.filter((entry) => normalizeTerm(entry.name) === normalizeTerm(target.term));
    if (matchingTerms.length > 1) throw new Error(`Duplicate ${target.term} course containers require review before continuing.`);
    let term = matchingTerms[0];
    if (!term) { term = { id: makeId(), name: target.term }; terms.push(term); newTerms += 1; }
    const sameCode = courses.filter((entry) => entry.termId === term.id && sameCourseShell(target.term, entry.code, target.courseCode));
    if (sameCode.length > 1) throw new Error(`Duplicate ${target.courseCode} courses require review before continuing.`);
    let course = sameCode[0];
    if (!course) {
      course = { id: makeId(), termId: term.id, code: target.courseCode,
        name: target.courseName, files: 0, modules: [] };
      courses.push(course); newCourses += 1;
    }
    const moduleAliases = course.modules.filter((entry) => sameModuleShell(target.term, entry.name, target.module));
    if (moduleAliases.length > 1) throw new Error(`Duplicate ${target.module} modules require review before continuing.`);
    if (!moduleAliases.length) {
      const updated = { ...course, modules: [...course.modules, { id: makeId(), name: target.module }] };
      courses[courses.indexOf(course)] = updated;
      newModules += 1;
    }
  }
  return { terms, courses, tracker, createdRows, revisedRows, newTerms, newCourses, newModules };
}
