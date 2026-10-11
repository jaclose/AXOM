import { courseTemplateVersions, savedCourseTemplates } from "../course-engine/templateLibrary";
import { moduleAliases, planCourseTemplate, reconcileCourseTemplate } from "../course-engine/templateParse";
import { countActivity, type CourseActivity } from "../course-engine/activity";
import { moduleKey } from "../course-engine/vocabulary";
import type { SourceDocument } from "../library";
import { courseBookId, type CourseBook } from "./courseBooks";
import type { TrackerItem } from "../types";
import { commitCourseLoad, type SaveOutcome } from "./loadCourse";

export function templatesForBook(documents: readonly SourceDocument[], book: CourseBook) {
  return courseTemplateVersions(savedCourseTemplates(documents)).map(versions => versions[0]).filter(({ section }) =>
    moduleKey(section.module) === moduleKey(book.module) && (!section.term || moduleKey(section.term) === moduleKey(book.term)));
}
export function withPreparedCourses(books: CourseBook[], documents: readonly SourceDocument[], tracker: readonly TrackerItem[] = []): CourseBook[] {
  const collection = [...books];
  for (const { section } of savedCourseTemplates(documents)) {
    if (collection.some(book => moduleKey(book.module) === moduleKey(section.module) && (!section.term || section.term === book.term))) continue;
    const related = books.find(book => moduleAliases(section.module).map(moduleKey).includes(moduleKey(book.module)));
    const term = section.term ?? related?.term ?? "Term unconfirmed";
    const course = related ?? books.find(book => book.term === term);
    collection.push({ kind: "course", id: courseBookId(term, course?.courseCode ?? term, section.module), title: section.module, module: section.module,
      term, shelf: term, courseCode: course?.courseCode, courseName: course?.courseName, count: 0, countLabel: "0 activities", state: "empty", origin: "curriculum", weeks: [], unfiled: 0, done: 0 });
  }
  return collection.map(book => {
    const templates = templatesForBook(documents, book);
    if (!templates.length) return book;
    const plan = planCourseTemplate(templates.map(t => t.section), { term: book.term });
    const loaded = new Set(tracker.flatMap(item => item.templateKey ? [item.templateKey] : []));
    const weeks = [...new Set(plan.items.flatMap(i => i.week ? [i.week] : []))].sort((a, b) => a - b).map(week => {
      const items = plan.items.filter(i => i.week === week);
      const counts = new Map<CourseActivity, number>();
      items.forEach(i => counts.set(i.activity, (counts.get(i.activity) ?? 0) + 1));
      return { week, total: items.length, done: book.weeks.find(w => w.week === week)?.done ?? 0,
        activities: [...counts].map(([activity, total]) => ({ activity, total, done: 0, label: countActivity(activity, total) })),
        items: items.map(i => ({ id: i.templateKey, label: i.label, kind: i.activity })) };
    });
    return { ...book, weeks, count: plan.items.length, countLabel: `${plan.items.length} activities`, state: "available" as const,
      stateNote: `${templates.length} prepared sections`, templateIds: templates.map(t => t.document.id), templateVersion: templates.map(t => t.document.checksum?.slice(0, 8)).join(" · "),
      loadedActivities: plan.items.filter(i => loaded.has(i.templateKey)).length,
      unfiled: plan.items.filter(i => !i.week).length };
  });
}
export async function loadPreparedCourse(book: CourseBook, assertCanWrite: () => void = () => {}): Promise<SaveOutcome> {
  if (book.term === "Term unconfirmed") return { status: "failed", message: "Choose the term in Customize Weeks & Activities before loading this template." };
  try {
    const [{ useStore }, vault] = await Promise.all([import("../store"), import("../localVault")]);
    assertCanWrite();
    const structure = await commitCourseLoad(book, assertCanWrite);
    if (structure.status === "failed") return structure;
    assertCanWrite();
    const s = useStore.getState();
    const sections = templatesForBook(s.documents, book).map(t => t.section);
    if (!sections.length) return structure;
    const checkpoint = vault.getVaultWriteCheckpoint();
    const changes = reconcileCourseTemplate(planCourseTemplate(sections, { term: book.term }), s.tracker);
    assertCanWrite();
    if (changes.create.length) s.bulkAddTrackerItems(changes.create.map(item => ({ path: item.path, label: item.label, kind: item.kind,
      passes: 0, ankiPasses: 0, yield: "none", activity: item.activity, templateKey: item.templateKey, weekSource: item.weekSource })));
    // Existing labels, notes and progress are learner-owned. Version customization is explicit.
    await vault.flushLocalVaultWrites(); vault.assertVaultWritesSince(checkpoint); assertCanWrite();
    return { status: changes.create.length ? "saved-on-device" : "nothing-to-save" };
  } catch (error) { return { status: "failed", message: error instanceof Error ? error.message : "Course could not be saved." }; }
}
