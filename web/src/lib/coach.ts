// Coach marks (JD, Ideas 1): after the guide, AXOM points at one thing at a
// time. "Overwhelmed?" appears once, pointing at Customize; after that each
// page may show one small hint the first time its target scrolls into view.
// The rules follow Apple's TipKit: every hint shows at most once, there is a
// global gap between hints, and a hint is dropped the moment the learner has
// already done what it would teach. A UI courtesy, so it lives in
// localStorage per device, like the guide offer.
import { useSoundscape } from "./soundscapes/store";
import { useStore } from "./store";

const KEY = "axom.coach.v1";

/** Sidebar listens for this and opens Customize ("Overwhelmed?" -> Show me). */
export const CUSTOMIZE_SIDEBAR_EVENT = "axom:customize-sidebar";
/** Help dispatches this after resetting page hints, so the coach re-reads its ledger. */
export const COACH_RESET_EVENT = "axom:coach-reset";

export const OVERWHELMED_ID = "overwhelmed";
/** Visible time in the app (after the guide and the Promise) before "Overwhelmed?". */
export const OVERWHELMED_AFTER_MS = 90_000;
/** Minimum time between any two coach marks, so page-hopping never becomes a tour. */
export const COACH_GAP_MS = 3 * 60_000;
/** How long a page must be open, and its target visible, before its hint shows. */
export const HINT_PAGE_SETTLE_MS = 1_500;
export const HINT_DWELL_MS = 700;

export interface CoachLedger {
  /** Coach marks already shown. */
  seen: string[];
  /** When the last one appeared (ms since epoch). */
  lastShownAt?: number;
  /** "No more hints" from a hint bubble; Help turns them back on. */
  off?: boolean;
}

export interface PageHint {
  id: string;
  route: string;
  /** CSS selector for the element the hint points at. */
  target: string;
  title: string;
  body: string;
  /** True once the learner has already done the thing (TipKit invalidation). */
  done?: () => boolean;
}

/** One hint per page, only where a first-timer most often stalls. */
export const PAGE_HINTS: readonly PageHint[] = [
  {
    id: "dashboard-edit",
    route: "dashboard",
    target: ".dashboard-edit-toggle",
    title: "Make this dashboard yours",
    body: "Move, resize or hide any widget. Hidden widgets keep their data.",
    done: () => useStore.getState().profile.dashboardLayout?.preset === "custom",
  },
  {
    id: "tracker-import",
    route: "tracker",
    target: "[data-module-tour=\"tracker-import-add\"] > :first-child",
    title: "Start with your lecture list",
    body: "Paste or import it once. Every pass you log fills in progress from there.",
    done: () => useStore.getState().tracker.some((item) => !/^example(?:[:\s]|$)/i.test(item.label.trim())),
  },
  {
    id: "questions-import",
    route: "questions",
    target: "[data-module-tour=\"qb-import\"] .qb-cta.primary",
    title: "Bring your questions in",
    body: "Drop a file or paste text. You confirm anything the importer is unsure of before it counts.",
    done: () => useStore.getState().questions.length > 0,
  },
  {
    id: "productivity-targets",
    route: "productivity",
    target: "[data-tour=\"requirements\"] > summary",
    title: "Decide what makes a day count",
    body: "Pick one to three targets. AXOM scores only what you choose.",
    done: () => Boolean(useStore.getState().profile.dailySuccess?.requirements.some((item) => item.enabled)),
  },
  {
    id: "soundscapes-pin",
    route: "soundscapes",
    target: ".soundscape-hero .soundscape-pin",
    title: "Pin the sounds you like",
    body: "Pinned sounds lead the quick picks on your dashboard.",
    done: () => useSoundscape.getState().pinned.length > 0,
  },
];

export function readCoachLedger(): CoachLedger {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CoachLedger> | null;
    return {
      seen: Array.isArray(raw?.seen) ? raw.seen.filter((id): id is string => typeof id === "string") : [],
      lastShownAt: typeof raw?.lastShownAt === "number" && Number.isFinite(raw.lastShownAt) ? raw.lastShownAt : undefined,
      off: raw?.off === true || undefined,
    };
  } catch {
    return { seen: [OVERWHELMED_ID], off: true }; // storage blocked: never nag
  }
}

export function writeCoachLedger(ledger: CoachLedger): void {
  try { localStorage.setItem(KEY, JSON.stringify(ledger)); } catch { /* storage blocked */ }
}

export function markCoachShown(ledger: CoachLedger, id: string, now: number): CoachLedger {
  return { ...ledger, seen: [...new Set([...ledger.seen, id])], lastShownAt: now };
}

/** Help's "Show page hints again": page hints return; "Overwhelmed?" stays a one-off. */
export function resetPageHints(ledger: CoachLedger): CoachLedger {
  return { seen: ledger.seen.filter((id) => id === OVERWHELMED_ID) };
}

function inGap(ledger: CoachLedger, now: number): boolean {
  return ledger.lastShownAt !== undefined && now - ledger.lastShownAt < COACH_GAP_MS;
}

export function overwhelmedDue(ledger: CoachLedger, now: number): boolean {
  return !ledger.off && !ledger.seen.includes(OVERWHELMED_ID) && !inGap(ledger, now);
}

/** The hint this page may show now, if any. Page hints wait for "Overwhelmed?" to have had its moment. */
export function eligiblePageHint(route: string, ledger: CoachLedger, now: number, hints: readonly PageHint[] = PAGE_HINTS): PageHint | undefined {
  if (ledger.off || !ledger.seen.includes(OVERWHELMED_ID) || inGap(ledger, now)) return undefined;
  return hints.find((hint) => hint.route === route && !ledger.seen.includes(hint.id) && !hint.done?.());
}
