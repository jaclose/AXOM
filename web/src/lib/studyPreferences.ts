import type { Course, TrackerItem, TrackerKind } from "./types";

export type StudyMethodId = "lecture-passes" | "practice-questions" | "anki" | "quizlet" | "noji" | "remnote" | "notes" | "teach-aloud" | "recall" | "external-resource" | "custom";
export type PracticeTiming = "before" | "after-first-pass" | "after-learning" | "near-exam" | "ongoing";
export interface StudyMethodPreference { id: StudyMethodId; enabled: boolean; label?: string; timing?: PracticeTiming; usage?: string; }
export interface StudyPlanSettings { methods?: StudyMethodPreference[]; lecturePasses?: number; reviewAfterDays?: number; customContext?: string; }
export interface StudyWorkflowPreferences extends StudyPlanSettings { configured: boolean; itemKindDefaults?: Partial<Record<TrackerKind, StudyPlanSettings>>; }
export interface EffectiveStudyPlan { methods: StudyMethodPreference[]; lecturePasses: number; reviewAfterDays: number; customContext?: string; sources: string[]; }

export const DEFAULT_STUDY_WORKFLOW: StudyWorkflowPreferences = {
  configured: false,
  methods: [
    { id: "lecture-passes", enabled: true },
    { id: "practice-questions", enabled: true, timing: "after-learning" },
  ],
  lecturePasses: 2,
  reviewAfterDays: 3,
};

export function normalizeStudyWorkflow(value: unknown): StudyWorkflowPreferences {
  const source = record(value);
  const rawKinds = record(source.itemKindDefaults); const itemKindDefaults: StudyWorkflowPreferences["itemKindDefaults"] = {};
  for (const kind of ["Lecture","DLA","PQ","Lab","Reading","Requirement","Milestone","Evidence","Question Block","Assessment","Review Loop"] as TrackerKind[]) if (rawKinds[kind]) itemKindDefaults[kind]=normalizeSettings(record(rawKinds[kind]));
  return {
    configured: source.configured === true,
    ...normalizeSettings(source),
    itemKindDefaults,
  };
}

export function resolveStudyPlan(profile: StudyWorkflowPreferences | undefined, course: Course | undefined, item: TrackerItem): EffectiveStudyPlan {
  const layers: Array<[string, StudyPlanSettings | undefined]> = [
    ["learner defaults", profile ?? DEFAULT_STUDY_WORKFLOW],
    ["course override", course?.studyPlanOverride],
    ["item-kind default", profile?.itemKindDefaults?.[item.kind]],
    ["item override", item.studyPlanOverride],
  ];
  let plan: StudyPlanSettings = {};
  const sources: string[] = [];
  for (const [name, layer] of layers) {
    if (!layer) continue;
    plan = mergePlan(plan, layer);
    sources.push(name);
  }
  return {
    methods: plan.methods ?? DEFAULT_STUDY_WORKFLOW.methods!,
    lecturePasses: clamp(plan.lecturePasses, 1, 6, 2),
    reviewAfterDays: clamp(plan.reviewAfterDays, 1, 14, 3),
    customContext: plan.customContext,
    sources,
  };
}

/** Course defaults belong to a path segment, not a substring of another
 * course (for example CARD 10 must not match CARD 101). Ambiguity falls back
 * to learner defaults instead of applying an arbitrary course's settings. */
export function studyPlanCourse(courses: Course[], item: TrackerItem): Course | undefined {
  const key = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const segments = new Set(item.path.split("/").map(key).filter(Boolean));
  const matches = courses.filter((course) => [course.code, course.name].some((value) => {
    const normalized = key(value);
    return normalized && segments.has(normalized);
  }));
  return matches.length === 1 ? matches[0] : undefined;
}

function mergePlan(base: StudyPlanSettings, next: StudyPlanSettings): StudyPlanSettings {
  const methods = new Map((base.methods ?? []).map((method) => [method.id, method]));
  for (const method of next.methods ?? []) methods.set(method.id, { ...methods.get(method.id), ...method });
  return { ...base, ...next, methods: [...methods.values()] };
}
function clamp(value: unknown, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function normalizeSettings(source: Record<string, unknown>): StudyPlanSettings {
  const valid = new Set<StudyMethodId>(["lecture-passes", "practice-questions", "anki", "quizlet", "noji", "remnote", "notes", "teach-aloud", "recall", "external-resource", "custom"]);
  const methods = Array.isArray(source.methods) ? source.methods.flatMap((candidate) => { const item = record(candidate); return valid.has(item.id as StudyMethodId) ? [{ id: item.id as StudyMethodId, enabled: item.enabled !== false, label: typeof item.label === "string" ? item.label.slice(0, 80) : undefined, timing: typeof item.timing === "string" && ["before", "after-first-pass", "after-learning", "near-exam", "ongoing"].includes(item.timing) ? item.timing as PracticeTiming : undefined, usage: typeof item.usage === "string" ? item.usage : undefined }] : []; }) : undefined;
  return { methods, lecturePasses: clamp(source.lecturePasses, 1, 6, 2), reviewAfterDays: clamp(source.reviewAfterDays, 1, 14, 3), customContext: typeof source.customContext === "string" ? source.customContext : undefined };
}

export const STUDY_METHOD_OPTIONS: Array<{ id: StudyMethodId; label: string }> = [
  { id: "lecture-passes", label: "Lecture passes" }, { id: "practice-questions", label: "Question-based practice" },
  { id: "anki", label: "Anki" }, { id: "quizlet", label: "Quizlet" }, { id: "noji", label: "Noji" },
  { id: "remnote", label: "RemNote" }, { id: "notes", label: "Notes / concept notes" },
  { id: "teach-aloud", label: "Teaching aloud / Feynman" }, { id: "recall", label: "Recall sessions" },
  { id: "external-resource", label: "External resources" }, { id: "custom", label: "Other" },
];

/** Toggling a method must never erase its timing, label, or original words. */
export function toggleStudyMethod(workflow: StudyWorkflowPreferences, id: StudyMethodId): StudyWorkflowPreferences {
  const enabled = workflow.methods?.find(method => method.id === id)?.enabled ?? false;
  const methods = STUDY_METHOD_OPTIONS.map(option => {
    const existing = workflow.methods?.find(method => method.id === option.id);
    return { ...existing, id: option.id, enabled: option.id === id ? !enabled : existing?.enabled ?? false };
  });
  return { ...workflow, configured: true, methods };
}
