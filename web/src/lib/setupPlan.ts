// First-run setup (Wave 2): the few choices a student makes, and everything
// AXOM derives from them. Pure functions first (tested in setupPlan.test.ts),
// then one `applySetup` that writes the result through existing store
// actions. Setup never asks what should make a day count: it starts from
// sensible targets the student edits later.
import type { AcademicStageId, DailySuccessRequirement, DashboardLayoutPreferences, EducationTrackId, ExperienceFocusId, Profile } from "./types";
import type { OnboardingMode } from "./onboardingProgress";
import { makeDailyRequirement } from "./dailySuccess";
import { adaptLegacyDashboardLayout, applyDashboardLayoutPreset } from "./dashboardWidgets";
import { focusOption } from "./experience";
import { resolveTrack } from "./tracks";
import type { PracticeTiming, StudyMethodPreference, StudyWorkflowPreferences } from "./studyPreferences";
import { buildCurriculum, SGU_CURRICULUM, withoutExampleRows, type CurriculumTemplate } from "./curricula";
import { useStore } from "./store";
import { localDateKey } from "./dailyRollover";

export type SetupPath = "sgu" | "usmd" | "do" | "img" | "premed" | "other";
export type SetupTool = "lectures" | "questions" | "uworld" | "amboss" | "anki" | "noji" | "quizlet" | "other";

export interface SetupChoices {
  version: 2;
  step: number;
  name: string;
  path: SetupPath;
  /** Id from `focusChoices(path)`. */
  focus: string;
  tools: SetupTool[];
  lecturePasses: number;
  questionTiming: PracticeTiming;
  reviewAfterDays: number;
  otherTool: string;
}

export interface PathOption { id: SetupPath; label: string; detail: string }
export interface FocusChoice { id: string; label: string; track: EducationTrackId; focus: ExperienceFocusId; stage: AcademicStageId }
export interface ToolOption { id: SetupTool; label: string; detail: string; group: "learn" | "questions" | "cards" }

export const PATH_OPTIONS: readonly PathOption[] = [
  { id: "sgu", label: "St. George's", detail: "SGU MD, terms 1 to 5" },
  { id: "usmd", label: "US MD", detail: "Allopathic medical school" },
  { id: "do", label: "DO", detail: "Osteopathic medical school" },
  { id: "img", label: "International", detail: "Medical school outside the US" },
  { id: "premed", label: "Pre-med", detail: "Courses, MCAT, applying" },
  { id: "other", label: "Something else", detail: "Nursing, PA, undergrad" },
];

const MED_FOCUS = (track: EducationTrackId): FocusChoice[] => [
  { id: "preclinical", label: "Pre-clinical", track, focus: "step1", stage: "preclinical" },
  { id: "clinical", label: "Clinical", track, focus: "shelf", stage: "clinical-rotations" },
  { id: "boards", label: "Boards", track, focus: "step1", stage: "dedicated-board-prep" },
];

const FOCUS_BY_PATH: Record<SetupPath, FocusChoice[]> = {
  sgu: [
    ...(["1", "2", "3", "4", "5"] as const).map((n) => ({ id: `term${n}`, label: `Term ${n}`, track: "sgu" as const, focus: `term${n}` as ExperienceFocusId, stage: "preclinical" as const })),
    { id: "cbse", label: "CBSE", track: "sgu", focus: "cbse", stage: "dedicated-board-prep" },
    { id: "step1", label: "Step 1", track: "sgu", focus: "step1", stage: "dedicated-board-prep" },
  ],
  usmd: MED_FOCUS("usmd"),
  do: MED_FOCUS("do"),
  img: MED_FOCUS("img"),
  premed: [
    { id: "coursework", label: "Coursework", track: "premed", focus: "premed", stage: "coursework" },
    { id: "mcat", label: "MCAT", track: "mcat", focus: "mcat", stage: "exam-prep" },
    { id: "applying", label: "Applying", track: "premed", focus: "premed", stage: "application" },
  ],
  other: [
    { id: "nursing", label: "Nursing", track: "nursing", focus: "premed", stage: "didactic" },
    { id: "pa", label: "PA", track: "pa", focus: "premed", stage: "didactic" },
    { id: "undergrad", label: "Undergrad", track: "undergrad", focus: "premed", stage: "coursework" },
  ],
};

export function focusChoices(path: SetupPath): FocusChoice[] {
  return FOCUS_BY_PATH[path];
}

export function resolveFocus(choices: Pick<SetupChoices, "path" | "focus">): FocusChoice {
  const options = focusChoices(choices.path);
  return options.find((option) => option.id === choices.focus) ?? options[0];
}

export const TOOL_OPTIONS: readonly ToolOption[] = [
  { id: "lectures", label: "Lecture review", detail: "Passes over lectures", group: "learn" },
  { id: "questions", label: "Practice questions", detail: "School or your own", group: "questions" },
  { id: "uworld", label: "UWorld", detail: "Question bank", group: "questions" },
  { id: "amboss", label: "AMBOSS", detail: "Library and questions", group: "questions" },
  { id: "anki", label: "Anki", detail: "Spaced repetition", group: "cards" },
  { id: "noji", label: "Noji", detail: "Flashcards", group: "cards" },
  { id: "quizlet", label: "Quizlet", detail: "Flashcards", group: "cards" },
  { id: "other", label: "Something else", detail: "Tell AXOM", group: "learn" },
];

export const QUESTION_TIMINGS: ReadonlyArray<{ id: PracticeTiming; label: string }> = [
  { id: "after-first-pass", label: "After each lecture" },
  { id: "after-learning", label: "After a block" },
  { id: "near-exam", label: "Before exams" },
];

export function defaultChoices(profile?: Partial<Profile>): SetupChoices {
  const name = profile?.name && !/^(axom|noctyrium)$/i.test(profile.name.trim()) ? profile.name : "";
  const path = pathForTrack(profile?.educationTrack);
  const focus = focusChoices(path).find((option) => option.focus === profile?.activeFocusId)?.id ?? focusChoices(path)[0].id;
  return {
    version: 2,
    step: 0,
    name,
    path,
    focus,
    tools: ["lectures", "questions", "anki"],
    lecturePasses: 2,
    questionTiming: "after-learning",
    reviewAfterDays: 3,
    otherTool: "",
  };
}

export function pathForTrack(track: string | undefined): SetupPath {
  if (track === "sgu" || track === "usmd" || track === "do" || track === "img") return track;
  if (track === "premed" || track === "mcat") return "premed";
  if (track === "nursing" || track === "pa" || track === "undergrad") return "other";
  return "sgu";
}

export const usesQuestions = (tools: readonly SetupTool[]) => tools.some((tool) => tool === "questions" || tool === "uworld" || tool === "amboss");
export const usesLectures = (tools: readonly SetupTool[]) => tools.includes("lectures");

export type CardSystem = { id: "anki" | "noji" | "quizlet"; label: string };

/** The flashcard app a student named, in the order AXOM can support it best. */
export function cardSystemFromTools(tools: readonly SetupTool[]): CardSystem | null {
  if (tools.includes("anki")) return { id: "anki", label: "Anki" };
  if (tools.includes("noji")) return { id: "noji", label: "Noji" };
  if (tools.includes("quizlet")) return { id: "quizlet", label: "Quizlet" };
  return null;
}

/** The study workflow the rest of AXOM reads (Course Tracker, Up next, plans). */
export function workflowFromChoices(choices: SetupChoices): StudyWorkflowPreferences {
  const tools = new Set(choices.tools);
  const banks = [tools.has("uworld") ? "UWorld" : "", tools.has("amboss") ? "AMBOSS" : ""].filter(Boolean);
  const methods: StudyMethodPreference[] = [
    { id: "lecture-passes", enabled: tools.has("lectures") },
    { id: "practice-questions", enabled: usesQuestions(choices.tools), timing: choices.questionTiming, ...(banks.length ? { usage: `Uses ${banks.join(" and ")}` } : {}) },
    { id: "anki", enabled: tools.has("anki") },
    { id: "noji", enabled: tools.has("noji") },
    { id: "quizlet", enabled: tools.has("quizlet") },
    { id: "external-resource", enabled: banks.length > 0, ...(banks.length ? { label: banks.join(", ") } : {}) },
    { id: "custom", enabled: tools.has("other") && Boolean(choices.otherTool.trim()), ...(choices.otherTool.trim() ? { label: choices.otherTool.trim().slice(0, 80) } : {}) },
  ];
  return {
    configured: true,
    methods,
    lecturePasses: clamp(choices.lecturePasses, 1, 6),
    reviewAfterDays: clamp(choices.reviewAfterDays, 1, 14),
  };
}

/**
 * Starting targets (JD, Wave 2): Study always; Practice questions and
 * Lectures when the student does them; Cards only with a card app. Amounts
 * follow the chosen focus and stay editable in Productivity.
 */
export function defaultTargets(choices: SetupChoices, today: string): DailySuccessRequirement[] {
  const focus = focusOption(resolveFocus(choices).focus);
  const boards = resolveFocus(choices).stage === "dedicated-board-prep";
  const targets: DailySuccessRequirement[] = [
    makeDailyRequirement({ id: "setup-study-v2", label: "Study", source: { kind: "study-minutes" }, target: roundTo(focus?.minuteTarget ?? 180, 30), unit: "minutes", trackingStartsAt: today }, today),
  ];
  if (usesQuestions(choices.tools)) {
    targets.push(makeDailyRequirement({ id: "setup-questions-v2", label: "Practice questions", source: { kind: "practice-questions" }, target: boards ? 40 : 20, unit: "questions", trackingStartsAt: today }, today));
  }
  if (usesLectures(choices.tools) && !boards) {
    targets.push(makeDailyRequirement({ id: "setup-lectures-v2", label: "Lectures", source: { kind: "activity-alias" }, aliases: ["Lecture", "Lectures", "Lecture review"], target: 2, unit: "lectures", trackingStartsAt: today }, today));
  }
  const cards = cardSystemFromTools(choices.tools);
  if (cards) {
    targets.push(makeDailyRequirement({ id: "setup-cards-v2", label: `${cards.label} cards`, source: { kind: "cards-reviewed" }, target: roundTo(focus?.cardTarget ?? 100, 10), unit: "cards", trackingStartsAt: today }, today));
  }
  return targets;
}

/** The Focused dashboard, adjusted so every widget on it has something to say. */
export function dashboardFromChoices(choices: SetupChoices): DashboardLayoutPreferences {
  const layout = applyDashboardLayoutPreset(adaptLegacyDashboardLayout(), "focused");
  const hidden = new Set(layout.hiddenWidgetIds);
  const show = (id: string) => hidden.delete(id);
  const hide = (id: string) => hidden.add(id);
  if (!usesQuestions(choices.tools)) { hide("questionBank"); show("dailyWord"); }
  if (choices.path === "premed" || choices.path === "other") { hide("courseTracker"); show("premedHours"); }
  if (choices.path === "premed" && resolveFocus(choices).id === "mcat") show("examCountdown");
  return { ...layout, hiddenWidgetIds: [...hidden] };
}

/** Writes a finished setup through the store. Reruns never touch course structure. */
export function applySetup(choices: SetupChoices, mode: "first-run" | "rerun"): void {
  const store = useStore.getState();
  const focus = resolveFocus(choices);
  const track = resolveTrack(focus.track);
  const today = store.activeDayKey || localDateKey();
  const firstRun = mode === "first-run";

  store.updateProfile({
    name: choices.name.trim(),
    onboarded: true,
    // The guide is offered after the Promise (GuideOffer), never forced.
    ...(firstRun ? { tourDone: true } : {}),
    academicStageId: focus.stage,
    studyWorkflow: workflowFromChoices(choices),
    ...(firstRun ? {
      dashboardLayout: dashboardFromChoices(choices),
      dailySuccess: { version: 1, configuredAt: today, requirements: defaultTargets(choices, today) },
    } : {}),
  });
  const option = focusOption(focus.focus);
  store.applyEducationTrack(track.id, {
    focusSubscriptions: [...new Set([...track.focusIds, focus.focus])],
    activeFocusId: focus.focus,
    showSguResources: track.showsSguResources,
    cardTarget: option?.cardTarget,
    minuteTarget: option?.minuteTarget,
    seedStructure: false,
  });
  if (!firstRun) return;
  // SGU gets its real term/module map; every other path starts clean (the
  // Course Tracker's first-use card shows how to add or import a structure).
  const state = useStore.getState();
  const built = choices.path === "sgu" ? buildCurriculum(SGU_CURRICULUM) : { terms: [], courses: [] };
  useStore.setState({ terms: built.terms, courses: built.courses, tracker: withoutExampleRows(state.tracker) });
}

/** Adds a school's term and module map beside whatever the student already has (Course Tracker's first-use card). */
export function installCurriculum(template: CurriculumTemplate): void {
  const built = buildCurriculum(template);
  useStore.setState((state) => ({ terms: [...state.terms, ...built.terms], courses: [...state.courses, ...built.courses] }));
}

// --- Draft (survives a refresh mid-setup) ----------------------------------

const DRAFT_KEY = "axom.setup.v2";

type StoredDraft = Partial<SetupChoices> & { mode?: OnboardingMode };

function storedDraft(): StoredDraft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as StoredDraft | null;
    return raw && raw.version === 2 ? raw : null;
  } catch {
    return null;
  }
}

/** Which setup a refresh interrupted, so App can reopen a rerun (a first run reopens by itself). */
export function readSetupDraftMode(): OnboardingMode | null {
  const mode = storedDraft()?.mode;
  return mode === "first-run" || mode === "rerun" ? mode : null;
}

/** A draft resumes only in the setup it came from: a first-run draft never leaks into a later rerun. */
export function readSetupDraft(fallback: SetupChoices, mode: OnboardingMode = "first-run"): SetupChoices {
  try {
    const raw = storedDraft();
    if (!raw || (raw.mode ?? "first-run") !== mode) return fallback;
    const path = PATH_OPTIONS.some((option) => option.id === raw.path) ? raw.path as SetupPath : fallback.path;
    const tools = Array.isArray(raw.tools) ? raw.tools.filter((tool): tool is SetupTool => TOOL_OPTIONS.some((option) => option.id === tool)) : fallback.tools;
    return {
      ...fallback,
      step: clamp(Number(raw.step), 0, 2),
      name: typeof raw.name === "string" ? raw.name.slice(0, 80) : fallback.name,
      path,
      focus: focusChoices(path).some((option) => option.id === raw.focus) ? String(raw.focus) : focusChoices(path)[0].id,
      tools,
      lecturePasses: clamp(Number(raw.lecturePasses ?? fallback.lecturePasses), 1, 6),
      questionTiming: QUESTION_TIMINGS.some((timing) => timing.id === raw.questionTiming) ? raw.questionTiming as PracticeTiming : fallback.questionTiming,
      reviewAfterDays: clamp(Number(raw.reviewAfterDays ?? fallback.reviewAfterDays), 1, 14),
      otherTool: typeof raw.otherTool === "string" ? raw.otherTool.slice(0, 80) : "",
    };
  } catch {
    return fallback;
  }
}

export function writeSetupDraft(choices: SetupChoices, mode: OnboardingMode = "first-run"): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...choices, mode })); } catch { /* storage blocked */ }
}

export function clearSetupDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min;
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}
