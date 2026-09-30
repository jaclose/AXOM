import { withoutLocalFolderPath } from "./localHubFolders";
// ===========================================================================
// JSON export / import. The portable backup story for the browser-stored data.
// ===========================================================================
import type { ClockPreferences, DailyWordPuzzleState, NoctyriumState, TimeZonePreference } from "./types";
import { normalizeEnergyChecks } from "./energyInsights";
import { normalizePrimaryScopes } from "./trackerFocus";
import {
  APP_VERSION_LABEL, DEFAULT_CLOCK_PREFERENCES, DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_HIDDEN_DASHBOARD_WIDGETS, DEFAULT_TIME_ZONE_PREFERENCE, SCHEMA_VERSION,
  STORED_DASHBOARD_WIDGET_IDS,
} from "./seed";
import { BRAND, STORAGE_KEYS } from "./brand";
import { userIdFromName } from "./userIdentity";
import { normalizeQuestionTaxonomy } from "./questions";
import { normalizeTagList } from "./questionTags";
import { normalizeSavedQuestionFilters } from "./questionFilters";
import { normalizeQuestionAnnotations, reconcileQuestionAnnotationSources } from "./questionAnnotations";
import {
  ATTACHMENT_EXPORT_KEY,
  collectQuestionAttachmentPayloads,
  normalizeQuestionAttachments,
} from "./questionAttachments";
import { DEFAULT_FOCUS_IDS, focusOption, normalizedFocusIds } from "./experience";
import { isAcademicStageId, resolveTrack } from "./tracks";
import { normalizeDailySuccessConfig } from "./dailySuccess";
import { normalizePomodoroPreferences } from "./pomodoroPreferences";
import { normalizeDailyLoopReminderPreferences } from "./dailyLoopReminders";
import { normalizeFocusCheckInPreferences } from "./focusCheckIn";
import { normalizeDashboardLayoutPreferences } from "./dashboardWidgets";
import { normalizeJournalEntries, normalizeJournalNotebookPreferences } from "./journalNotebook";
import { normalizeApplicationResearch } from "./applicationResearch";
import { normalizeApplicationProfile } from "./applicationProfile";
import { normalizeStudyWorkflow } from "./studyPreferences";

const DATA_KEYS = [
  "profile", "terms", "courses", "tracker", "productivityTrackers", "resources", "tasks", "journal",
  "premedExperiences", "prompts", "folders", "logs", "integrations", "boardPrep", "blueprintInstalls", "dayPlans", "activeDayKey", "schemaVersion",
  "lastActiveLocalDate", "lastTimezoneOffset", "dailyArchives", "dailyRolloverEvents", "energyFactors", "habits", "habitEntries",
  "sessions", "closeouts", "recoveryPlans", "questions", "quizSessions", "documents", "questionSets", "savedQuestionFilters", "quizBlocks", "ankiCards", "cardReviews",
  "dailyWordPuzzles",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toPortableState(state: NoctyriumState): NoctyriumState {
  const payload: Record<string, unknown> = {};
  const src = state as unknown as Record<string, unknown>;
  for (const k of DATA_KEYS) payload[k] = src[k];
  payload.folders = (state.folders ?? []).map(withoutLocalFolderPath);
  return payload as unknown as NoctyriumState;
}

export function exportState(state: NoctyriumState) {
  downloadBackupPayload({
    _app: BRAND.productName,
    _exported: new Date().toISOString(),
    ...toPortableState(state),
  });
}

/** Complete portable backup: workspace JSON plus question-note image bytes as
 * base64 payloads that exist only inside the exported file (Q2b-2). Reports
 * any attachment whose bytes were unavailable so the export is never silently
 * incomplete. */
export async function exportStateWithAttachments(
  state: NoctyriumState,
): Promise<{ attachmentCount: number; missingBlobKeys: string[] }> {
  const payload: Record<string, unknown> = {
    _app: BRAND.productName,
    _exported: new Date().toISOString(),
    ...toPortableState(state),
  };
  let attachmentCount = 0;
  let missingBlobKeys: string[];
  try {
    const collected = await collectQuestionAttachmentPayloads(state.questions ?? []);
    if (collected.payloads.length) payload[ATTACHMENT_EXPORT_KEY] = collected.payloads;
    attachmentCount = collected.payloads.length;
    missingBlobKeys = collected.missingBlobKeys;
  } catch {
    // Blob store unavailable (private mode): export metadata-only, reported.
    missingBlobKeys = (state.questions ?? []).flatMap((question) =>
      (question.attachments ?? []).map((attachment) => attachment.blobKey));
  }
  downloadBackupPayload(payload);
  return { attachmentCount, missingBlobKeys };
}

function downloadBackupPayload(payload: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${BRAND.productName.toLowerCase()}-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  markBackupDone();
}

/** Record when the user last exported, for the data-health panel. */
export function markBackupDone(at: Date = new Date()) {
  try {
    localStorage.setItem(STORAGE_KEYS.lastBackupAt, at.toISOString());
  } catch { /* best effort */ }
}

export function lastBackupAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.lastBackupAt);
  } catch {
    return null;
  }
}

/**
 * Merge an imported backup into the current state instead of replacing it.
 * Record lists are unioned by id; when the same id exists on both sides the
 * one with the later updated/created timestamp wins. Profile and day-cursor
 * fields keep the CURRENT values — merge never silently changes who you are
 * or what day it is. Use replace (with explicit confirmation) for full restore.
 */
export function mergeStates(current: NoctyriumState, imported: NoctyriumState): NoctyriumState {
  const listKeys = [
    "terms", "courses", "tracker", "productivityTrackers", "resources", "tasks", "journal",
    "premedExperiences", "prompts", "folders", "logs", "boardPrep" /* handled below */, "blueprintInstalls",
    "dayPlans", "dailyArchives", "dailyRolloverEvents", "energyFactors", "habits", "habitEntries",
    "sessions", "closeouts", "recoveryPlans", "questions", "quizSessions", "documents", "questionSets", "savedQuestionFilters", "quizBlocks", "ankiCards", "cardReviews",
    "dailyWordPuzzles",
  ] as const;

  const merged: Record<string, unknown> = { ...toPortableState(current) };
  const cur = current as unknown as Record<string, unknown>;
  const imp = imported as unknown as Record<string, unknown>;

  for (const key of listKeys) {
    if (key === "boardPrep") continue;
    const a = Array.isArray(cur[key]) ? cur[key] as Array<Record<string, unknown>> : [];
    const b = Array.isArray(imp[key]) ? imp[key] as Array<Record<string, unknown>> : [];
    merged[key] = key === "questions"
      ? mergeQuestionsById(a, b)
      : key === "dailyWordPuzzles"
        ? mergeDailyWordPuzzlesById(a, b)
        : mergeById(a, b, key === "dayPlans" ? "dayKey" : key === "dailyArchives" ? "date" : "id");
  }
  // boardPrep is a keyed map — imported lanes fill gaps, current lanes win ties by `updated`.
  const curPrep = (cur.boardPrep ?? {}) as Record<string, { updated?: string } | undefined>;
  const impPrep = (imp.boardPrep ?? {}) as Record<string, { updated?: string } | undefined>;
  const prep: Record<string, unknown> = { ...impPrep };
  for (const [lane, value] of Object.entries(curPrep)) {
    const other = impPrep[lane];
    prep[lane] = !other || String(value?.updated ?? "") >= String(other.updated ?? "") ? value : other;
  }
  merged.boardPrep = prep;
  // Bring in new saved schools without replacing the learner's current review
  // decisions (including deliberately unchecked facts) for an existing school.
  const research = new Map(normalizeApplicationResearch(imported.profile.applicationResearch).map(entry => [entry.schoolId, entry]));
  for (const entry of normalizeApplicationResearch(current.profile.applicationResearch)) research.set(entry.schoolId, entry);
  merged.profile = {
    ...current.profile, applicationResearch: [...research.values()],
    // The profile is one learner-edited record, so current wins whole rather than field-merging.
    applicationProfile: normalizeApplicationProfile(current.profile.applicationProfile) ?? normalizeApplicationProfile(imported.profile.applicationProfile),
  };
  return merged as unknown as NoctyriumState;
}

function mergeById(
  current: Array<Record<string, unknown>>,
  imported: Array<Record<string, unknown>>,
  idKey: string,
): Array<Record<string, unknown>> {
  const stamp = (r: Record<string, unknown>) =>
    String(r.updatedAt ?? r.updated ?? r.createdAt ?? r.created ?? "");
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of imported) {
    const id = String(record[idKey] ?? "");
    if (id) byId.set(id, record);
  }
  for (const record of current) {
    const id = String(record[idKey] ?? "");
    if (!id) continue;
    const other = byId.get(id);
    byId.set(id, !other || stamp(record) >= stamp(other) ? record : other);
  }
  // Keep unkeyed records from both sides rather than dropping them.
  const unkeyed = [...current, ...imported].filter((r) => !String(r[idKey] ?? ""));
  return [...byId.values(), ...unkeyed];
}

function mergeQuestionsById(
  current: Array<Record<string, unknown>>,
  imported: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const stamp = (record: Record<string, unknown>) =>
    String(record.updatedAt ?? record.updated ?? record.createdAt ?? record.created ?? "");
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of imported) {
    const id = String(record.id ?? "");
    if (id) byId.set(id, record);
  }
  for (const record of current) {
    const id = String(record.id ?? "");
    if (!id) continue;
    const other = byId.get(id);
    if (!other) {
      byId.set(id, record);
      continue;
    }
    const newer = stamp(record) >= stamp(other) ? record : other;
    const older = newer === record ? other : record;
    byId.set(id, {
      ...older,
      ...newer,
      attempts: mergeQuestionAttempts(older.attempts, newer.attempts),
      annotations: mergeQuestionAnnotations(older.annotations, newer.annotations),
      attachments: mergeQuestionAttachmentsMetadata(older.attachments, newer.attachments),
    });
  }
  const unkeyed = [...current, ...imported].filter((record) => !String(record.id ?? ""));
  return [...byId.values(), ...unkeyed].map(reconcileAnnotationRecord);
}

function reconcileAnnotationRecord(record: Record<string, unknown>): Record<string, unknown> {
  const annotations = normalizeQuestionAnnotations(record.annotations);
  if (!annotations?.length || typeof record.stem !== "string") {
    return { ...record, annotations };
  }
  const options = Array.isArray(record.options)
    ? record.options.flatMap((option) => (
      isRecord(option) && typeof option.key === "string" && typeof option.text === "string"
        ? [{ key: option.key, text: option.text }]
        : []
    ))
    : [];
  return reconcileQuestionAnnotationSources({
    ...record,
    stem: record.stem,
    explanation: typeof record.explanation === "string" ? record.explanation : undefined,
    options,
    annotations,
  });
}

function mergeQuestionAttachmentsMetadata(left: unknown, right: unknown) {
  // Dedup by id; normalizeQuestionAttachments keeps the later updatedAt.
  return normalizeQuestionAttachments([
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ]);
}

function mergeQuestionAnnotations(left: unknown, right: unknown) {
  const annotations = normalizeQuestionAnnotations([
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ]);
  return annotations;
}

function mergeQuestionAttempts(left: unknown, right: unknown): Array<Record<string, unknown>> {
  const attempts = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
    .filter(isRecord);
  const byFingerprint = new Map<string, Record<string, unknown>>();
  for (const attempt of attempts) {
    const fingerprint = [
      attempt.at, attempt.answerKey, attempt.status, attempt.confidence,
      attempt.timeSpentSeconds, attempt.changedFromKey, attempt.errorType, attempt.note,
    ].map((value) => String(value ?? "")).join("\u001f");
    byFingerprint.set(fingerprint, attempt);
  }
  return [...byFingerprint.values()].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
}

function mergeDailyWordPuzzlesById(
  current: Array<Record<string, unknown>>,
  imported: Array<Record<string, unknown>>,
): DailyWordPuzzleState[] {
  const byId = new Map<string, DailyWordPuzzleState>();
  for (const puzzle of normalizeDailyWordPuzzles([...imported, ...current])) {
    const existing = byId.get(puzzle.puzzleId);
    byId.set(puzzle.puzzleId, existing ? preferDailyWordPuzzle(existing, puzzle) : puzzle);
  }
  return [...byId.values()].sort((left, right) => (
    left.puzzleDate.localeCompare(right.puzzleDate) || left.puzzleId.localeCompare(right.puzzleId)
  ));
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

export function parseImport(text: string): NoctyriumState {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !Array.isArray(data.terms)) {
    throw new Error("This file doesn't look like an AXOM backup.");
  }
  // accept the file even if schemaVersion is missing/older — fill the gaps
  const profile = data.profile && typeof data.profile === "object"
    ? data.profile as Record<string, unknown>
    : {};
  const name = String(profile.name ?? "");
  const focusSubscriptions = normalizedFocusIds(profile.focusSubscriptions);
  const activeFocusId = focusSubscriptions.includes(profile.activeFocusId as (typeof focusSubscriptions)[number])
    ? profile.activeFocusId as NoctyriumState["profile"]["activeFocusId"]
    : focusSubscriptions[0] ?? DEFAULT_FOCUS_IDS[0];
  const activeFocus = focusOption(activeFocusId);
  const educationTrack = resolveTrack(typeof profile.educationTrack === "string" ? profile.educationTrack : undefined).id;

  const importedSchemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      name,
      userId: typeof profile.userId === "string" && profile.userId.trim() ? profile.userId : userIdFromName(name),
      versionLabel: String(profile.versionLabel ?? APP_VERSION_LABEL),
      tagline: String(profile.tagline ?? "Designed for execution, not decoration."),
      avatarDataUrl: typeof profile.avatarDataUrl === "string" ? profile.avatarDataUrl : undefined,
      dailyCardTarget: typeof profile.dailyCardTarget === "number" ? profile.dailyCardTarget : 120,
      dailyMinuteTarget: typeof profile.dailyMinuteTarget === "number" ? profile.dailyMinuteTarget : 240,
      onboarded: typeof profile.onboarded === "boolean" ? profile.onboarded : true,
      tourDone: typeof profile.tourDone === "boolean" ? profile.tourDone : undefined,
      promise: normalizePromise(profile.promise),
      promisePromptStatus: normalizePromisePromptStatus(profile.promisePromptStatus),
      phase: typeof profile.phase === "string" ? profile.phase as NoctyriumState["profile"]["phase"] : activeFocus?.phase,
      educationTrack,
      academicStageId: isAcademicStageId(profile.academicStageId) ? profile.academicStageId : undefined,
      customAcademicStage: typeof profile.customAcademicStage === "string"
        ? profile.customAcademicStage.slice(0, 120)
        : undefined,
      showSguResources: typeof profile.showSguResources === "boolean"
        ? profile.showSguResources
        : educationTrack === "sgu",
      activeFocusId,
      focusSubscriptions,
      dashboardWidgetOrder: normalizeDashboardWidgetOrder(profile.dashboardWidgetOrder),
      hiddenDashboardWidgets: normalizeDashboardWidgetList(profile.hiddenDashboardWidgets),
      dashboardLayout: normalizeDashboardLayoutPreferences(profile.dashboardLayout, {
        order: profile.dashboardWidgetOrder,
        hiddenWidgetIds: profile.hiddenDashboardWidgets,
      }),
      hiddenNav: normalizeHiddenNav(profile.hiddenNav, educationTrack),
      toolsCollapsed: typeof profile.toolsCollapsed === "boolean" ? profile.toolsCollapsed : undefined,
      prepCollapsed: typeof profile.prepCollapsed === "boolean" ? profile.prepCollapsed : undefined,
      dailyGamesCollapsed: typeof profile.dailyGamesCollapsed === "boolean" ? profile.dailyGamesCollapsed : undefined,
      journalReviewTime: normalizeJournalReviewTime(profile.journalReviewTime),
      journalNotebook: profile.journalNotebook === undefined
        ? undefined
        : normalizeJournalNotebookPreferences(profile.journalNotebook),
      dailyLoopReminders: profile.dailyLoopReminders === undefined
        ? undefined
        : normalizeDailyLoopReminderPreferences(profile.dailyLoopReminders),
      focusCheckIn: profile.focusCheckIn === undefined
        ? undefined
        : normalizeFocusCheckInPreferences(profile.focusCheckIn),
      energyChecks: normalizeEnergyChecks(profile.energyChecks),
      primaryTrackerScopes: normalizePrimaryScopes(profile.primaryTrackerScopes),
      // Preserve newer opt-in settings across export/import.
      taskAutofillDisabled: typeof profile.taskAutofillDisabled === "boolean" ? profile.taskAutofillDisabled : undefined,
      taskTemplates: Array.isArray(profile.taskTemplates) ? profile.taskTemplates as NoctyriumState["profile"]["taskTemplates"] : undefined,
      experimentalFlags: normalizeExperimentalFlags(profile.experimentalFlags),
      timeZonePreference: normalizeTimeZonePreference(profile.timeZonePreference),
      clockPreferences: normalizeClockPreferences(profile.clockPreferences),
      dailySuccess: profile.dailySuccess === undefined
        ? undefined
        : normalizeDailySuccessConfig(profile.dailySuccess),
      hiddenActivityShortcuts: Array.isArray(profile.hiddenActivityShortcuts)
        ? [...new Set(profile.hiddenActivityShortcuts.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.slice(0, 240)))].slice(0, 100)
        : undefined,
      pomodoroCustom: profile.pomodoroCustom && typeof profile.pomodoroCustom === "object"
        ? profile.pomodoroCustom as NoctyriumState["profile"]["pomodoroCustom"] : undefined,
      pomodoroPreferences: normalizePomodoroPreferences(profile.pomodoroPreferences),
      studyWorkflow: normalizeStudyWorkflow(profile.studyWorkflow),
      applicationResearch: normalizeApplicationResearch(profile.applicationResearch),
      applicationProfile: normalizeApplicationProfile(profile.applicationProfile),
    },
    terms: data.terms ?? [],
    courses: data.courses ?? [],
    tracker: data.tracker ?? [],
    productivityTrackers: Array.isArray(data.productivityTrackers) ? data.productivityTrackers : [],
    resources: data.resources ?? [],
    tasks: data.tasks ?? [],
    journal: normalizeJournalEntries(data.journal),
    premedExperiences: data.premedExperiences ?? [],
    prompts: data.prompts ?? [],
    folders: data.folders ?? [],
    logs: data.logs ?? [],
    integrations: data.integrations ?? [],
    boardPrep: {
      step1: defaultBoardPrep("MS2", "light", 18, 40),
      step2: defaultBoardPrep("MS3", "not-started", 14, 40),
      step3: defaultBoardPrep("Graduate / IMG", "not-started", 10, 30),
      shelf: defaultBoardPrep("MS3", "light", 10, 25),
      mcat: defaultBoardPrep("Pre-Med", "light", 12, 35),
      premed: defaultBoardPrep("Pre-Med", "not-started", 8, 15),
      ...(data.boardPrep ?? {}),
    },
    blueprintInstalls: Array.isArray(data.blueprintInstalls) ? data.blueprintInstalls : [],
    dayPlans: data.dayPlans ?? [],
    activeDayKey: typeof data.activeDayKey === "string" ? data.activeDayKey : new Date().toISOString().slice(0, 10),
    lastActiveLocalDate: typeof data.lastActiveLocalDate === "string" ? data.lastActiveLocalDate : (typeof data.activeDayKey === "string" ? data.activeDayKey : new Date().toISOString().slice(0, 10)),
    lastTimezoneOffset: typeof data.lastTimezoneOffset === "number" ? data.lastTimezoneOffset : new Date().getTimezoneOffset(),
    dailyArchives: Array.isArray(data.dailyArchives) ? data.dailyArchives : [],
    dailyRolloverEvents: Array.isArray(data.dailyRolloverEvents) ? data.dailyRolloverEvents : [],
    energyFactors: Array.isArray(data.energyFactors) ? data.energyFactors : [],
    habits: Array.isArray(data.habits) ? data.habits : [],
    habitEntries: Array.isArray(data.habitEntries) ? data.habitEntries : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    closeouts: Array.isArray(data.closeouts) ? data.closeouts : [],
    recoveryPlans: Array.isArray(data.recoveryPlans) ? data.recoveryPlans : [],
    questions: Array.isArray(data.questions)
      ? data.questions.map((question: unknown) => migrateImportedQuestion(question, importedSchemaVersion))
      : [],
    quizSessions: Array.isArray(data.quizSessions) ? data.quizSessions : [],
    documents: Array.isArray(data.documents) ? data.documents : [],
    questionSets: Array.isArray(data.questionSets) ? data.questionSets : [],
    savedQuestionFilters: normalizeSavedQuestionFilters(data.savedQuestionFilters),
    quizBlocks: Array.isArray(data.quizBlocks) ? data.quizBlocks : [],
    ankiCards: Array.isArray(data.ankiCards) ? data.ankiCards : [],
    cardReviews: Array.isArray(data.cardReviews) ? data.cardReviews : [],
    dailyWordPuzzles: normalizeDailyWordPuzzles(data.dailyWordPuzzles),
  } as NoctyriumState;
}

function migrateImportedQuestion(value: unknown, fromVersion: number): unknown {
  if (!isRecord(value)) return value;
  const question = { ...value };
  question.annotations = normalizeQuestionAnnotations(question.annotations);
  question.attachments = normalizeQuestionAttachments(question.attachments);
  question.tags = normalizeTagList(question.tags);
  if (fromVersion < 31) {
    question.taxonomy = normalizeQuestionTaxonomy(question.taxonomy, question) ?? {};
  }
  if (fromVersion < 32) {
    const extraction = isRecord(question.extraction) ? question.extraction : undefined;
    const scoreFor = (confidence: unknown) => confidence === "high" ? 0.9 : confidence === "medium" ? 0.65 : 0.35;
    const correctKey = typeof question.correctKey === "string" ? question.correctKey : undefined;
    const options = Array.isArray(question.options) ? question.options : [];
    const matched = options.find((option) => isRecord(option) && option.key === correctKey);
    const existingAnswerText = typeof question.correctAnswerText === "string" && question.correctAnswerText.trim()
      ? question.correctAnswerText
      : undefined;
    question.correctAnswerText = matched && typeof matched.text === "string" ? matched.text : existingAnswerText;
    if (extraction) {
      question.extraction = {
        ...extraction,
        questionDetectionConfidence: typeof extraction.questionDetectionConfidence === "number"
          ? extraction.questionDetectionConfidence : scoreFor(extraction.confidence),
        answerDetectionConfidence: typeof extraction.answerDetectionConfidence === "number"
          ? extraction.answerDetectionConfidence : correctKey ? scoreFor(extraction.confidence) : 0.1,
        explanationDetectionConfidence: typeof extraction.explanationDetectionConfidence === "number"
          ? extraction.explanationDetectionConfidence
          : typeof question.explanation === "string" && question.explanation.trim() ? scoreFor(extraction.confidence) : 0.15,
        overallImportConfidence: typeof extraction.overallImportConfidence === "number"
          ? extraction.overallImportConfidence : scoreFor(extraction.confidence),
        warnings: Array.isArray(extraction.warnings) ? extraction.warnings : [],
        parserRuleIds: Array.isArray(extraction.parserRuleIds) ? extraction.parserRuleIds : ["MIGRATED.LEGACY"],
      };
    }
  }
  return reconcileAnnotationRecord(question);
}

function normalizeDashboardWidgetOrder(value: unknown): NonNullable<NoctyriumState["profile"]["dashboardWidgetOrder"]> {
  if (!Array.isArray(value)) return [...DEFAULT_DASHBOARD_WIDGETS];
  const valid = new Set(STORED_DASHBOARD_WIDGET_IDS);
  const incoming = value.filter((item): item is typeof DEFAULT_DASHBOARD_WIDGETS[number] =>
    typeof item === "string" && valid.has(item as typeof DEFAULT_DASHBOARD_WIDGETS[number]),
  );
  return [...new Set([...incoming, ...DEFAULT_DASHBOARD_WIDGETS])];
}

function normalizeDashboardWidgetList(value: unknown): NonNullable<NoctyriumState["profile"]["hiddenDashboardWidgets"]> {
  if (!Array.isArray(value)) return [...DEFAULT_HIDDEN_DASHBOARD_WIDGETS];
  const valid = new Set(STORED_DASHBOARD_WIDGET_IDS);
  return [...new Set(value.filter((item): item is typeof DEFAULT_DASHBOARD_WIDGETS[number] =>
    typeof item === "string" && valid.has(item as typeof DEFAULT_DASHBOARD_WIDGETS[number]),
  ))];
}

function normalizeHiddenNav(value: unknown, trackId: string) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
  }
  const base = ["courses", "prompts", "integrations", "folders"];
  if (trackId === "premed" || trackId === "mcat" || trackId === "undergrad") return [...base, "step"];
  if (trackId === "nursing" || trackId === "pa") return [...base, "step", "premed"];
  return [...base, "premed"];
}

function normalizeJournalReviewTime(value: unknown) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "20:00";
}

function normalizePromise(value: unknown): NoctyriumState["profile"]["promise"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const signedName = typeof record.signedName === "string" ? record.signedName.trim() : "";
  const signedAt = typeof record.signedAt === "string" ? record.signedAt : "";
  if (!signedName || !signedAt) return undefined;
  return {
    signedName,
    signedAt,
    promiseTextVersion: typeof record.promiseTextVersion === "string" ? record.promiseTextVersion : "promise-of-use-v1",
    journalEntryId: typeof record.journalEntryId === "string" ? record.journalEntryId : undefined,
  };
}

function normalizePromisePromptStatus(value: unknown): NoctyriumState["profile"]["promisePromptStatus"] {
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

function normalizeExperimentalFlags(value: unknown): NoctyriumState["profile"]["experimentalFlags"] {
  const flags = isRecord(value) ? value : {};
  return {
    ...(flags as NoctyriumState["profile"]["experimentalFlags"]),
    habits: typeof flags.habits === "boolean" ? flags.habits : undefined,
    dailyGames: flags.dailyGames === true,
  };
}

function normalizeTimeZonePreference(value: unknown): TimeZonePreference {
  if (!isRecord(value) || value.mode !== "custom") return { ...DEFAULT_TIME_ZONE_PREFERENCE };
  const customTimezone = typeof value.customTimezone === "string" ? value.customTimezone.trim() : "";
  if (!isValidTimeZone(customTimezone)) return { ...DEFAULT_TIME_ZONE_PREFERENCE };
  return { mode: "custom", customTimezone };
}

function normalizeClockPreferences(value: unknown): ClockPreferences {
  const preferences = isRecord(value) ? value : {};
  const readBoolean = (key: Exclude<keyof ClockPreferences, "hourCycle">): boolean => (
    typeof preferences[key] === "boolean"
      ? preferences[key] as boolean
      : DEFAULT_CLOCK_PREFERENCES[key]
  );
  return {
    enabled: readBoolean("enabled"),
    showDigital: readBoolean("showDigital"),
    showAnalog: readBoolean("showAnalog"),
    showDigitalSeconds: readBoolean("showDigitalSeconds"),
    showAnalogSeconds: readBoolean("showAnalogSeconds"),
    showDate: readBoolean("showDate"),
    showTimezoneLabel: readBoolean("showTimezoneLabel"),
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
    if (!isRecord(candidate)) continue;
    const puzzleId = typeof candidate.puzzleId === "string" ? candidate.puzzleId.trim() : "";
    const puzzleDate = typeof candidate.puzzleDate === "string" ? candidate.puzzleDate.trim() : "";
    const timezone = typeof candidate.timezone === "string" ? candidate.timezone.trim() : "";
    const wordListVersion = typeof candidate.wordListVersion === "string" ? candidate.wordListVersion.trim() : "";
    const startedAt = typeof candidate.startedAt === "string" ? candidate.startedAt : "";
    const expectedId = `daily-word:${wordListVersion}:${puzzleDate}`;
    if (
      puzzleId !== expectedId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(wordListVersion) ||
      !isValidTimeZone(timezone) ||
      !startedAt
    ) continue;
    const guesses = Array.isArray(candidate.guesses)
      ? candidate.guesses
        .filter((guess): guess is string => typeof guess === "string" && /^[A-Za-z]{5}$/.test(guess))
        .slice(0, 6)
        .map((guess) => guess.toUpperCase())
      : [];
    const completed = candidate.completed === true;
    const puzzle: DailyWordPuzzleState = {
      puzzleId,
      puzzleDate,
      timezone,
      wordListVersion,
      guesses,
      completed,
      won: completed && candidate.won === true,
      startedAt,
      completedAt: completed && typeof candidate.completedAt === "string" ? candidate.completedAt : undefined,
      updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : typeof candidate.completedAt === "string" && candidate.completedAt
          ? candidate.completedAt
          : startedAt,
    };
    const existing = byId.get(puzzleId);
    byId.set(puzzleId, existing ? preferDailyWordPuzzle(existing, puzzle) : puzzle);
  }
  return [...byId.values()].sort((left, right) => (
    left.puzzleDate.localeCompare(right.puzzleDate) || left.puzzleId.localeCompare(right.puzzleId)
  ));
}

function defaultBoardPrep(medYear: string, contentStarted: string, weeklyHours: number, questionTarget: number) {
  return {
    medYear,
    contentStarted,
    weeklyHours,
    questionTarget,
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
