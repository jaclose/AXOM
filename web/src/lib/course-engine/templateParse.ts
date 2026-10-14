// ===========================================================================
// Course templates. A template is a plain list a learner can write or paste:
//
//   FTM 1 - Lectures + DLAs:
//
//   FTM Lecture 01 Histology of the Cytoskeleton of the Cell [Lecture]
//   DLA 02 Cellular Biology of Vesicular Transport [DLA]
//
// One heading, blank lines between groups, and the kind in brackets. Parsing is
// strict: a line it cannot read is reported, never guessed. Planning turns the
// sections of one module into week-by-week tracker rows, and says for every
// week whether the template stated it or AXOM worked it out.
//
// Dependency-free on purpose: scripts/source-inventory.ts imports this.
// ===========================================================================
import { TRACKER_KIND_FOR_ACTIVITY, type CourseActivity } from "./activity.ts";
import { canonicalModuleKey, moduleAliases, moduleKey, type ModuleVocabulary } from "./vocabulary.ts";

export interface CourseTemplateItem {
  /** As written, without the bracketed kind. */
  label: string;
  activity: CourseActivity;
  /** The item's own number when the label carries exactly one. */
  number?: number;
  /** A combined source line such as "CPR 19, 20, 21" is one composite activity, not lecture 19 alone. */
  numbers?: number[];
  /** 1-based position of the blank-line group it sits in. */
  group: number;
  /** A week the line itself names: "Week 1 ExamSoft Quiz". */
  statedWeek?: number;
  line: number;
}

export interface CourseTemplateSection {
  /** Optional explicit term prefix, such as "T5 - MI - Lectures". */
  term?: string;
  /** Module name from the heading: "FTM 1". */
  module: string;
  /** What the section lists: "Lectures + DLAs". */
  title: string;
  items: CourseTemplateItem[];
  groupCount: number;
  /** Lines that could not be read. */
  problems: string[];
  sourceName?: string;
  context?: CourseTemplateContext;
}

/** Explicit source metadata, independent of import time and the learner's term. */
export interface CourseTemplateContext {
  academicTerm?: string;
  cohort?: string;
  sourceRevision?: string;
  authority?: "reviewed";
  weekPolicy?: "explicit";
  sources: string[];
  weekDates: Record<number, string>;
}

/** The words a template may put in brackets, lower-cased. */
const KIND_WORDS: Record<string, CourseActivity> = {
  lecture: "lecture",
  "flipped lecture": "flipped-lecture",
  "flipped classroom": "flipped-lecture",
  dla: "dla",
  "small group": "small-group",
  sg: "small-group",
  imcq: "imcq",
  esoft: "esoft",
  examsoft: "esoft",
  pq: "pq",
  "practice questions": "pq",
  lab: "lab",
  case: "case",
  review: "review",
  assessment: "assessment",
  exam: "assessment",
  quiz: "assessment",
  assignment: "assignment",
};

export function parseCourseTemplate(text: string, sourceName?: string): CourseTemplateSection {
  // A byte-order mark at the start of a pasted file is not part of the heading.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const problems: string[] = [];
  const items: CourseTemplateItem[] = [];
  let module = "";
  let term: string | undefined;
  let title = "";
  let group = 0;
  let inGroup = false;
  let headedWeek: number | undefined;
  const context: CourseTemplateContext = { sources: [], weekDates: {} };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line) { inGroup = false; return; }

    if (line.startsWith("@")) {
      const metadata = line.match(/^@(academic-term|cohort|source-revision|authority|week-policy|source|week\s+\d+):\s*(.+)$/i);
      if (!metadata) { problems.push(`Line ${lineNumber} has unrecognized source metadata.`); return; }
      const [, name, value] = metadata;
      const key = name.toLowerCase();
      if (key === "academic-term") context.academicTerm = value;
      else if (key === "cohort") context.cohort = value;
      else if (key === "source-revision") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) context.sourceRevision = value;
        else problems.push(`Line ${lineNumber}: source revision must be YYYY-MM-DD.`);
      } else if (key === "authority") {
        if (value === "reviewed") context.authority = "reviewed";
        else problems.push(`Line ${lineNumber}: source authority is not reviewed.`);
      } else if (key === "week-policy") {
        if (value === "explicit") context.weekPolicy = "explicit";
        else problems.push(`Line ${lineNumber}: week policy must be explicit.`);
      } else if (key === "source") context.sources.push(value);
      else {
        const week = Number(key.match(/\d+/)?.[0]);
        if (!Number.isInteger(week) || week < 1 || week > 60) {
          problems.push(`Line ${lineNumber}: source week must be 1–60.`);
        } else if (context.weekDates[week] && context.weekDates[week] !== value) {
          problems.push(`Line ${lineNumber}: source Week ${week} has conflicting dates.`);
        } else context.weekDates[week] = value;
      }
      return;
    }

    // "Week 3:" on its own line dates every group below it, until the next one.
    const weekHeading = line.match(/^(?:week|wk)\s*0*(\d{1,2})\s*:?$/i);
    if (module && weekHeading) { headedWeek = Number(weekHeading[1]); inGroup = false; return; }
    if (module && /^Unscheduled\s*:\s*$/i.test(line)) { headedWeek = undefined; inGroup = false; return; }

    if (!module && !/\[[^\]]+\]\s*$/.test(line)) {
      let heading = line.replace(/:\s*$/, "");
      const termPrefix = heading.match(/^(?:T|Term)\s*(\d{1,2})\s+[-–]\s+(.+)$/i);
      if (termPrefix) { term = `Term ${Number(termPrefix[1])}`; heading = termPrefix[2]; }
      const dash = heading.search(/\s[-–]\s/);
      module = (dash > 0 ? heading.slice(0, dash) : heading).trim();
      title = dash > 0 ? heading.slice(dash).replace(/^\s[-–]\s/, "").trim() : "";
      return;
    }

    const match = line.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    if (!match || !match[1].trim()) {
      problems.push(`Line ${lineNumber} has no kind in brackets: "${line.slice(0, 80)}"`);
      return;
    }
    const activity = KIND_WORDS[match[2].trim().toLowerCase()];
    if (!activity) problems.push(`Line ${lineNumber} uses a kind AXOM does not know: [${match[2].trim()}]`);
    if (!inGroup) { group += 1; inGroup = true; }
    const label = match[1].trim();
    const week = label.match(/(?:^|[^a-z0-9])(?:week|wk)\s*0*(\d{1,2})(?![0-9])/i);
    const numbers = compositeNumbers(label, activity ?? "other");
    items.push({
      label,
      activity: activity ?? "other",
      number: numbers ? undefined : itemNumber(label, activity ?? "other"),
      ...(numbers ? { numbers } : {}),
      group,
      statedWeek: week ? Number(week[1]) : headedWeek,
      line: lineNumber,
    });
  });

  if (!module) problems.unshift("The first line should name the module, for example \"FTM 1 - Lectures + DLAs:\".");
  return { module, ...(term ? { term } : {}), title, items, groupCount: group, problems, sourceName,
    ...(context.academicTerm || context.cohort || context.sourceRevision || context.authority || context.sources.length || context.weekPolicy || Object.keys(context.weekDates).length ? { context } : {}) };
}

export type WeekBasis = "stated" | "group-order" | "spread" | "unknown";

export const WEEK_BASIS_NOTE: Record<WeekBasis, string> = {
  stated: "The template names this week.",
  "group-order": "AXOM tentatively treats each blank-line activity group as one week; the source does not explicitly verify these weeks.",
  spread: "The template does not give weeks for these. AXOM spread the groups across the module's weeks in order, so check where each week starts and ends.",
  unknown: "The template does not say which week these belong to.",
};

export interface PlannedCourseItem {
  /** Tracker scope: "T1/FTM 1/Week 2", or ".../Unscheduled" when the week is unknown. */
  path: string;
  label: string;
  kind: (typeof TRACKER_KIND_FOR_ACTIVITY)[CourseActivity];
  activity: CourseActivity;
  /** Stable across re-imports, so a changed title updates a row instead of adding one. */
  templateKey: string;
  /** Exact original source line, not a fabricated lecture/week reference. */
  sourceLine: number;
  sourceName?: string;
  sourceRevision?: string;
  week?: number;
  weekBasis: WeekBasis;
  /** Source stated the week, AXOM inferred it, or no week is evidenced. */
  weekSource?: "template" | "inferred";
}

export interface CourseTemplatePlan {
  module: string;
  term?: string;
  /** Optional explicit course grouping, e.g. "BPM 502". Older templates remain course-unassigned. */
  course?: string;
  /** Weeks the module runs, when any section establishes them. */
  weekCount?: number;
  items: PlannedCourseItem[];
  /** True when any week was worked out, so the learner should look before applying. */
  needsConfirmation: boolean;
  problems: string[];
}

/**
 * Turn every section of one module into week-by-week rows. A section whose
 * groups name a week (or whose items are the weekly quizzes and small groups)
 * sets the module's weeks. A section that does not (lectures are listed by
 * teaching day) is spread across those weeks in order and marked as such, or
 * left unscheduled when nothing establishes the weeks at all.
 *
 * `firstWeek` is the week of the term the module starts in. A template counts
 * a module's weeks from 1; its files usually say "Week 12".
 */
export function planCourseTemplate(
  sections: readonly CourseTemplateSection[],
  options: { term?: string; course?: string; moduleName?: string; firstWeek?: number } = {},
): CourseTemplatePlan {
  const offset = Math.max(1, options.firstWeek ?? 1) - 1;
  const module = sections[0]?.module ?? "";
  const term = options.term ?? sections[0]?.term;
  const course = options.course?.trim() || undefined;
  const moduleName = options.moduleName?.trim() || module;
  const problems = sections.flatMap((section) => section.problems);
  for (const section of sections) {
    if (canonicalModuleKey(section.module) !== canonicalModuleKey(module)) {
      problems.push(`"${section.sourceName ?? section.title}" is for ${section.module}, not ${module}.`);
    }
  }
  const sameModule = sections.filter((section) => canonicalModuleKey(section.module) === canonicalModuleKey(module));
  const weekly = sameModule.filter(setsTheWeeks);
  // Source labels such as Week 4 ESoft Quiz anchor their *own* group. An
  // adjacent SG/IMCQ remains inferred, but must never be filed into Week 1
  // merely because the source text had its first blank-line group there.
  const groupWeeks = new Map<CourseTemplateSection, Map<number, number>>();
  for (const section of weekly) {
    const anchored = new Map<number, Set<number>>();
    for (const item of section.items) {
      if (item.statedWeek === undefined) continue;
      const weeks = anchored.get(item.group) ?? new Set<number>();
      weeks.add(item.statedWeek);
      anchored.set(item.group, weeks);
    }
    const contradictoryGroup = [...anchored.values()].some((values) => values.size > 1);
    const shifts = new Set([...anchored.entries()].flatMap(([group, values]) =>
      values.size === 1 ? [[...values][0] - group] : []));
    const chronologyConsistent = !contradictoryGroup && shifts.size <= 1;
    if (!chronologyConsistent && section.context?.weekPolicy !== "explicit") {
      problems.push(`${section.sourceName ?? section.title}: explicit week labels conflict with a single consecutive group timeline. Unstated groups remain unscheduled.`);
    }
    const anchorShift = shifts.size === 1 ? [...shifts][0] : undefined;
    const byGroup = new Map<number, number>();
    for (let group = 1; group <= section.groupCount; group += 1) {
      const stated = anchored.get(group);
      if (stated?.size === 1) {
        byGroup.set(group, [...stated][0]);
      } else if (section.context?.weekPolicy !== "explicit" && chronologyConsistent) {
        // If there is no anchor, firstWeek is a learner-entered offset; with
        // anchors, they take precedence over firstWeek.
        const proposed = (anchorShift ?? offset) + group;
        if (proposed > 0 && proposed < 100) byGroup.set(group, proposed);
      }
    }
    groupWeeks.set(section, byGroup);
  }
  const moduleWeeks = [...new Set(weekly.flatMap((section) => (
    section.context?.weekPolicy === "explicit"
      ? section.items.flatMap(item => item.statedWeek ? [item.statedWeek] : [])
      : [...(groupWeeks.get(section)?.values() ?? [])]
  )))].sort((a, b) => a - b);
  const weekCount = moduleWeeks.length || undefined;

  const items: PlannedCourseItem[] = [];
  for (const section of sameModule) {
    const isWeekly = weekly.includes(section);
    for (const item of section.items) {
      // An explicit week on one activity is not evidence for the whole blank-line group.
      const stated = item.statedWeek;
      let week: number | undefined;
      let weekBasis: WeekBasis = "unknown";
      if (stated) { week = stated; weekBasis = "stated"; }
      else if (isWeekly && section.context?.weekPolicy !== "explicit") {
        week = groupWeeks.get(section)?.get(item.group);
        if (week !== undefined) weekBasis = "group-order";
      }
      else if (weekCount && section.context?.weekPolicy !== "explicit") {
        week = moduleWeeks[Math.ceil((item.group * weekCount) / section.groupCount) - 1];
        weekBasis = "spread";
      }
      items.push({
        path: [term, course, moduleName, week ? `Week ${week}` : "Unscheduled"].filter(Boolean).join("/"),
        label: item.label,
        kind: TRACKER_KIND_FOR_ACTIVITY[item.activity],
        activity: item.activity,
        templateKey: [section.context?.academicTerm, section.context?.cohort, templateKey(module, item)].filter(Boolean).join("|"),
        sourceLine: item.line,
        ...(section.sourceName ? { sourceName: section.sourceName } : {}),
        ...(section.context?.sourceRevision ? { sourceRevision: section.context.sourceRevision } : {}),
        week,
        weekBasis,
        weekSource: weekBasis === "stated" ? "template" : week ? "inferred" : undefined,
      });
    }
  }

  return {
    module,
    term,
    ...(course ? { course } : {}),
    weekCount,
    items,
    needsConfirmation: items.some((item) => item.weekBasis !== "stated"),
    problems,
  };
}

export interface TemplateReconciliation {
  /** Rows safe to create, after deduplication and identity checks. */
  create: PlannedCourseItem[];
  /** Only identity, location and labels are patched; study progress is untouched. */
  update: Array<{ id: string; path: string; label: string; weekSource?: "template" | "inferred" | "learner"; templateKey?: string }>;
  unchanged: number;
  /** Conflicts must be reconciled by the learner; they are never silently inserted. */
  review?: Array<{ item: PlannedCourseItem; reason: string; candidateIds: string[] }>;
  /** Existing source rows absent from the selected plan: informational, never auto-deleted. */
  notInSelection?: Array<{ id: string; label: string; path: string }>;
}

/** Plan against the existing workspace, without mutating passes, attendance, or links. */
export function reconcileCourseTemplate(
  plan: CourseTemplatePlan,
  existing: ReadonlyArray<{ id: string; path: string; label: string; activity?: CourseActivity; templateKey?: string; weekSource?: "template" | "inferred" | "learner" }>,
): TemplateReconciliation {
  // Only rows under this module AND this term can match. An identical activity
  // title in another term is never a duplicate of this student's work.
  const inScope = existing.filter((row) => {
    const segments = row.path.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    const hasWeekSuffix = /^week\s*\d+$/i.test(last) || /^unscheduled$/i.test(last);
    const moduleIndex = segments.length - (hasWeekSuffix ? 2 : 1);
    const module = segments[moduleIndex];
    const term = moduleIndex >= 1 ? segments[0] : undefined;
    const existingCourse = segments.slice(1, moduleIndex).join("/").trim().toLowerCase();
    // A course-selected reimport may adopt a legacy module-root row, but it
    // must never steal a row explicitly filed to another course.
    return canonicalModuleKey(module ?? "") === canonicalModuleKey(plan.module)
      && termIdentity(term) === termIdentity(plan.term)
      && (!plan.course || !existingCourse || existingCourse === plan.course.trim().toLowerCase());
  });
  const normalizeKey = (key: string) => normalizedTemplateIdentity(key, plan.module);
  const byKey = new Map<string, typeof inScope>();
  const byPlace = new Map<string, typeof inScope>();
  for (const row of inScope) {
    if (row.templateKey) {
      const key = normalizeKey(row.templateKey);
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
    const place = `${row.path}|${row.label}`.toLowerCase();
    byPlace.set(place, [...(byPlace.get(place) ?? []), row]);
  }
  const planKeyCounts = new Map<string, number>();
  for (const row of plan.items) {
    const key = normalizeKey(row.templateKey);
    planKeyCounts.set(key, (planKeyCounts.get(key) ?? 0) + 1);
  }
  const matched = new Set<string>();
  const review: NonNullable<TemplateReconciliation["review"]> = [];
  const result: TemplateReconciliation = { create: [], update: [], unchanged: 0 };
  for (const item of plan.items) {
    const identity = normalizeKey(item.templateKey);
    const candidates = byKey.get(identity) ?? [];
    const exactPlace = byPlace.get(`${item.path}|${item.label}`.toLowerCase()) ?? [];
    if ((planKeyCounts.get(identity) ?? 0) > 1 || candidates.length > 1 || exactPlace.length > 1) {
      review.push({ item, reason: "Repeated identity or duplicate workspace rows require manual reconciliation.", candidateIds: [...new Set([...candidates, ...exactPlace].map((row) => row.id))] });
      continue;
    }
    const match = candidates[0];
    if (match) {
      matched.add(match.id);
      // Retain a learner's exact week, and never drag a course-filed row back
      // into an old module-root layout when a legacy importer lacks course.
      const path = reconciledActivityPath(plan, item.path, match.path, match.weekSource);
      const weekSource = match.weekSource === "learner" ? "learner" : item.weekSource;
      if (match.path === path && match.label === item.label && match.weekSource === weekSource) result.unchanged += 1;
      else result.update.push({ id: match.id, path, label: item.label, weekSource });
      continue;
    }
    if (exactPlace.length === 1) {
      const existingRow = exactPlace[0];
      if (existingRow.templateKey && normalizeKey(existingRow.templateKey) !== identity) {
        review.push({ item, reason: "This location and title already exist under a different template identity. Confirm before merging progress.", candidateIds: [existingRow.id] });
        continue;
      }
      // A manually entered task is not converted into a template-owned record.
      matched.add(existingRow.id);
      result.unchanged += 1;
      continue;
    }
    // A learner may have filed the same unkeyed activity in another week.
    // Recreating it would make two entries with independent completion state.
    const unkeyedTitleMatches = inScope.filter((row) => !row.templateKey
      && row.label.trim().toLowerCase() === item.label.trim().toLowerCase());
    if (unkeyedTitleMatches.length) {
      review.push({ item, reason: "An existing unkeyed activity with this title may be the same activity in another week.", candidateIds: unkeyedTitleMatches.map((row) => row.id) });
      continue;
    }
    // A prior import may use an older, title-based key. A renamed unnumbered
    // item cannot be proved new by title similarity: require explicit review.
    const kindPrefix = identity.split("|").slice(0, -1).join("|") + "|";
    const legacyCandidates = inScope.filter((row) => row.templateKey
      && normalizeKey(row.templateKey).startsWith(kindPrefix)
      && !planKeyCounts.has(normalizeKey(row.templateKey)) && !matched.has(row.id));
    if (legacyCandidates.length) {
      review.push({ item, reason: "Existing unmatched activities of this type may be renamed or renumbered versions.", candidateIds: legacyCandidates.map((row) => row.id) });
      continue;
    }
    result.create.push(item);
  }
  const notInSelection = inScope.filter((row) => row.templateKey && !planKeyCounts.has(normalizeKey(row.templateKey)) && !matched.has(row.id))
    .map(({ id, path, label }) => ({ id, path, label }));
  if (review.length) result.review = review;
  if (notInSelection.length) result.notInSelection = notInSelection;
  return result;
}

/** Preserve explicit course filing and student week decisions during reimports. */
function reconciledActivityPath(
  plan: CourseTemplatePlan, proposed: string, existing: string,
  weekSource?: "template" | "inferred" | "learner",
): string {
  const oldParts = existing.split("/").filter(Boolean);
  const suffix = oldParts.at(-1) ?? "";
  const hasWeek = /^(?:week\s*\d+|unscheduled)$/i.test(suffix);
  const moduleIndex = oldParts.length - (hasWeek ? 2 : 1);
  if (moduleIndex < 0) return proposed;
  const oldCoursePath = oldParts.slice(1, moduleIndex);
  const newParts = proposed.split("/").filter(Boolean);
  const newWeek = newParts.at(-1) ?? "";
  const selectedWeek = weekSource === "learner" && hasWeek ? suffix : newWeek;
  if (weekSource === "learner" && (!hasWeek || !plan.course)) return existing;
  if (!plan.course && oldCoursePath.length > 0) {
    // The already-filed destination remains canonical when an older loader
    // cannot identify the course at all.
    return [...oldParts.slice(0, moduleIndex + 1), selectedWeek].join("/");
  }
  return [...newParts.slice(0, -1), selectedWeek].join("/");
}

/** Stable activity identity normalizes equivalent long/short SGU module labels. */
export function normalizedTemplateIdentity(key: string, plannedModule: string): string {
  const parts = key.split("|");
  if (parts.length < 3) return key;
  const modulePart = parts.length - 3;
  // Previous template keys have already lost word boundaries. Recognize only
  // the planner module's documented aliases, never arbitrary module prefixes.
  const spellings = [plannedModule, ...moduleAliases(plannedModule)].map(moduleKey);
  if (spellings.includes(parts[modulePart])) parts[modulePart] = canonicalModuleKey(plannedModule);
  return parts.join("|");
}

function termIdentity(value?: string): string {
  const normalized = (value ?? "").trim().toLowerCase();
  const match = normalized.match(/^(?:term|t)\s*0*(\d{1,2})$/);
  return match ? `term${Number(match[1])}` : normalized;
}

/** The module codes a set of templates establishes, for the mapping vocabulary. */
export function templateModules(
  sections: readonly CourseTemplateSection[],
  termFor: (module: string) => string | undefined = () => undefined,
): ModuleVocabulary[] {
  const seen = new Map<string, ModuleVocabulary>();
  for (const section of sections) {
    const key = moduleKey(section.module);
    if (!key || seen.has(key)) continue;
    seen.set(key, { code: section.module, aliases: moduleAliases(section.module), term: termFor(section.module) });
  }
  return [...seen.values()];
}

// Preserve the established public import location while sharing one alias rule.
export { moduleAliases } from "./vocabulary.ts";

function setsTheWeeks(section: CourseTemplateSection): boolean {
  if (section.items.some((item) => item.statedWeek)) return true;
  // Weekly quizzes and small groups are scheduled by the week; lectures by the day.
  const weeklyActivities = section.items.filter((item) => item.activity === "esoft" || item.activity === "imcq" || item.activity === "small-group");
  return section.items.length > 0 && weeklyActivities.length / section.items.length >= 0.8;
}

/** Combined numbered lectures are one source row; never attach one row's progress to a later split lecture. */
function compositeNumbers(label: string, activity: CourseActivity): number[] | undefined {
  if (activity !== "lecture" && activity !== "flipped-lecture") return undefined;
  const leading = label.match(/^(?:(?:lecture|lec)|[A-Z][A-Z0-9-]{1,9})\s+(\d{1,3}(?:\s*(?:,|&|and)\s*\d{1,3})+)(?=\s|$)/i);
  if (!leading) return undefined;
  const numbers = [...leading[1].matchAll(/\d{1,3}/g)].map(([digits]) => Number(digits));
  return numbers.length > 1 ? numbers : undefined;
}

function itemNumber(label: string, activity: CourseActivity): number | undefined {
  // Prefer this activity's own number, never a reference to another lecture in
  // its title: "DLA 02 before Lecture 06" identifies DLA 2, not Lecture 6.
  const byActivity: Partial<Record<CourseActivity, RegExp>> = {
    lecture: /\b(?:lecture|lec)\s*#?\s*0*(\d{1,3})\b/i,
    "flipped-lecture": /\b(?:lecture|lec)\s*#?\s*0*(\d{1,3})\b/i,
    dla: /\bdla\s*#?\s*0*(\d{1,3})\b/i,
    "small-group": /\b(?:sg|small\s+group)\s*#?\s*0*(\d{1,3})\b/i,
    imcq: /\bimcq\s*#?\s*0*(\d{1,3})\b/i,
    esoft: /\b(?:e\s?soft|examsoft)(?:\s+quiz)?\s*#?\s*0*(\d{1,3})\b/i,
    lab: /\blab\s*#?\s*0*(\d{1,3})\b/i,
    case: /\bcase\s*#?\s*0*(\d{1,3})\b/i,
    assessment: /\b(?:quiz|exam)\s*#?\s*0*(\d{1,3})\b/i,
  };
  const stated = label.match(byActivity[activity] ?? /a^/);
  if (stated) return Number(stated[1]);
  // Some official lists say "CPR 03 Histology" without spelling out Lecture.
  // This applies to lecture kinds only; do not infer assessment numbers.
  if (activity === "lecture" || activity === "flipped-lecture") {
    const leading = label.match(/^[A-Z][A-Z0-9-]{1,9}\s+0*(\d{1,3})(?=\s|[,;:/-]|$)/);
    if (leading) return Number(leading[1]);
  }
  return undefined;
}

function templateKey(module: string, item: CourseTemplateItem): string {
  const identity = item.numbers?.length
    ? `combined-${item.numbers.join("-")}`
    : item.number !== undefined ? String(item.number)
      : item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${moduleKey(module)}|${item.activity === "flipped-lecture" ? "lecture" : item.activity}|${identity}`;
}
