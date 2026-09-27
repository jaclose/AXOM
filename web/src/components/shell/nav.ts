// Navigation model — sidebar items + Alpha 2 grouping (Tools folder + order).
import type { LucideIcon } from "lucide-react";
import type { ExperimentalFlags } from "../../lib/types";
import {
  LayoutGrid, BookOpen, BadgeCheck, Brain, LineChart, Calendar, ListChecks,
  BookText, Share2, Library, Folder, Link, Wand2, LifeBuoy, ClipboardCheck, Trophy, Compass, Info, CalendarCheck,
  HelpCircle, BookOpenCheck, WholeWord, Stethoscope, Gamepad2, Blocks, AudioWaveform,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

export type ModuleStatus = "new" | "wip" | "under-construction";

export interface ModuleStatusMetadata {
  badgeLabel: string;
  accessibleLabel: string;
}

export interface ModuleStatusAssignment {
  status: ModuleStatus;
  /** Stable across deployments; changing it intentionally announces a new item. */
  announcementId?: string;
}

// One presentation vocabulary for module maturity across every sidebar mode.
export const MODULE_STATUS_META = {
  new: { badgeLabel: "NEW", accessibleLabel: "New" },
  wip: { badgeLabel: "WIP", accessibleLabel: "Work in progress" },
  "under-construction": { badgeLabel: "BUILDING", accessibleLabel: "Under construction" },
} as const satisfies Record<ModuleStatus, ModuleStatusMetadata>;

// All routable pages, keyed for lookup. Order here is not the sidebar order
// (that lives in the SIDEBAR_* groups below).
export const NAV = [
  { id: "dashboard", label: "Dashboard", subtitle: "Your command center at a glance", icon: LayoutGrid },
  { id: "courses", label: "Courses", subtitle: "Term-based course map with module-level folders", icon: BookOpen },
  { id: "tracker", label: "Course Tracker", subtitle: "Lecture, DLA, and PQ completion map", icon: BadgeCheck },
  { id: "questions", label: "Question Bank", subtitle: "Import Center, source library, question sets, blocks, and results", icon: HelpCircle },
  { id: "shared-set", label: "Shared Question Set", subtitle: "Preview and safely copy a private shared set", icon: HelpCircle },
  { id: "methods", label: "Study Methods", subtitle: "Evidence-informed technique templates with honest trade-offs", icon: BookOpenCheck },
  { id: "soundscapes", label: "Soundscapes", subtitle: "Synthesized study sound with live visuals and an honest listening log", icon: AudioWaveform },
  { id: "productivity", label: "Productivity", subtitle: "Study time, Anki cards, lecture blocks, day usefulness", icon: Calendar },
  { id: "journal", label: "Journal", subtitle: "Daily standups, intention follow-up, blockers, and tomorrow's plan", icon: BookText },
  { id: "reports", label: "Reports", subtitle: "Traceable statistics, energy, and performance vs. your goals", icon: LineChart },
  { id: "daily-games", label: "Daily Games", subtitle: "Short daily puzzles, status, and verified destinations", icon: Gamepad2 },
  { id: "daily-word", label: "Daily Word", subtitle: "A daily five-letter word puzzle.", icon: WholeWord },
  { id: "doctordle", label: "Doctordle", subtitle: "Open the verified independent daily diagnosis game", icon: Stethoscope },
  { id: "resources", label: "Resources", subtitle: "Saved hyperlinks for courses, boards, references, and tools", icon: Link },
  { id: "step", label: "USMLE / Shelf Prep", subtitle: "Step 1, Step 2, Step 3, shelf exams, and blueprint strategy", icon: Brain },
  { id: "step2", label: "Step 2 CK", subtitle: "Clinical reasoning blueprint and CK execution", icon: Brain },
  { id: "dedicated", label: "Dedicated Prep", subtitle: "Exam runway planning, assessments, and execution loops", icon: Brain },
  { id: "shelf", label: "Shelf Exams", subtitle: "Rotation subject exams and carry-forward repair", icon: Brain },
  { id: "step3", label: "Step 3", subtitle: "Independent practice, CCS, and longitudinal management", icon: Brain },
  { id: "premed", label: "Pre-Med / MCAT / DAT", subtitle: "Premed evidence, MCAT, DAT, CASPer, and application runway", icon: Compass },
  { id: "mcat", label: "MCAT", subtitle: "AAMC content spine, passages, CARS, and full-length repair", icon: Compass },
  { id: "dat", label: "DAT", subtitle: "Dental admission test blueprint and evidence-guided prep", icon: Compass },
  { id: "casper", label: "CASPer", subtitle: "Situational judgment practice and reflection evidence", icon: Compass },
  { id: "premed-log", label: "Experience Log", subtitle: "Pre-med activities, verification, evidence, and export", icon: Compass },
  { id: "appchecker", label: "Application Checker", subtitle: "Medical school research and saved review checks", icon: ClipboardCheck },
  // Tools folder
  { id: "tasks", label: "Tasks", subtitle: "Execute — open and completed work", icon: ListChecks },
  { id: "habits", label: "Habit Tracker", subtitle: "Calm, recovery-friendly habit tracking (experimental)", icon: CalendarCheck },
  { id: "anki", label: "Anki Lab", subtitle: "Turn lectures, DLAs & slides into Anki cards", icon: Wand2 },
  { id: "prompts", label: "Prompt Library", subtitle: "Reusable AI prompts for study workflows", icon: Library },
  { id: "integrations", label: "Integrations", subtitle: "Connect Anki, calendar, drives, and more", icon: Share2 },
  { id: "leaderboards", label: "Leaderboards", subtitle: "Personal weekly standings; friend groups planned", icon: Trophy },
  { id: "activity", label: "Activity History", subtitle: "Full local study ledger with filters and export", icon: Calendar },
  // After Tools
  { id: "about", label: "About", subtitle: "What AXOM is, where it is headed, and the live project preview", icon: Info },
  { id: "folders", label: "Hub Folders", subtitle: "Your modular folders and shortcuts", icon: Folder },
  { id: "building", label: "Building", subtitle: "A transparent map of AXOM systems and planned concepts", icon: Blocks },
  // Footer (Help is a page; Settings + Account open the modal)
  { id: "help", label: "Help", subtitle: "Guided tour, master guide, Anki import, and feedback", icon: LifeBuoy },
] as const satisfies readonly NavItem[];

export type NavItemId = (typeof NAV)[number]["id"];

// Status assignments live beside the navigation model rather than being
// re-declared by each rendering mode or page.
export const MODULE_STATUS_BY_NAV_ID = {
  questions: { status: "new", announcementId: "question-bank-entry-v1" },
  methods: { status: "new", announcementId: "study-methods-library-v1" },
  "daily-word": { status: "new", announcementId: "daily-word-launch-v1" },
  "daily-games": { status: "new", announcementId: "daily-games-hub-v1" },
  building: { status: "new", announcementId: "building-preview-v1" },
  soundscapes: { status: "new", announcementId: "soundscapes-v1" },
  anki: { status: "wip" },
  habits: { status: "wip" },
  step: { status: "wip" },
  premed: { status: "wip" },
  integrations: { status: "wip" },
  appchecker: { status: "wip" },
  leaderboards: { status: "wip" },
} as const satisfies Partial<Record<NavItemId, ModuleStatusAssignment>>;

export function getNavModuleStatusAssignment(id: string): ModuleStatusAssignment | undefined {
  return MODULE_STATUS_BY_NAV_ID[id as keyof typeof MODULE_STATUS_BY_NAV_ID];
}

export function getNavModuleStatus(id: string): ModuleStatus | undefined {
  return getNavModuleStatusAssignment(id)?.status;
}

export function getNavAnnouncementId(id: string): string | undefined {
  return getNavModuleStatusAssignment(id)?.announcementId;
}

export const navById = (id: string): NavItem | undefined => NAV.find((n) => n.id === id);

// Sidebar order (Alpha 2). Tools is a collapsible folder.
export const SIDEBAR_TODAY = ["dashboard"] as const;
export const SIDEBAR_LEARN = ["courses", "tracker", "questions", "anki"] as const;
export const SIDEBAR_REVIEW = ["productivity", "journal", "reports"] as const;
export const SIDEBAR_TOP = [...SIDEBAR_TODAY, ...SIDEBAR_LEARN, ...SIDEBAR_REVIEW];
export const SIDEBAR_PREP = ["step", "premed", "appchecker"];
export const SIDEBAR_TOOLS = ["tasks", "habits", "soundscapes", "methods", "resources", "prompts", "integrations", "leaderboards"];
export const SIDEBAR_BOTTOM = ["folders", "building"];
// Dashboard can't be hidden; everything else is subscribe/unsubscribe-able.
export const SIDEBAR_LOCKED = new Set(["dashboard"]);

export const DAILY_GAMES_ROUTE_IDS = ["daily-games", "daily-word", "doctordle"] as const satisfies readonly NavItemId[];
export type DailyGamesRouteId = (typeof DAILY_GAMES_ROUTE_IDS)[number];

/** Optional-folder metadata stays beside the rest of the navigation model. */
export const DAILY_GAMES_FOLDER = {
  id: "daily-games",
  label: "Daily Games",
  description: "Daily puzzles with clear local and external boundaries.",
  icon: Gamepad2,
  featureFlag: "dailyGames",
  toggleId: "sidebar-daily-games-toggle",
  regionId: "sidebar-daily-games-items",
  routes: DAILY_GAMES_ROUTE_IDS,
} as const satisfies {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  featureFlag: keyof ExperimentalFlags;
  toggleId: string;
  regionId: string;
  routes: readonly NavItemId[];
};

export function isDailyGamesEnabled(flags: ExperimentalFlags | undefined): boolean {
  return flags?.[DAILY_GAMES_FOLDER.featureFlag] === true;
}

export function isDailyGamesRoute(id: string): id is DailyGamesRouteId {
  return (DAILY_GAMES_ROUTE_IDS as readonly string[]).includes(id);
}
