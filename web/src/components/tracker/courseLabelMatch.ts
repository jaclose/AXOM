import { canonicalModuleKey, moduleKey } from "../../lib/course-engine/vocabulary";

/** Display-level match only. Storage ownership still uses the exact course ID. */
export function sameCourseLabel(left: { term: string; module: string }, right: { term: string; module: string }): boolean {
  const term = (value: string) => {
    const numbered = value.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
    return numbered ? `term${Number(numbered[1])}` : moduleKey(value);
  };
  const module = canonicalModuleKey(left.module);
  return Boolean(module) && module === canonicalModuleKey(right.module)
    && term(left.term) === term(right.term);
}
