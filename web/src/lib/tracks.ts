// ===========================================================================
// Education tracks. The top-level "what are you studying for" choice, made
// first during onboarding. A track decides three things:
//   1. Structure  — which terms/courses are auto-seeded (Term 1/2 only for SGU).
//   2. Resources  — whether SGU drives show; everyone keeps personal + board drives.
//   3. Lanes      — which ExperienceFocusId options + which blueprint to install.
//
// Every track also carries an explicit *progress model* so "install blueprint"
// is never vague: it states what one pass means and when an item is done, in the
// vocabulary of that program (a prereq course is "passed", a Step domain is
// "mastered", a clinical block is "covered"). This is what makes adding, say, a
// pre-med prerequisite actually mean something instead of "it's a lecture now".
// ===========================================================================
import type { AcademicStageId, EducationTrackId, ExperienceFocusId, TrackerKind, Yield } from "./types";
import { SGU_CURRICULUM } from "./curricula";

export type TrackGroup = "Medical School" | "Pre-Health" | "Other Health Professions";

/** A course shell the track installs (lands on the Courses page). */
export interface BlueprintCourse {
  code: string;
  name: string;
  modules: string[];
}

/** A term/year/phase grouping for the blueprint's course shells. */
export interface BlueprintTerm {
  name: string;
  courses: BlueprintCourse[];
}

/** A starter Course-Tracker row the track installs, with a meaning-bearing note. */
export interface BlueprintTrackerRow {
  path: string;
  label: string;
  kind: TrackerKind;
  yield: Yield;
  note?: string;
}

export interface ProgressModel {
  /** One short line: what does a single "pass" represent here? */
  passMeaning: string;
  /** One short line: when is an item "done"? */
  doneMeaning: string;
  /** What the whole structure is for — shown above the blueprint installer. */
  summary: string;
  /** The noun for a structural unit ("term", "year", "block"). */
  unit: string;
}

export interface EducationTrack {
  id: EducationTrackId;
  label: string; // full name shown in the picker
  short: string; // chip / compact label
  program: string; // human description of the credential path
  blurb: string; // one-liner under the title
  group: TrackGroup;
  tier: number; // ordering — Medical School first, PA/Nursing last
  status: "live" | "planned"; // planned = pickable, but blueprint is a light stub
  icon: string; // lucide icon name, mapped in the UI
  /** Default value for the "show SGU drives" switch when this track is chosen. */
  showsSguResources: boolean;
  /** Study lanes (ExperienceFocusId) this track surfaces in onboarding. */
  focusIds: ExperienceFocusId[];
  defaultFocusId: ExperienceFocusId;
  /** Does choosing this track auto-create the term/course shells below? */
  seedsStructure: boolean;
  progress: ProgressModel;
  terms: BlueprintTerm[];
  trackerRows: BlueprintTrackerRow[];
}

export interface AcademicStageOption {
  id: AcademicStageId;
  label: string;
}

const MEDICAL_STAGES: AcademicStageOption[] = [
  { id: "preclinical", label: "Pre-clinical" },
  { id: "clinical-rotations", label: "Clinical rotations" },
  { id: "dedicated-board-prep", label: "Dedicated board preparation" },
  { id: "residency-application", label: "Residency application" },
  { id: "other", label: "Other / Custom" },
];

const PREHEALTH_STAGES: AcademicStageOption[] = [
  { id: "coursework", label: "Coursework" },
  { id: "exam-prep", label: "Exam preparation" },
  { id: "application", label: "Application" },
  { id: "other", label: "Other / Custom" },
];

const CLINICAL_PROGRAM_STAGES: AcademicStageOption[] = [
  { id: "didactic", label: "Didactic / classroom" },
  { id: "clinical-training", label: "Clinical training" },
  { id: "licensure-prep", label: "Licensure preparation" },
  { id: "application", label: "Job or residency application" },
  { id: "other", label: "Other / Custom" },
];

/** Stage is deliberately separate from exam/focus; every accepted track resolves. */
export const ACADEMIC_STAGES_BY_TRACK: Record<EducationTrackId, {
  defaultStageId: AcademicStageId;
  options: AcademicStageOption[];
}> = {
  sgu: { defaultStageId: "preclinical", options: MEDICAL_STAGES },
  usmd: { defaultStageId: "preclinical", options: MEDICAL_STAGES },
  do: { defaultStageId: "preclinical", options: MEDICAL_STAGES },
  img: { defaultStageId: "preclinical", options: MEDICAL_STAGES },
  premed: { defaultStageId: "coursework", options: PREHEALTH_STAGES },
  mcat: { defaultStageId: "exam-prep", options: PREHEALTH_STAGES },
  undergrad: { defaultStageId: "coursework", options: PREHEALTH_STAGES },
  nursing: { defaultStageId: "didactic", options: CLINICAL_PROGRAM_STAGES },
  pa: { defaultStageId: "didactic", options: CLINICAL_PROGRAM_STAGES },
};

export function academicStagesForTrack(trackId: EducationTrackId) {
  return ACADEMIC_STAGES_BY_TRACK[trackId];
}

export function isAcademicStageId(value: unknown): value is AcademicStageId {
  return typeof value === "string"
    && Object.values(ACADEMIC_STAGES_BY_TRACK).some((group) => group.options.some((option) => option.id === value));
}

// --- Reusable blueprint pieces ---------------------------------------------

// One source for the SGU structure: lib/curricula.ts (JD's Term 1-5 + Boards).
const SGU_TERMS: BlueprintTerm[] = SGU_CURRICULUM.terms.map((term) => ({
  name: term.name,
  courses: term.courses.map((course) => ({ code: course.code, name: course.name, modules: [...course.modules] })),
}));

const ORGAN_SYSTEMS = [
  "Cardiovascular", "Respiratory", "Renal", "Gastrointestinal",
  "Endocrine & Reproductive", "Neuro & Behavioral", "MSK & Derm", "Heme & Immune",
];

// US MD/DO/IMG share a generic, school-agnostic pre-clinical → clinical spine.
function medSchoolSpine(opts: { boardLabel: string }): BlueprintTerm[] {
  return [
    {
      name: "Pre-Clinical · Year 1",
      courses: [
        { code: "M1 · Foundations", name: "Foundations (anatomy, biochem, cell & molecular, immunology)", modules: ["Anatomy", "Biochemistry", "Cell & Molecular", "Immunology", "Microbiology"] },
        { code: "M1 · Systems A", name: "Early organ systems", modules: ORGAN_SYSTEMS.slice(0, 4) },
      ],
    },
    {
      name: "Pre-Clinical · Year 2",
      courses: [
        { code: "M2 · Systems B", name: "Remaining organ systems + pathology/pharm", modules: ORGAN_SYSTEMS.slice(4) },
        { code: `M2 · ${opts.boardLabel} Runway`, name: `Dedicated ${opts.boardLabel} preparation`, modules: ["Content review", "Question banks", "Practice exams"] },
      ],
    },
    {
      name: "Clinical · Core Rotations",
      courses: [
        { code: "M3 · Core Clerkships", name: "Internal Medicine, Surgery, Peds, OB/GYN, Psych, Family", modules: ["Internal Medicine", "Surgery", "Pediatrics", "OB/GYN", "Psychiatry", "Family Medicine"] },
      ],
    },
  ];
}

// --- The tracks -------------------------------------------------------------

export const EDUCATION_TRACKS: EducationTrack[] = [
  {
    id: "sgu",
    label: "St. George's University (SGU)",
    short: "SGU",
    program: "Caribbean MD · term-based pre-clinical",
    blurb: "Auto-loads SGU Terms 1–5, BPM/PPM courses, and the SGU shared drives.",
    group: "Medical School",
    tier: 1,
    status: "live",
    icon: "GraduationCap",
    showsSguResources: true,
    focusIds: ["term1", "term2", "term3", "term4", "term5", "cbse", "step1"],
    defaultFocusId: "term1",
    seedsStructure: true,
    progress: {
      unit: "term",
      summary: "Your SGU runway: each term holds its courses, each course its modules. Track lectures, DLAs, and PQs underneath.",
      passMeaning: "One focused study pass over a lecture / DLA / PQ set.",
      doneMeaning: "Mastered = 4 passes (PQs = 3 completed sets), then anchored in Anki.",
    },
    terms: SGU_TERMS,
    trackerRows: [
      { path: "Term 1/BPM 500/FTM 1/Lectures", label: "Example lecture: Cellular adaptation", kind: "Lecture", yield: "high" },
      { path: "Term 1/BPM 500/FTM 1/DLAs", label: "Example DLA: Histology orientation", kind: "DLA", yield: "none" },
      { path: "Term 1/BPM 500/FTM 1/PQs", label: "Example PQ set: General principles", kind: "PQ", yield: "none" },
    ],
  },
  {
    id: "usmd",
    label: "US Medical School (MD)",
    short: "US MD",
    program: "US allopathic · systems-based pre-clinical → clerkships",
    blurb: "Generic M1–M4 spine with organ-system blocks and a Step 1 runway. No SGU drives.",
    group: "Medical School",
    tier: 2,
    status: "live",
    icon: "Stethoscope",
    showsSguResources: false,
    focusIds: ["step1", "step2", "step3", "shelf"],
    defaultFocusId: "step1",
    seedsStructure: true,
    progress: {
      unit: "year",
      summary: "A school-agnostic MD spine: pre-clinical foundations & systems, then core clerkships. Rename blocks to match your curriculum.",
      passMeaning: "One focused study pass over a block, lecture, or question set.",
      doneMeaning: "Mastered = 4 passes; clerkship blocks are 'covered' once you've worked the shelf material.",
    },
    terms: medSchoolSpine({ boardLabel: "Step 1" }),
    trackerRows: [
      { path: "Pre-Clinical · Year 1/M1 · Foundations/Anatomy", label: "Example: Upper limb anatomy", kind: "Lecture", yield: "high" },
      { path: "Pre-Clinical · Year 2/M2 · Step 1 Runway/Question banks", label: "Example: UWorld cardiovascular block", kind: "PQ", yield: "review" },
    ],
  },
  {
    id: "do",
    label: "US Osteopathic School (DO)",
    short: "US DO",
    program: "US osteopathic · adds OMM + COMLEX alongside USMLE",
    blurb: "MD spine plus an OMM thread and a COMLEX/USMLE runway. No SGU drives.",
    group: "Medical School",
    tier: 3,
    status: "live",
    icon: "Stethoscope",
    showsSguResources: false,
    focusIds: ["step1", "step2", "step3", "shelf"],
    defaultFocusId: "step1",
    seedsStructure: true,
    progress: {
      unit: "year",
      summary: "An osteopathic spine: pre-clinical systems with OMM, then clerkships, on a COMLEX Level 1 / USMLE Step 1 runway.",
      passMeaning: "One focused study pass over a block, OMM technique, or question set.",
      doneMeaning: "Mastered = 4 passes; OMM techniques are 'done' once you can perform + explain them.",
    },
    terms: [
      ...medSchoolSpine({ boardLabel: "COMLEX / Step 1" }),
      {
        name: "OMM · Longitudinal",
        courses: [
          { code: "OMM", name: "Osteopathic Manipulative Medicine", modules: ["Principles", "Cranial", "Muscle Energy", "HVLA", "Counterstrain", "Myofascial"] },
        ],
      },
    ],
    trackerRows: [
      { path: "OMM · Longitudinal/OMM/Muscle Energy", label: "Example: Muscle energy for the lumbar spine", kind: "Lab", yield: "high", note: "Done once you can perform and explain it." },
    ],
  },
  {
    id: "img",
    label: "International Medical School",
    short: "IMG",
    program: "International medical degree · school-specific curriculum",
    blurb: "A school-agnostic medical spine that you can rename around your curriculum and board pathway.",
    group: "Medical School",
    tier: 4,
    status: "live",
    icon: "Globe2",
    showsSguResources: false,
    focusIds: ["step1", "step2", "step3", "shelf"],
    defaultFocusId: "step1",
    seedsStructure: true,
    progress: {
      unit: "stage",
      summary: "A flexible pre-clinical and clinical spine for international programs, with board lanes available when useful.",
      passMeaning: "One focused study pass over a course block, clinical topic, or question set.",
      doneMeaning: "Done follows the target you set for the course or clinical block; the starter structure is fully editable.",
    },
    terms: medSchoolSpine({ boardLabel: "Board exam" }),
    trackerRows: [
      { path: "Pre-Clinical · Year 1/M1 · Foundations", label: "Example: Current foundational block", kind: "Lecture", yield: "none" },
    ],
  },
  {
    id: "premed",
    label: "Pre-Med (Undergraduate)",
    short: "Pre-Med",
    program: "Pre-health undergrad · prerequisites, experiences, application",
    blurb: "Prerequisites become real courses you complete; experiences & application milestones are tracked separately.",
    group: "Pre-Health",
    tier: 4,
    status: "live",
    icon: "Compass",
    showsSguResources: false,
    focusIds: ["premed", "mcat"],
    defaultFocusId: "premed",
    seedsStructure: true,
    progress: {
      unit: "requirement group",
      summary:
        "Pre-med is a checklist, not a lecture stream. Prerequisites are courses you complete with a passing grade; experiences and application pieces are milestones you finish once.",
      passMeaning: "A prerequisite is a course — 'one pass' = one term of that course completed.",
      doneMeaning: "Done = the prereq is passed (grade recorded) or the milestone is finished. You don't grind these to 4 passes.",
    },
    terms: [
      {
        name: "Prerequisites",
        courses: [
          { code: "BIOL", name: "Biology I & II (with lab)", modules: ["Biology I", "Biology I Lab", "Biology II", "Biology II Lab"] },
          { code: "GCHEM", name: "General Chemistry I & II (with lab)", modules: ["Gen Chem I", "Gen Chem I Lab", "Gen Chem II", "Gen Chem II Lab"] },
          { code: "OCHEM", name: "Organic Chemistry I & II (with lab)", modules: ["Organic I", "Organic I Lab", "Organic II", "Organic II Lab"] },
          { code: "PHYS", name: "Physics I & II (with lab)", modules: ["Physics I", "Physics I Lab", "Physics II", "Physics II Lab"] },
          { code: "BIOCHEM", name: "Biochemistry", modules: ["Biochemistry"] },
          { code: "MATH/STAT", name: "Math & Statistics", modules: ["Calculus / Math", "Statistics"] },
          { code: "ENGL/PSYC", name: "English, Psychology & Sociology", modules: ["English Composition", "Psychology", "Sociology"] },
        ],
      },
    ],
    trackerRows: [
      { path: "Experiences/Clinical", label: "Clinical hours (shadowing, scribe, EMT…)", kind: "Evidence", yield: "high", note: "Done = evidence logged toward your target hours, not 4 lecture passes." },
      { path: "Experiences/Research", label: "Research / project involvement", kind: "Evidence", yield: "high", note: "Done = a meaningful artifact or update exists." },
      { path: "Experiences/Service", label: "Volunteering & community service", kind: "Evidence", yield: "review", note: "Done = non-clinical service evidence logged." },
      { path: "Application/Materials", label: "Personal statement draft", kind: "Milestone", yield: "high", note: "Done when a review-ready draft exists." },
      { path: "Application/Materials", label: "Letters of recommendation secured", kind: "Milestone", yield: "review", note: "Done when committed letters are in hand." },
      { path: "Application/Materials", label: "School list + AMCAS/AACOMAS primary", kind: "Milestone", yield: "high", note: "Done when the primary is submitted." },
    ],
  },
  {
    id: "mcat",
    label: "MCAT Prep",
    short: "MCAT",
    program: "Exam-focused · content review, full-lengths, CARS, error log",
    blurb: "Installs the four AAMC sections as review domains with a repair loop. Pairs well with Pre-Med.",
    group: "Pre-Health",
    tier: 5,
    status: "live",
    icon: "Brain",
    showsSguResources: false,
    focusIds: ["mcat", "premed"],
    defaultFocusId: "mcat",
    seedsStructure: true,
    progress: {
      unit: "section",
      summary: "MCAT prep is a domain + repair loop: review content, work passages, log misses, retest. One row per AAMC section, expanded into subjects as you go.",
      passMeaning: "One focused review cycle of a section (content + passages + error review).",
      doneMeaning: "Mastered = 4 cycles with stable accuracy; track full-lengths separately as milestones.",
    },
    terms: [
      {
        name: "MCAT Sections",
        courses: [
          { code: "C/P", name: "Chemical & Physical Foundations", modules: ["Gen Chem", "Organic", "Physics", "Biochem", "Passage drills"] },
          { code: "CARS", name: "Critical Analysis & Reasoning", modules: ["Timing", "Main idea", "Inference", "Tone", "Daily passages"] },
          { code: "B/B", name: "Biological & Biochemical Foundations", modules: ["Biology", "Biochemistry", "Lab/experimental", "Passage drills"] },
          { code: "P/S", name: "Psychological, Social & Biological", modules: ["Psychology", "Sociology", "Biology of behavior", "Stats/research"] },
        ],
      },
    ],
    trackerRows: [
      { path: "MCAT Sections/CARS/Daily passages", label: "CARS daily passage set", kind: "Question Block", yield: "high", note: "Repair loop: do passages, review every miss, repeat." },
      { path: "Full-Lengths/AAMC", label: "AAMC full-length #1", kind: "Assessment", yield: "review", note: "Milestone: take it, then build an error log from it." },
    ],
  },
  {
    id: "undergrad",
    label: "General Undergraduate",
    short: "Undergrad",
    program: "Any major · course & GPA tracking (tailoring in progress)",
    blurb: "A neutral semester structure for any major. Deeper major/DARS tooling is on the roadmap.",
    group: "Pre-Health",
    tier: 6,
    status: "planned",
    icon: "BookOpen",
    showsSguResources: false,
    focusIds: ["premed"],
    defaultFocusId: "premed",
    seedsStructure: true,
    progress: {
      unit: "semester",
      summary: "A neutral two-semester shell you fill with your own courses. Major-specific DARS import and degree audits are planned.",
      passMeaning: "One focused study pass over a course's material or assignment set.",
      doneMeaning: "Done = the course is completed; rename and add your real courses.",
    },
    terms: [
      { name: "This Semester", courses: [{ code: "COURSE 1", name: "Add your courses", modules: ["Unit 1", "Unit 2", "Exams"] }] },
      { name: "Next Semester", courses: [] },
    ],
    trackerRows: [],
  },
  {
    id: "nursing",
    label: "Nursing School",
    short: "Nursing",
    program: "ADN/BSN · NCLEX runway (tailoring in progress)",
    blurb: "Light starter structure for nursing fundamentals and NCLEX. Deeper tailoring is on the roadmap.",
    group: "Other Health Professions",
    tier: 7,
    status: "planned",
    icon: "HeartPulse",
    showsSguResources: false,
    focusIds: ["premed"],
    defaultFocusId: "premed",
    seedsStructure: true,
    progress: {
      unit: "term",
      summary: "A light nursing shell: fundamentals, med-surg, and an NCLEX runway. Full nursing tailoring is planned.",
      passMeaning: "One focused study pass over content or an NCLEX-style question set.",
      doneMeaning: "Mastered = 4 passes; skills check-offs are 'done' once demonstrated.",
    },
    terms: [
      { name: "Fundamentals", courses: [{ code: "NUR · Fundamentals", name: "Nursing fundamentals & skills", modules: ["Health assessment", "Pharmacology", "Skills lab"] }] },
      { name: "NCLEX Runway", courses: [{ code: "NCLEX", name: "NCLEX preparation", modules: ["Content review", "Question banks", "Practice exams"] }] },
    ],
    trackerRows: [],
  },
  {
    id: "pa",
    label: "PA School",
    short: "PA",
    program: "Physician Assistant · didactic → clinical (tailoring in progress)",
    blurb: "Light starter structure for the didactic year and PANCE. Deeper tailoring is on the roadmap.",
    group: "Other Health Professions",
    tier: 8,
    status: "planned",
    icon: "Syringe",
    showsSguResources: false,
    focusIds: ["premed"],
    defaultFocusId: "premed",
    seedsStructure: true,
    progress: {
      unit: "phase",
      summary: "A light PA shell: didactic systems then a PANCE runway. Full PA tailoring is planned.",
      passMeaning: "One focused study pass over a system or question set.",
      doneMeaning: "Mastered = 4 passes; clinical rotations are 'covered' once worked through.",
    },
    terms: [
      { name: "Didactic Year", courses: [{ code: "PA · Didactic", name: "Didactic systems & clinical medicine", modules: ORGAN_SYSTEMS.slice(0, 4) }] },
      { name: "PANCE Runway", courses: [{ code: "PANCE", name: "PANCE preparation", modules: ["Content review", "Question banks"] }] },
    ],
    trackerRows: [],
  },
];

export const DEFAULT_TRACK_ID: EducationTrackId = "sgu";

export function educationTrack(id?: string): EducationTrack | undefined {
  return EDUCATION_TRACKS.find((t) => t.id === id);
}

export function resolveTrack(id?: string): EducationTrack {
  return educationTrack(id) ?? EDUCATION_TRACKS[0];
}

/** Tracks grouped for the picker, preserving tier order within each group. */
export function groupedTracks(): Array<[TrackGroup, EducationTrack[]]> {
  const order: TrackGroup[] = ["Medical School", "Pre-Health", "Other Health Professions"];
  return order.map((group) => [
    group,
    EDUCATION_TRACKS.filter((t) => t.group === group).sort((a, b) => a.tier - b.tier),
  ]);
}

/**
 * Infer the most likely track from a legacy profile's focus subscriptions, used
 * once during migration for users who onboarded before tracks existed.
 */
export function inferTrackFromFocus(focusIds: string[]): EducationTrackId {
  const set = new Set(focusIds);
  if (["term1", "term2", "term3", "term4", "term5", "cbse"].some((id) => set.has(id))) return "sgu";
  if (set.has("premed") && !set.has("step1") && !set.has("step2")) return "premed";
  if (set.has("mcat") && !set.has("step1")) return "mcat";
  return "sgu"; // the app has been SGU-centric; safest default for existing data
}
