// ===========================================================================
// Alpha starter data. Keep the app useful on first launch without shipping a
// personal workload: canonical SGU terms/courses, a few sample tracker rows,
// official board resources, and empty logs/journal.
// ===========================================================================
import type { BoardPrepProfile, ClockPreferences, DashboardWidgetId, NoctyriumState, ProductivityTracker, TimeZonePreference, TrackerItem, TrackerKind, Yield } from "./types";
import { isoDate } from "./scoring";
import { userIdFromName } from "./userIdentity";
import { ACADEMIC_TEMPLATE_COURSES, ACADEMIC_TEMPLATE_TERMS, DEFAULT_FOCUS_IDS } from "./experience";
import { normalizeResourceUrl } from "./resourceUtils";

export const SCHEMA_VERSION = 34;
// Version + brand strings live in brand.ts (single source of truth for rebrand).
export { APP_RELEASE_VERSION, APP_BUILD_LABEL, APP_VERSION_LABEL } from "./brand";
import { APP_VERSION_LABEL, BRAND } from "./brand";
export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  "winDay",
  "todayScore",
  "examCountdown",
  "pomodoro",
  "weekly",
  "suggested",
  "schedule",
  "termMap",
  "localData",
  "latestStandup",
  "productivityTrend",
  "premedHours",
  "resourceFocus",
  "boardBlueprint",
];
export const DEFAULT_HIDDEN_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  "suggested",
  "schedule",
  "termMap",
  "localData",
  "latestStandup",
  "productivityTrend",
  "premedHours",
  "resourceFocus",
  "boardBlueprint",
];

/**
 * IDs accepted when hydrating old profiles and portable backups. `aiActions`
 * is storage-only legacy metadata: retaining it avoids rewriting historical
 * preferences, while the current dashboard and widget catalogs omit it.
 */
export const STORED_DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  ...DEFAULT_DASHBOARD_WIDGETS,
  "welcome",
  "commandBrief",
  "questionBank",
  "courseTracker",
  "tasks",
  "readiness",
  "activity",
  "journal",
  "streak",
  "dailyWord",
  "aiActions",
];

export const DEFAULT_TIME_ZONE_PREFERENCE: TimeZonePreference = { mode: "system" };

export const DEFAULT_CLOCK_PREFERENCES: ClockPreferences = {
  enabled: true,
  showDigital: true,
  showAnalog: true,
  showDigitalSeconds: false,
  showAnalogSeconds: false,
  showDate: false,
  showTimezoneLabel: false,
  hourCycle: "12",
};

const now = () => new Date().toISOString();
const localDate = () => isoDate(new Date());

function trackerRow(
  path: string,
  label: string,
  kind: TrackerKind,
  passes: number,
  ankiPasses = 0,
  y: Yield = "none",
): TrackerItem {
  return { id: crypto.randomUUID(), path, label, kind, passes, ankiPasses, yield: y, updated: now() };
}

export function makeSeed(): NoctyriumState {
  const seedNow = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    activeDayKey: localDate(),
    lastActiveLocalDate: localDate(),
    lastTimezoneOffset: new Date().getTimezoneOffset(),
    dailyArchives: [],
    dailyRolloverEvents: [],
    energyFactors: [],
    habits: [],
    habitEntries: [],
    sessions: [],
    closeouts: [],
    recoveryPlans: [],
    questions: [],
    quizSessions: [],
    documents: [],
    questionSets: [],
    savedQuestionFilters: [],
    quizBlocks: [],
    ankiCards: [],
    cardReviews: [],
    dailyWordPuzzles: [],
    profile: {
      name: BRAND.productName,
      userId: userIdFromName(BRAND.productName),
      versionLabel: APP_VERSION_LABEL,
      tagline: BRAND.tagline,
      dailyCardTarget: 120,
      dailyMinuteTarget: 240,
      onboarded: false,
      educationTrack: "sgu",
      academicStageId: "preclinical",
      showSguResources: true,
      activeFocusId: "term1",
      focusSubscriptions: DEFAULT_FOCUS_IDS,
      dashboardWidgetOrder: DEFAULT_DASHBOARD_WIDGETS,
      hiddenDashboardWidgets: DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
      journalReviewTime: "20:00",
      // New workspaces begin neutral: support for a metric never makes it a
      // requirement automatically. Existing profiles without this field keep
      // their accepted legacy targets until they configure daily success.
      dailySuccess: { version: 1, configuredAt: localDate(), requirements: [] },
      experimentalFlags: { dailyGames: false },
      timeZonePreference: { ...DEFAULT_TIME_ZONE_PREFERENCE },
      clockPreferences: { ...DEFAULT_CLOCK_PREFERENCES },
      hiddenNav: ["courses", "prompts", "integrations", "folders", "premed"],
    },
    terms: ACADEMIC_TEMPLATE_TERMS.map((term) => ({ ...term })),
    courses: ACADEMIC_TEMPLATE_COURSES.map(({ aliases: _aliases, modules, ...course }) => ({
      ...course,
      id: crypto.randomUUID(),
      modules: modules.map((n) => ({ id: crypto.randomUUID(), name: n })),
    })),
    productivityTrackers: defaultProductivityTrackers(seedNow),
    tracker: [
      // Small examples only. Users can bulk-import real lecture/DLA/PQ lists.
      trackerRow("Term 1/BPM 500/FTM 1/Lectures", "Example lecture: Cellular adaptation", "Lecture", 0, 0, "high"),
      trackerRow("Term 1/BPM 500/FTM 1/DLAs", "Example DLA: Histology orientation", "DLA", 0, 0),
      trackerRow("Term 1/BPM 500/FTM 1/PQs", "Example PQ set: General principles", "PQ", 0, 0),
      trackerRow("Term 2/BPM 501/NB3/Lectures", "Example lecture: Sleep and biological rhythms", "Lecture", 1, 1, "review"),
      trackerRow("Term 2/BPM 501/NB3/PQs", "Example PQ set: Psych foundations", "PQ", 1, 0),
    ],
    resources: [
      { id: crypto.randomUUID(), title: "USMLE Step 1 Content Outline", url: "https://www.usmle.org/exam-resources/step-1-materials/step-1-content-outline-and-specifications", category: "STEP 1", tags: ["official", "blueprint"], favorite: true, created: now() },
      { id: crypto.randomUUID(), title: "USMLE Step 1 Sample Questions", url: "https://www.usmle.org/exam-resources/step-1-materials/step-1-sample-test-questions", category: "STEP 1", tags: ["official", "practice"], favorite: true, created: now() },
      { id: crypto.randomUUID(), title: "USMLE Step 2 CK Content Outline", url: "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-content-outline-specifications", category: "STEP 2", tags: ["official", "blueprint"], favorite: true, created: now() },
      { id: crypto.randomUUID(), title: "USMLE Step 2 CK Sample Questions", url: "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-sample-test-questions", category: "STEP 2", tags: ["official", "practice"], created: now() },
      { id: crypto.randomUUID(), title: "AnKing Overview (Step 1 deck)", url: "https://www.ankingmed.com/", category: "Anki", tags: ["deck", "step1"], favorite: true, created: now() },
      { id: crypto.randomUUID(), title: "AnKing Step Deck on AnkiHub", url: "https://www.ankihub.net/step-deck", category: "Anki", tags: ["deck", "step1", "step2"], favorite: true, created: now() },
      { id: crypto.randomUUID(), title: "Mehlman Medical Free HY Documents", url: "https://mehlmanmedical.com/free-stuff/", category: "STEP 1", tags: ["review", "hy"], favorite: true, created: now() },
      ...SGU_DRIVES.map((d) => ({ id: crypto.randomUUID(), created: now(), ...driveResourceFields(d) })),
    ],
    tasks: [
      { id: crypto.randomUUID(), title: "Create today's standup", done: false, archived: false, scope: "Journal", created: now(), due: isoDate(new Date()) },
      { id: crypto.randomUUID(), title: "Add your real lecture/DLA/PQ list", done: false, archived: false, scope: "Course Tracker", created: now() },
      { id: crypto.randomUUID(), title: "Save progress from Settings", done: false, archived: false, scope: "Cloud Sync", created: now() },
    ],
    journal: [],
    premedExperiences: [],
    prompts: [
      {
        id: crypto.randomUUID(), title: "Lecture → Anki cloze deck", category: "Anki",
        tags: ["anki", "cloze", "lectures"],
        body: "You are my medical-school study partner. Convert the following lecture notes into high-yield Anki cloze cards. Keep one fact per card, prefer cloze over basic, and tag by system. Notes:\n\n{{paste notes}}",
        created: now(), updated: now(),
      },
      {
        id: crypto.randomUUID(), title: "STEP 1 weak-area drill", category: "STEP 1",
        tags: ["step1", "questions", "review"],
        body: "Act as a STEP 1 tutor. Given my weak area below, generate 5 vignette-style MCQs with one-line explanations and a final 'why the others are wrong' block. Weak area: {{topic}}",
        created: now(), updated: now(),
      },
      {
        id: crypto.randomUUID(), title: "Daily standup summary", category: "Productivity",
        tags: ["standup", "journal"],
        body: "Summarize my day from these bullet points into a tight standup: what I did, what's next, blockers, and a one-word energy rating. Bullets:\n\n{{bullets}}",
        created: now(), updated: now(),
      },
    ],
    folders: [
      { id: crypto.randomUUID(), name: "Inbox", description: "Files waiting to be sorted", icon: "Inbox", color: "var(--cyan)" },
      { id: crypto.randomUUID(), name: "Anki Decks", description: "Exported .apkg builds", icon: "Layers", color: "var(--purple)" },
      { id: crypto.randomUUID(), name: "Research", description: "Papers & references", icon: "FlaskConical", color: "var(--green)" },
      { id: crypto.randomUUID(), name: "Summaries & Sheets", description: "Condensed high-yield docs", icon: "FileText", color: "var(--orange)" },
    ],
    logs: [],
    integrations: [
      { id: crypto.randomUUID(), name: "Anki Lab", description: "Turn lectures, DLAs & slides into cards (prompt-based today)", status: "available", icon: "Wand2" },
      { id: crypto.randomUUID(), name: "Anki Sync", description: "Pull review counts + due cards into Productivity", status: "planned", icon: "Layers" },
      { id: crypto.randomUUID(), name: "Calendar", description: "Sync study blocks", status: "planned", icon: "Calendar" },
      { id: crypto.randomUUID(), name: "Google Drive", description: "Course file routing", status: "planned", icon: "HardDrive" },
      { id: crypto.randomUUID(), name: "JSON Backup", description: "Export / import all data", status: "connected", icon: "Database" },
    ],
    boardPrep: {
      step1: boardPrepSeed("light", 18, 40),
      step2: boardPrepSeed("not-started", 14, 40),
      step3: boardPrepSeed("not-started", 10, 30),
      shelf: boardPrepSeed("light", 10, 25),
      mcat: boardPrepSeed("light", 12, 35),
      premed: boardPrepSeed("not-started", 8, 15),
    },
    dayPlans: [],
    blueprintInstalls: [],
  };
}

export function defaultProductivityTrackers(timestamp = now()): ProductivityTracker[] {
  return [
    trackerDef("tracker-study", "Study", "BookOpen", "var(--cyan)", "minutes", 240, 1680, "Academic", true, true, true, true, true, timestamp),
    trackerDef("tracker-coding", "Coding", "Code2", "var(--purple)", "minutes", 60, 420, "Deep Work", false, true, true, true, false, timestamp),
    trackerDef("tracker-gym", "Gym", "Dumbbell", "var(--green)", "minutes", 45, 180, "Health", false, true, true, true, true, timestamp),
    trackerDef("tracker-class", "Class", "GraduationCap", "var(--orange)", "minutes", 120, 600, "Academic", true, true, false, true, false, timestamp),
    trackerDef("tracker-research", "Research", "FlaskConical", "var(--cyan)", "minutes", 60, 300, "Academic", false, true, true, true, false, timestamp),
    trackerDef("tracker-writing", "Writing", "FileText", "var(--purple)", "minutes", 45, 240, "Creative", false, true, true, true, true, timestamp),
    trackerDef("tracker-language", "Language Learning", "Languages", "var(--green)", "minutes", 30, 180, "Learning", false, true, true, true, true, timestamp),
  ];
}

function trackerDef(
  id: string,
  name: string,
  icon: string,
  color: string,
  unitType: ProductivityTracker["unitType"],
  dailyTarget: number,
  weeklyTarget: number,
  category: string,
  contributesToAcademicStudy: boolean,
  contributesToTotalProductiveTime: boolean,
  contributesToEnergy: boolean,
  contributesToReports: boolean,
  contributesToHabitTracking: boolean,
  timestamp: string,
): ProductivityTracker {
  return {
    id,
    name,
    icon,
    color,
    unitType,
    dailyTarget,
    weeklyTarget,
    category,
    contributesToAcademicStudy,
    contributesToTotalProductiveTime,
    contributesToEnergy,
    contributesToReports,
    contributesToHabitTracking,
    visible: true,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// Curated shared drives — mostly SGU. These ship with every build so they are
// present for all users. Paste real SGU shared-drive links here to bake them in.
// Permanent curated drives. `rating` (1–10) is JD's personal usefulness score;
// `ratingReason` shows on hover. My Drive + MADCOW are 10/10. Titles/ratings on
// the SGU Shared entries are placeholders — rename + re-rate them in-app.
export type SeedDrive = { title: string; url: string; category: string; rating: number; ratingReason: string; tags: string[]; note?: string };
// Exact curated permanent resources (spec v0.1.0-alpha.1). My Drive pins first
// via resourceSortScore; MADCOW + Claudfather are 10/10. Labels here are canonical
// and are corrected onto existing installs by the schema-16 migration.
export const SGU_DRIVES: SeedDrive[] = [
  { title: "My Drive", url: "https://drive.google.com/drive/folders/19_3nrTD66v_oCIKlruFVidirdCAIe8yp?usp=sharing", category: "Personal Core", rating: 10, ratingReason: "Primary personal medical school resource hub and Anki build location.", tags: ["mine", "personal", "anki"] },
  { title: "Claudfather", url: "https://drive.google.com/drive/folders/1_P0tj-OayBawZtAT8WkY22Osepg1oCfy?usp=sharing", category: "AI / Automation", rating: 10, ratingReason: "High-value automation and AI-assisted workflow resource.", tags: ["claudfather", "ai", "automation"] },
  { title: "Madcow", url: "https://accidental-scallion-328.notion.site/MADCOW-Drive-1a51388b1e708076b592e522eda64aeb?pvs=143", category: "High-Yield Drive / Notion", rating: 10, ratingReason: "Top-tier curated high-yield resource. Personally rated 10/10 for usefulness.", tags: ["madcow", "high-yield", "notion"] },
  { title: "Nana's Practice Questions", url: "https://drive.google.com/drive/folders/1qju4aorkQCH6lZ5xrfEgyzR8BUAhPe7l?usp=sharing", category: "Practice Questions", rating: 9, ratingReason: "High-utility practice question source for active recall and exam-style review.", tags: ["pq", "practice"] },
  { title: "Last Ditch PQ's and Review", url: "https://drive.google.com/drive/folders/1w2k2j-RGy6WWvYi4iXk4yye_nw_2EL6Y?usp=sharing", category: "Term Review", rating: 9, ratingReason: "Term-by-term student-made review and practice resources for close-to-exam review.", tags: ["review", "term"] },
  { title: "SGU Materials", url: "https://drive.google.com/drive/folders/1fnL3d74y4S8ocCfOPlKzrQAAqkpDVjsS?usp=sharing", category: "SGU Materials", rating: 9, ratingReason: "Core SGU material repository for course support and reference.", tags: ["sgu", "materials"] },
  { title: "Mehlman Drive", url: "https://drive.google.com/drive/folders/1YVx3-zjKlXwc63s7KSyfVrU92-nW6WEB", category: "Boards / Step Prep", rating: 9, ratingReason: "Strong board review resource, especially for focused Step-style reinforcement.", tags: ["boards", "step", "mehlman"] },
  { title: "Schedules & Anki", url: "https://drive.google.com/drive/folders/1vrL1kLb5p9RaoSjD6694ZrXOdn5T1kzJ?usp=sharing", category: "Scheduling / Anki", rating: 8, ratingReason: "Useful for planning structure and Anki workflow support.", tags: ["schedule", "anki"] },
  { title: "Mega Drive", url: "https://mega.nz/folder/QqwggaSR#K_dXqEHbtBKYAzWjT2GeLQ", category: "External Archive", rating: 8, ratingReason: "Large external archive. Useful, but should be filtered carefully.", tags: ["mega", "archive"] },
  { title: "SGU Silly Goose Wiki", url: "https://baquino.notion.site/sillygoosewiki?v=6feec2d3e6b64760bf5d9b6e84a60fa7", category: "SGU Wiki", rating: 8, ratingReason: "Community wiki for SGU-specific orientation, workflows, and practical survival knowledge.", tags: ["wiki", "sgu", "notion"] },
  { title: "White Coat DES", url: "https://drive.google.com/drive/folders/16i6O5TbmXJ90fYshhx05QeBb5NKdzJL9", category: "Boards / Study Support", rating: 8, ratingReason: "Supplemental board and study support resource.", tags: ["boards", "study"] },
];

/** Map a curated drive to Resource fields. category stays "Drives" (band
 *  membership); the sub-group rides in tags[0] and drives the band's grouping. */
export function driveResourceFields(d: SeedDrive) {
  return {
    title: d.title, url: normalizeResourceUrl(d.url), category: "Drives",
    tags: [d.category, ...d.tags], note: d.note,
    rating: d.rating, ratingReason: d.ratingReason, favorite: d.rating >= 10,
  };
}

function boardPrepSeed(
  contentStarted: BoardPrepProfile["contentStarted"],
  weeklyHours: number,
  questionTarget: number,
): BoardPrepProfile {
  return {
    medYear: "MS2",
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
    updated: now(),
  };
}
