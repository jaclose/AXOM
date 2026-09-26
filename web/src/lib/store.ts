// ===========================================================================
// The single source of truth. Zustand + an IndexedDB-first persistent vault so
// every change survives reloads, works offline, and needs no backend. All lists are CRUD-
// able, which is what makes the app "modular" rather than the fixed Swift build.
// ===========================================================================
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  BoardBlueprintLog, BoardExamId, BoardPrepProfile, Course, CourseModule, DailyRolloverEvent, DayPlan, HubFolder, JournalEntry, NoctyriumState,
  PremedExperienceEntry, ProductivityTracker, Prompt, Resource, Task, Term, TrackerItem, Profile, StudyLog, InstalledBlueprintNode, EnergyFactor,
  Habit, HabitEntry, HabitCheckStatus, DailyWordPuzzleState,
} from "./types";
import { blueprintById } from "./blueprintCatalog";
import { instantiateBlueprint, duplicateInstall, reconcileBlueprint } from "./blueprintInstall";
import {
  APP_VERSION_LABEL, DEFAULT_CLOCK_PREFERENCES, DEFAULT_DASHBOARD_WIDGETS, DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
  DEFAULT_TIME_ZONE_PREFERENCE, STORED_DASHBOARD_WIDGET_IDS,
  defaultProductivityTrackers,
  driveResourceFields, makeSeed, SCHEMA_VERSION, SGU_DRIVES,
} from "./seed";
import { dayKey, isoDate } from "./scoring";
import {
  buildDailyArchive,
  carryOpenTasksForward,
  localDateKey,
  markRolloverDone,
  mergeDailyArchive,
  mergeRolloverEvent,
  shouldRollover,
  type RolloverReason,
} from "./dailyRollover";
import { assertVaultWrite, getVaultWriteCheckpoint, localVaultStorage } from "./localVault";
import { storeHydration } from "./storeHydration";
import { userIdFromName } from "./userIdentity";
import { ACADEMIC_TEMPLATE_COURSES, ACADEMIC_TEMPLATE_TERMS, focusOption, normalizedFocusIds } from "./experience";
import { inferTrackFromFocus, isAcademicStageId, resolveTrack } from "./tracks";
import type { EducationTrack } from "./tracks";
import type { EducationTrackId, ExperienceFocusId } from "./types";

interface ApplyTrackOptions {
  focusSubscriptions?: ExperienceFocusId[];
  activeFocusId?: ExperienceFocusId;
  showSguResources?: boolean;
  cardTarget?: number;
  minuteTarget?: number;
  /** Install the track's term/course/tracker blueprint (replaces seed shells). */
  seedStructure?: boolean;
}
import { normalizeTrackerPath, trackerPathKey } from "./pathUtils";
import { normalizeResourceUrl } from "./resourceUtils";
import { normalizeDailySuccessConfig } from "./dailySuccess";
import { normalizePomodoroPreferences } from "./pomodoroPreferences";
import { normalizeDailyLoopReminderPreferences } from "./dailyLoopReminders";
import { normalizeFocusCheckInPreferences } from "./focusCheckIn";
import { normalizeDashboardLayoutPreferences } from "./dashboardWidgets";
import { normalizeJournalEntries, normalizeJournalNotebookPreferences } from "./journalNotebook";
import { normalizeStudyWorkflow } from "./studyPreferences";
import { normalizeApplicationResearch } from "./applicationResearch";
import { normalizeApplicationProfile } from "./applicationProfile";
import { BRAND, STORAGE_KEYS } from "./brand";
import {
  closeOpenSegment, findLiveSession, openNewSegment, restoreSession, sessionElapsedMinutes,
  type SessionCapture, type SessionLink, type SessionQuickLog, type StudySession,
} from "./sessions";
import type { DailyCloseout } from "./closeout";
import type { RecoveryPlan } from "./recovery";
import { applyAttempt, normalizeQuestionTaxonomy, validateQuestionRecord, withCorrectAnswerText, type QuestionAttempt, type QuestionRecord } from "./questions";
import { normalizeTagList, mergeTagsInList } from "./questionTags";
import {
  normalizeSavedQuestionFilters, normalizeQuestionFilter,
  type SavedQuestionFilter, type QuestionFilterCriteria,
} from "./questionFilters";
import type { QuestionOrdering } from "./questionOrdering";
import { reconcileQuestionAnnotationSources } from "./questionAnnotations";
import { deleteQuestionAttachmentBlobs, listQuestionAttachmentBlobKeys, runQuestionAttachmentMaintenance } from "./questionAttachments";
import type { QuizBlock, QuizSession } from "./quiz";
import { buildQuestionSetFromFilter, type QuestionSet, type SourceDocument } from "./library";
import { repairOrphans } from "./orphanRepair";
import type {
  ReviewedImportPersistencePlan,
  ReviewedImportPersistenceResult,
} from "./questionImportFinalization";
import {
  nextSchedule, validateAnkiCard,
  type AnkiCard, type CardReviewLog, type ReviewRating,
} from "./ankiCards";

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

interface Actions {
  // profile
  updateProfile: (patch: Partial<Profile>) => void;
  // education track (program) — sets prefs, and optionally installs its
  // term/course/tracker blueprint (used by onboarding + "load starter structure")
  applyEducationTrack: (trackId: EducationTrackId, opts?: ApplyTrackOptions) => void;

  // terms
  addTerm: (name: string) => void;
  renameTerm: (id: string, name: string) => void;
  removeTerm: (id: string) => void;

  // courses
  addCourse: (c: Omit<Course, "id" | "modules"> & { modules?: string[] }) => void;
  updateCourse: (id: string, patch: Partial<Course>) => void;
  removeCourse: (id: string) => void;
  addModule: (courseId: string, name: string) => void;
  renameModule: (courseId: string, moduleId: string, name: string) => void;
  removeModule: (courseId: string, moduleId: string) => void;

  // tracker
  addTrackerItem: (item: Omit<TrackerItem, "id" | "updated">) => void;
  bulkAddTrackerItems: (items: Omit<TrackerItem, "id" | "updated">[]) => void;
  updateTrackerItem: (id: string, patch: Partial<TrackerItem>) => void;
  renameTrackerScope: (oldPath: string, newPath: string) => void;
  removeTrackerScope: (path: string) => void;
  bumpPasses: (id: string, delta: number) => void; // +1 / -1 study pass (clamped 0..)
  setPasses: (id: string, n: number) => void; // click a dot to set passes directly
  cycleAnki: (id: string) => void; // 0→1→2→3→0 (orange/yellow/purple)
  cycleYield: (id: string) => void; // none→high→review→low
  removeTrackerItem: (id: string) => void;

  // resources (saved hyperlinks)
  addResource: (r: Omit<Resource, "id" | "created">) => void;
  bulkAddResources: (rs: Omit<Resource, "id" | "created">[]) => void;
  updateResource: (id: string, patch: Partial<Resource>) => void;
  removeResource: (id: string) => void;
  toggleResourceFavorite: (id: string) => void;

  // tasks
  addTask: (title: string, due?: string, scope?: string) => void;
  toggleTask: (id: string) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;

  // journal
  addJournal: (e: Omit<JournalEntry, "id"> & { id?: string }) => void;
  updateJournal: (id: string, patch: Partial<JournalEntry>) => void;
  removeJournal: (id: string) => void;

  // pre-med experiences
  addPremedExperience: (e: Omit<PremedExperienceEntry, "id" | "created">) => void;
  updatePremedExperience: (id: string, patch: Partial<PremedExperienceEntry>) => void;
  removePremedExperience: (id: string) => void;

  // prompts
  addPrompt: (p: Omit<Prompt, "id" | "created" | "updated">) => void;
  updatePrompt: (id: string, patch: Partial<Prompt>) => void;
  removePrompt: (id: string) => void;

  // hub folders
  addFolder: (f: Omit<HubFolder, "id">) => void;
  updateFolder: (id: string, patch: Partial<HubFolder>) => void;
  removeFolder: (id: string) => void;

  // productivity
  logStudy: (entry: { type: string; minutes?: number; cards?: number; note?: string }) => void;
  logActivity: (entry: {
    label: string;
    trackerId?: string;
    minutes?: number;
    quantity?: number;
    quantityKind?: "cards" | "questions" | "count";
    quantityLabel?: string;
    note?: string;
  }) => void;
  logProductivity: (entry: { trackerId: string; quantity?: number; minutes?: number; note?: string }) => void;
  addProductivityTracker: (tracker: Omit<ProductivityTracker, "id" | "createdAt" | "updatedAt">) => void;
  updateProductivityTracker: (id: string, patch: Partial<ProductivityTracker>) => void;
  startNewStudyDay: () => void;
  checkDailyRollover: (reason?: RolloverReason, at?: Date) => { changed: boolean; toDate: string; daysAway: number; carriedTaskIds?: string[] };

  // energy/readiness
  addEnergyFactor: (factor: Omit<EnergyFactor, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  updateEnergyFactor: (id: string, patch: Partial<EnergyFactor>) => void;
  removeEnergyFactor: (id: string) => void;

  // habits (experimental — §6)
  addHabit: (habit: Omit<Habit, "id" | "createdAt" | "updatedAt">) => string;
  updateHabit: (id: string, patch: Partial<Habit>) => void;
  removeHabit: (id: string) => void;
  checkHabit: (habitId: string, date: string, status: HabitCheckStatus, value?: number, note?: string) => void;
  clearHabitCheck: (habitId: string, date: string) => void;

  // board prep
  updateBoardPrep: (exam: BoardExamId, patch: Partial<BoardPrepProfile>) => void;
  addBoardBlueprintLog: (exam: BoardExamId, entry: Omit<BoardBlueprintLog, "id" | "updated">) => void;
  removeBoardBlueprintLog: (exam: BoardExamId, id: string) => void;

  // win the day
  setDayPlan: (
    dayKey: string,
    intention: string,
    wins: string[],
    details?: Pick<DayPlan, "expectedStudyMinutes" | "personalNote" | "priority" | "anticipatedObstacle" | "commitmentLevel">,
  ) => void;
  reviewDayPlan: (dayKey: string, outcome: DayPlan["outcome"], reviewNote?: string) => void;

  // blueprint prep (installable operating-system containers)
  installBlueprint: (blueprintId: string, opts?: { duplicate?: boolean }) => string | null;
  duplicateBlueprintInstall: (installId: string) => string | null;
  removeBlueprintInstall: (installId: string) => void;
  updateBlueprintNode: (installId: string, nodeId: string, patch: Partial<InstalledBlueprintNode>) => void;
  reconcileBlueprintInstall: (installId: string) => void;

  // study sessions (daily loop §2) — timestamp-segment based, reload-safe
  startSession: (input: { title: string; link: SessionLink; plannedMinutes?: number; resources?: string[]; reason?: string; source: StudySession["source"] }) => string;
  pauseSession: (id: string) => void;
  resumeSession: (id: string) => void;
  quickLogSession: (id: string, log: SessionQuickLog, note?: string) => void;
  completeSession: (id: string, capture: SessionCapture) => void;
  abandonSession: (id: string) => void;
  /** Re-normalize live sessions after reload (caps stale open segments). */
  restoreLiveSessions: () => void;

  // daily closeout (§3) — one per study day, upserted
  saveCloseout: (closeout: Omit<DailyCloseout, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;

  // recovery protocol (§4)
  saveRecoveryPlan: (plan: RecoveryPlan) => void;
  updateRecoveryPlan: (id: string, patch: Partial<RecoveryPlan>) => void;

  // question workspace (Phase 4) — records are validated at the boundary
  addQuestion: (input: unknown) => { ok: boolean; errors: string[]; id?: string };
  /** Validate and durably persist one complete reviewed import snapshot. */
  commitReviewedImport: (plan: ReviewedImportPersistencePlan) => Promise<ReviewedImportPersistenceResult>;
  updateQuestion: (id: string, patch: Partial<QuestionRecord>) => void;
  removeQuestion: (id: string) => void;
  recordQuestionAttempt: (id: string, attempt: Omit<QuestionAttempt, "at">) => void;

  // quiz sessions (tutor/exam blocks, schema v29)
  saveQuizSession: (session: QuizSession) => void;
  toggleQuestionMarked: (id: string) => void;
  /** Bulk-apply category/tags to many questions (Question Bank bulk edit). */
  bulkUpdateQuestions: (ids: string[], patch: { category?: string; tags?: string[]; addTags?: string[] }) => void;
  /** Q2b-3 bulk tag operations — add/remove/replace/clear across a selection. */
  bulkTagQuestions: (ids: string[], op: { add?: string[]; remove?: string[]; replace?: string[]; clear?: boolean }) => void;
  renameTag: (from: string, to: string) => void;
  removeTag: (tag: string) => void;
  /** Fold every `from` tag into `into` across the bank (normalized, deduped). */
  mergeTags: (from: string[], into: string) => void;

  // Q2b-3: locally-saved Question Bank filter presets
  addSavedQuestionFilter: (input: { name: string; criteria: QuestionFilterCriteria; ordering?: QuestionOrdering }) => string;
  updateSavedQuestionFilter: (id: string, patch: Partial<Pick<SavedQuestionFilter, "name" | "criteria" | "ordering">>) => void;
  removeSavedQuestionFilter: (id: string) => void;
  /** Create an immutable, deterministically-ordered question set from a filter.
   * `scopeIds` (when given) restricts the source pool to exactly those ids so the
   * snapshot matches the on-screen list under mode-pill / mapping-review scoping. */
  createQuestionSetFromFilter: (input: {
    title: string; criteria: QuestionFilterCriteria; ordering: QuestionOrdering; seed?: string; tags?: string[]; scopeIds?: readonly string[];
  }) => string;

  // question-bank library (schema v30) — documents, sets, saved blocks
  addDocument: (doc: SourceDocument) => void;
  updateDocument: (id: string, patch: Partial<SourceDocument>) => void;
  removeDocument: (id: string) => void;
  addQuestionSet: (set: QuestionSet) => void;
  updateQuestionSet: (id: string, patch: Partial<QuestionSet>) => void;
  /** Remove a set; its questions stay in the bank, unlinked (never silent data loss). */
  removeQuestionSet: (id: string) => void;
  saveQuizBlock: (block: QuizBlock) => void;
  removeQuizBlock: (id: string) => void;
  /** Repair dangling library links (never deletes questions/attempts). */
  repairQuestionBankOrphans: () => number;

  // anki card vault (Phase 5) — validated + reviewed before save
  addAnkiCards: (inputs: unknown[]) => { saved: number; errors: string[] };
  updateAnkiCard: (id: string, patch: Partial<AnkiCard>) => void;
  removeAnkiCard: (id: string) => void;
  reviewAnkiCard: (id: string, rating: ReviewRating, msToAnswer?: number) => void;

  // optional Daily Games — submitted guesses live in the IndexedDB workspace
  upsertDailyWordPuzzle: (puzzle: DailyWordPuzzleState) => void;
  resetDailyWordPuzzles: () => void;

  // data management
  replaceAll: (state: NoctyriumState) => void;
  resetToSeed: () => void;
  startFresh: () => void; // wipe sample data, keep an empty personal profile
}

export type Store = NoctyriumState & Actions;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...makeSeed(),

      updateProfile: (patch) => set((s) => {
        const profile = { ...s.profile, ...patch };
        if ("name" in patch || !profile.userId) profile.userId = userIdFromName(profile.name);
        return { profile };
      }),

      applyEducationTrack: (trackId, opts = {}) =>
        set((s) => {
          const track = resolveTrack(trackId);
          const focusSubscriptions = opts.focusSubscriptions
            ? normalizedFocusIds(opts.focusSubscriptions)
            : s.profile.focusSubscriptions;
          const activeFocusId = opts.activeFocusId
            && focusSubscriptions.includes(opts.activeFocusId)
            ? opts.activeFocusId
            : s.profile.activeFocusId;
          const focus = focusOption(activeFocusId);
          const profile: Profile = {
            ...s.profile,
            educationTrack: trackId,
            showSguResources: opts.showSguResources ?? track.showsSguResources,
            hiddenNav: hiddenNavForTrackSwitch(s.profile.hiddenNav, trackId),
            focusSubscriptions,
            activeFocusId,
            phase: focus?.phase ?? s.profile.phase,
            ...(opts.cardTarget != null ? { dailyCardTarget: opts.cardTarget } : {}),
            ...(opts.minuteTarget != null ? { dailyMinuteTarget: opts.minuteTarget } : {}),
          };
          if (!opts.seedStructure) return { profile };

          const built = buildTrackStructure(track);
          // First-run / explicit reseed: swap in the track's term/course shells
          // and keep any tracker rows the user added (drop only seed examples).
          const keptTracker = s.tracker.filter((t) => !/^example[:\s]/i.test(t.label));
          return {
            profile,
            terms: built.terms,
            courses: built.courses,
            tracker: [...keptTracker, ...built.tracker],
          };
        }),

      addTerm: (name) => set((s) => ({ terms: [...s.terms, { id: uid(), name }] })),
      renameTerm: (id, name) =>
        set((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, name } : t)) })),
      removeTerm: (id) =>
        set((s) => ({
          terms: s.terms.filter((t) => t.id !== id),
          courses: s.courses.filter((c) => c.termId !== id),
        })),

      addCourse: ({ modules = [], ...rest }) =>
        set((s) => ({
          courses: [
            ...s.courses,
            { ...rest, id: uid(), modules: modules.map((n) => ({ id: uid(), name: n })) },
          ],
        })),
      updateCourse: (id, patch) =>
        set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeCourse: (id) => set((s) => ({ courses: s.courses.filter((c) => c.id !== id) })),
      addModule: (courseId, name) =>
        set((s) => ({
          courses: s.courses.map((c) =>
            c.id === courseId ? { ...c, modules: [...c.modules, { id: uid(), name }] } : c,
          ),
        })),
      renameModule: (courseId, moduleId, name) =>
        set((s) => ({
          courses: s.courses.map((c) =>
            c.id === courseId
              ? { ...c, modules: c.modules.map((m) => (m.id === moduleId ? { ...m, name } : m)) }
              : c,
          ),
        })),
      removeModule: (courseId, moduleId) =>
        set((s) => ({
          courses: s.courses.map((c) =>
            c.id === courseId
              ? { ...c, modules: c.modules.filter((m: CourseModule) => m.id !== moduleId) }
              : c,
          ),
        })),

      addTrackerItem: (item) =>
        set((s) => ({ tracker: [...s.tracker, { ...item, path: normalizeTrackerPath(item.path), id: uid(), updated: now() }] })),
      bulkAddTrackerItems: (items) =>
        set((s) => ({
          tracker: [...s.tracker, ...items.map((item) => ({ ...item, path: normalizeTrackerPath(item.path), id: uid(), updated: now() }))],
        })),
      updateTrackerItem: (id, patch) =>
        set((s) => ({
          tracker: s.tracker.map((t) => (t.id === id ? { ...t, ...patch, updated: now() } : t)),
        })),
      renameTrackerScope: (oldPath, newPath) =>
        set((s) => {
          const from = normalizeTrackerPath(oldPath);
          const to = normalizeTrackerPath(newPath);
          const fromKey = trackerPathKey(from);
          const toKey = trackerPathKey(to);
          if (!from || !to || fromKey === toKey) return {};
          return {
            tracker: s.tracker.map((t) => {
              const cleanPath = normalizeTrackerPath(t.path);
              const key = trackerPathKey(cleanPath);
              return key === fromKey || key.startsWith(`${fromKey}/`)
                ? { ...t, path: `${to}${cleanPath.slice(from.length)}`, updated: now() }
                : t;
            }),
          };
        }),
      removeTrackerScope: (path) =>
        set((s) => {
          const from = trackerPathKey(path);
          if (!from) return {};
          return { tracker: s.tracker.filter((t) => {
            const key = trackerPathKey(t.path);
            return !(key === from || key.startsWith(`${from}/`));
          }) };
        }),
      bumpPasses: (id, delta) =>
        set((s) => ({
          tracker: s.tracker.map((t) =>
            t.id === id ? { ...t, passes: Math.max(0, t.passes + delta), updated: now() } : t),
        })),
      setPasses: (id, n) =>
        set((s) => ({
          tracker: s.tracker.map((t) =>
            // click the dot you're already at to clear it back one
            t.id === id ? { ...t, passes: t.passes === n ? n - 1 : n, updated: now() } : t),
        })),
      cycleAnki: (id) =>
        set((s) => ({
          tracker: s.tracker.map((t) =>
            t.id === id ? { ...t, ankiPasses: (t.ankiPasses + 1) % 4, updated: now() } : t),
        })),
      cycleYield: (id) =>
        set((s) => {
          const order = ["none", "high", "review", "low"] as const;
          return {
            tracker: s.tracker.map((t) =>
              t.id === id
                ? { ...t, yield: order[(order.indexOf(t.yield) + 1) % order.length], updated: now() }
                : t),
          };
        }),
      removeTrackerItem: (id) => set((s) => ({ tracker: s.tracker.filter((t) => t.id !== id) })),

      addResource: (r) =>
        set((s) => addResourceToState(s.resources, r)),
      bulkAddResources: (rs) =>
        set((s) => addResourcesToState(s.resources, rs)),
      updateResource: (id, patch) =>
        set((s) => {
          const resources = s.resources.map((r) =>
            r.id === id ? { ...r, ...patch, url: patch.url ? normalizeResourceUrl(patch.url) : r.url } : r,
          );
          return { resources: dedupeResources(resources) };
        }),
      removeResource: (id) => set((s) => ({ resources: s.resources.filter((r) => r.id !== id) })),
      toggleResourceFavorite: (id) =>
        set((s) => ({ resources: s.resources.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r)) })),

      addTask: (title, due, scope) =>
        set((s) => ({ tasks: [{ id: uid(), title, due, scope, done: false, archived: false, created: now() }, ...s.tasks] })),
      toggleTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? now() : undefined } : t,
          ),
        })),
      updateTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      addJournal: (e) => set((s) => ({ journal: [{ ...e, id: e.id ?? uid() }, ...s.journal] })),
      updateJournal: (id, patch) =>
        set((s) => ({ journal: s.journal.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
      removeJournal: (id) => set((s) => ({ journal: s.journal.filter((j) => j.id !== id) })),

      addPremedExperience: (e) =>
        set((s) => ({ premedExperiences: [{ ...e, id: uid(), created: now() }, ...(s.premedExperiences ?? [])] })),
      updatePremedExperience: (id, patch) =>
        set((s) => ({ premedExperiences: (s.premedExperiences ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) })),
      removePremedExperience: (id) =>
        set((s) => ({ premedExperiences: (s.premedExperiences ?? []).filter((entry) => entry.id !== id) })),

      addPrompt: (p) =>
        set((s) => ({ prompts: [{ ...p, id: uid(), created: now(), updated: now() }, ...s.prompts] })),
      updatePrompt: (id, patch) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch, updated: now() } : p)),
        })),
      removePrompt: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),

      addFolder: (f) => set((s) => upsertFolder(s.folders, f)),
      updateFolder: (id, patch) =>
        set((s) => ({ folders: sortFolders(s.folders.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: now() } : f))) })),
      removeFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),

      logStudy: ({ type, minutes = 0, cards = 0, note }) =>
        set((s) => {
          const tracker = matchProductivityTracker(s.productivityTrackers, type);
          const current = s.logs.reduce((totals, log) => {
            if (log.dayKey !== s.activeDayKey || log.academic === false) return totals;
            return { minutes: totals.minutes + log.minutes, cards: totals.cards + log.cards };
          }, { minutes: 0, cards: 0 });
          let nextMinutes = Number.isFinite(minutes) ? minutes : 0;
          let nextCards = Number.isFinite(cards) ? cards : 0;
          if (nextMinutes < 0) nextMinutes = -Math.min(Math.max(0, current.minutes), Math.abs(nextMinutes));
          if (nextCards < 0) nextCards = -Math.min(Math.max(0, current.cards), Math.abs(nextCards));
          if (!nextMinutes && !nextCards) return {};
          const entry: StudyLog = {
            id: uid(),
            dayKey: s.activeDayKey,
            ts: now(),
            type: type.trim() || tracker?.name || "Study",
            minutes: nextMinutes,
            cards: nextCards,
            note,
            trackerId: tracker?.id,
            unitType: tracker?.unitType ?? "minutes",
            quantity: tracker?.unitType === "count" ? nextCards : nextMinutes,
            academic: tracker ? tracker.contributesToAcademicStudy : true,
            productive: tracker ? tracker.contributesToTotalProductiveTime : true,
          };
          return { logs: [entry, ...s.logs] };
        }),

      logActivity: ({ label, trackerId, minutes = 0, quantity = 0, quantityKind, quantityLabel, note }) =>
        set((s) => {
          const tracker = trackerId
            ? s.productivityTrackers.find((item) => item.id === trackerId && !item.archived)
            : undefined;
          const cleanLabel = label.trim().slice(0, 160);
          const nextMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
          const nextQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
          if (!cleanLabel && !tracker?.name) return {};
          // A named activity is a valid yes/no event even without a duration or
          // quantity. This keeps logging fast without fabricating study minutes.
          const semanticQuantity = nextQuantity || (!nextMinutes ? 1 : 0);
          const kind = quantityKind ?? (nextQuantity ? "count" : undefined);
          const entry: StudyLog = {
            id: uid(),
            dayKey: s.activeDayKey,
            ts: now(),
            type: cleanLabel || tracker?.name || "Activity",
            minutes: nextMinutes,
            cards: kind === "cards" ? semanticQuantity : 0,
            note: note?.trim() || undefined,
            trackerId: tracker?.id,
            unitType: nextMinutes && !semanticQuantity
              ? "minutes"
              : semanticQuantity && !nextMinutes
                ? (semanticQuantity === 1 && !kind ? "yesno" : "count")
                : tracker?.unitType ?? "custom",
            quantity: semanticQuantity,
            quantityKind: kind,
            quantityLabel: quantityLabel?.trim().slice(0, 40) || undefined,
            academic: tracker ? tracker.contributesToAcademicStudy : true,
            productive: tracker ? tracker.contributesToTotalProductiveTime : true,
          };
          return { logs: [entry, ...s.logs] };
        }),

      logProductivity: ({ trackerId, quantity = 0, minutes, note }) =>
        set((s) => {
          const tracker = s.productivityTrackers.find((item) => item.id === trackerId);
          if (!tracker || tracker.archived) return {};
          const value = Number.isFinite(minutes) ? Number(minutes) : Number(quantity) || 0;
          if (!value) return {};
          const entry: StudyLog = {
            id: uid(),
            dayKey: s.activeDayKey,
            ts: now(),
            type: tracker.name,
            minutes: tracker.unitType === "minutes" ? value : 0,
            cards: 0,
            note,
            trackerId: tracker.id,
            unitType: tracker.unitType,
            quantity: value,
            academic: tracker.contributesToAcademicStudy,
            productive: tracker.contributesToTotalProductiveTime,
          };
          return { logs: [entry, ...s.logs] };
        }),

      addProductivityTracker: (tracker) =>
        set((s) => ({
          productivityTrackers: [
            ...s.productivityTrackers,
            { ...tracker, id: uid(), createdAt: now(), updatedAt: now() },
          ],
        })),
      updateProductivityTracker: (id, patch) =>
        set((s) => ({
          productivityTrackers: s.productivityTrackers.map((tracker) =>
            tracker.id === id ? { ...tracker, ...patch, updatedAt: now() } : tracker),
        })),

      addEnergyFactor: (factor) =>
        set((s) => {
          const timestamp = now();
          const entry: EnergyFactor = {
            ...factor,
            id: factor.id ?? uid(),
            date: factor.date || localDateKey(),
            label: factor.label.trim() || "Readiness factor",
            delta: clampNumber(factor.delta, -40, 40),
            confidence: clampNumber(factor.confidence, 0, 1),
            carryoverDays: Math.max(0, Math.min(14, Math.round(factor.carryoverDays))),
            decayPerDay: clampNumber(factor.decayPerDay, 0, 1),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          return { energyFactors: upsertEnergyFactor(s.energyFactors ?? [], entry) };
        }),
      updateEnergyFactor: (id, patch) =>
        set((s) => ({
          energyFactors: (s.energyFactors ?? []).map((factor) =>
            factor.id === id
              ? {
                  ...factor,
                  ...patch,
                  delta: patch.delta === undefined ? factor.delta : clampNumber(patch.delta, -40, 40),
                  confidence: patch.confidence === undefined ? factor.confidence : clampNumber(patch.confidence, 0, 1),
                  carryoverDays: patch.carryoverDays === undefined ? factor.carryoverDays : Math.max(0, Math.min(14, Math.round(patch.carryoverDays))),
                  decayPerDay: patch.decayPerDay === undefined ? factor.decayPerDay : clampNumber(patch.decayPerDay, 0, 1),
                  updatedAt: now(),
                }
              : factor),
        })),
      removeEnergyFactor: (id) =>
        set((s) => ({ energyFactors: (s.energyFactors ?? []).filter((factor) => factor.id !== id) })),

      // habits (experimental — §6) -------------------------------------------
      addHabit: (habit) => {
        const id = uid();
        set((s) => ({
          habits: [
            ...(s.habits ?? []),
            { ...habit, name: habit.name.trim() || "Habit", id, createdAt: now(), updatedAt: now() },
          ],
        }));
        return id;
      },
      updateHabit: (id, patch) =>
        set((s) => ({
          habits: (s.habits ?? []).map((h) => (h.id === id ? { ...h, ...patch, updatedAt: now() } : h)),
        })),
      removeHabit: (id) =>
        set((s) => ({
          habits: (s.habits ?? []).filter((h) => h.id !== id),
          habitEntries: (s.habitEntries ?? []).filter((e) => e.habitId !== id),
        })),
      // Upsert one check per habit per local date (idempotent — prevents dupes).
      checkHabit: (habitId, date, status, value, note) =>
        set((s) => {
          const entries = s.habitEntries ?? [];
          const existing = entries.find((e) => e.habitId === habitId && e.date === date);
          if (existing) {
            return {
              habitEntries: entries.map((e) =>
                e === existing ? { ...e, status, value, note } : e),
            };
          }
          const entry: HabitEntry = { id: uid(), habitId, date, status, value, note, createdAt: now() };
          return { habitEntries: [entry, ...entries] };
        }),
      clearHabitCheck: (habitId, date) =>
        set((s) => ({
          habitEntries: (s.habitEntries ?? []).filter((e) => !(e.habitId === habitId && e.date === date)),
        })),

      // Deprecated compatibility path. The app shell now calls checkDailyRollover
      // automatically from load/focus/visibility/midnight events.
      startNewStudyDay: () =>
        set((s) => {
          const today = localDateKey();
          if (s.activeDayKey >= today) return {};
          return { activeDayKey: today, lastActiveLocalDate: today, lastTimezoneOffset: new Date().getTimezoneOffset() };
        }),

      checkDailyRollover: (reason = "manual-check", at = new Date()) => {
        const current = get();
        const decision = shouldRollover(current, at);
        if (!decision.due) {
          return { changed: false, toDate: decision.today, daysAway: 0 };
        }
        const processedAt = at.toISOString();
        const fromDate = decision.lastDate;
        const toDate = decision.today;
        let carriedTaskIds: string[] = [];
        set((s) => {
          const freshDecision = shouldRollover(s, at);
          if (!freshDecision.due) return {};
          if (freshDecision.daysAway === 0 && freshDecision.lastDate === freshDecision.today) {
            const event: DailyRolloverEvent = {
              id: uid(),
              fromDate: freshDecision.lastDate,
              toDate: freshDecision.today,
              processedAt,
              reason: freshDecision.timezoneChanged ? "timezone-change" : reason,
              daysAway: 0,
              timezoneOffset: at.getTimezoneOffset(),
              carriedTaskIds: [],
            };
            return {
              activeDayKey: freshDecision.today,
              lastActiveLocalDate: freshDecision.today,
              lastTimezoneOffset: at.getTimezoneOffset(),
              dailyRolloverEvents: mergeRolloverEvent(s.dailyRolloverEvents ?? [], event),
            };
          }
          const carried = carryOpenTasksForward(s.tasks, previousRolloverArchiveDate(freshDecision.lastDate, freshDecision.today), freshDecision.today, processedAt);
          carriedTaskIds = carried.carriedTaskIds;
          const archiveDate = previousRolloverArchiveDate(freshDecision.lastDate, freshDecision.today);
          const archive = buildDailyArchive(s, archiveDate, carried.carriedTaskIds, processedAt);
          const event: DailyRolloverEvent = {
            id: uid(),
            fromDate: freshDecision.lastDate,
            toDate: freshDecision.today,
            processedAt,
            reason: freshDecision.timezoneChanged ? "timezone-change" : reason,
            daysAway: freshDecision.daysAway,
            timezoneOffset: at.getTimezoneOffset(),
            carriedTaskIds: carried.carriedTaskIds,
          };
          return {
            tasks: carried.tasks,
            activeDayKey: freshDecision.today,
            lastActiveLocalDate: freshDecision.today,
            lastTimezoneOffset: at.getTimezoneOffset(),
            dailyArchives: mergeDailyArchive(s.dailyArchives ?? [], archive),
            dailyRolloverEvents: mergeRolloverEvent(s.dailyRolloverEvents ?? [], event),
          };
        });
        if (typeof localStorage !== "undefined") markRolloverDone(localStorage, toDate);
        return { changed: true, toDate, daysAway: decision.daysAway || (fromDate === toDate ? 0 : 1), carriedTaskIds };
      },

      updateBoardPrep: (exam, patch) =>
        set((s) => ({
          boardPrep: {
            ...defaultBoardPrepState(),
            ...s.boardPrep,
            [exam]: {
              ...defaultBoardPrep(exam),
              ...s.boardPrep?.[exam],
              ...patch,
              updated: now(),
            },
          },
        })),
      addBoardBlueprintLog: (exam, entry) =>
        set((s) => {
          const current = {
            ...defaultBoardPrep(exam),
            ...s.boardPrep?.[exam],
          };
          return {
            boardPrep: {
              ...defaultBoardPrepState(),
              ...s.boardPrep,
              [exam]: {
                ...current,
                blueprintLogs: [{ ...entry, id: uid(), updated: now() }, ...(current.blueprintLogs ?? [])],
                updated: now(),
              },
            },
          };
        }),
      removeBoardBlueprintLog: (exam, id) =>
        set((s) => {
          const current = {
            ...defaultBoardPrep(exam),
            ...s.boardPrep?.[exam],
          };
          return {
            boardPrep: {
              ...defaultBoardPrepState(),
              ...s.boardPrep,
              [exam]: {
                ...current,
                blueprintLogs: (current.blueprintLogs ?? []).filter((log) => log.id !== id),
                updated: now(),
              },
            },
          };
        }),

      setDayPlan: (dk, intention, wins, details) =>
        set((s) => {
          const rest = s.dayPlans.filter((p) => p.dayKey !== dk);
          if (!intention.trim()) return { dayPlans: rest };
          const prev = s.dayPlans.find((p) => p.dayKey === dk);
          return {
            dayPlans: [
              { dayKey: dk, intention, wins, createdAt: prev?.createdAt ?? now(),
                expectedStudyMinutes: details?.expectedStudyMinutes ?? prev?.expectedStudyMinutes,
                personalNote: details?.personalNote ?? prev?.personalNote,
                priority: details?.priority ?? prev?.priority,
                anticipatedObstacle: details?.anticipatedObstacle ?? prev?.anticipatedObstacle,
                commitmentLevel: details?.commitmentLevel ?? prev?.commitmentLevel,
                reviewedAt: prev?.reviewedAt, outcome: prev?.outcome, reviewNote: prev?.reviewNote },
              ...rest,
            ],
          };
        }),
      reviewDayPlan: (dk, outcome, reviewNote) =>
        set((s) => ({
          dayPlans: s.dayPlans.map((p) =>
            p.dayKey === dk
              ? outcome
                ? { ...p, outcome, reviewNote, reviewedAt: now() }
                : { ...p, outcome: undefined, reviewNote: undefined, reviewedAt: undefined }
              : p),
        })),

      installBlueprint: (blueprintId, opts = {}): string | null => {
        const entry = blueprintById(blueprintId);
        if (!entry) return null;
        const existing = get().blueprintInstalls.filter((i) => i.blueprintId === blueprintId);
        // Duplicate prevention: the UI decides; default install returns the existing one.
        if (existing.length && !opts.duplicate) return existing[0].id;
        const title = opts.duplicate ? `${entry.title} (v${existing.length + 1})` : entry.title;
        const install = instantiateBlueprint(entry, title);
        set((s) => ({ blueprintInstalls: [...s.blueprintInstalls, install] }));
        return install.id;
      },
      duplicateBlueprintInstall: (installId): string | null => {
        const source = get().blueprintInstalls.find((i) => i.id === installId);
        if (!source) return null;
        const entry = blueprintById(source.blueprintId);
        const count = get().blueprintInstalls.filter((i) => i.blueprintId === source.blueprintId).length;
        const title = `${entry?.title ?? source.title} (v${count + 1})`;
        const copy = duplicateInstall(source, title);
        set((s) => ({ blueprintInstalls: [...s.blueprintInstalls, copy] }));
        return copy.id;
      },
      removeBlueprintInstall: (installId) =>
        set((s) => ({ blueprintInstalls: s.blueprintInstalls.filter((i) => i.id !== installId) })),
      updateBlueprintNode: (installId, nodeId, patch) =>
        set((s) => ({
          blueprintInstalls: s.blueprintInstalls.map((install) =>
            install.id !== installId ? install : {
              ...install,
              updatedAt: now(),
              nodes: install.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch, updatedAt: now() } : node)),
            }),
        })),
      reconcileBlueprintInstall: (installId) =>
        set((s) => {
          const install = s.blueprintInstalls.find((i) => i.id === installId);
          const entry = install && blueprintById(install.blueprintId);
          if (!install || !entry || install.catalogVersion >= entry.version) return {};
          return { blueprintInstalls: s.blueprintInstalls.map((i) => (i.id === installId ? reconcileBlueprint(i, entry) : i)) };
        }),

      // study sessions (§2) — one live session at a time; starting a new one
      // pauses whatever was running so no minutes are double-counted.
      startSession: ({ title, link, plannedMinutes, resources, reason, source }) => {
        const id = uid();
        const at = new Date();
        set((s) => {
          const sessions = (s.sessions ?? []).map((session) =>
            session.status === "active"
              ? { ...session, status: "paused" as const, segments: closeOpenSegment(session.segments, at) }
              : session);
          const session: StudySession = {
            id,
            title: title.trim() || link.label || "Study session",
            link,
            plannedMinutes,
            resources,
            reason,
            segments: [{ startedAt: at.toISOString() }],
            status: "active",
            quickLogs: [],
            source,
            dayKey: s.activeDayKey,
            createdAt: at.toISOString(),
          };
          return { sessions: [session, ...sessions] };
        });
        return id;
      },
      pauseSession: (id) =>
        set((s) => ({
          sessions: (s.sessions ?? []).map((session) =>
            session.id === id && session.status === "active"
              ? { ...session, status: "paused", segments: closeOpenSegment(session.segments) }
              : session),
        })),
      resumeSession: (id) =>
        set((s) => {
          const at = new Date();
          return {
            sessions: (s.sessions ?? []).map((session) => {
              if (session.id === id && session.status === "paused") {
                return { ...session, status: "active", segments: openNewSegment(session.segments, at) };
              }
              // Only one active session at a time.
              if (session.status === "active") {
                return { ...session, status: "paused", segments: closeOpenSegment(session.segments, at) };
              }
              return session;
            }),
          };
        }),
      quickLogSession: (id, log, note) =>
        set((s) => ({
          sessions: (s.sessions ?? []).map((session) =>
            session.id === id
              ? { ...session, quickLogs: [...session.quickLogs, { at: now(), log, note }] }
              : session),
        })),
      completeSession: (id, capture) => {
        const at = new Date();
        const session = (get().sessions ?? []).find((item) => item.id === id);
        if (!session || session.status === "completed" || session.status === "abandoned") return;
        const closedSegments = closeOpenSegment(session.segments, at);
        const minutes = sessionElapsedMinutes({ segments: closedSegments }, at);
        set((s) => ({
          sessions: (s.sessions ?? []).map((item) =>
            item.id === id
              ? { ...item, status: "completed" as const, segments: closedSegments, capture, endedAt: at.toISOString() }
              : item),
        }));
        // Completed focus time feeds the study day like any other logged work.
        if (minutes > 0) {
          get().logStudy({
            type: "Session",
            minutes,
            note: `Session: ${session.title}${capture.takeaway ? ` — ${capture.takeaway}` : ""}`,
          });
        }
        // A completed task-linked session closes its task.
        if (capture.outcome === "completed" && session.link.kind === "task" && session.link.id) {
          const task = get().tasks.find((t) => t.id === session.link.id);
          if (task && !task.done) get().toggleTask(task.id);
        }
      },
      abandonSession: (id) =>
        set((s) => ({
          sessions: (s.sessions ?? []).map((session) =>
            session.id === id && (session.status === "active" || session.status === "paused")
              ? { ...session, status: "abandoned", segments: closeOpenSegment(session.segments), endedAt: now() }
              : session),
        })),
      restoreLiveSessions: () =>
        set((s) => {
          const live = findLiveSession(s.sessions ?? []);
          if (!live) return {};
          const restored = restoreSession(live);
          if (restored === live) return {};
          return { sessions: (s.sessions ?? []).map((session) => (session.id === live.id ? restored : session)) };
        }),

      saveCloseout: (closeout) =>
        set((s) => {
          const existing = (s.closeouts ?? []).find((c) => c.dayKey === closeout.dayKey);
          const record: DailyCloseout = {
            ...closeout,
            id: existing?.id ?? closeout.id ?? uid(),
            createdAt: existing?.createdAt ?? now(),
            updatedAt: now(),
          };
          return { closeouts: [record, ...(s.closeouts ?? []).filter((c) => c.dayKey !== closeout.dayKey)] };
        }),

      saveRecoveryPlan: (plan) =>
        set((s) => ({ recoveryPlans: [plan, ...(s.recoveryPlans ?? []).filter((p) => p.id !== plan.id)] })),
      updateRecoveryPlan: (id, patch) =>
        set((s) => ({
          recoveryPlans: (s.recoveryPlans ?? []).map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: now() } : p),
        })),

      addQuestion: (input) => {
        const result = validateQuestionRecord(input);
        if (!result.ok || !result.value) return { ok: false, errors: result.errors };
        const record = result.value;
        set((s) => ({ questions: [record, ...(s.questions ?? [])] }));
        return { ok: true, errors: [], id: record.id };
      },
      commitReviewedImport: async (plan) => {
        const current = get();
        const failure = (message: string, rollbackFailures: string[] = []): ReviewedImportPersistenceResult => ({
          ok: false,
          message,
          rollbackFailures,
        });
        const validId = (value: unknown): value is string => (
          typeof value === "string" && value.length > 0 && value === value.trim()
        );

        if (!plan.questions.length && !plan.questionSet && !plan.documentWrite) {
          return failure("The reviewed import does not contain anything to persist.");
        }
        if (plan.questions.length > 0 && !plan.questionSet) {
          return failure("Reviewed questions must be finalized into a question set.");
        }

        const requestedQuestionIds = plan.questions.map((question) => question.id);
        if (requestedQuestionIds.some((id) => !validId(id))) {
          return failure("Every reviewed question must have a stable ID before finalization.");
        }
        if (new Set(requestedQuestionIds).size !== requestedQuestionIds.length) {
          return failure("Reviewed question IDs must be unique within one import.");
        }
        const existingQuestionIds = new Set((current.questions ?? []).map((question) => question.id));
        const conflictingQuestionId = requestedQuestionIds.find((id) => existingQuestionIds.has(id));
        if (conflictingQuestionId) {
          return failure(`Question ID "${conflictingQuestionId}" already exists.`);
        }

        const validationTime = new Date();
        const validatedQuestions: QuestionRecord[] = [];
        for (let index = 0; index < plan.questions.length; index += 1) {
          const result = validateQuestionRecord(plan.questions[index], validationTime);
          if (!result.ok || !result.value) {
            return failure(
              `Question ${plan.questions[index].questionNumber ?? index + 1}: ${result.errors.slice(0, 2).join(" ")}`,
            );
          }
          const optionKeys = result.value.options.map((option) => option.key);
          if (result.value.options.length < 2 || new Set(optionKeys).size !== optionKeys.length) {
            return failure(
              `Question ${plan.questions[index].questionNumber ?? index + 1}: At least two usable, uniquely labeled answer choices are required.`,
            );
          }
          if (!result.value.correctKey || !optionKeys.includes(result.value.correctKey)) {
            return failure(
              `Question ${plan.questions[index].questionNumber ?? index + 1}: A correct answer matching an existing choice is required.`,
            );
          }
          if (result.value.needsReview) {
            return failure(
              `Question ${plan.questions[index].questionNumber ?? index + 1}: Review must be completed before finalization.`,
            );
          }
          if (result.value.extraction?.reviewed !== true) {
            return failure(
              `Question ${plan.questions[index].questionNumber ?? index + 1}: Reviewed import confirmation is required before finalization.`,
            );
          }
          validatedQuestions.push(result.value);
        }

        const questionSet = plan.questionSet
          ? { ...plan.questionSet, questionIds: validatedQuestions.map((question) => question.id) }
          : undefined;
        if (questionSet) {
          if (!validId(questionSet.id)) return failure("The reviewed question set must have a stable ID.");
          if (!validatedQuestions.length) return failure("A reviewed question set must contain at least one question.");
          if (new Set(questionSet.sourceDocumentIds).size !== questionSet.sourceDocumentIds.length) {
            return failure("Question-set source-document IDs must be unique.");
          }
          if ((current.questionSets ?? []).some((item) => item.id === questionSet.id)) {
            return failure(`Question set ID "${questionSet.id}" already exists.`);
          }
          for (let index = 0; index < validatedQuestions.length; index += 1) {
            validatedQuestions[index] = { ...validatedQuestions[index], setId: questionSet.id };
          }
        }

        let documents = current.documents ?? [];
        const documentWrite = plan.documentWrite;
        if (documentWrite?.kind === "create") {
          if (!validId(documentWrite.document.id)) {
            return failure("The imported source document must have a stable ID.");
          }
          if (documents.some((document) => document.id === documentWrite.document.id)) {
            return failure(`Source document ID "${documentWrite.document.id}" already exists.`);
          }
          documents = [documentWrite.document, ...documents];
        } else if (documentWrite?.kind === "update") {
          if (!validId(documentWrite.id)) {
            return failure("The source-document update must have a stable ID.");
          }
          const target = documents.find((document) => document.id === documentWrite.id);
          if (!target) {
            return failure(`Source document "${documentWrite.id}" no longer exists.`);
          }
          if (documentWrite.patch.id !== undefined && documentWrite.patch.id !== documentWrite.id) {
            return failure("A source-document update cannot change the document ID.");
          }
          documents = documents.map((document) => document.id === documentWrite.id
            ? { ...document, ...documentWrite.patch, id: document.id }
            : document);
        }

        const availableDocumentIds = new Set(documents.map((document) => document.id));
        const missingSetDocument = questionSet?.sourceDocumentIds.find((id) => !availableDocumentIds.has(id));
        if (missingSetDocument) {
          return failure(`Source document "${missingSetDocument}" does not exist.`);
        }
        const missingQuestionDocument = validatedQuestions
          .map((question) => question.sourceDocumentId)
          .find((id): id is string => Boolean(id) && !availableDocumentIds.has(id!));
        if (missingQuestionDocument) {
          return failure(`Source document "${missingQuestionDocument}" does not exist.`);
        }
        if (questionSet) {
          const setDocumentIds = new Set(questionSet.sourceDocumentIds);
          const inconsistentQuestion = validatedQuestions.find((question) => (
            question.sourceDocumentId
              ? !setDocumentIds.has(question.sourceDocumentId)
              : setDocumentIds.size > 0
          ));
          if (inconsistentQuestion) {
            return failure(
              `Question "${inconsistentQuestion.id}" does not share the question set's source-document association.`,
            );
          }
        }

        if (questionSet?.sourceDocumentIds.length) {
          const linkedDocumentIds = new Set(questionSet.sourceDocumentIds);
          documents = documents.map((document) => linkedDocumentIds.has(document.id)
            ? {
                ...document,
                linkedQuestionSetIds: [...new Set([...document.linkedQuestionSetIds, questionSet.id])],
                libraryOnly: false,
              }
            : document);
        }

        const previous = {
          questions: current.questions ?? [],
          questionSets: current.questionSets ?? [],
          documents: current.documents ?? [],
        };
        const next = {
          // Preserve the existing addQuestion ordering while committing one
          // serialized workspace snapshot.
          questions: [...validatedQuestions].reverse().concat(previous.questions),
          questionSets: questionSet ? [questionSet, ...previous.questionSets] : previous.questionSets,
          documents,
        };

        const sameValue = (left: unknown, right: unknown) => (
          JSON.stringify(left) === JSON.stringify(right)
        );
        const insertedQuestionIds = new Set(validatedQuestions.map((question) => question.id));
        const insertedSetId = questionSet?.id;
        const createdDocumentId = documentWrite?.kind === "create" ? documentWrite.document.id : undefined;
        const priorDocuments = new Map(previous.documents.map((document) => [document.id, document]));
        const committedDocuments = new Map(next.documents.map((document) => [document.id, document]));
        const changedDocumentIds = new Set([
          ...(questionSet?.sourceDocumentIds ?? []),
          ...(documentWrite?.kind === "update" ? [documentWrite.id] : []),
        ]);

        const writeSequence = getVaultWriteCheckpoint() + 1;
        try {
          // Zustand persist returns the storage promise at runtime. Awaiting it
          // here guarantees that success means the complete snapshot reached
          // IndexedDB or the established localStorage fallback.
          await set(() => next);
          assertVaultWrite(writeSequence);
        } catch (error) {
          const rollbackFailures = new Set<string>();
          const rollbackSequence = getVaultWriteCheckpoint() + 1;
          try {
            await set((live) => {
              const liveQuestionSets = live.questionSets ?? [];
              const liveQuestions = live.questions ?? [];
              for (const liveSet of liveQuestionSets) {
                if (liveSet.id !== insertedSetId
                  && liveSet.questionIds.some((id) => insertedQuestionIds.has(id))) {
                  rollbackFailures.add(`question set ${liveSet.id}`);
                }
              }

              const createdDocumentHasConcurrentReferences = Boolean(createdDocumentId) && (
                liveQuestionSets.some((liveSet) => (
                  liveSet.id !== insertedSetId
                  && liveSet.sourceDocumentIds.includes(createdDocumentId!)
                ))
                || liveQuestions.some((question) => (
                  !insertedQuestionIds.has(question.id)
                  && question.sourceDocumentId === createdDocumentId
                ))
              );
              if (createdDocumentHasConcurrentReferences) {
                rollbackFailures.add(`source document ${createdDocumentId} (concurrent references)`);
              }

              let rolledBackDocuments = (live.documents ?? [])
                .filter((document) => (
                  document.id !== createdDocumentId || createdDocumentHasConcurrentReferences
                ))
                .map((document) => {
                  const beforeDocument = priorDocuments.get(document.id);
                  const committedDocument = committedDocuments.get(document.id);
                  const restore: Partial<SourceDocument> = {};

                  // A failed set cannot retain reverse links to itself. Remove
                  // only the inserted set ID, preserving every other live link.
                  if (insertedSetId
                    && document.linkedQuestionSetIds.includes(insertedSetId)
                    && !beforeDocument?.linkedQuestionSetIds.includes(insertedSetId)) {
                    restore.linkedQuestionSetIds = document.linkedQuestionSetIds
                      .filter((id) => id !== insertedSetId);
                  }

                  if (!changedDocumentIds.has(document.id) || !beforeDocument || !committedDocument) {
                    return Object.keys(restore).length ? { ...document, ...restore } : document;
                  }

                  const beforeValues = beforeDocument as unknown as Record<string, unknown>;
                  const committedValues = committedDocument as unknown as Record<string, unknown>;
                  const liveValues = document as unknown as Record<string, unknown>;
                  const restoreValues = restore as unknown as Record<string, unknown>;
                  const changedKeys = new Set([
                    ...Object.keys(beforeValues),
                    ...Object.keys(committedValues),
                  ]);

                  for (const key of changedKeys) {
                    if (key === "id" || sameValue(beforeValues[key], committedValues[key])) continue;
                    if (key === "linkedQuestionSetIds") {
                      const liveLinks = restore.linkedQuestionSetIds ?? document.linkedQuestionSetIds;
                      const committedLinks = committedDocument.linkedQuestionSetIds
                        .filter((id) => id !== insertedSetId || beforeDocument.linkedQuestionSetIds.includes(id));
                      if (sameValue(committedLinks, beforeDocument.linkedQuestionSetIds)) {
                        // The import changed only its own reverse link. It was
                        // removed above; retain unrelated concurrent links.
                        continue;
                      }
                      if (sameValue(liveLinks, committedLinks)) {
                        restore.linkedQuestionSetIds = [...beforeDocument.linkedQuestionSetIds];
                      } else if (!sameValue(liveLinks, beforeDocument.linkedQuestionSetIds)) {
                        rollbackFailures.add(`source document ${document.id}.linkedQuestionSetIds`);
                      }
                      continue;
                    }

                    if (sameValue(liveValues[key], committedValues[key])) {
                      restoreValues[key] = beforeValues[key];
                    } else if (!sameValue(liveValues[key], beforeValues[key])) {
                      rollbackFailures.add(`source document ${document.id}.${key}`);
                    }
                  }

                  return Object.keys(restore).length ? { ...document, ...restore, id: document.id } : document;
                });

              // A concurrently-created document can observe the tentative set;
              // remove only that now-invalid reverse link as well.
              if (insertedSetId) {
                rolledBackDocuments = rolledBackDocuments.map((document) => (
                  document.linkedQuestionSetIds.includes(insertedSetId)
                    && !priorDocuments.get(document.id)?.linkedQuestionSetIds.includes(insertedSetId)
                    ? {
                        ...document,
                        linkedQuestionSetIds: document.linkedQuestionSetIds.filter((id) => id !== insertedSetId),
                      }
                    : document
                ));
              }

              // A concurrent link makes a document part of the active
              // question-bank graph even if the import had temporarily
              // changed libraryOnly from true to false.
              rolledBackDocuments = rolledBackDocuments.map((document) => (
                document.linkedQuestionSetIds.length > 0 && document.libraryOnly
                  ? { ...document, libraryOnly: false }
                  : document
              ));

              return {
                questions: liveQuestions.filter((question) => !insertedQuestionIds.has(question.id)),
                questionSets: liveQuestionSets.filter((item) => item.id !== insertedSetId),
                documents: rolledBackDocuments,
              };
            });
            assertVaultWrite(rollbackSequence);
          } catch {
            rollbackFailures.add("reviewed import state");
          }
          return failure(
            error instanceof Error ? error.message : "AXOM could not persist the reviewed import.",
            [...rollbackFailures],
          );
        }

        return {
          ok: true,
          questionIds: validatedQuestions.map((question) => question.id),
          questionSetId: questionSet?.id,
          documentId: documentWrite?.kind === "create" ? documentWrite.document.id : documentWrite?.id,
        };
      },
      updateQuestion: (id, patch) =>
        set((s) => ({
          questions: (s.questions ?? []).map((q) => {
            if (q.id !== id) return q;
            const merged = { ...q, ...patch, updatedAt: now() };
            if (patch.tags) merged.tags = normalizeTagList(patch.tags);
            return reconcileQuestionAnnotationSources(withCorrectAnswerText(merged));
          }),
        })),
      removeQuestion: (id) => set((s) => {
        // Q2b-2: deleting a question deletes its attachment bytes (targeted,
        // fire-and-forget; the post-restore sweep is the backstop).
        const removed = (s.questions ?? []).find((q) => q.id === id);
        const blobKeys = (removed?.attachments ?? []).map((attachment) => attachment.blobKey);
        if (blobKeys.length) void deleteQuestionAttachmentBlobs(blobKeys).catch(() => {});
        return {
          questions: (s.questions ?? []).filter((q) => q.id !== id),
          questionSets: (s.questionSets ?? []).map((questionSet) => ({
            ...questionSet,
            questionIds: questionSet.questionIds.filter((questionId) => questionId !== id),
          })),
        };
      }),
      recordQuestionAttempt: (id, attempt) =>
        set((s) => ({
          questions: (s.questions ?? []).map((q) => (q.id === id ? applyAttempt(q, attempt) : q)),
        })),

      saveQuizSession: (session) =>
        set((s) => ({
          quizSessions: [session, ...(s.quizSessions ?? []).filter((q) => q.id !== session.id)].slice(0, 500),
        })),
      toggleQuestionMarked: (id) =>
        set((s) => ({
          questions: (s.questions ?? []).map((q) => (q.id === id ? { ...q, marked: !q.marked, updatedAt: now() } : q)),
        })),
      bulkUpdateQuestions: (ids, patch) =>
        set((s) => {
          const idSet = new Set(ids);
          return {
            questions: (s.questions ?? []).map((q) => {
              if (!idSet.has(q.id)) return q;
              const tags = patch.tags
                ? normalizeTagList(patch.tags)
                : patch.addTags
                  ? normalizeTagList([...q.tags, ...patch.addTags])
                  : q.tags;
              return {
                ...q,
                category: patch.category !== undefined ? patch.category || undefined : q.category,
                tags,
                updatedAt: now(),
              };
            }),
          };
        }),
      bulkTagQuestions: (ids, op) =>
        set((s) => {
          const idSet = new Set(ids);
          if (!idSet.size) return {};
          const add = normalizeTagList(op.add ?? []);
          const remove = new Set(normalizeTagList(op.remove ?? []));
          const replace = op.replace ? normalizeTagList(op.replace) : undefined;
          const stamp = now();
          return {
            questions: (s.questions ?? []).map((q) => {
              if (!idSet.has(q.id)) return q;
              let tags: string[];
              if (op.clear) tags = [];
              else if (replace) tags = replace;
              else tags = normalizeTagList([...q.tags.filter((t) => !remove.has(t)), ...add]);
              // No-op when the tag set is unchanged — avoids needless timestamp churn.
              if (tags.length === q.tags.length && tags.every((t, i) => t === q.tags[i])) return q;
              return { ...q, tags, updatedAt: stamp };
            }),
          };
        }),
      renameTag: (from, to) =>
        set((s) => {
          const source = normalizeTagList([from])[0];
          const target = normalizeTagList([to])[0];
          if (!source || !target || source === target) return {};
          const fromSet = new Set([source]);
          return {
            questions: (s.questions ?? []).map((q) =>
              q.tags.includes(source)
                ? { ...q, tags: mergeTagsInList(q.tags, fromSet, target), updatedAt: now() }
                : q),
          };
        }),
      removeTag: (tag) =>
        set((s) => {
          const target = normalizeTagList([tag])[0];
          if (!target) return {};
          return {
            questions: (s.questions ?? []).map((q) =>
              q.tags.includes(target) ? { ...q, tags: q.tags.filter((t) => t !== target), updatedAt: now() } : q),
          };
        }),
      mergeTags: (from, into) =>
        set((s) => {
          const target = normalizeTagList([into])[0];
          const fromSet = new Set(normalizeTagList(from).filter((tag) => tag !== target));
          if (!target || !fromSet.size) return {};
          return {
            questions: (s.questions ?? []).map((q) =>
              q.tags.some((tag) => fromSet.has(tag))
                ? { ...q, tags: mergeTagsInList(q.tags, fromSet, target), updatedAt: now() }
                : q),
          };
        }),

      addDocument: (doc) =>
        set((s) => ({ documents: [doc, ...(s.documents ?? []).filter((d) => d.id !== doc.id)] })),
      updateDocument: (id, patch) =>
        set((s) => ({ documents: (s.documents ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      removeDocument: (id) =>
        set((s) => ({
          documents: (s.documents ?? []).filter((d) => d.id !== id),
          questionSets: (s.questionSets ?? []).map((qs) => ({
            ...qs,
            sourceDocumentIds: qs.sourceDocumentIds.filter((did) => did !== id),
          })),
          questions: (s.questions ?? []).map((q) =>
            q.sourceDocumentId === id ? { ...q, sourceDocumentId: undefined } : q),
        })),
      addQuestionSet: (qset) =>
        set((s) => ({ questionSets: [qset, ...(s.questionSets ?? []).filter((x) => x.id !== qset.id)] })),
      updateQuestionSet: (id, patch) =>
        set((s) => ({ questionSets: (s.questionSets ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeQuestionSet: (id) =>
        set((s) => ({
          questionSets: (s.questionSets ?? []).filter((x) => x.id !== id),
          documents: (s.documents ?? []).map((d) => ({
            ...d,
            linkedQuestionSetIds: d.linkedQuestionSetIds.filter((sid) => sid !== id),
          })),
          questions: (s.questions ?? []).map((q) => (q.setId === id ? { ...q, setId: undefined } : q)),
        })),
      addSavedQuestionFilter: (input) => {
        const id = uid();
        const stamp = now();
        const preset: SavedQuestionFilter = {
          id,
          name: input.name.trim().slice(0, 120) || "Saved filter",
          criteria: normalizeQuestionFilter(input.criteria),
          ordering: input.ordering,
          createdAt: stamp,
          updatedAt: stamp,
        };
        set((s) => ({ savedQuestionFilters: [preset, ...(s.savedQuestionFilters ?? [])] }));
        return id;
      },
      updateSavedQuestionFilter: (id, patch) =>
        set((s) => ({
          savedQuestionFilters: (s.savedQuestionFilters ?? []).map((filter) => (filter.id === id
            ? {
                ...filter,
                name: patch.name !== undefined ? patch.name.trim().slice(0, 120) || filter.name : filter.name,
                criteria: patch.criteria !== undefined ? normalizeQuestionFilter(patch.criteria) : filter.criteria,
                ordering: patch.ordering !== undefined ? patch.ordering : filter.ordering,
                updatedAt: now(),
              }
            : filter)),
        })),
      removeSavedQuestionFilter: (id) =>
        set((s) => ({ savedQuestionFilters: (s.savedQuestionFilters ?? []).filter((filter) => filter.id !== id) })),
      createQuestionSetFromFilter: (input) => {
        const id = uid();
        const all = get().questions ?? [];
        const pool = input.scopeIds
          ? (() => { const allowed = new Set(input.scopeIds); return all.filter((q) => allowed.has(q.id)); })()
          : all;
        const built = buildQuestionSetFromFilter({
          id,
          title: input.title,
          questions: pool,
          criteria: input.criteria,
          ordering: input.ordering,
          seed: input.seed,
          tags: input.tags,
          now: now(),
        });
        set((s) => ({ questionSets: [built, ...(s.questionSets ?? []).filter((x) => x.id !== id)] }));
        return id;
      },
      saveQuizBlock: (block) =>
        set((s) => ({ quizBlocks: [block, ...(s.quizBlocks ?? []).filter((b) => b.id !== block.id)].slice(0, 200) })),
      removeQuizBlock: (id) =>
        set((s) => ({ quizBlocks: (s.quizBlocks ?? []).filter((b) => b.id !== id) })),
      repairQuestionBankOrphans: () => {
        const state = get();
        const result = repairOrphans(state);
        if (result.report.totalIssues > 0) {
          set(() => ({ questions: result.questions, questionSets: result.questionSets, documents: result.documents }));
        }
        return result.report.totalIssues;
      },

      addAnkiCards: (inputs) => {
        const errors: string[] = [];
        const cards: AnkiCard[] = [];
        for (const input of inputs) {
          const result = validateAnkiCard(input);
          if (result.ok && result.value) cards.push(result.value);
          else errors.push(...result.errors);
        }
        if (cards.length) set((s) => ({ ankiCards: [...cards, ...(s.ankiCards ?? [])] }));
        return { saved: cards.length, errors };
      },
      updateAnkiCard: (id, patch) =>
        set((s) => ({
          ankiCards: (s.ankiCards ?? []).map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now() } : c)),
        })),
      removeAnkiCard: (id) =>
        set((s) => ({
          ankiCards: (s.ankiCards ?? []).filter((c) => c.id !== id),
          cardReviews: (s.cardReviews ?? []).filter((r) => r.cardId !== id),
        })),
      reviewAnkiCard: (id, rating, msToAnswer) =>
        set((s) => {
          const card = (s.ankiCards ?? []).find((c) => c.id === id);
          if (!card) return {};
          const review: CardReviewLog = { id: uid(), cardId: id, at: now(), rating, msToAnswer };
          return {
            ankiCards: (s.ankiCards ?? []).map((c) =>
              c.id === id ? { ...c, schedule: nextSchedule(c.schedule, rating), updatedAt: now() } : c),
            cardReviews: [review, ...(s.cardReviews ?? [])].slice(0, 5000),
          };
        }),

      upsertDailyWordPuzzle: (puzzle) =>
        set((s) => ({
          dailyWordPuzzles: upsertDailyWordPuzzle(s.dailyWordPuzzles, puzzle),
        })),
      resetDailyWordPuzzles: () => set(() => ({ dailyWordPuzzles: [] })),

      replaceAll: (state) => set(() => ({
        ...state,
        profile: normalizeProfile(state.profile),
        dailyWordPuzzles: normalizeDailyWordPuzzles(state.dailyWordPuzzles),
      })),
      resetToSeed: () => {
        // Wiping all questions orphans every stored image — purge the blob
        // store so a "reset" leaves no screenshot bytes behind on disk.
        void listQuestionAttachmentBlobKeys().then((keys) => keys.length ? deleteQuestionAttachmentBlobs(keys) : undefined).catch(() => {});
        set(() => ({ ...makeSeed() }));
      },
      startFresh: () => {
        void listQuestionAttachmentBlobKeys().then((keys) => keys.length ? deleteQuestionAttachmentBlobs(keys) : undefined).catch(() => {});
        set((s) => ({
          terms: [], courses: [], tracker: [], productivityTrackers: defaultProductivityTrackers(), tasks: [],
          // keep the curated shared drives even on a fresh start
          resources: SGU_DRIVES.map((d) => ({ id: uid(), created: now(), ...driveResourceFields(d) })),
          journal: [], premedExperiences: [], prompts: [], folders: [], logs: [], dayPlans: [],
          energyFactors: [],
          habits: [], habitEntries: [],
          sessions: [], closeouts: [], recoveryPlans: [], questions: [], quizSessions: [], documents: [], questionSets: [], savedQuestionFilters: [], quizBlocks: [], ankiCards: [], cardReviews: [], dailyWordPuzzles: [],
          blueprintInstalls: [],
          boardPrep: defaultBoardPrepState(),
          activeDayKey: localDateKey(),
          lastActiveLocalDate: localDateKey(),
          lastTimezoneOffset: new Date().getTimezoneOffset(),
          dailyArchives: [],
          dailyRolloverEvents: [],
          // keep the user's profile + integrations catalog
          profile: normalizeProfile({ ...s.profile, name: isPlaceholderProfileName(s.profile.name) ? "" : s.profile.name }),
        }));
      },
    }),
    {
      name: "noctyrium-state",
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localVaultStorage),
      migrate: (persisted, fromVersion) => migratePersistedState(persisted, fromVersion),
      onRehydrateStorage: () => {
        storeHydration.start();
        return (state, error) => {
          storeHydration.finish(error);
          // Only sweep after rehydration, when questions are authoritative.
          if (state && Array.isArray(state.questions)) {
            void runQuestionAttachmentMaintenance(state.questions).catch(() => {});
          }
        };
      },
      partialize: (s) => {
        // persist data only — strip the action functions
        const {
          profile, terms, courses, tracker, productivityTrackers, resources, tasks, journal, premedExperiences, prompts,
          folders, logs, integrations, boardPrep, dayPlans, blueprintInstalls, activeDayKey,
          lastActiveLocalDate, lastTimezoneOffset, dailyArchives, dailyRolloverEvents, energyFactors,
          habits, habitEntries, sessions, closeouts, recoveryPlans, questions, quizSessions, documents, questionSets, savedQuestionFilters, quizBlocks, ankiCards, cardReviews, dailyWordPuzzles, schemaVersion,
        } = s;
        return {
          profile, terms, courses, tracker, productivityTrackers, resources, tasks, journal, premedExperiences, prompts,
          folders, logs, integrations, boardPrep, dayPlans, blueprintInstalls, activeDayKey,
          lastActiveLocalDate, lastTimezoneOffset, dailyArchives, dailyRolloverEvents, energyFactors,
          habits, habitEntries, sessions, closeouts, recoveryPlans, questions, quizSessions, documents, questionSets, savedQuestionFilters, quizBlocks, ankiCards, cardReviews, dailyWordPuzzles, schemaVersion,
        } as NoctyriumState;
      },
    },
  ),
);

// ===========================================================================
// Forward-migrate older saved data so existing users never lose anything as
// the schema grows. Exported for tests. A pre-migration snapshot is written
// first. The full automatic safety copy lives in IndexedDB; this synchronous
// marker remains small so localStorage is reserved for preferences/metadata.
// ===========================================================================
export function migratePersistedState(persisted: unknown, fromVersion: number): NoctyriumState {
  const s = (persisted ?? {}) as Record<string, unknown>;
  if (fromVersion < SCHEMA_VERSION) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          STORAGE_KEYS.preMigrationSnapshot,
          JSON.stringify({
            fromVersion,
            savedAt: new Date().toISOString(),
            recordCounts: {
              questions: Array.isArray(s.questions) ? s.questions.length : 0,
              documents: Array.isArray(s.documents) ? s.documents.length : 0,
              questionSets: Array.isArray(s.questionSets) ? s.questionSets.length : 0,
              tasks: Array.isArray(s.tasks) ? s.tasks.length : 0,
            },
          }),
        );
      }
    } catch {
      /* snapshot is best-effort; the primary copy is untouched */
    }
  }
  if (fromVersion < 2) {
    s.resources = s.resources ?? [];
    const tracker = (s.tracker as Array<Record<string, unknown>>) ?? [];
    s.tracker = tracker.map((t) => ({
      ...t,
      kind: t.kind ?? t.type ?? "Lecture",
    }));
    const profile = (s.profile as Record<string, unknown>) ?? {};
    s.profile = { dailyCardTarget: 120, dailyMinuteTarget: 240, ...profile };
  }
  if (fromVersion < 3) {
    // status/quality → passes / ankiPasses / yield
    const tracker = (s.tracker as Array<Record<string, unknown>>) ?? [];
    const fromStatus = (st: unknown) =>
      st === "mature" ? 3 : st === "working" ? 2 : st === "anki" ? 1 : 0;
    s.tracker = tracker.map((t) => ({
      id: t.id, path: t.path, label: t.label, kind: t.kind ?? "Lecture",
      passes: typeof t.passes === "number" ? t.passes : fromStatus(t.status),
      ankiPasses: typeof t.ankiPasses === "number" ? t.ankiPasses : (t.status === "anki" ? 1 : 0),
      yield: t.yield ?? "none",
      note: t.note, updated: t.updated ?? new Date().toISOString(),
    }));
  }
  if (fromVersion < 4) {
    const tasks = (s.tasks as Array<Record<string, unknown>>) ?? [];
    s.tasks = tasks.map((t) => ({
      ...t,
      archived: typeof t.archived === "boolean" ? t.archived : Boolean(t.done),
    }));
    const folders = (s.folders as Array<Record<string, unknown>>) ?? [];
    s.folders = folders.map((f) => ({
      ...f,
      localPath: f.localPath ?? "",
    }));
  }
  if (fromVersion < 5) {
    normalizeAcademicMap(s);
  }
  if (fromVersion < 6) {
    const profile = normalizeProfile(s.profile);
    if (/^v0\.\d+\.\d+ · web$/.test(profile.versionLabel)) profile.versionLabel = APP_VERSION_LABEL;
    s.profile = profile;
  }
  if (fromVersion < 7) {
    s.boardPrep = normalizeBoardPrep(s.boardPrep);
  }
  if (fromVersion < 8) {
    // Win-the-day plans + curated SGU drives that ship for everyone.
    s.dayPlans = s.dayPlans ?? [];
    const resources = (s.resources as Array<Record<string, unknown>>) ?? [];
    const urls = new Set(resources.map((r) => normalizeResourceUrl(String(r.url ?? ""))));
    for (const d of SGU_DRIVES) {
      if (!urls.has(normalizeResourceUrl(d.url))) {
        resources.unshift({ id: crypto.randomUUID(), created: new Date().toISOString(), ...driveResourceFields(d) });
      }
    }
    s.resources = dedupeResourceRecords(resources);
  }
  if (fromVersion < 9) {
    const profile = normalizeProfile(s.profile);
    if (/^v0\.\d+\.\d+ · web$/.test(profile.versionLabel)) profile.versionLabel = APP_VERSION_LABEL;
    s.profile = profile;
    s.resources = normalizeResourceLinks(s.resources);
    s.dayPlans = s.dayPlans ?? [];
  }
  if (fromVersion < 10) {
    const profile = normalizeProfile(s.profile);
    if (/^v0\.\d+\.\d+ · web$/.test(profile.versionLabel) || profile.versionLabel === "v0.10.0 · web") {
      profile.versionLabel = APP_VERSION_LABEL;
    }
    s.profile = profile;
  }
  if (fromVersion < 11) {
    s.boardPrep = normalizeBoardPrep(s.boardPrep);
  }
  if (fromVersion < 12) {
    const profile = normalizeProfile(s.profile);
    if (
      /^v0\.\d+\.\d+ · web$/.test(profile.versionLabel) ||
      profile.versionLabel === "v0.10.0 · web" ||
      profile.versionLabel === "alpha 1 · web" ||
      /^Axom Alpha 1 · v[\d.-]+alpha[\d.-]* · web$/.test(profile.versionLabel)
    ) {
      profile.versionLabel = APP_VERSION_LABEL;
    }
    s.profile = profile;
  }
  if (fromVersion < 13) {
    // Legacy unspecified profiles already have a workspace, but an explicit
    // unfinished setup decision must survive every migration.
    const profile = normalizeProfile(s.profile);
    s.profile = profile;
  }
  if (fromVersion < 14) {
    normalizeAcademicMap(s);
    s.boardPrep = normalizeBoardPrep(s.boardPrep);
    const profile = normalizeProfile(s.profile);
    s.profile = profile;
  }
  if (fromVersion < 15) {
    // Refresh the curated drive set (My Drive + MADCOW + SGU shared) with
    // personal usefulness ratings. Adds any missing by URL; keeps user drives.
    const resources = (s.resources as Array<Record<string, unknown>>) ?? [];
    const urls = new Set(resources.map((r) => normalizeResourceUrl(String(r.url ?? ""))));
    for (const d of SGU_DRIVES) {
      if (!urls.has(normalizeResourceUrl(d.url))) {
        resources.unshift({ id: crypto.randomUUID(), created: new Date().toISOString(), ...driveResourceFields(d) });
      }
    }
    s.resources = dedupeResourceRecords(resources);
  }
  if (fromVersion < 16) {
    s.profile = normalizeProfile(s.profile);
    s.resources = normalizeResourceLinks(s.resources);
    const tracker = (s.tracker as Array<Record<string, unknown>>) ?? [];
    s.tracker = tracker.map((t) => ({ ...t, path: normalizeTrackerPath(String(t.path ?? "")) }));
  }
  if (fromVersion < 17) {
    // Correct curated drive labels/categories/ratings to the canonical set
    // (fixes "Claudfather"↔"My Drive" mislabel + placeholder SGU names; adds
    // Mehlman + White Coat). Matches by normalized URL; injects any missing.
    const resources = (s.resources as Array<Record<string, unknown>>) ?? [];
    const byUrl = new Map(resources.map((r) => [normalizeResourceUrl(String(r.url ?? "")), r]));
    for (const d of SGU_DRIVES) {
      const fields = driveResourceFields(d);
      const existing = byUrl.get(normalizeResourceUrl(d.url));
      if (existing) {
        existing.title = fields.title;
        existing.url = fields.url;
        existing.category = "Drives";
        existing.tags = fields.tags;
        existing.rating = fields.rating;
        existing.ratingReason = fields.ratingReason;
        if (fields.note !== undefined) existing.note = fields.note;
      } else {
        resources.unshift({ id: crypto.randomUUID(), created: new Date().toISOString(), ...fields });
      }
    }
    s.resources = dedupeResourceRecords(resources);
  }
  if (fromVersion < 18) {
    // Introduce the education-track layer. Existing installs have been
    // SGU-centric, so infer their track from focus and keep SGU drives on.
    const profile = isRecord(s.profile) ? s.profile : {};
    if (typeof profile.educationTrack !== "string") {
      profile.educationTrack = inferTrackFromFocus(
        Array.isArray(profile.focusSubscriptions) ? profile.focusSubscriptions.map(String) : [],
      );
    }
    if (typeof profile.showSguResources !== "boolean") {
      profile.showSguResources = profile.educationTrack === "sgu";
    }
    s.profile = normalizeProfile(profile);
  }
  if (fromVersion < 19) {
    s.profile = normalizeProfile(s.profile);
  }
  if (fromVersion < 20) {
    s.premedExperiences = s.premedExperiences ?? [];
    const profile = isRecord(s.profile) ? s.profile : {};
    profile.hiddenDashboardWidgets = mergeStringLists(
      profile.hiddenDashboardWidgets,
      DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
    );
    profile.hiddenNav = mergeStringLists(profile.hiddenNav, defaultHiddenNavForTrack(String(profile.educationTrack ?? "")));
    s.profile = normalizeProfile(profile);
  }
  if (fromVersion < 21) {
    s.boardPrep = normalizeBoardPrep(s.boardPrep);
    const profile = isRecord(s.profile) ? s.profile : {};
    profile.hiddenNav = mergeStringLists(profile.hiddenNav, defaultHiddenNavForTrack(String(profile.educationTrack ?? "")));
    s.profile = normalizeProfile(profile);
  }
  if (fromVersion < 22) {
    // Introduce installable blueprint containers; existing data is untouched.
    s.blueprintInstalls = Array.isArray(s.blueprintInstalls) ? s.blueprintInstalls : [];
  }
  if (fromVersion < 23) {
    // Add direct Blueprint lane routes without flooding existing sidebars.
    const profile = isRecord(s.profile) ? s.profile : {};
    profile.hiddenNav = mergeStringLists(profile.hiddenNav, defaultHiddenNavForTrack(String(profile.educationTrack ?? "")));
    s.profile = normalizeProfile(profile);
  }
  if (fromVersion < 24) {
    s.activeDayKey = typeof s.activeDayKey === "string" && s.activeDayKey ? s.activeDayKey : isoDate(new Date());
    s.lastActiveLocalDate = typeof s.lastActiveLocalDate === "string" && s.lastActiveLocalDate
      ? s.lastActiveLocalDate
      : String(s.activeDayKey);
    s.lastTimezoneOffset = typeof s.lastTimezoneOffset === "number" ? s.lastTimezoneOffset : new Date().getTimezoneOffset();
    s.dailyArchives = Array.isArray(s.dailyArchives) ? s.dailyArchives : [];
    s.dailyRolloverEvents = Array.isArray(s.dailyRolloverEvents) ? s.dailyRolloverEvents : [];
    s.productivityTrackers = normalizeProductivityTrackers(s.productivityTrackers);
    s.logs = arrayOfRecords(s.logs).map((log) => ({
      ...log,
      academic: typeof log.academic === "boolean" ? log.academic : true,
      productive: typeof log.productive === "boolean" ? log.productive : true,
      unitType: typeof log.unitType === "string" ? log.unitType : "minutes",
      quantity: typeof log.quantity === "number" ? log.quantity : Number(log.minutes ?? 0),
    }));
    s.folders = normalizeFolders(s.folders);
  }
  if (fromVersion < 25) {
    s.energyFactors = normalizeEnergyFactors(s.energyFactors);
    s.dailyArchives = arrayOfRecords(s.dailyArchives).map((archive) => ({
      ...archive,
      energyFactorIds: Array.isArray(archive.energyFactorIds)
        ? archive.energyFactorIds.filter((id): id is string => typeof id === "string")
        : [],
    }));
  }
  if (fromVersion < 26) {
    // Habit tracker (experimental). New arrays only — no existing data touched.
    s.habits = Array.isArray(s.habits) ? s.habits : [];
    s.habitEntries = Array.isArray(s.habitEntries) ? s.habitEntries : [];
  }
  if (fromVersion < 27) {
    // Daily academic loop: sessions, closeouts, recovery plans, question
    // workspace, anki card vault. Additive arrays only — nothing touched.
    s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
    s.closeouts = Array.isArray(s.closeouts) ? s.closeouts : [];
    s.recoveryPlans = Array.isArray(s.recoveryPlans) ? s.recoveryPlans : [];
    s.questions = Array.isArray(s.questions) ? s.questions : [];
    s.ankiCards = Array.isArray(s.ankiCards) ? s.ankiCards : [];
    s.cardReviews = Array.isArray(s.cardReviews) ? s.cardReviews : [];
  }
  if (fromVersion < 28) {
    // Rebrand: Noctyrium → Axom. Only cosmetic profile fields change; user
    // names, data, and every storage key stay exactly as they are.
    const profile = isRecord(s.profile) ? s.profile : {};
    if (isPlaceholderProfileName(profile.name)) profile.name = BRAND.productName;
    if (typeof profile.versionLabel !== "string" || profile.versionLabel.includes("Noctyrium")) {
      profile.versionLabel = APP_VERSION_LABEL;
    }
    if (profile.tagline === "Designed for execution, not decoration.") {
      profile.tagline = BRAND.tagline;
    }
    s.profile = normalizeProfile(profile);
  }
  if (fromVersion < 29) {
    // Question bank upgrade: persisted quiz sessions (tutor/exam blocks).
    // Additive array only; new question metadata fields are optional.
    s.quizSessions = Array.isArray(s.quizSessions) ? s.quizSessions : [];
  }
  if (fromVersion < 30) {
    // Import rehaul: source-document library, formal question sets, saved
    // quiz blocks. Additive arrays only — existing questions keep working
    // unlinked and can be attached to sets later.
    s.documents = Array.isArray(s.documents) ? s.documents : [];
    s.questionSets = Array.isArray(s.questionSets) ? s.questionSets : [];
    s.quizBlocks = Array.isArray(s.quizBlocks) ? s.quizBlocks : [];
  }
  if (fromVersion < 31) {
    // Question-bank taxonomy support. Existing question records stay valid:
    // legacy fields (system/topic/category/errorType) seed an optional taxonomy
    // object, and records with no taxonomy simply get an empty object.
    s.questions = arrayOfRecords(s.questions).map((question) => ({
      ...question,
      taxonomy: normalizeQuestionTaxonomy(question.taxonomy, question) ?? {},
    }));
  }
  if (fromVersion < 32) {
    // Import provenance + confidence diagnostics. This is additive: existing
    // question content is never rewritten, and old confidence buckets seed
    // conservative numeric scores for the new review UI.
    const scoreFor = (value: unknown) => value === "high" ? 0.9 : value === "medium" ? 0.65 : 0.35;
    s.questions = arrayOfRecords(s.questions).map((question) => {
      const extraction = isRecord(question.extraction) ? question.extraction : undefined;
      const options = Array.isArray(question.options) ? question.options : [];
      const correctKey = typeof question.correctKey === "string" ? question.correctKey : undefined;
      const correct = options.find((option) => isRecord(option) && option.key === correctKey);
      const existingAnswerText = typeof question.correctAnswerText === "string" && question.correctAnswerText.trim()
        ? question.correctAnswerText
        : undefined;
      return {
        ...question,
        correctAnswerText: correct && typeof correct.text === "string" ? correct.text : existingAnswerText,
        extraction: extraction
          ? {
              ...extraction,
              questionDetectionConfidence: typeof extraction.questionDetectionConfidence === "number"
                ? extraction.questionDetectionConfidence
                : scoreFor(extraction.confidence),
              answerDetectionConfidence: typeof extraction.answerDetectionConfidence === "number"
                ? extraction.answerDetectionConfidence
                : correctKey ? scoreFor(extraction.confidence) : 0.1,
              explanationDetectionConfidence: typeof extraction.explanationDetectionConfidence === "number"
                ? extraction.explanationDetectionConfidence
                : typeof question.explanation === "string" && question.explanation.trim() ? scoreFor(extraction.confidence) : 0.15,
              overallImportConfidence: typeof extraction.overallImportConfidence === "number"
                ? extraction.overallImportConfidence
                : scoreFor(extraction.confidence),
              warnings: Array.isArray(extraction.warnings) ? extraction.warnings : [],
              parserRuleIds: Array.isArray(extraction.parserRuleIds) ? extraction.parserRuleIds : ["MIGRATED.LEGACY"],
            }
          : undefined,
      };
    });
  }
  // Wave 5 adds optional profile preferences and one additive workspace list.
  // Keeping these defaults unconditional makes direct/imported v32 payloads
  // idempotent without turning the optional module on or bumping the schema.
  s.profile = normalizeProfile(s.profile);
  s.journal = normalizeJournalEntries(s.journal);
  s.dailyWordPuzzles = normalizeDailyWordPuzzles(s.dailyWordPuzzles);
  // Q2b-3: canonicalize question tags and default the saved-filter presets. The
  // schema bump to 33 guarantees this one-time migration actually runs for the
  // existing v32 population (persist only calls migrate on a version mismatch);
  // keeping it in the unconditional tail also normalizes direct/imported payloads.
  // Idempotent — tags are already string[]; this only re-cases/dedupes.
  s.questions = arrayOfRecords(s.questions).map((question) => ({
    ...question,
    tags: normalizeTagList(question.tags),
  }));
  s.savedQuestionFilters = normalizeSavedQuestionFilters(s.savedQuestionFilters);
  s.tracker = arrayOfRecords(s.tracker).map((item) => {
    const difficulty = ["easy", "moderate", "hard", "very-hard"].includes(String(item.difficulty)) ? item.difficulty : undefined;
    const assessmentDate = typeof item.assessmentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.assessmentDate) ? item.assessmentDate : undefined;
    const priority = Number(item.explicitPriority);
    const recommendationSnoozedUntil = typeof item.recommendationSnoozedUntil === "string" && Number.isFinite(Date.parse(item.recommendationSnoozedUntil)) ? item.recommendationSnoozedUntil : undefined;
    return { ...item, path: normalizeTrackerPath(String(item.path ?? "")), difficulty, assessmentDate, explicitPriority: priority >= 1 && priority <= 5 ? Math.round(priority) : undefined, recommendationSnoozedUntil };
  });
  s.schemaVersion = SCHEMA_VERSION;
  return s as unknown as NoctyriumState;
}


type AnyRecord = Record<string, unknown>;

/** Seed placeholder display names (old + new brand) that mean "not set yet". */
function isPlaceholderProfileName(name: unknown): boolean {
  return typeof name === "string" && /^(axom|noctyrium)$/i.test(name.trim());
}

/** Convert a track's blueprint into live Term/Course/TrackerItem arrays. */
function buildTrackStructure(track: EducationTrack): { terms: Term[]; courses: Course[]; tracker: TrackerItem[] } {
  const terms: Term[] = track.terms.map((t) => ({ id: uid(), name: t.name }));
  const courses: Course[] = [];
  track.terms.forEach((termDef, index) => {
    const termId = terms[index].id;
    for (const course of termDef.courses) {
      courses.push({
        id: uid(),
        termId,
        code: course.code,
        name: course.name,
        files: 0,
        modules: course.modules.map((name) => ({ id: uid(), name })),
      });
    }
  });
  const tracker: TrackerItem[] = track.trackerRows.map((row) => ({
    id: uid(),
    path: normalizeTrackerPath(row.path),
    label: row.label,
    kind: row.kind,
    passes: 0,
    ankiPasses: 0,
    yield: row.yield,
    note: row.note,
    updated: now(),
  }));
  return { terms, courses, tracker };
}

function matchProductivityTracker(trackers: ProductivityTracker[] = [], type: string): ProductivityTracker | undefined {
  const clean = cleanText(type);
  if (!clean) return trackers.find((tracker) => tracker.id === "tracker-study");
  return trackers.find((tracker) => !tracker.archived && cleanText(tracker.name) === clean);
}

function normalizeProductivityTrackers(value: unknown): ProductivityTracker[] {
  const timestamp = new Date().toISOString();
  const defaults = defaultProductivityTrackers(timestamp);
  const byName = new Map(defaults.map((tracker) => [cleanText(tracker.name), tracker]));
  for (const record of arrayOfRecords(value)) {
    const name = String(record.name ?? "").trim();
    if (!name) continue;
    const base = byName.get(cleanText(name));
    byName.set(cleanText(name), {
      ...(base ?? defaults[0]),
      id: typeof record.id === "string" && record.id ? record.id : base?.id ?? uid(),
      name,
      icon: typeof record.icon === "string" && record.icon ? record.icon : base?.icon ?? "Activity",
      color: typeof record.color === "string" && record.color ? record.color : base?.color ?? "var(--cyan)",
      unitType: isUnitType(record.unitType) ? record.unitType : base?.unitType ?? "minutes",
      customUnit: typeof record.customUnit === "string" ? record.customUnit : base?.customUnit,
      dailyTarget: typeof record.dailyTarget === "number" ? record.dailyTarget : base?.dailyTarget,
      weeklyTarget: typeof record.weeklyTarget === "number" ? record.weeklyTarget : base?.weeklyTarget,
      category: typeof record.category === "string" && record.category ? record.category : base?.category ?? "Productivity",
      contributesToAcademicStudy: typeof record.contributesToAcademicStudy === "boolean" ? record.contributesToAcademicStudy : base?.contributesToAcademicStudy ?? false,
      contributesToTotalProductiveTime: typeof record.contributesToTotalProductiveTime === "boolean" ? record.contributesToTotalProductiveTime : base?.contributesToTotalProductiveTime ?? true,
      contributesToEnergy: typeof record.contributesToEnergy === "boolean" ? record.contributesToEnergy : base?.contributesToEnergy ?? true,
      contributesToReports: typeof record.contributesToReports === "boolean" ? record.contributesToReports : base?.contributesToReports ?? true,
      contributesToHabitTracking: typeof record.contributesToHabitTracking === "boolean" ? record.contributesToHabitTracking : base?.contributesToHabitTracking ?? false,
      visible: typeof record.visible === "boolean" ? record.visible : base?.visible ?? true,
      archived: typeof record.archived === "boolean" ? record.archived : base?.archived ?? false,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : base?.createdAt ?? timestamp,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
    });
  }
  return [...byName.values()];
}

const ENERGY_FACTOR_SOURCES: EnergyFactor["source"][] = ["journal", "manual", "sleep", "tracker", "habit", "goal", "import"];
const ENERGY_FACTOR_CATEGORIES: EnergyFactor["category"][] = ["sleep", "movement", "food", "focus", "spirit", "recovery", "substance", "workload"];

function upsertEnergyFactor(factors: EnergyFactor[], factor: EnergyFactor): EnergyFactor[] {
  return [
    factor,
    ...factors.filter((item) => item.id !== factor.id),
  ].sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function normalizeEnergyFactors(value: unknown): EnergyFactor[] {
  const timestamp = new Date().toISOString();
  return arrayOfRecords(value).map((record) => {
    const date = typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
      ? record.date
      : isoDate(new Date());
    const source = ENERGY_FACTOR_SOURCES.includes(record.source as EnergyFactor["source"])
      ? record.source as EnergyFactor["source"]
      : "manual";
    const category = ENERGY_FACTOR_CATEGORIES.includes(record.category as EnergyFactor["category"])
      ? record.category as EnergyFactor["category"]
      : "recovery";
    return {
      id: typeof record.id === "string" && record.id ? record.id : uid(),
      date,
      source,
      label: String(record.label ?? "Readiness factor").trim() || "Readiness factor",
      category,
      delta: clampNumber(Number(record.delta ?? 0), -40, 40),
      confidence: clampNumber(Number(record.confidence ?? 1), 0, 1),
      carryoverDays: Math.max(0, Math.min(14, Math.round(Number(record.carryoverDays ?? 0)))),
      decayPerDay: clampNumber(Number(record.decayPerDay ?? 1), 0, 1),
      userConfirmed: typeof record.userConfirmed === "boolean" ? record.userConfirmed : true,
      notes: typeof record.notes === "string" ? record.notes : undefined,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : timestamp,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function isUnitType(value: unknown): value is ProductivityTracker["unitType"] {
  return ["minutes", "count", "yesno", "distance", "custom"].includes(String(value));
}

function upsertFolder(folders: HubFolder[], folder: Omit<HubFolder, "id">): { folders: HubFolder[] } {
  const timestamp = now();
  const key = folderIdentity(folder);
  const existing = folders.find((candidate) => folderIdentity(candidate) === key);
  if (existing) {
    return {
      folders: sortFolders(folders.map((candidate) =>
        candidate.id === existing.id ? { ...candidate, ...folder, id: candidate.id, updatedAt: timestamp } : candidate)),
    };
  }
  const sortOrder = typeof folder.sortOrder === "number" ? folder.sortOrder : nextFolderSortOrder(folders);
  return {
    folders: sortFolders([
      ...folders,
      { ...folder, id: uid(), sortOrder, archived: folder.archived ?? false, favorite: folder.favorite ?? false, tags: folder.tags ?? [], createdAt: timestamp, updatedAt: timestamp },
    ]),
  };
}

function normalizeFolders(value: unknown): HubFolder[] {
  const timestamp = new Date().toISOString();
  return sortFolders(arrayOfRecords(value).map((record, index) => ({
    id: typeof record.id === "string" && record.id ? record.id : uid(),
    name: String(record.name ?? "Untitled folder").trim() || "Untitled folder",
    description: typeof record.description === "string" ? record.description : undefined,
    link: typeof record.link === "string" ? record.link : undefined,
    localPath: typeof record.localPath === "string" ? record.localPath : "",
    icon: typeof record.icon === "string" ? record.icon : "Folder",
    color: typeof record.color === "string" ? record.color : "var(--cyan)",
    tags: Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === "string") : [],
    group: typeof record.group === "string" ? record.group : undefined,
    favorite: typeof record.favorite === "boolean" ? record.favorite : false,
    archived: typeof record.archived === "boolean" ? record.archived : false,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : index,
    lastOpenedAt: typeof record.lastOpenedAt === "string" && Number.isFinite(Date.parse(record.lastOpenedAt)) ? record.lastOpenedAt : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : timestamp,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
  })));
}

function sortFolders(folders: HubFolder[]): HubFolder[] {
  return [...folders].sort((a, b) =>
    Number(a.archived) - Number(b.archived)
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || a.name.localeCompare(b.name));
}

function nextFolderSortOrder(folders: HubFolder[]): number {
  return folders.reduce((max, folder) => Math.max(max, folder.sortOrder ?? 0), -1) + 1;
}

function folderIdentity(folder: Pick<HubFolder, "name" | "link" | "localPath">): string {
  const destination = String(folder.link || folder.localPath || "").trim().toLowerCase();
  return destination || cleanText(folder.name);
}

function previousRolloverArchiveDate(lastDate: string, today: string): string {
  return lastDate < today ? lastDate : isoDate(new Date(localDateAtStart(today).getTime() - 86_400_000));
}

function localDateAtStart(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function normalizeAcademicMap(state: AnyRecord) {
  // Only the SGU template owns the canonical Term 1–5 / BPM-PPM course map.
  // Other tracks manage their own structure, so don't force-inject SGU courses.
  const track = isRecord(state.profile) ? state.profile.educationTrack : undefined;
  if (track && track !== "sgu") return;
  const terms = arrayOfRecords(state.terms);
  const courses = arrayOfRecords(state.courses);
  const termIds = new Map<string, string>();

  for (const termDef of ACADEMIC_TEMPLATE_TERMS) {
    const existing = terms.find((t) => cleanText(t.name) === cleanText(termDef.name));
    if (existing) {
      existing.name = termDef.name;
      termIds.set(termDef.name, String(existing.id ?? termDef.id));
    } else {
      terms.push({ id: termDef.id, name: termDef.name });
      termIds.set(termDef.name, termDef.id);
    }
  }

  const termNameById = new Map(ACADEMIC_TEMPLATE_TERMS.map((term) => [term.id, term.name]));
  for (const courseDef of ACADEMIC_TEMPLATE_COURSES) {
    const existing = courses.find((c) => courseDef.aliases.includes(cleanCode(c.code)));
    const termName = termNameById.get(courseDef.termId) ?? "Term";
    const termId = termIds.get(termName) ?? courseDef.termId;
    if (existing) {
      existing.termId = termId;
      existing.code = courseDef.code;
      existing.name = courseDef.name;
      existing.files = typeof existing.files === "number" ? existing.files : 0;
      existing.modules = mergeModules(arrayOfRecords(existing.modules), courseDef.modules);
    } else {
      courses.push({
        id: uid(),
        termId,
        code: courseDef.code,
        name: courseDef.name,
        files: 0,
        modules: mergeModules([], courseDef.modules),
      });
    }
  }

  const profile = isRecord(state.profile) ? state.profile : {};
  profile.versionLabel = APP_VERSION_LABEL;
  state.profile = normalizeProfile(profile);
  state.terms = terms;
  state.courses = courses;
}

const ACADEMIC_PHASES = [
  "pre-med", "mcat", "preclinical", "clinical", "step1-dedicated", "step2-dedicated", "other",
] as const;

function normalizeProfile(value: unknown): Profile {
  const profile = isRecord(value) ? value : {};
  const name = String(profile.name ?? "");
  const phase = ACADEMIC_PHASES.includes(profile.phase as typeof ACADEMIC_PHASES[number])
    ? profile.phase as Profile["phase"]
    : undefined;
  const focusSubscriptions = normalizedFocusIds(profile.focusSubscriptions);
  const activeFocus = focusSubscriptions.includes(profile.activeFocusId as typeof focusSubscriptions[number])
    ? profile.activeFocusId as Profile["activeFocusId"]
    : focusSubscriptions[0];
  const focus = focusOption(activeFocus);
  const educationTrack = resolveTrack(
    typeof profile.educationTrack === "string" ? profile.educationTrack : undefined,
  ).id;
  const dashboardWidgetOrder = normalizeDashboardWidgetOrder(profile.dashboardWidgetOrder);
  const hiddenDashboardWidgets = normalizeDashboardWidgetList(profile.hiddenDashboardWidgets);
  const hiddenNav = normalizeHiddenNav(profile.hiddenNav, educationTrack);
  const journalReviewTime = typeof profile.journalReviewTime === "string" && /^\d{2}:\d{2}$/.test(profile.journalReviewTime)
    ? profile.journalReviewTime
    : "20:00";
  return {
    name,
    userId: typeof profile.userId === "string" && profile.userId.trim()
      ? profile.userId
      : userIdFromName(name),
    versionLabel: String(profile.versionLabel ?? APP_VERSION_LABEL),
    tagline: String(profile.tagline ?? "Designed for execution, not decoration."),
    avatarDataUrl: typeof profile.avatarDataUrl === "string" ? profile.avatarDataUrl : undefined,
    dailyCardTarget: typeof profile.dailyCardTarget === "number" ? profile.dailyCardTarget : 120,
    dailyMinuteTarget: typeof profile.dailyMinuteTarget === "number" ? profile.dailyMinuteTarget : 240,
    onboarded: typeof profile.onboarded === "boolean" ? profile.onboarded : true,
    tourDone: typeof profile.tourDone === "boolean" ? profile.tourDone : undefined,
    promise: normalizePromise(profile.promise),
    promisePromptStatus: normalizePromisePromptStatus(profile.promisePromptStatus),
    phase: phase ?? focus?.phase,
    educationTrack,
    academicStageId: isAcademicStageId(profile.academicStageId) ? profile.academicStageId : undefined,
    customAcademicStage: typeof profile.customAcademicStage === "string"
      ? profile.customAcademicStage.slice(0, 120)
      : undefined,
    showSguResources: typeof profile.showSguResources === "boolean"
      ? profile.showSguResources
      : educationTrack === "sgu",
    activeFocusId: activeFocus,
    focusSubscriptions,
    dashboardWidgetOrder,
    hiddenDashboardWidgets,
    dashboardLayout: normalizeDashboardLayoutPreferences(profile.dashboardLayout, {
      order: dashboardWidgetOrder,
      hiddenWidgetIds: hiddenDashboardWidgets,
    }),
    hiddenNav,
    toolsCollapsed: typeof profile.toolsCollapsed === "boolean" ? profile.toolsCollapsed : undefined,
    prepCollapsed: typeof profile.prepCollapsed === "boolean" ? profile.prepCollapsed : undefined,
    dailyGamesCollapsed: typeof profile.dailyGamesCollapsed === "boolean" ? profile.dailyGamesCollapsed : undefined,
    journalReviewTime,
    journalNotebook: profile.journalNotebook === undefined
      ? undefined
      : normalizeJournalNotebookPreferences(profile.journalNotebook),
    dailyLoopReminders: profile.dailyLoopReminders === undefined
      ? undefined
      : normalizeDailyLoopReminderPreferences(profile.dailyLoopReminders),
    focusCheckIn: profile.focusCheckIn === undefined
      ? undefined
      : normalizeFocusCheckInPreferences(profile.focusCheckIn),
    // Preserve optional opt-in fields so they survive reset/migration.
    blueprintMode: profile.blueprintMode === "usmle" || profile.blueprintMode === "prehealth"
      ? profile.blueprintMode as Profile["blueprintMode"] : undefined,
    taskAutofillDisabled: typeof profile.taskAutofillDisabled === "boolean" ? profile.taskAutofillDisabled : undefined,
    taskTemplates: Array.isArray(profile.taskTemplates) ? profile.taskTemplates as Profile["taskTemplates"] : undefined,
    experimentalFlags: normalizeExperimentalFlags(profile.experimentalFlags),
    timeZonePreference: normalizeTimeZonePreference(profile.timeZonePreference),
    clockPreferences: normalizeClockPreferences(profile.clockPreferences),
    dailySuccess: profile.dailySuccess === undefined
      ? undefined
      : normalizeDailySuccessConfig(profile.dailySuccess),
    hiddenActivityShortcuts: Array.isArray(profile.hiddenActivityShortcuts)
      ? [...new Set(profile.hiddenActivityShortcuts.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.slice(0, 240)))].slice(0, 100)
      : undefined,
    pomodoroCustom: isRecord(profile.pomodoroCustom) ? profile.pomodoroCustom as Profile["pomodoroCustom"] : undefined,
    pomodoroPreferences: normalizePomodoroPreferences(profile.pomodoroPreferences),
    studyWorkflow: normalizeStudyWorkflow(profile.studyWorkflow),
    applicationResearch: normalizeApplicationResearch(profile.applicationResearch),
    applicationProfile: normalizeApplicationProfile(profile.applicationProfile),
  };
}

function normalizeExperimentalFlags(value: unknown): Profile["experimentalFlags"] {
  const flags = isRecord(value) ? value : {};
  return {
    ...(flags as Profile["experimentalFlags"]),
    habits: typeof flags.habits === "boolean" ? flags.habits : undefined,
    // Missing, malformed, and false are all the safe disabled state.
    dailyGames: flags.dailyGames === true,
  };
}

function normalizeTimeZonePreference(value: unknown): NonNullable<Profile["timeZonePreference"]> {
  if (!isRecord(value) || value.mode !== "custom") return { ...DEFAULT_TIME_ZONE_PREFERENCE };
  const customTimezone = typeof value.customTimezone === "string" ? value.customTimezone.trim() : "";
  if (!isValidTimeZone(customTimezone)) return { ...DEFAULT_TIME_ZONE_PREFERENCE };
  return { mode: "custom", customTimezone };
}

function normalizeClockPreferences(value: unknown): NonNullable<Profile["clockPreferences"]> {
  const preferences = isRecord(value) ? value : {};
  const booleanPreference = (key: Exclude<keyof NonNullable<Profile["clockPreferences"]>, "hourCycle">): boolean => (
    typeof preferences[key] === "boolean"
      ? preferences[key] as boolean
      : DEFAULT_CLOCK_PREFERENCES[key]
  );
  return {
    enabled: booleanPreference("enabled"),
    showDigital: booleanPreference("showDigital"),
    showAnalog: booleanPreference("showAnalog"),
    showDigitalSeconds: booleanPreference("showDigitalSeconds"),
    showAnalogSeconds: booleanPreference("showAnalogSeconds"),
    showDate: booleanPreference("showDate"),
    showTimezoneLabel: booleanPreference("showTimezoneLabel"),
    hourCycle: preferences.hourCycle === "24" ? "24" : "12",
  };
}

function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function normalizeDailyWordPuzzles(value: unknown): DailyWordPuzzleState[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, DailyWordPuzzleState>();
  for (const candidate of value) {
    const puzzle = normalizeDailyWordPuzzle(candidate);
    if (!puzzle) continue;
    const existing = byId.get(puzzle.puzzleId);
    byId.set(puzzle.puzzleId, existing ? preferDailyWordPuzzle(existing, puzzle) : puzzle);
  }
  return [...byId.values()].sort((left, right) => (
    left.puzzleDate.localeCompare(right.puzzleDate) || left.puzzleId.localeCompare(right.puzzleId)
  ));
}

function normalizeDailyWordPuzzle(value: unknown): DailyWordPuzzleState | null {
  if (!isRecord(value)) return null;
  const puzzleId = typeof value.puzzleId === "string" ? value.puzzleId.trim() : "";
  const puzzleDate = typeof value.puzzleDate === "string" ? value.puzzleDate.trim() : "";
  const timezone = typeof value.timezone === "string" ? value.timezone.trim() : "";
  const wordListVersion = typeof value.wordListVersion === "string" ? value.wordListVersion.trim() : "";
  const startedAt = typeof value.startedAt === "string" ? value.startedAt : "";
  const expectedId = `daily-word:${wordListVersion}:${puzzleDate}`;
  if (
    puzzleId !== expectedId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(wordListVersion) ||
    !isValidTimeZone(timezone) ||
    !startedAt
  ) return null;
  const guesses = Array.isArray(value.guesses)
    ? value.guesses
      .filter((guess): guess is string => typeof guess === "string" && /^[A-Za-z]{5}$/.test(guess))
      .slice(0, 6)
      .map((guess) => guess.toUpperCase())
    : [];
  const completed = value.completed === true;
  return {
    puzzleId,
    puzzleDate,
    timezone,
    wordListVersion,
    guesses,
    completed,
    won: completed && value.won === true,
    startedAt,
    completedAt: completed && typeof value.completedAt === "string" ? value.completedAt : undefined,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt
      ? value.updatedAt
      : typeof value.completedAt === "string" && value.completedAt
        ? value.completedAt
        : startedAt,
  };
}

function preferDailyWordPuzzle(left: DailyWordPuzzleState, right: DailyWordPuzzleState): DailyWordPuzzleState {
  const rank = (puzzle: DailyWordPuzzleState) => [
    puzzle.completed ? 1 : 0,
    puzzle.guesses.length,
    puzzle.updatedAt,
    puzzle.completedAt ?? "",
    JSON.stringify(puzzle),
  ] as const;
  const a = rank(left);
  const b = rank(right);
  for (let index = 0; index < a.length; index += 1) {
    const comparison = String(a[index]).localeCompare(String(b[index]));
    if (comparison !== 0) return comparison > 0 ? left : right;
  }
  return left;
}

function upsertDailyWordPuzzle(
  puzzles: DailyWordPuzzleState[] | undefined,
  candidate: DailyWordPuzzleState,
): DailyWordPuzzleState[] {
  const next = normalizeDailyWordPuzzle(candidate);
  const current = normalizeDailyWordPuzzles(puzzles);
  if (!next) return current;
  const index = current.findIndex((puzzle) => puzzle.puzzleId === next.puzzleId);
  if (index < 0) return [...current, next];
  const merged = [...current];
  merged[index] = preferDailyWordPuzzle(merged[index], next);
  return merged;
}

function normalizeDashboardWidgetOrder(value: unknown): Profile["dashboardWidgetOrder"] {
  if (!Array.isArray(value)) return [...DEFAULT_DASHBOARD_WIDGETS];
  const valid = new Set(STORED_DASHBOARD_WIDGET_IDS);
  const incoming = value.filter((item): item is typeof DEFAULT_DASHBOARD_WIDGETS[number] =>
    typeof item === "string" && valid.has(item as typeof DEFAULT_DASHBOARD_WIDGETS[number]),
  );
  return [...new Set([...incoming, ...DEFAULT_DASHBOARD_WIDGETS])];
}

function normalizeDashboardWidgetList(value: unknown): Profile["hiddenDashboardWidgets"] {
  if (!Array.isArray(value)) return [...DEFAULT_HIDDEN_DASHBOARD_WIDGETS];
  const valid = new Set(STORED_DASHBOARD_WIDGET_IDS);
  return [...new Set(value.filter((item): item is typeof DEFAULT_DASHBOARD_WIDGETS[number] =>
    typeof item === "string" && valid.has(item as typeof DEFAULT_DASHBOARD_WIDGETS[number]),
  ))];
}

function normalizeHiddenNav(value: unknown, trackId: string): Profile["hiddenNav"] {
  if (!Array.isArray(value)) return defaultHiddenNavForTrack(trackId);
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

function mergeStringLists(value: unknown, defaults: readonly string[]) {
  const incoming = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return [...new Set([...incoming, ...defaults])];
}

function defaultHiddenNavForTrack(trackId: string): string[] {
  const base = ["courses", "prompts", "integrations", "folders"];
  if (trackId === "premed" || trackId === "mcat" || trackId === "undergrad") return [...base, "step"];
  if (trackId === "nursing" || trackId === "pa") return [...base, "step", "premed"];
  return [...base, "premed"];
}

function hiddenNavForTrackSwitch(current: unknown, trackId: string): string[] {
  const set = new Set(normalizeHiddenNav(current, trackId));
  set.add("courses");
  set.add("prompts");
  set.add("integrations");
  set.add("folders");
  if (trackId === "premed" || trackId === "mcat" || trackId === "undergrad") {
    set.add("step");
    set.delete("premed");
  } else if (trackId === "nursing" || trackId === "pa") {
    set.add("step");
    set.add("premed");
  } else {
    set.add("premed");
    set.delete("step");
  }
  return [...set];
}

function normalizePromise(value: unknown): Profile["promise"] {
  if (!isRecord(value)) return undefined;
  const signedName = typeof value.signedName === "string" ? value.signedName.trim() : "";
  const signedAt = typeof value.signedAt === "string" ? value.signedAt : "";
  if (!signedName || !signedAt) return undefined;
  return {
    signedName,
    signedAt,
    promiseTextVersion: typeof value.promiseTextVersion === "string" ? value.promiseTextVersion : "promise-of-use-v1",
    journalEntryId: typeof value.journalEntryId === "string" ? value.journalEntryId : undefined,
  };
}

function normalizePromisePromptStatus(value: unknown): Profile["promisePromptStatus"] {
  if (!isRecord(value) || (value.state !== "deferred" && value.state !== "skipped")) return undefined;
  const updatedAt = typeof value.updatedAt === "string" && !Number.isNaN(new Date(value.updatedAt).getTime())
    ? new Date(value.updatedAt).toISOString()
    : new Date().toISOString();
  return {
    state: value.state,
    updatedAt,
    promptVersion: typeof value.promptVersion === "string" && value.promptVersion.trim()
      ? value.promptVersion.trim().slice(0, 80)
      : undefined,
  };
}

function addResourceToState(resources: Resource[], payload: Omit<Resource, "id" | "created">) {
  return addResourcesToState(resources, [payload]);
}

function addResourcesToState(resources: Resource[], payloads: Omit<Resource, "id" | "created">[]) {
  const created = now();
  const next = dedupeResources(resources);
  for (const payload of payloads) {
    const url = normalizeResourceUrl(payload.url);
    if (!payload.title.trim() || !url.trim()) continue;
    const existing = next.find((resource) => normalizeResourceUrl(resource.url).toLowerCase() === url.toLowerCase());
    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...payload,
        url,
        id: existing.id,
        created: existing.created,
        favorite: existing.favorite || payload.favorite,
        tags: Array.from(new Set([...(existing.tags ?? []), ...(payload.tags ?? [])])),
      });
    } else {
      next.unshift({ ...payload, url, id: uid(), created });
    }
  }
  return { resources: next };
}

function dedupeResources(resources: Resource[]): Resource[] {
  const seen = new Map<string, Resource>();
  const out: Resource[] = [];
  for (const resource of resources) {
    const normalized = normalizeResourceUrl(resource.url);
    const key = normalized.toLowerCase();
    const cleaned = { ...resource, url: normalized };
    const previous = seen.get(key);
    if (previous) {
      Object.assign(previous, {
        ...previous,
        ...cleaned,
        id: previous.id,
        created: previous.created,
        favorite: previous.favorite || cleaned.favorite,
        rating: Math.max(previous.rating ?? 0, cleaned.rating ?? 0) || previous.rating || cleaned.rating,
        ratingReason: previous.ratingReason || cleaned.ratingReason,
        tags: Array.from(new Set([...(previous.tags ?? []), ...(cleaned.tags ?? [])])),
        note: previous.note || cleaned.note,
      });
      continue;
    }
    seen.set(key, cleaned);
    out.push(cleaned);
  }
  return out;
}

function dedupeResourceRecords(resources: AnyRecord[]): AnyRecord[] {
  const typed = resources.map((resource) => ({
    id: typeof resource.id === "string" ? resource.id : uid(),
    title: String(resource.title ?? hostFallback(resource.url)),
    url: normalizeResourceUrl(String(resource.url ?? "")),
    category: String(resource.category ?? "General"),
    tags: Array.isArray(resource.tags) ? resource.tags.filter((x): x is string => typeof x === "string") : [],
    note: typeof resource.note === "string" ? resource.note : undefined,
    favorite: typeof resource.favorite === "boolean" ? resource.favorite : undefined,
    rating: typeof resource.rating === "number" ? resource.rating : undefined,
    ratingReason: typeof resource.ratingReason === "string" ? resource.ratingReason : undefined,
    created: typeof resource.created === "string" ? resource.created : now(),
  }));
  return dedupeResources(typed) as unknown as AnyRecord[];
}

function hostFallback(value: unknown) {
  try {
    return new URL(normalizeResourceUrl(String(value ?? ""))).hostname;
  } catch {
    return "Untitled resource";
  }
}

const BOARD_EXAMS: BoardExamId[] = ["step1", "step2", "step3", "shelf", "mcat", "premed"];

function defaultBoardPrepState(): Record<BoardExamId, BoardPrepProfile> {
  return Object.fromEntries(BOARD_EXAMS.map((exam) => [exam, defaultBoardPrep(exam)])) as Record<BoardExamId, BoardPrepProfile>;
}

function defaultBoardPrep(exam: BoardExamId): BoardPrepProfile {
  return {
    medYear: exam === "step1" ? "MS2" : exam === "step2" || exam === "shelf" ? "MS3" : "Other",
    contentStarted: exam === "step1" || exam === "mcat" || exam === "shelf" ? "light" : "not-started",
    weeklyHours: exam === "step1" ? 18 : exam === "step2" ? 14 : exam === "mcat" ? 12 : 10,
    questionTarget: exam === "premed" ? 15 : exam === "shelf" ? 25 : exam === "step3" ? 30 : 40,
    resourcesDone: [],
    installedBlueprintAreas: [],
    completedBlueprintItems: [],
    otherResources: "",
    confidence: "medium",
    blueprintLogs: [],
    aiStrategy: "",
    updated: new Date().toISOString(),
  };
}

function normalizeBoardPrep(value: unknown): Record<BoardExamId, BoardPrepProfile> {
  const src = isRecord(value) ? value : {};
  return Object.fromEntries(BOARD_EXAMS.map((exam) => [exam, normalizeBoardPrepProfile(src[exam], exam)])) as Record<BoardExamId, BoardPrepProfile>;
}

function normalizeResourceLinks(value: unknown): AnyRecord[] {
  const resources = arrayOfRecords(value);
  const replacements = new Map([
    [
      "https://www.usmle.org/prepare-your-exam/step-1-materials",
      {
        title: "USMLE Step 1 Sample Questions",
        url: "https://www.usmle.org/exam-resources/step-1-materials/step-1-sample-test-questions",
      },
    ],
    [
      "https://www.usmle.org/prepare-your-exam/step-2-ck-materials",
      {
        title: "USMLE Step 2 CK Sample Questions",
        url: "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-sample-test-questions",
      },
    ],
  ]);

  for (const resource of resources) {
    const currentUrl = normalizeResourceUrl(String(resource.url ?? ""));
    const replacement = replacements.get(currentUrl) ?? replacements.get(String(resource.url ?? ""));
    if (replacement) {
      resource.url = replacement.url;
      if (String(resource.title ?? "").includes("Practice Materials")) resource.title = replacement.title;
    } else {
      resource.url = currentUrl;
    }
  }

  const urls = new Set(resources.map((r) => normalizeResourceUrl(String(r.url ?? ""))));
  for (const d of SGU_DRIVES) {
    if (!urls.has(normalizeResourceUrl(d.url))) {
      resources.unshift({ id: crypto.randomUUID(), created: new Date().toISOString(), ...driveResourceFields(d) });
    }
  }
  return dedupeResourceRecords(resources);
}

function normalizeBoardPrepProfile(value: unknown, exam: BoardExamId): BoardPrepProfile {
  const base = defaultBoardPrep(exam);
  const profile = isRecord(value) ? value : {};
  const contentStarted = ["not-started", "light", "half", "most", "dedicated"].includes(String(profile.contentStarted))
    ? profile.contentStarted as BoardPrepProfile["contentStarted"]
    : base.contentStarted;
  const confidence = ["low", "medium", "high"].includes(String(profile.confidence))
    ? profile.confidence as BoardPrepProfile["confidence"]
    : base.confidence;
  return {
    medYear: String(profile.medYear ?? base.medYear),
    contentStarted,
    examDate: typeof profile.examDate === "string" ? profile.examDate : undefined,
    weeklyHours: typeof profile.weeklyHours === "number" ? profile.weeklyHours : base.weeklyHours,
    questionTarget: typeof profile.questionTarget === "number" ? profile.questionTarget : base.questionTarget,
    resourcesDone: Array.isArray(profile.resourcesDone) ? profile.resourcesDone.filter((x): x is string => typeof x === "string") : [],
    installedBlueprintAreas: Array.isArray(profile.installedBlueprintAreas) ? profile.installedBlueprintAreas.filter((x): x is string => typeof x === "string") : [],
    completedBlueprintItems: Array.isArray(profile.completedBlueprintItems) ? profile.completedBlueprintItems.filter((x): x is string => typeof x === "string") : [],
    otherResources: String(profile.otherResources ?? ""),
    confidence,
    blueprintLogs: normalizeBoardBlueprintLogs(profile.blueprintLogs),
    aiStrategy: typeof profile.aiStrategy === "string" ? profile.aiStrategy : "",
    updated: typeof profile.updated === "string" ? profile.updated : new Date().toISOString(),
  };
}

function normalizeBoardBlueprintLogs(value: unknown): BoardBlueprintLog[] {
  return arrayOfRecords(value).map((log) => {
    const dimension = ["system", "competency", "discipline"].includes(String(log.dimension))
      ? log.dimension as BoardBlueprintLog["dimension"]
      : "system";
    const oldMode = String(log.mode);
    const mode = oldMode === "Content"
      ? "First pass"
      : oldMode === "Retrieval"
        ? "Missed facts"
        : ["First pass", "Questions", "Missed facts", "Assessment", "Review"].includes(oldMode)
          ? oldMode as BoardBlueprintLog["mode"]
          : "Questions";
    const confidence = ["red", "orange", "green", "blue"].includes(String(log.confidence))
      ? log.confidence as BoardBlueprintLog["confidence"]
      : "orange";
    return {
      id: typeof log.id === "string" && log.id ? log.id : uid(),
      date: typeof log.date === "string" && log.date ? log.date : dayKey(),
      dimension,
      area: String(log.area ?? "Unmapped"),
      mode,
      minutes: typeof log.minutes === "number" ? log.minutes : 0,
      questions: typeof log.questions === "number" ? log.questions : 0,
      correct: typeof log.correct === "number" ? log.correct : 0,
      confidence,
      notes: typeof log.notes === "string" ? log.notes : undefined,
      updated: typeof log.updated === "string" ? log.updated : new Date().toISOString(),
    };
  });
}

function mergeModules(existing: AnyRecord[], names: string[]) {
  const out = [...existing];
  for (const name of names) {
    if (!out.some((m) => cleanText(m.name) === cleanText(name))) {
      out.push({ id: uid(), name });
    }
  }
  return out;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function cleanCode(value: unknown): string {
  return cleanText(value).replace(/[^a-z0-9]/g, "");
}
