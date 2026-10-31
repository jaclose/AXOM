import type { AcademicPhase, Course, ExperienceFocusId, Term } from "./types";

export interface FocusOption {
  id: ExperienceFocusId;
  label: string;
  group: "Course Terms" | "Boards" | "Pre-Med";
  blurb: string;
  phase: AcademicPhase;
  cardTarget: number;
  minuteTarget: number;
  tagline: string;
}

export const FOCUS_OPTIONS: FocusOption[] = [
  {
    id: "term1",
    label: "Term 1 · BPM 500",
    group: "Course Terms",
    blurb: "FTM 1, FTM 2, MSK, CPR 1, CPR 2, and BSCE T1.",
    phase: "preclinical",
    cardTarget: 100,
    minuteTarget: 220,
    tagline: "Term 1 foundation: clean passes, small daily wins.",
  },
  {
    id: "term2",
    label: "Term 2 · BPM 501",
    group: "Course Terms",
    blurb: "ER, DM, NB1, NB2, NB3, and BSCE T2.",
    phase: "preclinical",
    cardTarget: 130,
    minuteTarget: 260,
    tagline: "Term 2 systems mode: lecture, DLA, PQ, repair.",
  },
  {
    id: "term3",
    label: "Term 3 · BPM 502",
    group: "Course Terms",
    blurb: "Pre-midterm and post-midterm module structure.",
    phase: "preclinical",
    cardTarget: 140,
    minuteTarget: 270,
    tagline: "Term 3: organize the split, protect the cadence.",
  },
  {
    id: "term4",
    label: "Term 4 · PPM 500",
    group: "Course Terms",
    blurb: "FTCM pending structure and BSCE T4 readiness.",
    phase: "clinical",
    cardTarget: 110,
    minuteTarget: 220,
    tagline: "Term 4: clinical bridge with board discipline.",
  },
  {
    id: "term5",
    label: "Term 5 · PPM 501",
    group: "Course Terms",
    blurb: "CBSE-facing final preclinical runway.",
    phase: "step1-dedicated",
    cardTarget: 180,
    minuteTarget: 330,
    tagline: "Term 5: CBSE runway, questions first.",
  },
  {
    id: "cbse",
    label: "CBSE",
    group: "Boards",
    blurb: "NBME-style basic science readiness before Step 1.",
    phase: "step1-dedicated",
    cardTarget: 200,
    minuteTarget: 360,
    tagline: "CBSE mode: blueprint, questions, repair, retest.",
  },
  {
    id: "step1",
    label: "Step 1",
    group: "Boards",
    blurb: "Broad USMLE blueprint domains with weak-area logging.",
    phase: "step1-dedicated",
    cardTarget: 200,
    minuteTarget: 360,
    tagline: "Step 1: one blueprint, one repair loop.",
  },
  {
    id: "step2",
    label: "Step 2 CK",
    group: "Boards",
    blurb: "Clinical systems, diagnosis, management, and shelf repair.",
    phase: "step2-dedicated",
    cardTarget: 180,
    minuteTarget: 300,
    tagline: "Step 2 CK: clinical reasoning under time.",
  },
  {
    id: "step3",
    label: "Step 3",
    group: "Boards",
    blurb: "Management, prognosis, safety, and CCS-style planning.",
    phase: "clinical",
    cardTarget: 90,
    minuteTarget: 180,
    tagline: "Step 3: safe management, steady execution.",
  },
  {
    id: "shelf",
    label: "Shelf Exams",
    group: "Boards",
    blurb: "Rotation-specific questions, algorithms, and missed concepts.",
    phase: "clinical",
    cardTarget: 80,
    minuteTarget: 150,
    tagline: "Shelf mode: ward day plus protected recall.",
  },
  {
    id: "mcat",
    label: "MCAT",
    group: "Pre-Med",
    blurb: "Content review, full-lengths, CARS, and mistake repair.",
    phase: "mcat",
    cardTarget: 80,
    minuteTarget: 180,
    tagline: "MCAT mode: content, passages, review.",
  },
  {
    id: "premed",
    label: "Pre-Med",
    group: "Pre-Med",
    blurb: "Prereqs, application work, shadowing, and sustainable reps.",
    phase: "pre-med",
    cardTarget: 60,
    minuteTarget: 120,
    tagline: "Pre-med foundation: build quietly and consistently.",
  },
];

export const DEFAULT_FOCUS_IDS: ExperienceFocusId[] = ["term1", "step1"];

export const ACADEMIC_TEMPLATE_TERMS: Term[] = [
  { id: "term-1", name: "Term 1" },
  { id: "term-2", name: "Term 2" },
  { id: "term-3", name: "Term 3" },
  { id: "term-4", name: "Term 4" },
  { id: "term-5", name: "Term 5" },
];

export const ACADEMIC_TEMPLATE_COURSES: Array<Omit<Course, "id" | "modules"> & { id: string; modules: string[]; aliases: string[] }> = [
  {
    id: "course-bpm-500",
    termId: "term-1",
    code: "BPM 500",
    aliases: ["bpm500", "01bpm500"],
    name: "Basic Principles of Medicine I",
    files: 0,
    modules: ["FTM 1", "FTM 2", "MSK", "CPR 1", "CPR 2", "BSCE T1"],
  },
  {
    id: "course-bpm-501",
    termId: "term-2",
    code: "BPM 501",
    aliases: ["bpm501", "01bpm501"],
    name: "Basic Principles of Medicine II",
    files: 0,
    modules: ["ER", "DM", "NB1", "NB2", "NB3", "BSCE T2"],
  },
  {
    id: "course-bpm-502",
    termId: "term-3",
    code: "BPM 502",
    aliases: ["bpm502", "ppm502", "02ppm502"],
    name: "Basic Principles of Medicine III",
    files: 0,
    modules: ["Pre-Midterm", "Post-Midterm"],
  },
  {
    id: "course-ppm-500",
    termId: "term-4",
    code: "PPM 500",
    aliases: ["ppm500", "sppm500", "02ppm500"],
    name: "Principles & Practice of Medicine / FTCM",
    files: 0,
    modules: ["FTCM (pending)", "BSCE T4"],
  },
  {
    id: "course-ppm-501",
    termId: "term-5",
    code: "PPM 501",
    aliases: ["ppm501", "02ppm501"],
    name: "Principles & Practice of Medicine I",
    files: 0,
    modules: ["CBSE"],
  },
];

export function focusOption(id?: string) {
  return FOCUS_OPTIONS.find((option) => option.id === id);
}

export function normalizedFocusIds(value: unknown): ExperienceFocusId[] {
  const valid = new Set(FOCUS_OPTIONS.map((option) => option.id));
  const incoming = Array.isArray(value)
    ? value.filter((item): item is ExperienceFocusId => typeof item === "string" && valid.has(item as ExperienceFocusId))
    : [];
  return incoming.length ? [...new Set(incoming)] : DEFAULT_FOCUS_IDS;
}
