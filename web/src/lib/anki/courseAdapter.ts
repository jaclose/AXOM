// ===========================================================================
// The one adapter between AXOM's course model (Course, CourseModule, Term,
// TrackerItem) and the Anki link. Everything Anki-side (deck paths, tags,
// premade-deck mappings, Anki-round suggestions) reads courses through this
// catalog, so the course model can grow without touching the link.
//
// Tracker items carry no course id; they live under a path such as
// "Term 2/BPM 501/NB3/Lectures" or the short "T2/NB3/Lectures". Placement
// matches path segments against course codes/names and module names, and
// uses the term segment only to break ties. An ambiguous item stays
// unplaced rather than being guessed into the wrong module.
// ===========================================================================
import type { Course, Term, TrackerItem } from "../types";

export interface ModuleInfo {
  id: string;
  name: string;
  courseId: string;
}

export interface CourseInfo {
  id: string;
  code: string;
  name: string;
  termId: string;
  termName?: string;
  modules: ModuleInfo[];
}

export interface LectureInfo {
  id: string;
  label: string;
  kind: string;
  path: string;
  ankiPasses: number;
  courseId?: string;
  moduleId?: string;
}

export interface CourseCatalog {
  courses: CourseInfo[];
  course(id?: string): CourseInfo | undefined;
  module(id?: string): ModuleInfo | undefined;
  /** Tracker items placed under a module (lectures, DLAs, labs…). */
  lectures(moduleId: string): LectureInfo[];
  lecture(id?: string): LectureInfo | undefined;
  /** Every tracker item, placed or not. */
  allLectures: LectureInfo[];
}

export interface CatalogSource {
  courses: readonly Course[];
  terms?: readonly Term[];
  tracker?: readonly TrackerItem[];
}

/** Lowercase, collapse whitespace; "BPM 501" and "bpm501" compare equal. */
export function looseKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_\-.]+/g, "");
}

/** "Term 2" → "t2", "T2" → "t2", "Year 1" → "y1". */
function termKey(value: string): string {
  const match = value.trim().toLowerCase().match(/^(term|t|year|y|block|b|semester|sem|s)\s*0*(\d+)$/);
  if (!match) return looseKey(value);
  const letter = match[1].startsWith("y") ? "y" : match[1].startsWith("b") ? "b" : match[1].startsWith("s") ? "s" : "t";
  return `${letter}${match[2]}`;
}

export function placeTrackerItem(item: Pick<TrackerItem, "path">, courses: readonly CourseInfo[]): { courseId?: string; moduleId?: string } {
  const segments = item.path.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return {};
  const keys = segments.map(looseKey);
  const termKeys = new Set(segments.map(termKey));

  const courseMatches = courses.filter((course) =>
    keys.includes(looseKey(course.code)) || (course.name && keys.includes(looseKey(course.name))));
  if (courseMatches.length === 1) {
    const course = courseMatches[0];
    const module = course.modules.find((candidate) => keys.includes(looseKey(candidate.name)));
    return { courseId: course.id, moduleId: module?.id };
  }

  const pool = courseMatches.length > 1 ? courseMatches : courses;
  const moduleMatches = pool.flatMap((course) => course.modules
    .filter((module) => keys.includes(looseKey(module.name)))
    .map((module) => ({ course, module })));
  if (moduleMatches.length === 1) return { courseId: moduleMatches[0].course.id, moduleId: moduleMatches[0].module.id };
  if (moduleMatches.length > 1) {
    const byTerm = moduleMatches.filter(({ course }) => course.termName && termKeys.has(termKey(course.termName)));
    if (byTerm.length === 1) return { courseId: byTerm[0].course.id, moduleId: byTerm[0].module.id };
  }
  return {};
}

export function buildCourseCatalog(source: CatalogSource): CourseCatalog {
  const termNames = new Map((source.terms ?? []).map((term) => [term.id, term.name]));
  const courses: CourseInfo[] = source.courses.map((course) => ({
    id: course.id,
    code: course.code?.trim() ?? "",
    name: course.name?.trim() ?? "",
    termId: course.termId,
    termName: termNames.get(course.termId),
    modules: (course.modules ?? []).map((module) => ({ id: module.id, name: module.name.trim(), courseId: course.id })),
  }));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const moduleById = new Map(courses.flatMap((course) => course.modules.map((module) => [module.id, module] as const)));

  const allLectures: LectureInfo[] = (source.tracker ?? []).map((item) => ({
    id: item.id,
    label: item.label.trim(),
    kind: item.kind,
    path: item.path,
    ankiPasses: item.ankiPasses,
    ...placeTrackerItem(item, courses),
  }));
  const lectureById = new Map(allLectures.map((lecture) => [lecture.id, lecture]));
  const byModule = new Map<string, LectureInfo[]>();
  for (const lecture of allLectures) {
    if (!lecture.moduleId) continue;
    const list = byModule.get(lecture.moduleId) ?? [];
    list.push(lecture);
    byModule.set(lecture.moduleId, list);
  }

  return {
    courses,
    course: (id) => (id ? courseById.get(id) : undefined),
    module: (id) => (id ? moduleById.get(id) : undefined),
    lectures: (moduleId) => byModule.get(moduleId) ?? [],
    lecture: (id) => (id ? lectureById.get(id) : undefined),
    allLectures,
  };
}

/** Human label for a course: its code, else its name. */
export function courseLabel(course: Pick<CourseInfo, "code" | "name">): string {
  return course.code || course.name || "Untitled course";
}
