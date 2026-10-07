// ===========================================================================
// The words a learner's school uses, as data. The mapping engine holds no
// course names: it reads module codes from the learner's own courses and
// templates, and activity words from this table, which a template may extend.
//
// Dependency-free on purpose: scripts/inventory-sources.mjs imports this.
// ===========================================================================
import type { CourseActivity } from "./activity.ts";

export interface ModuleVocabulary {
  /** The code as the learner writes it: "FTM1". */
  code: string;
  /** Other spellings seen in file and folder names: "FTM 1". */
  aliases?: string[];
  /** The term it belongs to, when that is known: "T1". */
  term?: string;
}

export interface ActivityVocabulary {
  activity: CourseActivity;
  /** Case-insensitive pattern sources, tested against a name with separators as spaces. */
  patterns: string[];
}

export interface SourceVocabulary {
  modules: ModuleVocabulary[];
  /** Tested in order, so the more specific activity comes first. */
  activities: ActivityVocabulary[];
  /** Names that mark a list pointing into a book or site, not a set of questions. */
  referenceSources: string[];
}

/**
 * Checked top to bottom. A file named "Lecture 11 Practice Questions" is
 * practice questions about a lecture, so question words outrank "lecture".
 */
export const DEFAULT_ACTIVITY_VOCABULARY: ActivityVocabulary[] = [
  { activity: "imcq", patterns: ["\\bimcqs?\\b"] },
  { activity: "esoft", patterns: ["\\be ?soft\\b", "\\bexam ?soft\\b"] },
  // "Lecture_DLA Objectives" is the objectives list, not a lecture or a DLA.
  { activity: "objectives", patterns: ["\\b(?:learning\\s+)?objectives\\b"] },
  { activity: "pq", patterns: ["\\bpqs?\\b", "\\bpractice\\s+questions?\\b", "\\bprob(?:lem)?\\s+sets?\\b", "\\bquestions?\\s+and\\s+answers\\b", "\\bmcqs?\\b"] },
  { activity: "small-group", patterns: ["\\bsgs?\\b", "\\bsmall\\s+groups?\\b"] },
  { activity: "dla", patterns: ["\\bdlas?\\b"] },
  { activity: "lab", patterns: ["\\blab\\b", "\\bpractical\\b"] },
  { activity: "case", patterns: ["\\bcases?\\b"] },
  { activity: "assignment", patterns: ["\\btake\\s+home\\b", "\\bassignment\\b"] },
  { activity: "review", patterns: ["\\breview\\b", "\\bcumulative\\b", "\\bsummary\\b", "\\bjeopardy\\b", "\\boffice\\s+hours\\b"] },
  { activity: "assessment", patterns: ["\\bexam\\b", "\\bquiz\\b", "\\bmidterm\\b", "\\bfinal\\b"] },
  { activity: "flipped-lecture", patterns: ["\\bflipped\\b"] },
  { activity: "lecture", patterns: ["\\blectures?\\b", "\\bslides\\b"] },
];

/** Question books and sites a school list may point into. */
export const DEFAULT_REFERENCE_SOURCES = [
  "from gray", "gray's", "lippincott", "guyton", "clinicalkey", "first aid", "pretest", "brs",
];

export function buildVocabulary(
  modules: readonly ModuleVocabulary[],
  extra: Partial<Pick<SourceVocabulary, "activities" | "referenceSources">> = {},
): SourceVocabulary {
  return {
    modules: dedupeModules(modules),
    // A template's own words are tried before the defaults.
    activities: [...(extra.activities ?? []), ...DEFAULT_ACTIVITY_VOCABULARY],
    referenceSources: [...new Set([...(extra.referenceSources ?? []), ...DEFAULT_REFERENCE_SOURCES])],
  };
}

/**
 * The vocabulary a workspace already implies: every module of every course,
 * with the term its course sits in. This is how a file named after a module
 * finds its term without the name saying so.
 */
export function vocabularyFromCourses(
  terms: ReadonlyArray<{ id: string; name: string }>,
  courses: ReadonlyArray<{ termId: string; modules: ReadonlyArray<{ name: string }> }>,
  aliasesFor: (module: string) => string[] = () => [],
): SourceVocabulary {
  const termName = new Map(terms.map((term) => [term.id, term.name]));
  return buildVocabulary(courses.flatMap((course) => course.modules.map((module) => ({
    code: module.name,
    aliases: aliasesFor(module.name),
    term: termName.get(course.termId),
  }))));
}

/** "FTM 1", "ftm1" and "FTM-1" are one module. */
export function moduleKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeModules(modules: readonly ModuleVocabulary[]): ModuleVocabulary[] {
  const byKey = new Map<string, ModuleVocabulary>();
  for (const module of modules) {
    const key = moduleKey(module.code);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing
      ? {
          code: existing.code,
          term: existing.term ?? module.term,
          aliases: [...new Set([...(existing.aliases ?? []), ...(module.aliases ?? []), module.code])]
            .filter((alias) => alias !== existing.code),
        }
      : { ...module });
  }
  return [...byKey.values()];
}
