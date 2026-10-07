// ===========================================================================
// What kind of course item something is. `TrackerKind` stays the coarse,
// long-lived grouping every build understands; `CourseActivity` is the finer
// label a course template carries (a small group is not a lab, an in-class
// quiz is not a final). It is an optional field wherever it is stored, so a
// workspace written with it still opens in a build that has never heard of it.
//
// Dependency-free on purpose: scripts/inventory-sources.mjs imports this.
// ===========================================================================

export const COURSE_ACTIVITIES = [
  "lecture", "flipped-lecture", "dla", "small-group", "imcq", "esoft", "pq",
  "lab", "case", "review", "assessment", "assignment", "objectives", "reference", "other",
] as const;

export type CourseActivity = (typeof COURSE_ACTIVITIES)[number];

export const COURSE_ACTIVITY_LABEL: Record<CourseActivity, string> = {
  lecture: "Lecture",
  "flipped-lecture": "Flipped lecture",
  dla: "DLA",
  "small-group": "Small group",
  imcq: "IMCQ",
  esoft: "ESoft quiz",
  pq: "Practice questions",
  lab: "Lab",
  case: "Case",
  review: "Review",
  assessment: "Assessment",
  assignment: "Assignment",
  objectives: "Learning objectives",
  reference: "Reference",
  other: "Other",
};

const COUNTED: Partial<Record<CourseActivity, [one: string, many: string]>> = {
  lecture: ["lecture", "lectures"],
  "flipped-lecture": ["flipped lecture", "flipped lectures"],
  dla: ["DLA", "DLAs"],
  "small-group": ["small group", "small groups"],
  imcq: ["IMCQ", "IMCQs"],
  esoft: ["ESoft quiz", "ESoft quizzes"],
  lab: ["lab", "labs"],
  case: ["case", "cases"],
};

/** "24 lectures", "1 IMCQ": a count that keeps acronyms as they are written. */
export function countActivity(activity: CourseActivity, count: number): string {
  const [one, many] = COUNTED[activity] ?? [COURSE_ACTIVITY_LABEL[activity], COURSE_ACTIVITY_LABEL[activity]];
  return `${count} ${count === 1 ? one : many}`;
}

/** The existing tracker grouping each activity falls under. */
export const TRACKER_KIND_FOR_ACTIVITY = {
  lecture: "Lecture",
  "flipped-lecture": "Lecture",
  dla: "DLA",
  "small-group": "Requirement",
  imcq: "Assessment",
  esoft: "Assessment",
  pq: "PQ",
  lab: "Lab",
  case: "Requirement",
  review: "Review Loop",
  assessment: "Assessment",
  assignment: "Requirement",
  objectives: "Reading",
  reference: "Reading",
  other: "Lecture",
} as const satisfies Record<CourseActivity, string>;

/** Activities a learner attends, and so can be absent from. */
export const ATTENDED_ACTIVITIES: readonly CourseActivity[] = [
  "lecture", "flipped-lecture", "small-group", "imcq", "esoft", "lab",
];

/** Activities made of questions the learner answers. */
export const QUESTION_ACTIVITIES: readonly CourseActivity[] = ["imcq", "esoft", "pq", "assessment"];

export function isCourseActivity(value: unknown): value is CourseActivity {
  return typeof value === "string" && (COURSE_ACTIVITIES as readonly string[]).includes(value);
}

/**
 * Attendance is counted per category, and a flipped lecture is a lecture for
 * that purpose: one allowance covers both.
 */
export function attendanceCategory(activity: CourseActivity): CourseActivity {
  return activity === "flipped-lecture" ? "lecture" : activity;
}
