import { courseTemplateVersions, savedCourseTemplates, type SavedCourseTemplate } from "../course-engine/templateLibrary";
import { planCourseTemplate, reconcileCourseTemplate, type CourseTemplateSection } from "../course-engine/templateParse";
import { countActivity, type CourseActivity } from "../course-engine/activity";
import { canonicalModuleKey, moduleKey } from "../course-engine/vocabulary";
import { CURRICULA } from "../curricula";
import type { SourceDocument } from "../library";
import { buildCourseBooks, courseBookId, type CourseBook } from "./courseBooks";
import type { Course, Term, TrackerItem } from "../types";
import { commitCourseLoad, type SaveOutcome } from "./loadCourse";

const termKey = (term: string): string => {
  const numbered = term.trim().match(/^(?:t|term)\s*0*(\d{1,2})$/i);
  return numbered ? `term${Number(numbered[1])}` : moduleKey(term);
};

const sectionMatchesBook = (section: Pick<CourseTemplateSection, "module" | "term">, book: CourseBook): boolean =>
  canonicalModuleKey(section.module) === canonicalModuleKey(book.module)
  && (!section.term || termKey(section.term) === termKey(book.term));

const matchingBooks = (section: Pick<CourseTemplateSection, "module" | "term">, books: readonly CourseBook[]): CourseBook[] =>
  books.filter((book) => sectionMatchesBook(section, book));

const sameBook = (left: CourseBook, right: CourseBook): boolean =>
  termKey(left.term) === termKey(right.term)
  && moduleKey(left.courseCode ?? "") === moduleKey(right.courseCode ?? "")
  && canonicalModuleKey(left.module) === canonicalModuleKey(right.module);

const bookOwnerKey = (book: CourseBook): string => [
  termKey(book.term), moduleKey(book.courseCode ?? ""), canonicalModuleKey(book.module),
].join("|");

const HOSTED_COURSE_CODE = /^academic:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HostedTemplateReference {
  collectionId: string;
  templateIds: string[];
}

function hostedTemplateReference(document: SourceDocument): HostedTemplateReference | undefined {
  if (document.fileType !== "axom-academic-reference") return;
  try {
    const reference = JSON.parse(document.rawText) as {
      collectionId?: unknown; revisionId?: unknown; accountId?: unknown; templateIds?: unknown;
    };
    if (typeof reference.collectionId !== "string" || !HOSTED_COURSE_CODE.test(`academic:${reference.collectionId}`)
      || typeof reference.revisionId !== "string" || document.id !== `academic-${reference.revisionId}`
      || typeof reference.accountId !== "string" || !reference.accountId.length
      || !Array.isArray(reference.templateIds)
      || reference.templateIds.some(id => typeof id !== "string" || !id.length)) return;
    return { collectionId: reference.collectionId, templateIds: reference.templateIds };
  } catch { return; }
}

function hostedTemplateOwners(documents: readonly SourceDocument[], templateId: string): Set<string> {
  return new Set(documents.flatMap(document => {
    const reference = hostedTemplateReference(document);
    return reference?.templateIds.includes(templateId) ? [reference.collectionId] : [];
  }));
}

function templateBelongsToBook(documents: readonly SourceDocument[], templateId: string, book: CourseBook): boolean {
  const owners = hostedTemplateOwners(documents, templateId);
  if (!owners.size) return true;
  const collectionId = book.courseCode?.trim().match(HOSTED_COURSE_CODE)?.[0]?.slice("academic:".length);
  return Boolean(collectionId && owners.has(collectionId));
}

function hasVerifiedHostedBinding(book: CourseBook, documents: readonly SourceDocument[]): boolean {
  const collectionId = book.courseCode?.trim().match(HOSTED_COURSE_CODE)?.[0]?.slice("academic:".length);
  const selectedTemplateIds = book.templateIds;
  if (!collectionId || !selectedTemplateIds?.length) return false;
  return documents.some((document) => {
    const reference = hostedTemplateReference(document);
    return reference?.collectionId === collectionId
      && selectedTemplateIds.every((id) => reference.templateIds.includes(id));
  });
}

function belongsToCurriculum(book: CourseBook): boolean {
  const curriculum = CURRICULA.find((candidate) => candidate.id === book.curriculumId);
  return Boolean(curriculum?.terms.some((term) => termKey(term.name) === termKey(book.term)
    && term.courses.some((course) => moduleKey(course.code) === moduleKey(book.courseCode ?? "")
      && course.modules.some((module) => canonicalModuleKey(module) === canonicalModuleKey(book.module)))));
}

function hasResolvedCourseOwner(
  book: CourseBook,
  canonicalBooks: readonly CourseBook[],
  documents: readonly SourceDocument[],
): boolean {
  const courseCode = book.courseCode?.trim();
  if (!courseCode) return false;
  if (canonicalBooks.some(owner => sameBook(owner, book))) return true;

  // A claimed curriculum id is useful only when its real outline contains this
  // exact term/course/module owner. Hosted courses must also have the durable
  // authenticated download receipt written before activation; a UUID-shaped
  // string by itself is not ownership evidence.
  if (!book.templateIds?.length) return false;
  return belongsToCurriculum(book) || hasVerifiedHostedBinding(book, documents);
}

function distinctOwners(books: readonly CourseBook[]): CourseBook[] {
  const byOwner = new Map<string, CourseBook>();
  for (const book of books) {
    const key = bookOwnerKey(book);
    const current = byOwner.get(key);
    // The live workspace record is authoritative when a curriculum shell names
    // the same owner. Counting both would turn one course into false ambiguity.
    if (!current || (current.origin === "curriculum" && book.origin === "workspace")) byOwner.set(key, book);
  }
  return [...byOwner.values()];
}

export function canonicalCourseOwnerUniverse(
  workspace: { terms: readonly Term[]; courses: readonly Course[]; tracker: readonly TrackerItem[] },
  selected: CourseBook,
): CourseBook[] {
  return distinctOwners([
    ...buildCourseBooks({ ...workspace, curricula: CURRICULA }),
    selected,
  ]);
}

interface TemplateResolution {
  templates: SavedCourseTemplate[];
  error?: string;
}

function resolveTemplatesForBook(
  documents: readonly SourceDocument[],
  book: CourseBook,
  ownershipBooks: readonly CourseBook[],
): TemplateResolution {
  const saved = savedCourseTemplates(documents);
  if (book.templateIds !== undefined) {
    if (!book.templateIds.length) return { templates: [], error: "This course has no prepared plan to load." };
    if (new Set(book.templateIds).size !== book.templateIds.length) {
      return { templates: [], error: "This course plan contains duplicate template references. Reopen the course before loading it." };
    }
    const byId = new Map(saved.map(template => [template.document.id, template]));
    const exact = book.templateIds.map(id => byId.get(id));
    if (exact.some(template => !template)) {
      return { templates: [], error: "This course plan is no longer the exact saved version. Reopen the course before loading it." };
    }
    const templates = exact as SavedCourseTemplate[];
    if (templates.some(({ document }) => !templateBelongsToBook(documents, document.id, book))) {
      return { templates: [], error: "A downloaded course plan belongs to a different hosted course. Nothing was loaded." };
    }
    if (templates.some(({ section }) => !sectionMatchesBook(section, book))) {
      return { templates: [], error: "A saved course plan belongs to a different term or module. Nothing was loaded." };
    }
    return { templates };
  }

  const candidates = courseTemplateVersions(saved.filter(({ document, section }) =>
    sectionMatchesBook(section, book) && templateBelongsToBook(documents, document.id, book)))
    .map(versions => versions[0]);
  if (!candidates.length) return { templates: [], error: "No prepared course plan matches this term and module." };
  const owned = candidates.filter(({ document, section }) => {
    if (hostedTemplateOwners(documents, document.id).size) return true;
    const owners = matchingBooks(section, ownershipBooks);
    return owners.length === 1 && sameBook(owners[0], book);
  });
  if (!owned.length) {
    return { templates: [], error: "More than one course can own this unbound plan. Choose an exact course plan before loading it." };
  }
  const reviewed = owned.filter(({ section }) => section.context?.authority === "reviewed" && section.context.sources.length && !section.problems.length)
    .sort((a, b) => (b.section.context?.sourceRevision ?? "").localeCompare(a.section.context?.sourceRevision ?? ""));
  // Reviewed complete plans supersede inferred lists for preview, never delete them.
  // Different cohorts remain separately selectable in the saved template library.
  return { templates: reviewed.length ? [reviewed[0]] : owned };
}

/**
 * Course templates created before course ownership was recorded are accepted
 * only when the supplied shelf has one possible owner. A book carrying exact
 * template ids is an explicit learner selection and remains loadable.
 */
export function templatesForBook(
  documents: readonly SourceDocument[],
  book: CourseBook,
  ownershipBooks: readonly CourseBook[] = [book],
) {
  return resolveTemplatesForBook(documents, book, distinctOwners(ownershipBooks)).templates;
}

function trackerPlacement(path: string): { term: string; course?: string; module: string } | undefined {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (/^(?:week|wk)\s*\d{1,2}$/i.test(segments.at(-1) ?? "") || /^unscheduled$/i.test(segments.at(-1) ?? "")) segments.pop();
  if (segments.length < 2) return undefined;
  const term = segments.shift()!;
  const module = segments.pop()!;
  const course = segments.join("/").trim() || undefined;
  return { term, course, module };
}

function trackerBelongsToBook(item: TrackerItem, book: CourseBook, books: readonly CourseBook[]): boolean {
  const place = trackerPlacement(item.path);
  if (!place || termKey(place.term) !== termKey(book.term)
    || canonicalModuleKey(place.module) !== canonicalModuleKey(book.module)) return false;
  if (place.course) return Boolean(book.courseCode) && moduleKey(place.course) === moduleKey(book.courseCode ?? "");
  return matchingBooks({ term: book.term, module: book.module }, books).length === 1;
}

function planForBook(templates: readonly SavedCourseTemplate[], book: CourseBook) {
  return planCourseTemplate(templates.map(template => template.section), {
    term: book.term,
    ...(book.courseCode ? { course: book.courseCode } : {}),
    moduleName: book.module,
  });
}

export function withPreparedCourses(
  books: CourseBook[],
  documents: readonly SourceDocument[],
  tracker: readonly TrackerItem[] = [],
  ownershipBooks?: readonly CourseBook[],
): CourseBook[] {
  const collection = [...books];
  for (const { document, section } of savedCourseTemplates(documents)) {
    if (hostedTemplateOwners(documents, document.id).size) continue;
    if (matchingBooks(section, collection).length) continue;
    const term = section.term ?? "Term unconfirmed";
    collection.push({ kind: "course", id: courseBookId(term, term, section.module), title: section.module, module: section.module,
      term, shelf: term, count: 0, countLabel: "0 activities", state: "empty", origin: "curriculum", weeks: [], unfiled: 0, done: 0 });
  }
  const owners = distinctOwners(ownershipBooks ?? collection);
  return collection.map(book => {
    const templates = templatesForBook(documents, book, owners);
    if (!templates.length) return book;
    const plan = planForBook(templates, book);
    const scopedTracker = tracker.filter(item => trackerBelongsToBook(item, book, owners));
    const loaded = new Set(scopedTracker.flatMap(item => item.templateKey ? [item.templateKey] : []));
    const completed = new Set(scopedTracker.flatMap(item => item.templateKey && item.passes > 0 ? [item.templateKey] : []));
    const weeks = [...new Set(plan.items.flatMap(i => i.week ? [i.week] : []))].sort((a, b) => a - b).map(week => {
      const items = plan.items.filter(i => i.week === week);
      const counts = new Map<CourseActivity, number>();
      items.forEach(i => counts.set(i.activity, (counts.get(i.activity) ?? 0) + 1));
      return { week, total: items.length, done: items.filter(item => completed.has(item.templateKey)).length,
        activities: [...counts].map(([activity, total]) => ({ activity, total,
          done: items.filter(item => item.activity === activity && completed.has(item.templateKey)).length,
          label: countActivity(activity, total) })),
        items: items.map(i => ({ id: i.templateKey, label: i.label, kind: i.activity })) };
    });
    return { ...book, weeks, done: plan.items.filter(item => completed.has(item.templateKey)).length, count: plan.items.length, countLabel: `${plan.items.length} activities`, state: "available" as const,
      stateNote: `${templates.length} prepared sections`, templateIds: templates.map(t => t.document.id), templateVersion: templates.map(t => t.document.checksum?.slice(0, 8)).join(" · "),
      loadedActivities: plan.items.filter(i => loaded.has(i.templateKey)).length, academicContext: templates[0].section.context,
      unfiled: plan.items.filter(i => !i.week).length };
  });
}
export async function loadPreparedCourse(
  book: CourseBook,
  selectedWeeksOrAssert?: readonly number[] | (() => void),
  currentGuard: () => void = () => {},
): Promise<SaveOutcome> {
  const selectedWeeks = typeof selectedWeeksOrAssert === "function" ? undefined : selectedWeeksOrAssert;
  const assertCurrent = typeof selectedWeeksOrAssert === "function" ? selectedWeeksOrAssert : currentGuard;
  if (selectedWeeks && !selectedWeeks.some(week => book.weeks.some(entry => entry.week === week))) return { status: "nothing-to-save" };
  if (book.term === "Term unconfirmed") return { status: "failed", message: "Choose the term in Customize Weeks & Activities before loading this template." };
  try {
    const [{ useStore }, vault] = await Promise.all([import("../store"), import("../localVault")]);
    assertCurrent();
    const s = useStore.getState();
    const canonicalBooks = buildCourseBooks({ ...s, curricula: CURRICULA });
    if (!hasResolvedCourseOwner(book, canonicalBooks, s.documents)) {
      return { status: "failed", message: "Choose the course that owns this prepared plan before loading it. Nothing was changed." };
    }
    const ownershipBooks = canonicalCourseOwnerUniverse(s, book);
    const resolution = resolveTemplatesForBook(s.documents, book, ownershipBooks);
    if (resolution.error) return { status: "failed", message: resolution.error };
    const templates = resolution.templates;
    const plan = planForBook(templates, book);
    if (plan.problems.length) {
      return { status: "failed", message: `Review this course plan before loading it. ${plan.problems.slice(0, 2).join(" ")}` };
    }
    const items = selectedWeeks === undefined ? plan.items : plan.items.filter(item => item.week !== undefined && selectedWeeks.includes(item.week));
    if (!items.length) return { status: "nothing-to-save" };
    const possibleOwners = matchingBooks({ term: book.term, module: book.module }, ownershipBooks);
    const changes = reconcileCourseTemplate({ ...plan, items }, s.tracker, {
      legacyCourseAdoption: possibleOwners.length === 1 && sameBook(possibleOwners[0], book) ? "confirmed-unique" : "review",
    });
    if (changes.review?.length) {
      return { status: "failed", message: `${changes.review.length} course activit${changes.review.length === 1 ? "y needs" : "ies need"} identity review before this course can be loaded. Nothing was changed.` };
    }
    assertCurrent();
    // Every identity and ownership check above is read-only. Course structure
    // is committed only after the complete activation is known to be safe.
    const structure = await commitCourseLoad(book, assertCurrent);
    if (structure.status === "failed") return structure;
    assertCurrent();
    if (!changes.create.length) return structure;
    const checkpoint = vault.getVaultWriteCheckpoint();
    if (changes.create.length) s.bulkAddTrackerItems(changes.create.map(item => ({ path: item.path, label: item.label, kind: item.kind,
      passes: 0, ankiPasses: 0, yield: "none", activity: item.activity, templateKey: item.templateKey, weekSource: item.weekSource })));
    // Existing labels, notes and progress are learner-owned. Version customization is explicit.
    await vault.flushLocalVaultWrites();
    vault.assertVaultWritesSince(checkpoint);
    assertCurrent();
    return { status: "saved-on-device" };
  } catch (error) { return { status: "failed", message: error instanceof Error ? error.message : "Course could not be saved." }; }
}
