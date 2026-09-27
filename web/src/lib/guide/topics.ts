// ===========================================================================
// The AXOM Guide's map of the app: what each feature does, where it lives and
// which controls to point at. Local matching and the optional AI answer both
// choose from these topics, so the guide can only send people to real places.
// Step targets are data-guide (or existing data-tour) anchors; a test keeps
// every target present in the source.
// ===========================================================================
import type { SettingsTab } from "../../components/shell/SettingsModal";

export interface GuideStep {
  /** Route id from components/shell/nav.ts. */
  route: string;
  /** data-guide or data-tour anchor to point at; omit for a page-level note. */
  target?: string;
  title: string;
  body: string;
}

export interface GuideTopic {
  id: string;
  title: string;
  /** Answers "how do I…" on its own, in one or two sentences. */
  summary: string;
  keywords: string[];
  /** Point at each control in turn; clicking the highlighted one continues. */
  steps?: GuideStep[];
  /** Features that live in Settings open it on this tab instead. */
  settingsTab?: SettingsTab;
}

export const GUIDE_TOPICS: readonly GuideTopic[] = [
  {
    id: "anki-generate",
    title: "Generate Anki cards with AI",
    summary: "In Anki Lab, open AI generate, paste your notes, pick a style and generate. You review every draft and save only the ones you keep.",
    keywords: ["anki", "card", "flashcard", "generate", "ai", "make", "create", "deck", "notes", "claude"],
    steps: [
      { route: "anki", target: "anki-tab-generate", title: "Open AI generate", body: "Click AI generate to open the card generator." },
      { route: "anki", target: "anki-ai-generator", title: "Paste and generate", body: "Paste notes or objectives, choose a style and how many cards, then Generate drafts. Uncheck any draft you don't want before saving." },
    ],
  },
  {
    id: "anki-review",
    title: "Review due Anki cards",
    summary: "Anki Lab has built-in spaced review: the Review tab shows the cards due today.",
    keywords: ["review", "due", "spaced", "repetition", "srs", "anki", "card", "study"],
    steps: [{ route: "anki", target: "anki-tab-review", title: "Open Review", body: "Click Review to study today's due cards. The number shows how many are waiting." }],
  },
  {
    id: "anki-vault",
    title: "Browse, add or edit your cards",
    summary: "The Card vault in Anki Lab lists every card you've saved. Open a card to edit it, or create one by hand.",
    keywords: ["vault", "edit", "browse", "add", "manage", "delete", "anki", "card"],
    steps: [{ route: "anki", target: "anki-tab-vault", title: "Open the Card vault", body: "Click Card vault to see, edit and create cards." }],
  },
  {
    id: "anki-export",
    title: "Export cards to the Anki app",
    summary: "Anki Lab's Prompt studio builds an Anki-ready AI prompt and exports Cloze and Basic cards as separate CSV files for Anki desktop.",
    keywords: ["export", "anki", "desktop", "csv", "tsv", "download", "prompt", "import"],
    steps: [{ route: "anki", target: "anki-tab-prompt", title: "Open Prompt studio", body: "Click Prompt studio. Its Export to Anki section downloads Cloze and Basic CSV files that Anki desktop imports." }],
  },
  {
    id: "questions-generate",
    title: "Generate practice questions with AI",
    summary: "In Question Bank, choose Import, then Generate with AI. Give a topic or paste reference text; every question is reviewed before it joins your bank.",
    keywords: ["question", "mcq", "generate", "ai", "practice", "make", "create", "vignette", "board", "claude"],
    steps: [
      { route: "questions", target: "qb-open-import", title: "Open the importer", body: "Click Import to open the Import Center." },
      { route: "questions", target: "qb-source-ai", title: "Generate with AI", body: "Choose Generate with AI, then set a topic, style, difficulty and count." },
    ],
  },
  {
    id: "questions-import",
    title: "Import questions from a file or text",
    summary: "In Question Bank, choose Import to bring in files or pasted question text. AXOM maps the answers and flags anything uncertain for you to confirm.",
    keywords: ["import", "question", "file", "pdf", "docx", "paste", "upload", "bank", "uworld", "amboss"],
    steps: [
      { route: "questions", target: "qb-open-import", title: "Open the importer", body: "Click Import to open the Import Center." },
      { route: "questions", target: "qb-source-file", title: "Pick a source", body: "Import one file, several files, or paste text. You confirm uncertain answer mappings before finalizing." },
    ],
  },
  {
    id: "questions-practice",
    title: "Practice a question set",
    summary: "Question Bank's first button starts practice or continues your last session. Question Sets and Saved Blocks are listed just below.",
    keywords: ["practice", "quiz", "block", "question", "set", "exam", "tutor", "timed", "session"],
    steps: [{ route: "questions", target: "question-bank-entry", title: "Start practice", body: "Use Start practice or Continue last session. Question Sets and Saved Blocks are just below." }],
  },
  {
    id: "command-brief",
    title: "What should I study next?",
    summary: "The Command Brief on the Dashboard turns your current work into one next move and explains why. Nothing changes until you choose.",
    keywords: ["next", "plan", "today", "study", "recommend", "brief", "dashboard", "what", "priority"],
    steps: [{ route: "dashboard", target: "command-brief", title: "Command Brief", body: "Your next move, why it's suggested, and the actions you can take." }],
  },
  {
    id: "intention",
    title: "Set today's intention",
    summary: "The Dashboard check-in records your intention for the day, so the Journal can follow up on it.",
    keywords: ["intention", "check", "checkin", "goal", "today", "morning", "dashboard"],
    steps: [{ route: "dashboard", target: "intention", title: "Today's intention", body: "Write what today is for. You can follow up on it in the Journal." }],
  },
  {
    id: "daily-targets",
    title: "Set daily study targets",
    summary: "Daily requirements on the Dashboard define what a complete study day means for you.",
    keywords: ["target", "requirement", "goal", "daily", "quota", "minimum", "dashboard"],
    steps: [{ route: "dashboard", target: "requirements", title: "Daily requirements", body: "Set the targets that make up a complete study day." }],
  },
  {
    id: "course-tracker",
    title: "Add courses and lectures to the Course Tracker",
    summary: "Course Tracker maps lectures, DLAs and practice questions. Import a list or add work manually, then mark each study pass as you go.",
    keywords: ["course", "lecture", "dla", "tracker", "module", "import", "schedule", "pass", "syllabus"],
    steps: [{ route: "tracker", target: "import", title: "Import or add work", body: "Import a lecture list or add items manually, then track each study pass." }],
  },
  {
    id: "courses",
    title: "Organize courses by term",
    summary: "Courses is a term-based course map with module-level folders.",
    keywords: ["course", "term", "semester", "module", "folder", "organize"],
    steps: [{ route: "courses", title: "Courses", body: "Your term-based course map with module-level folders." }],
  },
  {
    id: "pomodoro",
    title: "Start a focus timer",
    summary: "Productivity has a Pomodoro focus timer for timed study sprints.",
    keywords: ["pomodoro", "timer", "focus", "sprint", "session", "clock", "break"],
    steps: [{ route: "productivity", target: "pomodoro", title: "Pomodoro", body: "Start a focus sprint here." }],
  },
  {
    id: "log-study",
    title: "Log study time",
    summary: "Productivity's log records study time, Anki cards and lecture blocks. Everything you log feeds your reports.",
    keywords: ["log", "record", "hours", "time", "study", "track", "productivity"],
    steps: [{ route: "productivity", target: "log", title: "Log a session", body: "Record study time, cards or lecture blocks." }],
  },
  {
    id: "journal",
    title: "Write a daily standup",
    summary: "Journal holds daily standups: how your intention went, blockers, and tomorrow's plan.",
    keywords: ["journal", "standup", "reflect", "diary", "blocker", "tomorrow", "notes"],
    steps: [{ route: "journal", title: "Journal", body: "Write today's standup: intention follow-up, blockers and tomorrow's plan." }],
  },
  {
    id: "reports",
    title: "See reports and trends",
    summary: "Reports shows today, the week, course distribution and longer trends from what you've recorded, measured against your goals.",
    keywords: ["report", "stats", "statistics", "trend", "progress", "chart", "analytics", "performance", "weak"],
    steps: [{ route: "reports", target: "reports-top", title: "Reports", body: "Review today, the week and longer trends." }],
  },
  {
    id: "soundscapes",
    title: "Play focus sounds",
    summary: "Soundscapes plays synthesized study sound with live visuals and keeps an honest listening log.",
    keywords: ["sound", "music", "noise", "ambient", "soundscape", "audio", "focus"],
    steps: [{ route: "soundscapes", title: "Soundscapes", body: "Pick a scene to play while you study." }],
  },
  {
    id: "study-methods",
    title: "Choose a study method",
    summary: "Study Methods is a library of evidence-informed techniques, each with honest trade-offs.",
    keywords: ["method", "technique", "strategy", "learn", "evidence", "active", "recall"],
    steps: [{ route: "methods", title: "Study Methods", body: "Browse techniques and their trade-offs." }],
  },
  {
    id: "tasks",
    title: "Track tasks",
    summary: "Tasks lists your open and completed work.",
    keywords: ["task", "todo", "to-do", "list", "assignment", "deadline"],
    steps: [{ route: "tasks", target: "tasks", title: "Tasks", body: "Add and complete tasks here." }],
  },
  {
    id: "habits",
    title: "Track habits",
    summary: "Habit Tracker is calm, recovery-friendly habit tracking. It is still experimental.",
    keywords: ["habit", "streak", "routine", "sleep", "exercise"],
    steps: [{ route: "habits", title: "Habit Tracker", body: "Track habits without punishing a missed day." }],
  },
  {
    id: "board-prep",
    title: "Plan for Step 1, Step 2 CK or shelf exams",
    summary: "USMLE / Shelf Prep covers Step 1, Step 2 CK, Step 3, dedicated prep and shelf exams, with blueprint strategy for each.",
    keywords: ["step", "usmle", "shelf", "comlex", "board", "dedicated", "blueprint", "nbme", "exam"],
    steps: [{ route: "step", target: "step", title: "Board prep", body: "Choose an exam lane and work through its blueprint." }],
  },
  {
    id: "premed",
    title: "MCAT, DAT and pre-med planning",
    summary: "Pre-Med covers MCAT, DAT and CASPer prep, plus an Experience Log for your application.",
    keywords: ["mcat", "dat", "casper", "premed", "pre-med", "application", "experience"],
    steps: [{ route: "premed", title: "Pre-Med", body: "MCAT, DAT, CASPer and your application runway." }],
  },
  {
    id: "application-checker",
    title: "Research medical schools",
    summary: "Application Checker helps you research medical schools and save review checks.",
    keywords: ["school", "application", "admission", "research", "residency", "program", "apply"],
    steps: [{ route: "appchecker", title: "Application Checker", body: "Research schools and save your checks." }],
  },
  {
    id: "resources",
    title: "Save useful links",
    summary: "Resources keeps saved links for courses, boards, references and tools.",
    keywords: ["link", "resource", "bookmark", "url", "reference", "website"],
    steps: [{ route: "resources", target: "resources", title: "Resources", body: "Save links you use often." }],
  },
  {
    id: "account",
    title: "Create an account, sign in, or sync devices",
    summary: "Open Settings → Account, or the cloud button at the bottom of the sidebar. Accounts are optional: sign in with an email code or a password, then choose Protect this workspace to keep versions in the cloud.",
    keywords: ["account", "sign", "login", "signup", "register", "sync", "cloud", "device", "email", "password", "protect"],
    settingsTab: "account",
  },
  {
    id: "ai-settings",
    title: "Turn on AI features",
    summary: "Open Settings → Advanced and expand AI and provider settings. Choose AXOM Cloud AI (Claude through your account, no key needed), Local AI with Ollama, or Demo mode.",
    keywords: ["ai", "claude", "ollama", "provider", "enable", "turn", "model", "key", "cloud"],
    settingsTab: "ai",
  },
  {
    id: "backup",
    title: "Back up or restore your data",
    summary: "Settings → Emergency recovery exports a portable backup and restores verified automatic snapshots. Your workspace otherwise saves on this device as you work.",
    keywords: ["backup", "restore", "export", "snapshot", "recovery", "data", "lost", "save", "transfer"],
    settingsTab: "backup",
  },
  {
    id: "appearance",
    title: "Change the theme or appearance",
    summary: "Settings → Appearance changes the theme and visual style. The sidebar also has a quick theme switch.",
    keywords: ["theme", "dark", "light", "appearance", "color", "font", "style", "mode"],
    settingsTab: "appearance",
  },
  {
    id: "dashboard-widgets",
    title: "Choose which Dashboard widgets appear",
    summary: "Settings → Personalization → Dashboard chooses which widgets appear on your Dashboard.",
    keywords: ["widget", "dashboard", "customize", "layout", "hide", "show"],
    settingsTab: "dashboard",
  },
  {
    id: "daily-rhythm",
    title: "Reminders, check-ins and the clock",
    summary: "Settings → Personalization → Daily rhythm sets reminders, lock-in check-ins and the clock.",
    keywords: ["reminder", "notification", "clock", "timezone", "rhythm", "alarm", "checkin"],
    settingsTab: "rhythm",
  },
  {
    id: "sidebar",
    title: "Show or hide sidebar sections",
    summary: "The customize control at the top of the sidebar subscribes to or hides sections. You can restore them at any time.",
    keywords: ["sidebar", "menu", "hide", "show", "section", "customize", "navigation"],
    steps: [{ route: "dashboard", target: "control-surface-menu", title: "Customize the sidebar", body: "Use this control to show or hide sections." }],
  },
  {
    id: "updates",
    title: "Check for app updates",
    summary: "Settings → Advanced → App updates checks for a new version. AXOM saves a recovery snapshot before it installs one.",
    keywords: ["update", "version", "upgrade", "new", "release", "install"],
    settingsTab: "advanced",
  },
  {
    id: "tour",
    title: "Replay the guided tour",
    summary: "The Help page can replay the seven-step guided tour of AXOM at any time.",
    keywords: ["tour", "tutorial", "intro", "onboarding", "walkthrough", "help"],
    steps: [{ route: "help", title: "Help", body: "Use Replay guided tour for the full walkthrough." }],
  },
  {
    id: "feedback",
    title: "Send feedback or report a bug",
    summary: "The Help page has Community and Feedback for bug reports and feature requests.",
    keywords: ["feedback", "bug", "report", "issue", "problem", "feature", "request", "contact"],
    steps: [{ route: "help", title: "Help", body: "Scroll to Community and Feedback to report a bug or request a feature." }],
  },
];

export function guideTopicById(id: string): GuideTopic | undefined {
  return GUIDE_TOPICS.find((topic) => topic.id === id);
}
