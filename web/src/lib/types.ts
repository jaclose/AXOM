// ===========================================================================
// Axom data model. Everything here is user-owned, editable, and persisted
// in the browser. Nothing is hard-coded into the UI — the seed (seed.ts) merely
// provides a starting point that the user can fully reshape.
// ===========================================================================

import type { JournalNotebookEntryFields, JournalNotebookPreferences } from "./journalNotebook";
import type { StudyPlanSettings, StudyWorkflowPreferences } from "./studyPreferences";

export type ID = string;
export type BoardExamId = "step1" | "step2" | "step3" | "shelf" | "mcat" | "premed";

/** A term groups courses (e.g. "Term 1"). */
export interface Term {
  id: ID;
  name: string;
}

/** A module inside a course (e.g. "FTM 1", "MSK"). */
export interface CourseModule {
  id: ID;
  name: string;
}

/** A course (e.g. "01 BPM 500"), belonging to a term. */
export interface Course {
  id: ID;
  termId: ID;
  code: string; // "01 BPM 500"
  name: string; // optional longer name
  files: number; // count shown on the card; user-editable
  link?: string; // optional URL the "Open" button targets
  modules: CourseModule[];
  studyPlanOverride?: StudyPlanSettings;
}

export type TrackerStatus = "anki" | "working" | "mature" | "reset";

/**
 * A row in the Course Tracker mastery tree. `path` is a slash-delimited
 * grouping (e.g. "T2/NB3/Lectures") so the tree is fully data-driven.
 */
/** First-class work kinds so the tracker can describe more than lectures. */
export type TrackerKind =
  | "Lecture"
  | "DLA"
  | "PQ"
  | "Lab"
  | "Reading"
  | "Requirement"
  | "Milestone"
  | "Evidence"
  | "Question Block"
  | "Assessment"
  | "Review Loop";

/** High-yield / low-yield / needs-review — feeds the suggestion engine. */
export type Yield = "high" | "low" | "review" | "none";

export interface TrackerItem {
  id: ID;
  path: string; // "T2/NB3/Lectures"
  label: string;
  kind: TrackerKind; // Lecture / DLA / PQ / Lab / Reading
  passes: number; // study passes: 0 untouched, 1 red, 2 young, 3 mature, 4+ mastered
  ankiPasses: number; // Anki rounds: 0 off, 1 orange, 2 yellow, 3 purple (mastered)
  yield: Yield; // high / low / review / none
  note?: string;
  updated: string; // ISO
  studyPlanOverride?: StudyPlanSettings;
  difficulty?: "easy" | "moderate" | "hard" | "very-hard";
  assessmentDate?: string; // yyyy-MM-dd; explicit learner/course evidence only
  explicitPriority?: 1 | 2 | 3 | 4 | 5;
  recommendationSnoozedUntil?: string; // ISO timestamp; defers, never deletes
}

export interface Task {
  id: ID;
  title: string;
  due?: string; // ISO date
  done: boolean;
  created: string; // ISO
  completedAt?: string; // ISO
  scope?: string; // inferred course/module/board area
  archived?: boolean;
  carryoverFrom?: string[]; // local calendar dates this task was carried from
  carriedAt?: string; // ISO
}

/** A reusable task template saved from the local repetitive-task detector (§18). */
export interface TaskTemplate {
  id: ID;
  signature: string;
  title: string;
  frequency: "daily" | "weekdays" | "weekly" | "custom";
  scope?: string;
  createdAt: string;
}

export interface JournalEntry extends JournalNotebookEntryFields {
  id: ID;
  date: string; // ISO datetime
  today: string;
  tomorrow: string;
  blockers: string;
  energy: "Low" | "Medium" | "High" | "";
  rating: string; // "Useful" | "Wasted" | ...
}

export type PremedExperienceKind = "Clinical" | "Service" | "Research" | "Shadowing" | "Leadership";

export interface PremedExperienceEntry {
  id: ID;
  date: string; // yyyy-MM-dd
  kind: PremedExperienceKind;
  title: string;
  organization: string;
  contact?: string;
  hours: number;
  verified: boolean;
  reflection: string;
  evidenceLink?: string;
  competencyTags?: string[];
  notes?: string;
  created: string; // ISO
}

export interface Prompt {
  id: ID;
  title: string;
  category: string;
  tags: string[];
  body: string;
  created: string;
  updated: string;
}

/** A saved hyperlink / resource (STEP 1 prep, references, tools, decks…). */
export interface Resource {
  id: ID;
  title: string;
  url: string;
  category: string; // "STEP 1", "Reference", "Anki", "Tools", "Drives", …
  tags: string[];
  note?: string;
  favorite?: boolean;
  rating?: number; // 1–10 personal usefulness (mainly for Drives)
  ratingReason?: string; // shown on hover over the rating badge
  created: string;
}

/** A user-defined folder / shortcut on the Hub Folders page. */
export interface HubFolder {
  id: ID;
  name: string;
  description?: string;
  link?: string;
  localPath?: string; // local file/folder path for packaged/local use
  icon?: string; // lucide icon name
  color?: string;
  tags?: string[];
  group?: string;
  favorite?: boolean;
  archived?: boolean;
  sortOrder?: number;
  /** When the shortcut was last opened or copied from Hub Folders. */
  lastOpenedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ===========================================================================
// Habit tracker (directive §6) — behind an experimental flag. Calm + behaviorally
// intelligent: recovery-aware streaks, intentional skips, non-punitive language.
// ===========================================================================
export type HabitType =
  | "binary" // did it or not
  | "duration" // minutes toward a target
  | "count" // reps/units toward a target
  | "avoidance" // a thing you're trying NOT to do (success = avoided)
  | "weekly" // flexible: N times per week, any days
  | "scheduled" // specific weekdays
  | "recovery" // gentle restart habit, streak never punishes
  | "milestone"; // one-time / cumulative goal

export type HabitCheckStatus = "done" | "partial" | "skipped" | "missed";

export interface Habit {
  id: ID;
  name: string;
  icon?: string;
  color?: string;
  type: HabitType;
  category?: string;
  target?: number; // count/duration target per day
  unit?: string; // "min", "reps", "pages"…
  weeklyTarget?: number; // for flexible weekly habits
  schedule?: number[]; // weekday indices 0(Sun)–6(Sat) for scheduled habits
  reminderStart?: string; // "08:00" — start of a reminder WINDOW, not a fixed alarm
  reminderEnd?: string; // "10:00"
  quietMode?: boolean; // suppress reminders
  examMode?: boolean; // examination-period mode: pause pressure, keep logging
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  // Optional explicit tracking start (local date key or ISO). When absent the
  // effective start is derived from createdAt (or the earliest log): a habit can
  // never be "missed" for a day before it existed. Additive; no schema change.
  trackingStartsAt?: string;
}

export interface HabitEntry {
  id: ID;
  habitId: ID;
  date: string; // local yyyy-MM-dd
  status: HabitCheckStatus;
  value?: number; // for count/duration habits
  note?: string;
  createdAt: string;
}

export interface ExperimentalFlags {
  habits?: boolean;
  /** Optional Daily Games folder. Missing and false both mean disabled. */
  dailyGames?: boolean;
}

/** One shared timezone preference for the clock and date-based utilities. */
export interface TimeZonePreference {
  mode: "system" | "custom";
  customTimezone?: string;
}

export interface ClockPreferences {
  enabled: boolean;
  showDigital: boolean;
  showAnalog: boolean;
  showDigitalSeconds: boolean;
  showAnalogSeconds: boolean;
  showDate: boolean;
  showTimezoneLabel: boolean;
  hourCycle: "12" | "24";
}

export interface PomodoroSavedPreset {
  id: string;
  label: string;
  focus: number;
  break: number;
  longBreak: number;
  cyclesBeforeLongBreak: number;
  intention?: string;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  lastUsedAt?: string;
}

export interface PomodoroPreferences {
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  savedPresets: PomodoroSavedPreset[];
  /** Mirror the timer in the macOS menu bar (desktop app only). Unset means on. */
  showInMenuBar?: boolean;
}

/** Persisted submitted rows only; the unsubmitted row remains component-local. */
export interface DailyWordPuzzleState {
  puzzleId: string;
  puzzleDate: string;
  timezone: string;
  wordListVersion: string;
  guesses: string[];
  completed: boolean;
  won: boolean;
  startedAt: string;
  completedAt?: string;
  /** Supports deterministic local upserts and backup conflict resolution. */
  updatedAt: string;
}

export type ProductivityUnitType = "minutes" | "count" | "yesno" | "distance" | "custom";

export interface ProductivityTracker {
  id: ID;
  name: string;
  icon: string;
  color: string;
  unitType: ProductivityUnitType;
  customUnit?: string;
  dailyTarget?: number;
  weeklyTarget?: number;
  /** "at-least" builds a behavior up; "at-most" keeps it under a daily limit. */
  goal?: "at-least" | "at-most";
  /** The habit this tracker keeps checked when habit tracking is on. */
  linkedHabitId?: string;
  category: string;
  contributesToAcademicStudy: boolean;
  contributesToTotalProductiveTime: boolean;
  contributesToEnergy: boolean;
  contributesToReports: boolean;
  contributesToHabitTracking: boolean;
  visible: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One study event — minutes and/or cards logged on a given study day. */
export interface StudyLog {
  id: ID;
  dayKey: string; // yyyy-MM-dd (Axom 4am-shifted study day)
  ts: string; // ISO datetime
  type: string; // "Lecture", "Anki", "Deep Study", "Manual"
  minutes: number;
  cards: number;
  note?: string;
  trackerId?: string;
  unitType?: ProductivityUnitType;
  quantity?: number;
  /** Optional semantic count for fast activity logging (cards/questions/general count). */
  quantityKind?: "cards" | "questions" | "count";
  quantityLabel?: string;
  academic?: boolean;
  productive?: boolean;
}

export type BoardBlueprintDimension = "system" | "competency" | "discipline";
export type BoardBlueprintMode = "First pass" | "Questions" | "Missed facts" | "Assessment" | "Review";
export type BoardConfidence = "red" | "orange" | "green" | "blue";

export interface BoardBlueprintLog {
  id: ID;
  date: string; // yyyy-MM-dd
  dimension: BoardBlueprintDimension;
  area: string;
  mode: BoardBlueprintMode;
  minutes: number;
  questions: number;
  correct: number;
  confidence: BoardConfidence;
  notes?: string;
  updated: string;
}

export interface Integration {
  id: ID;
  name: string;
  description: string;
  status: "connected" | "available" | "planned";
  icon?: string;
}

export interface BoardPrepProfile {
  medYear: string;
  contentStarted: "not-started" | "light" | "half" | "most" | "dedicated";
  examDate?: string; // yyyy-MM-dd
  weeklyHours: number;
  questionTarget: number;
  resourcesDone: string[];
  installedBlueprintAreas?: string[];
  completedBlueprintItems?: string[];
  otherResources: string;
  confidence: "low" | "medium" | "high";
  blueprintLogs: BoardBlueprintLog[];
  aiStrategy?: string;
  updated: string;
}

/** "Win the day" — a morning intention reviewed at the end of the day. */
export interface DayPlan {
  dayKey: string; // the study day this plan is for (yyyy-MM-dd)
  intention: string; // what would make today a win
  wins: string[]; // a few concrete win conditions / mini-tasks
  /** Optional, user-authored context for the Daily Check-In. */
  expectedStudyMinutes?: number;
  personalNote?: string;
  priority?: string;
  anticipatedObstacle?: string;
  commitmentLevel?: 1 | 2 | 3 | 4 | 5;
  createdAt: string;
  reviewedAt?: string;
  outcome?: "won" | "partial" | "missed";
  reviewNote?: string;
}

export interface DailyArchive {
  date: string; // local yyyy-MM-dd
  archivedAt: string;
  studyMinutes: number;
  ankiCards: number;
  productiveMinutes: number;
  openTaskIds: string[];
  carriedTaskIds: string[];
  journalEntryIds: string[];
  energyFactorIds: string[];
  dayPlanOutcome?: DayPlan["outcome"];
}

export interface DailyRolloverEvent {
  id: ID;
  fromDate: string;
  toDate: string;
  processedAt: string;
  reason: "app-load" | "focus" | "visible" | "midnight" | "timezone-change" | "manual-check" | "migration";
  daysAway: number;
  timezoneOffset: number;
  carriedTaskIds: string[];
}

export type EnergyFactorSource = "journal" | "manual" | "sleep" | "tracker" | "habit" | "goal" | "import";

export type EnergyFactorCategory =
  | "sleep"
  | "movement"
  | "food"
  | "focus"
  | "spirit"
  | "recovery"
  | "substance"
  | "workload";

export interface EnergyFactor {
  id: ID;
  date: string; // local yyyy-MM-dd
  source: EnergyFactorSource;
  label: string;
  category: EnergyFactorCategory;
  delta: number;
  confidence: number;
  carryoverDays: number;
  decayPerDay: number;
  userConfirmed: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Academic phase, set during first-launch onboarding — tailors targets, tagline, and AI context. */
export type AcademicPhase =
  | "pre-med"
  | "mcat"
  | "preclinical"
  | "clinical"
  | "step1-dedicated"
  | "step2-dedicated"
  | "other";

export type ExperienceFocusId =
  | "term1"
  | "term2"
  | "term3"
  | "term4"
  | "term5"
  | "cbse"
  | "step1"
  | "step2"
  | "step3"
  | "shelf"
  | "mcat"
  | "premed";

/**
 * Top-level program a user belongs to, chosen first during onboarding. It sits
 * above ExperienceFocusId (the individual study lanes) and decides which course
 * structure is auto-seeded, which resources show, and which focus lanes appear.
 */
export type EducationTrackId =
  | "sgu" // St. George's University (Caribbean MD)
  | "usmd" // US allopathic MD
  | "do" // US osteopathic DO
  | "img" // Other international medical school
  | "premed" // Pre-med / pre-health undergraduate
  | "mcat" // MCAT-focused prep
  | "undergrad" // General undergraduate
  | "nursing" // Nursing school
  | "pa"; // Physician Assistant school

/** Inclusive training stage, independent from the user's current exam/focus lane. */
export type AcademicStageId =
  | "preclinical"
  | "clinical-rotations"
  | "dedicated-board-prep"
  | "residency-application"
  | "coursework"
  | "exam-prep"
  | "application"
  | "didactic"
  | "clinical-training"
  | "licensure-prep"
  | "other";

export type DailySuccessSchedule =
  | { kind: "daily" }
  | { kind: "weekdays"; weekdays: number[] }
  | { kind: "times-per-week"; times: number; weekStartsOn?: 0 | 1 };

export type DailySuccessSource =
  | { kind: "study-minutes" }
  | { kind: "cards-reviewed" }
  | { kind: "practice-questions" }
  | { kind: "productivity-tracker"; trackerId: string }
  | { kind: "habit"; habitId: string }
  | { kind: "activity-alias" }
  | { kind: "manual" }
  | { kind: "journal-closeout" };

/**
 * A reference layer over existing logs/habits/closeouts. Sparse manual
 * corrections are user-authored overrides; derived completion remains a pure
 * ledger and does not duplicate those engines.
 */
export interface DailySuccessRequirement {
  id: ID;
  label: string;
  enabled: boolean;
  source: DailySuccessSource;
  /**
   * Exact, case-insensitive activity labels that may contribute when a record
   * is not already linked through the requirement's native source. Aliases are
   * intentionally exact after punctuation/whitespace normalization; they are
   * never substring matches.
   */
  aliases?: string[];
  /** Explicit per-target activity corrections. Exclusions undo a match without
   * deleting its source log; inclusions reassign a source log to this target. */
  excludedSourceRecordIds?: ID[];
  includedSourceRecordIds?: ID[];
  /** Optional user-authored corrections for this target; no separate engine. */
  manualContributions?: DailySuccessManualContribution[];
  /** Relative contribution to aggregate progress; absent means 1. */
  weight?: number;
  target: number;
  unit: string;
  schedule: DailySuccessSchedule;
  /** Local yyyy-MM-dd floor. Dates before this can never be missed. */
  trackingStartsAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An optional user-authored correction for one target/day. These records live
 * beside the target configuration so they can round-trip through the existing
 * profile backup path without creating another activity engine.
 */
export interface DailySuccessManualContribution {
  id: ID;
  requirementId: ID;
  dayKey: string;
  value: number;
  unit?: string;
  note?: string;
  /** Add a signed correction, or replace that day's derived total. */
  mode: "add" | "override";
  createdAt: string;
  updatedAt: string;
}

export interface DailySuccessConfig {
  version: 1;
  configuredAt: string;
  requirements: DailySuccessRequirement[];
}

export type DashboardWidgetId =
  | "welcome"
  | "commandBrief"
  | "questionBank"
  | "courseTracker"
  | "tasks"
  | "readiness"
  | "activity"
  | "journal"
  | "streak"
  | "dailyWord"
  | "winDay"
  | "todayScore"
  | "examCountdown"
  | "pomodoro"
  | "weekly"
  | "suggested"
  /** Legacy storage-only ID; intentionally absent from current catalogs. */
  | "aiActions"
  | "schedule"
  | "termMap"
  | "localData"
  | "latestStandup"
  | "productivityTrend"
  | "premedHours"
  | "resourceFocus"
  | "boardBlueprint";

export type DashboardWidgetSize = "small" | "medium" | "large" | "extra-large";

export type DashboardLayoutPresetId = "focused" | "study-heavy" | "wellbeing-balanced" | "custom";

/**
 * Additive presentation state for one dashboard widget. The index signature is
 * intentional: a newer AXOM build may add a harmless JSON preference that an
 * older build must round-trip instead of deleting.
 */
export interface DashboardWidgetPreferences {
  size: DashboardWidgetSize;
  enabledFields?: string[];
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Versioned, optional dashboard layout metadata. Legacy order/visibility
 * fields remain supported so v32 workspaces do not require a migration.
 */
export interface DashboardLayoutPreferences {
  version: 1;
  preset: DashboardLayoutPresetId;
  order: string[];
  hiddenWidgetIds: string[];
  widgets: Record<string, DashboardWidgetPreferences>;
  dismissedExtraLargeRecommendation?: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}

// ===========================================================================
// Blueprint Prep — an installable operating-system model (god-file architecture).
// A catalog defines lanes → blueprints → categories → nodes; installing a
// blueprint instantiates a rich, per-user container of mastery objects rather
// than flattening everything into lecture "passes".
// ===========================================================================

/** Top-level pathway. The active bar only shows the current mode's lanes. */
export type BlueprintMode = "usmle" | "prehealth";

export type BlueprintLaneId =
  // USMLE mode
  | "step1" | "step2" | "dedicated" | "shelf" | "step3"
  // Pre-Health mode
  | "premed" | "mcat" | "dat" | "casper";

/** A node is not always a checkbox — it can be content, a task, a tracker, etc. */
export type BlueprintNodeType =
  | "content" | "task" | "tracker" | "queue" | "assessment" | "evidence" | "metric" | "planner";

export type BlueprintNodeStatus = "not-started" | "in-progress" | "blocked" | "mastered" | "done";
export type BlueprintPriority = "high" | "medium" | "low";

export type SourceType = "official" | "tool" | "internal";
export type VerificationStatus = "verified" | "source-audited" | "needs-review" | "unverified";
export type SourceConfidence = "high" | "medium" | "low";

/** Source governance — official sources govern; tools are labeled as tools. */
export interface BlueprintSource {
  type: SourceType;
  name: string;
  url?: string;
  lastVerified?: string; // ISO date
  verification: VerificationStatus;
  confidence: SourceConfidence;
  sourceVersion?: string;
  changeLog?: string;
  auditNote?: string;
  userConfirmed?: boolean;
}

export interface BlueprintResourceLink {
  label: string;
  url: string;
  kind: SourceType;
}

/** A user-owned mastery object inside an installed blueprint container. */
export interface InstalledBlueprintNode {
  id: string;            // unique per install
  catalogNodeId: string; // links back to the catalog template
  category: string;
  subCategory?: string;
  objective: string;
  detail?: string;
  taskType: BlueprintNodeType;
  priority: BlueprintPriority;
  status: BlueprintNodeStatus;
  mastery: number;       // 0–100
  tags: string[];
  sourceType?: SourceType;
  sourceName?: string;
  sourceUrl?: string;
  lastVerified?: string;
  sourceVerification?: VerificationStatus;
  sourceConfidence?: SourceConfidence;
  sourceVersion?: string;
  sourceAuditNote?: string;
  sourceChangeLog?: string;
  resourceLinks: BlueprintResourceLink[];
  linkedQuestions: number;
  linkedAnki: number;
  linkedErrorLog: number;
  linkedAssessments: number;
  dueDate?: string;
  estimatedMinutes?: number;
  evidenceOfCompletion?: string;
  notes?: string;
  order: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One installed blueprint = a named, collapsible container under the tracker. */
export interface InstalledBlueprint {
  id: string;            // containerId
  blueprintId: string;
  laneId: BlueprintLaneId;
  title: string;         // container name (duplicates get a version suffix)
  catalogVersion: number;
  installedAt: string;
  updatedAt: string;
  nodes: InstalledBlueprintNode[];
}

export interface Profile {
  name: string;
  userId: string; // local backend owner key derived from display name
  versionLabel: string;
  tagline: string;
  avatarDataUrl?: string; // user-uploaded avatar (data URL)
  // Anti-overload targets: a "good enough" day, not a maximum to grind past.
  dailyCardTarget: number;
  dailyMinuteTarget: number;
  // Sidebar customization: hidden (unsubscribed) nav ids + collapsed Tools folder
  hiddenNav?: string[];
  toolsCollapsed?: boolean;
  prepCollapsed?: boolean;
  dailyGamesCollapsed?: boolean;
  // First-launch onboarding
  onboarded: boolean;
  tourDone?: boolean; // global guided tour completed or skipped
  promise?: {
    signedName: string;
    signedAt: string;
    promiseTextVersion?: string;
    journalEntryId?: string;
  }; // the signed "promise to yourself"
  /** Automatic post-guide prompt suppression; signing remains available in Settings. */
  promisePromptStatus?: { state: "deferred" | "skipped"; updatedAt: string; promptVersion?: string };
  phase?: AcademicPhase;
  // The program chosen during onboarding (drives structure, resources, lanes).
  educationTrack?: EducationTrackId;
  academicStageId?: AcademicStageId;
  customAcademicStage?: string;
  // Whether SGU-specific shared drives are shown on the Resources page.
  showSguResources?: boolean;
  activeFocusId?: ExperienceFocusId;
  focusSubscriptions: ExperienceFocusId[];
  dashboardWidgetOrder?: DashboardWidgetId[];
  hiddenDashboardWidgets?: DashboardWidgetId[];
  /** Optional Wave 5.5D layout metadata; legacy widget fields remain valid. */
  dashboardLayout?: DashboardLayoutPreferences;
  journalReviewTime?: string; // "20:00" local time
  /** Optional notebook cover/paper metadata; journal text remains in entries. */
  journalNotebook?: JournalNotebookPreferences;
  /** Optional daily-loop reminder preferences. Reminder delivery metadata is
   * device-only and never stored with the workspace. */
  dailyLoopReminders?: DailyLoopReminderPreferences;
  /** Optional "Are you locked in?" interval check-ins. Delivery state is device-only. */
  focusCheckIn?: import("./focusCheckIn").FocusCheckInPreferences;
  /** One-tap energy checks (0–100), newest last; synced with the workspace. */
  energyChecks?: import("./energyInsights").EnergyCheck[];
  blueprintMode?: BlueprintMode; // which lane bar (USMLE vs Pre-Health) is active
  // Repetitive-task autofill (§18): user-owned, local-only.
  taskAutofillDisabled?: boolean;
  taskTemplates?: TaskTemplate[];
  // Early/experimental features (§6) — opt-in via Settings → Early Features.
  experimentalFlags?: ExperimentalFlags;
  /** Shared by the clock and new date-based utilities. */
  timeZonePreference?: TimeZonePreference;
  clockPreferences?: ClockPreferences;
  /** Undefined keeps accepted legacy scoring; an explicit empty list is neutral. */
  dailySuccess?: DailySuccessConfig;
  /** Device-owned presentation preference; hiding a shortcut never removes logs. */
  hiddenActivityShortcuts?: string[];
  // Custom Pomodoro durations (§3), persisted with the profile.
  pomodoroCustom?: { focus: number; break: number; longBreak: number; cyclesBeforeLongBreak: number };
  pomodoroPreferences?: PomodoroPreferences;
  /** Learner-authored defaults; course, kind, and item layers resolve without duplicating state. */
  studyWorkflow?: StudyWorkflowPreferences;
  applicationResearch?: import("./applicationResearch").ApplicationResearchEntry[];
  applicationProfile?: import("./applicationProfile").ApplicationProfile;
}

export interface DailyLoopReminderPreferences {
  checkInEnabled?: boolean;
  checkInTime?: string; // "08:00" device-local time
  closeoutEnabled?: boolean;
  closeoutTime?: string; // "20:30" device-local time
  /** Optional device-local interval in which AXOM does not publish reminder signals. */
  quietHoursEnabled?: boolean;
  quietHoursStart?: string; // "22:00" device-local time
  quietHoursEnd?: string; // "07:00" device-local time
}

// New daily-loop record types live in their own modules (kept out of this file
// so domains stay composable); the state shape references them here.
import type { StudySession } from "./sessions";
import type { DailyCloseout } from "./closeout";
import type { RecoveryPlan } from "./recovery";
import type { QuestionRecord } from "./questions";
import type { QuizBlock, QuizSession } from "./quiz";
import type { QuestionSet, SourceDocument } from "./library";
import type { SavedQuestionFilter } from "./questionFilters";
import type { AnkiCard, CardReviewLog } from "./ankiCards";

export interface NoctyriumState {
  profile: Profile;
  terms: Term[];
  courses: Course[];
  tracker: TrackerItem[];
  productivityTrackers: ProductivityTracker[];
  resources: Resource[];
  tasks: Task[];
  journal: JournalEntry[];
  premedExperiences: PremedExperienceEntry[];
  prompts: Prompt[];
  folders: HubFolder[];
  logs: StudyLog[];
  integrations: Integration[];
  boardPrep: Record<BoardExamId, BoardPrepProfile>;
  dayPlans: DayPlan[];
  blueprintInstalls: InstalledBlueprint[];
  activeDayKey: string; // current study day
  lastActiveLocalDate: string; // current device-local calendar date
  lastTimezoneOffset: number;
  dailyArchives: DailyArchive[];
  dailyRolloverEvents: DailyRolloverEvent[];
  energyFactors: EnergyFactor[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  // Daily academic loop (schema v27)
  sessions: StudySession[];
  closeouts: DailyCloseout[];
  recoveryPlans: RecoveryPlan[];
  questions: QuestionRecord[];
  quizSessions: QuizSession[];
  // Question-bank library (schema v30)
  documents: SourceDocument[];
  questionSets: QuestionSet[];
  /** Q2b-3: locally-saved Question Bank filter presets. */
  savedQuestionFilters: SavedQuestionFilter[];
  quizBlocks: QuizBlock[]; // schema v29
  ankiCards: AnkiCard[];
  cardReviews: CardReviewLog[];
  // Optional Daily Games history. Enablement lives in profile preferences.
  dailyWordPuzzles: DailyWordPuzzleState[];
  schemaVersion: number;
}
