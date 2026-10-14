// Legacy questions did not store courseId. Project a course only for the week
// overview when exactly one active course owns the canonical module code.
// This never alters the store or source provenance; ambiguous ownership stays
// unresolved instead of being counted in several courses.
import { questionScope } from "../../lib/course-engine/scope";
import { canonicalModuleKey } from "../../lib/course-engine/vocabulary";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { Course, ID } from "../../lib/types";

export function questionsWithUnambiguousCourse(
  questions: readonly QuestionRecord[],
  courses: readonly Course[],
  setsById?: ReadonlyMap<ID, Pick<QuestionSet, "scope">>,
): QuestionRecord[] {
  const courseOwners = new Map<string, Set<ID>>();
  for (const course of courses) {
    for (const module of course.modules) {
      const key = canonicalModuleKey(module.name);
      if (!key) continue;
      const ids = courseOwners.get(key) ?? new Set<ID>();
      ids.add(course.id);
      courseOwners.set(key, ids);
    }
  }
  return questions.map((question) => {
    const scope = questionScope(question, setsById);
    if (scope.courseId) return question;
    const key = canonicalModuleKey(scope.module ?? "");
    const owners = courseOwners.get(key);
    if (!owners || owners.size !== 1) return question;
    const [courseId] = [...owners];
    return { ...question, courseId };
  });
}
