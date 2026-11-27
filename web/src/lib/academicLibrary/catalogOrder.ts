import { canonicalModuleKey } from "../course-engine/vocabulary";
import { SGU_CURRICULUM } from "../curricula";

const termNumber = (term: string): number => {
  const match = term.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/** Position of a module within its term in the SGU outline; unknown modules sort after. */
export function curriculumModuleRank(term: string, module: string): number {
  const number = termNumber(term);
  const outline = SGU_CURRICULUM.terms.find(entry => termNumber(entry.name) === number);
  const key = canonicalModuleKey(module);
  const index = outline?.courses.flatMap(course => course.modules).findIndex(entry => canonicalModuleKey(entry) === key) ?? -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Term 1 to Term 5, then the outline's module order, then name. */
export function compareCourses(left: { term: string; module: string }, right: { term: string; module: string }): number {
  return termNumber(left.term) - termNumber(right.term)
    || curriculumModuleRank(left.term, left.module) - curriculumModuleRank(right.term, right.module)
    || left.module.localeCompare(right.module, undefined, { numeric: true, sensitivity: "base" });
}

/** Courses grouped by term in curriculum order, keeping every course once.
 * Accepted Term 1-5 aliases share a heading; the original course record and
 * unrecognized term labels remain untouched. */
export function coursesByTerm<T extends { term: string; module: string }>(courses: readonly T[]): Array<{ term: string; courses: T[] }> {
  const groups = new Map<string, T[]>();
  for (const course of [...courses].sort(compareCourses)) {
    const number = termNumber(course.term);
    const heading = number >= 1 && number <= 5 ? `Term ${number}` : course.term;
    groups.set(heading, [...(groups.get(heading) ?? []), course]);
  }
  return [...groups].map(([term, entries]) => ({ term, courses: entries }));
}
