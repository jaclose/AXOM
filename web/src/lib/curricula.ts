// Curriculum templates: the term -> course -> module shells a study path can
// install into Course Tracker. Data only; setup (lib/setupPlan.ts) and the
// SGU track (lib/tracks.ts) read from here, so a school's structure is edited
// in one place. Templates never carry example tracker rows: a new student's
// tracker should show their own work, not ours.
import type { Course, Term, TrackerItem } from "./types";

export interface CurriculumCourse {
  code: string;
  name: string;
  modules: string[];
}

export interface CurriculumTerm {
  name: string;
  courses: CurriculumCourse[];
}

export interface CurriculumTemplate {
  id: string;
  label: string;
  terms: CurriculumTerm[];
}

const BOARD_MODULES = ["Content review", "Question banks", "Practice exams"];

/** SGU MD, as JD laid it out (Ideas 3). Term 3 is split at the midterm. */
export const SGU_CURRICULUM: CurriculumTemplate = {
  id: "sgu-md",
  label: "St. George's University MD",
  terms: [
    { name: "Term 1", courses: [{ code: "BPM 500", name: "Basic Principles of Medicine I", modules: ["FTM 1", "FTM 2", "MSK", "CPR 1", "CPR 2", "BSCE 1"] }] },
    { name: "Term 2", courses: [{ code: "BPM 501", name: "Basic Principles of Medicine II", modules: ["ER", "DM", "NB1", "NB2", "NB3", "BSCE 2"] }] },
    { name: "Term 3", courses: [{ code: "BPM 502", name: "Basic Principles of Medicine III", modules: ["Pre-Midterm", "Post-Midterm"] }] },
    { name: "Term 4", courses: [{ code: "PPM 500", name: "Principles & Practice of Medicine I", modules: ["FTCM", "NCRS", "RHPS", "DERS", "BSCE 3"] }] },
    { name: "Term 5", courses: [{ code: "PPM 501", name: "Principles & Practice of Medicine II", modules: ["NMI", "CPRH", "GOER", "DNPR"] }] },
    {
      name: "Boards",
      courses: [
        { code: "CBSE", name: "Comprehensive Basic Science Exam", modules: BOARD_MODULES },
        { code: "STEP 1", name: "USMLE Step 1", modules: BOARD_MODULES },
      ],
    },
  ],
};

export const CURRICULA: readonly CurriculumTemplate[] = [SGU_CURRICULUM];

export function curriculumById(id: string | undefined): CurriculumTemplate | undefined {
  return CURRICULA.find((template) => template.id === id);
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${counter}-${random}`;
}

/** Term and course records for a template (fresh ids every time). */
export function buildCurriculum(template: CurriculumTemplate): { terms: Term[]; courses: Course[] } {
  const terms: Term[] = template.terms.map((term) => ({ id: newId("term"), name: term.name }));
  const courses: Course[] = template.terms.flatMap((term, index) => term.courses.map((course) => ({
    id: newId("course"),
    termId: terms[index].id,
    code: course.code,
    name: course.name,
    files: 0,
    modules: course.modules.map((name) => ({ id: newId("module"), name })),
  })));
  return { terms, courses };
}

/** Seed examples (label starts with "Example") make way for a real structure. */
export function withoutExampleRows(rows: TrackerItem[]): TrackerItem[] {
  return rows.filter((row) => !/^example(?:[:\s]|$)/i.test(row.label.trim()));
}
