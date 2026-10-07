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
import { moduleKey, type ModuleVocabulary } from "./vocabulary.ts";

export interface CourseTemplateItem {
  /** As written, without the bracketed kind. */
  label: string;
  activity: CourseActivity;
  /** The item's own number when the label carries one: "Lecture 07" is 7. */
  number?: number;
  /** 1-based position of the blank-line group it sits in. */
  group: number;
  /** A week the line itself names: "Week 1 ExamSoft Quiz". */
  statedWeek?: number;
  line: number;
}

export interface CourseTemplateSection {
  /** Module name from the heading: "FTM 1". */
  module: string;
  /** What the section lists: "Lectures + DLAs". */
  title: string;
  items: CourseTemplateItem[];
  groupCount: number;
  /** Lines that could not be read. */
  problems: string[];
  sourceName?: string;
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
  let title = "";
  let group = 0;
  let inGroup = false;
  let headedWeek: number | undefined;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line) { inGroup = false; return; }

    // "Week 3:" on its own line dates every group below it, until the next one.
    const weekHeading = line.match(/^(?:week|wk)\s*0*(\d{1,2})\s*:?$/i);
    if (module && weekHeading) { headedWeek = Number(weekHeading[1]); inGroup = false; return; }

    if (!module && !/\[[^\]]+\]\s*$/.test(line)) {
      const heading = line.replace(/:\s*$/, "");
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
    items.push({
      label,
      activity: activity ?? "other",
      number: itemNumber(label),
      group,
      statedWeek: week ? Number(week[1]) : headedWeek,
      line: lineNumber,
    });
  });

  if (!module) problems.unshift("The first line should name the module, for example \"FTM 1 - Lectures + DLAs:\".");
  return { module, title, items, groupCount: group, problems, sourceName };
}

export type WeekBasis = "stated" | "group-order" | "spread" | "unknown";

export const WEEK_BASIS_NOTE: Record<WeekBasis, string> = {
  stated: "The template names this week.",
  "group-order": "Each group in the template is taken as one week, in order.",
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
  week?: number;
  weekBasis: WeekBasis;
  /** What to record on the row: only a stated or group-ordered week is the template's own. */
  weekSource?: "template" | "inferred";
}

export interface CourseTemplatePlan {
  module: string;
  term?: string;
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
  options: { term?: string; firstWeek?: number } = {},
): CourseTemplatePlan {
  const offset = Math.max(1, options.firstWeek ?? 1) - 1;
  const module = sections[0]?.module ?? "";
  const problems = sections.flatMap((section) => section.problems);
  for (const section of sections) {
    if (moduleKey(section.module) !== moduleKey(module)) {
      problems.push(`"${section.sourceName ?? section.title}" is for ${section.module}, not ${module}.`);
    }
  }
  const sameModule = sections.filter((section) => moduleKey(section.module) === moduleKey(module));
  const weekly = sameModule.filter(setsTheWeeks);
  // A week the template names is already a week of the term; a group counted
  // in order is a week of the module, moved to where the module starts.
  const groupWeek = (section: CourseTemplateSection, group: number): number => (
    section.items.find((item) => item.group === group && item.statedWeek)?.statedWeek ?? offset + group
  );
  const moduleWeeks = [...new Set(weekly.flatMap((section) => (
    Array.from({ length: section.groupCount }, (_, index) => groupWeek(section, index + 1))
  )))].sort((a, b) => a - b);
  const weekCount = moduleWeeks.length || undefined;

  const items: PlannedCourseItem[] = [];
  for (const section of sameModule) {
    const isWeekly = weekly.includes(section);
    const statedByGroup = new Map<number, number>();
    for (const item of section.items) if (item.statedWeek) statedByGroup.set(item.group, item.statedWeek);

    for (const item of section.items) {
      const stated = statedByGroup.get(item.group);
      let week: number | undefined;
      let weekBasis: WeekBasis = "unknown";
      if (stated) { week = stated; weekBasis = "stated"; }
      else if (isWeekly) { week = offset + item.group; weekBasis = "group-order"; }
      else if (weekCount) {
        week = moduleWeeks[Math.ceil((item.group * weekCount) / section.groupCount) - 1];
        weekBasis = "spread";
      }
      items.push({
        path: [options.term, module, week ? `Week ${week}` : "Unscheduled"].filter(Boolean).join("/"),
        label: item.label,
        kind: TRACKER_KIND_FOR_ACTIVITY[item.activity],
        activity: item.activity,
        templateKey: templateKey(module, item),
        week,
        weekBasis,
        weekSource: weekBasis === "stated" || weekBasis === "group-order" ? "template" : week ? "inferred" : undefined,
      });
    }
  }

  return {
    module,
    term: options.term,
    weekCount,
    items,
    needsConfirmation: items.some((item) => item.weekBasis !== "stated" && item.weekBasis !== "group-order"),
    problems,
  };
}

export interface TemplateReconciliation {
  /** Rows the workspace does not have yet. */
  create: PlannedCourseItem[];
  /** Rows that exist under the same template identity with a different title or week. */
  update: Array<{ id: string; path: string; label: string; weekSource?: "template" | "inferred" | "learner" }>;
  unchanged: number;
}

/**
 * Compare a plan with what the tracker already holds. Applying a template twice
 * adds nothing, and a row the learner has already studied keeps its progress:
 * only its title and place are brought up to date.
 */
export function reconcileCourseTemplate(
  plan: CourseTemplatePlan,
  existing: ReadonlyArray<{ id: string; path: string; label: string; templateKey?: string; weekSource?: "template" | "inferred" | "learner" }>,
): TemplateReconciliation {
  const byKey = new Map(existing.flatMap((item) => (item.templateKey ? [[item.templateKey, item] as const] : [])));
  const byPlace = new Set(existing.map((item) => `${item.path}|${item.label}`.toLowerCase()));
  const result: TemplateReconciliation = { create: [], update: [], unchanged: 0 };
  for (const item of plan.items) {
    const match = byKey.get(item.templateKey);
    if (match) {
      // A week the learner chose stands: a re-import may retitle the row, never move it.
      const path = match.weekSource === "learner" ? match.path : item.path;
      if (match.path === path && match.label === item.label) result.unchanged += 1;
      else result.update.push({ id: match.id, path, label: item.label, weekSource: match.weekSource === "learner" ? "learner" : item.weekSource });
    } else if (byPlace.has(`${item.path}|${item.label}`.toLowerCase())) {
      result.unchanged += 1;
    } else {
      result.create.push(item);
    }
  }
  return result;
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

/**
 * Other ways a module name is written in file names. "NB Block 3" is filed as
 * "NB3"; "BPM502 Post-Midterm" as "PostMidterm".
 */
export function moduleAliases(module: string): string[] {
  const words = module.trim().split(/\s+/);
  const aliases = new Set<string>();
  const number = module.match(/(\d+)\s*$/)?.[1];
  if (words.length > 2 && number) aliases.add(`${words[0]}${number}`);
  if (words.length >= 2 && /\d/.test(words[0]) && !number) aliases.add(words.slice(1).join(" "));
  aliases.delete(module);
  return [...aliases];
}

function setsTheWeeks(section: CourseTemplateSection): boolean {
  if (section.items.some((item) => item.statedWeek)) return true;
  // Weekly quizzes and small groups are scheduled by the week; lectures by the day.
  const weeklyActivities = section.items.filter((item) => item.activity === "esoft" || item.activity === "imcq" || item.activity === "small-group");
  return section.items.length > 0 && weeklyActivities.length / section.items.length >= 0.8;
}

function itemNumber(label: string): number | undefined {
  const match = label.match(/\b(?:lecture|dla|sg|imcq|quiz|lab|case)\s*0*(\d{1,3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function templateKey(module: string, item: CourseTemplateItem): string {
  const identity = item.number !== undefined
    ? String(item.number)
    : item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${moduleKey(module)}|${item.activity === "flipped-lecture" ? "lecture" : item.activity}|${identity}`;
}
