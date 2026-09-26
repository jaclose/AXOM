// Migration safety: upgrading a real pre-v27 state must add the new arrays,
// preserve every existing record untouched, and leave a pre-migration snapshot.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migratePersistedState } from "./store";
import { STORAGE_KEYS } from "./brand";
import { makeSeed, SCHEMA_VERSION } from "./seed";

// Minimal localStorage stand-in so the pre-migration snapshot path is
// observable regardless of the test environment.
const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => { backing.set(k, String(v)); },
  removeItem: (k: string) => { backing.delete(k); },
  clear: () => backing.clear(),
});

function v26State() {
  return {
    profile: {
      name: "JD", userId: "jd", versionLabel: "old-label", tagline: "t",
      dailyCardTarget: 120, dailyMinuteTarget: 240, onboarded: true,
      focusSubscriptions: ["term1"], educationTrack: "sgu",
    },
    terms: [{ id: "t1", name: "Term 1" }],
    courses: [{ id: "c1", termId: "t1", code: "BPM 500", name: "", files: 0, modules: [] }],
    tracker: [{ id: "tr1", path: "T1/L", label: "Lecture 1", kind: "Lecture", passes: 2, ankiPasses: 1, yield: "high", updated: "2026-06-01T00:00:00.000Z" }],
    productivityTrackers: [],
    resources: [],
    tasks: [{ id: "task1", title: "Old task", done: false, created: "2026-06-01T00:00:00.000Z" }],
    journal: [{ id: "j1", date: "2026-06-01T00:00:00.000Z", today: "x", tomorrow: "y", blockers: "", energy: "High", rating: "Useful" }],
    premedExperiences: [], prompts: [], folders: [],
    logs: [{ id: "l1", dayKey: "2026-06-01", ts: "2026-06-01T10:00:00.000Z", type: "Anki", minutes: 30, cards: 50 }],
    integrations: [], boardPrep: {}, dayPlans: [], blueprintInstalls: [],
    activeDayKey: "2026-06-23", lastActiveLocalDate: "2026-06-23", lastTimezoneOffset: 240,
    dailyArchives: [], dailyRolloverEvents: [], energyFactors: [], habits: [], habitEntries: [],
    schemaVersion: 26,
  };
}

describe("v26 → v27 migration", () => {
  beforeEach(() => localStorage.clear());

  it.each([12, 13])("preserves unfinished setup when upgrading schema %i", (version) => {
    const saved = makeSeed();
    saved.profile.onboarded = false;
    const result = migratePersistedState(saved, version);
    expect(result.profile.onboarded).toBe(false);
  });

  it.each([12, 13])("does not force legacy established users through setup on schema %i", (version) => {
    const saved = makeSeed();
    delete (saved.profile as Partial<typeof saved.profile>).onboarded;
    const result = migratePersistedState(saved, version);
    expect(result.profile.onboarded).toBe(true);
  });

  it("adds the daily-loop arrays without touching existing records", () => {
    const before = v26State();
    const result = migratePersistedState(structuredClone(before), 26);

    expect(result.sessions).toEqual([]);
    expect(result.closeouts).toEqual([]);
    expect(result.recoveryPlans).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.ankiCards).toEqual([]);
    expect(result.cardReviews).toEqual([]);

    // Nothing existing was dropped or mutated.
    expect(result.tracker).toEqual(before.tracker);
    expect(result.tasks).toEqual(before.tasks);
    expect(result.journal).toEqual(before.journal);
    expect(result.logs).toEqual(before.logs);
    expect(result.activeDayKey).toBe("2026-06-23");
  });

  it("preserves already-present v27 data on a same-version pass", () => {
    const state = {
      ...v26State(),
      sessions: [{ id: "s1" }],
      questions: [{ id: "q1" }],
      schemaVersion: 27,
    };
    const result = migratePersistedState(structuredClone(state), 26);
    expect(result.sessions).toEqual([{ id: "s1" }]);
    // Q2b-3: migration normalizes the required tags array to [] on tag-less records.
    expect(result.questions).toEqual([{ id: "q1", taxonomy: {}, tags: [] }]);
  });

  it("writes only lightweight pre-migration metadata to localStorage", () => {
    migratePersistedState(v26State(), 26);
    const raw = localStorage.getItem(STORAGE_KEYS.preMigrationSnapshot);
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(raw!) as {
      fromVersion: number;
      savedAt: string;
      recordCounts: { tasks: number };
      state?: unknown;
    };
    expect(snapshot.fromVersion).toBe(26);
    expect(snapshot.recordCounts.tasks).toBe(1);
    expect(snapshot.state).toBeUndefined();
  });

  it("v28→v29 adds quiz sessions; the v28 rebrand touches only placeholder names", () => {
    // Upgrading from 28: only the additive quizSessions array appears.
    const from28 = migratePersistedState(structuredClone({ ...v26State(), schemaVersion: 28 }), 28);
    expect(from28.quizSessions).toEqual([]);
    // Upgrading from 27 with the old placeholder name: rebranded to the product name.
    const legacy = { ...v26State(), schemaVersion: 27, profile: { ...v26State().profile, name: "Noctyrium" } };
    expect(migratePersistedState(structuredClone(legacy), 27).profile.name).toBe("AXOM");
    // A real user name is never touched by the rebrand.
    const named = { ...legacy, profile: { ...legacy.profile, name: "JD" } };
    expect(migratePersistedState(structuredClone(named), 27).profile.name).toBe("JD");
  });

  it("v29→v30 adds the library arrays without touching questions", () => {
    const state = { ...v26State(), schemaVersion: 29, questions: [{ id: "q1", stem: "s" }] };
    const result = migratePersistedState(structuredClone(state), 29);
    expect(result.documents).toEqual([]);
    expect(result.questionSets).toEqual([]);
    expect(result.quizBlocks).toEqual([]);
    expect(result.questions).toEqual([{ id: "q1", stem: "s", taxonomy: {}, tags: [] }]);
  });

  it("v30→v31 seeds optional question taxonomy from legacy fields", () => {
    const state = {
      ...v26State(),
      schemaVersion: 30,
      questions: [{ id: "q1", stem: "s", system: "Cardio", topic: "Murmurs", category: "Physiology", errorType: "missed-clue" }],
    };
    const result = migratePersistedState(structuredClone(state), 30);
    expect(result.questions[0].taxonomy).toEqual({
      system: "Cardio",
      discipline: "Physiology",
      topic: "Murmurs",
      errorPattern: "missed-clue",
    });
  });

  it("v31→v32 adds import diagnostics without rewriting question content", () => {
    const question = {
      id: "q1",
      stem: "A preserved stem",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "B",
      explanation: "A preserved explanation",
      extraction: { confidence: "medium", reviewed: false },
    };
    const state = { ...v26State(), schemaVersion: 31, questions: [question] };
    const result = migratePersistedState(structuredClone(state), 31);
    expect(result.schemaVersion).toBe(34);
    expect(result.questions[0].stem).toBe(question.stem);
    expect(result.questions[0].explanation).toBe(question.explanation);
    expect(result.questions[0].correctAnswerText).toBe("Beta");
    expect(result.questions[0].extraction).toMatchObject({
      confidence: "medium",
      questionDetectionConfidence: 0.65,
      answerDetectionConfidence: 0.65,
      explanationDetectionConfidence: 0.65,
      overallImportConfidence: 0.65,
      parserRuleIds: ["MIGRATED.LEGACY"],
    });
  });

  it("preserves existing answer text when a legacy key cannot be matched", () => {
    const state = {
      ...v26State(),
      schemaVersion: 31,
      questions: [{
        id: "q1", stem: "Preserve me", options: [{ key: "A", text: "Alpha" }],
        correctKey: "B", correctAnswerText: "Legacy free-text answer",
      }],
    };
    const result = migratePersistedState(structuredClone(state), 31);
    expect(result.questions[0].correctAnswerText).toBe("Legacy free-text answer");
  });

  it("survives a deep-legacy (v1-era) payload without throwing", () => {
    const ancient = {
      profile: { name: "Old" },
      terms: [], courses: [],
      tracker: [{ id: "x", path: "p", label: "l", type: "Lecture", status: "working" }],
      tasks: [], journal: [], prompts: [], folders: [], logs: [], integrations: [],
    };
    const result = migratePersistedState(ancient, 1);
    expect(Array.isArray(result.resources)).toBe(true);
    expect(result.tracker[0].kind).toBe("Lecture");
    expect(result.sessions).toEqual([]);
    expect(result.ankiCards).toEqual([]);
  });

  it("adds safe Wave 5 defaults at schema v32 without enabling Daily Games and stays idempotent", () => {
    const state = makeSeed() as unknown as Record<string, unknown>;
    const profile = { ...(state.profile as Record<string, unknown>) };
    delete profile.experimentalFlags;
    delete profile.dailyGamesCollapsed;
    delete profile.timeZonePreference;
    delete profile.clockPreferences;
    state.profile = profile;
    delete state.dailyWordPuzzles;

    const migrated = migratePersistedState(structuredClone(state), SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(34);
    expect(migrated.profile.experimentalFlags?.dailyGames).toBe(false);
    expect(migrated.profile.timeZonePreference).toEqual({ mode: "system" });
    expect(migrated.profile.clockPreferences).toMatchObject({ enabled: true, showDigitalSeconds: false, hourCycle: "12" });
    expect(migrated.dailyWordPuzzles).toEqual([]);

    expect(migratePersistedState(structuredClone(migrated), SCHEMA_VERSION)).toEqual(migrated);
  });

  it("uses the same focused widget fallback as backup hydration while preserving an explicit show-all choice", () => {
    const missing = makeSeed() as unknown as Record<string, unknown>;
    const missingProfile = { ...(missing.profile as Record<string, unknown>) };
    delete missingProfile.hiddenDashboardWidgets;
    missing.profile = missingProfile;
    expect(migratePersistedState(structuredClone(missing), SCHEMA_VERSION).profile.hiddenDashboardWidgets)
      .toEqual(makeSeed().profile.hiddenDashboardWidgets);

    const explicit = makeSeed();
    explicit.profile.hiddenDashboardWidgets = [];
    expect(migratePersistedState(structuredClone(explicit), SCHEMA_VERSION).profile.hiddenDashboardWidgets).toEqual([]);
  });

  it("preserves the legacy AI widget ID in storage while safely dropping unknown widget IDs", () => {
    const legacy = makeSeed() as unknown as Record<string, unknown>;
    const profile = legacy.profile as Record<string, unknown>;
    profile.dashboardWidgetOrder = ["aiActions", "todayScore", "future-unknown-widget"];
    profile.hiddenDashboardWidgets = ["aiActions", "future-unknown-widget"];

    const migrated = migratePersistedState(structuredClone(legacy), SCHEMA_VERSION);
    expect(migrated.profile.dashboardWidgetOrder?.[0]).toBe("aiActions");
    expect(migrated.profile.dashboardWidgetOrder).toEqual(expect.arrayContaining(["todayScore", "winDay"]));
    expect(migrated.profile.dashboardWidgetOrder).not.toContain("future-unknown-widget");
    expect(migrated.profile.hiddenDashboardWidgets).toEqual(["aiActions"]);
  });

  it("normalizes optional widget layout metadata without a schema bump or dropping future fields", () => {
    const state = makeSeed() as unknown as Record<string, unknown>;
    const profile = state.profile as Record<string, unknown>;
    profile.dashboardLayout = {
      version: 5,
      preset: "custom",
      order: ["todayScore", "future-widget"],
      hiddenWidgetIds: ["future-widget"],
      widgets: {
        todayScore: { size: "extra-large", enabledFields: ["progress"] },
        "future-widget": { size: "medium", enabledFields: ["future-field"], futurePreference: true },
      },
      futureLayoutField: { safe: true },
    };

    const migrated = migratePersistedState(structuredClone(state), SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(34);
    expect(migrated.profile.dashboardLayout).toMatchObject({
      version: 1,
      preset: "custom",
      order: ["todayScore", "future-widget"],
      hiddenWidgetIds: ["future-widget"],
      futureLayoutField: { safe: true },
      widgets: {
        todayScore: { size: "extra-large", enabledFields: ["progress"] },
        "future-widget": { size: "medium", enabledFields: ["future-field"], futurePreference: true },
      },
    });
    expect(migratePersistedState(structuredClone(migrated), SCHEMA_VERSION)).toEqual(migrated);
  });

  it("normalizes an optional promise prompt version without bumping schema", () => {
    const state = makeSeed();
    state.profile.promisePromptStatus = {
      state: "deferred",
      updatedAt: "2026-07-12T12:00:00.000Z",
      promptVersion: "promise-prompt-v1",
    };
    const migrated = migratePersistedState(structuredClone(state), SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(34);
    expect(migrated.profile.promisePromptStatus).toEqual(state.profile.promisePromptStatus);
  });

  it("preserves and de-duplicates existing Daily Word history without altering unrelated records", () => {
    const state = makeSeed();
    const incomplete = {
      puzzleId: "daily-word:general-1:2026-07-12",
      puzzleDate: "2026-07-12",
      timezone: "America/Grenada",
      wordListVersion: "general-1",
      guesses: ["APPLE"],
      completed: false,
      won: false,
      startedAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:01:00.000Z",
    };
    state.dailyWordPuzzles = [incomplete, {
      ...incomplete,
      guesses: ["APPLE", "BERRY"],
      completed: true,
      won: true,
      completedAt: "2026-07-12T10:02:00.000Z",
      updatedAt: "2026-07-12T10:02:00.000Z",
    }];
    const beforeTasks = structuredClone(state.tasks);

    const migrated = migratePersistedState(structuredClone(state), SCHEMA_VERSION);
    expect(migrated.dailyWordPuzzles).toHaveLength(1);
    expect(migrated.dailyWordPuzzles[0]).toMatchObject({ completed: true, guesses: ["APPLE", "BERRY"] });
    expect(migrated.tasks).toEqual(beforeTasks);
  });
});
