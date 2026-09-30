import { STORAGE_KEYS } from "./brand";
import { isoDate } from "./scoring";
import { isWithinDailyLoopQuietHours } from "./dailyLoopReminders";
import type { DailyLoopReminderPreferences } from "./types";

/**
 * "Are you locked in?" — an optional, interval-based focus check-in.
 *
 * Preferences live in the profile (so they follow a learner across devices
 * and backups). Delivery bookkeeping is device-only and contains timestamps
 * and counts, never study content.
 */
export type FocusCheckInScope = "focus" | "anytime";
export type FocusCheckInTone = "gentle" | "coach" | "intense";
export type FocusCheckInResponse = "locked-in" | "drifted" | "break";

export interface FocusCheckInPreferences {
  enabled?: boolean;
  /** Minutes between check-ins. */
  intervalMinutes?: number;
  /** "focus": only during a running focus sprint or study session. "anytime": whenever AXOM is open. */
  scope?: FocusCheckInScope;
  /** Also send an OS notification when AXOM is in the background (needs permission). */
  systemNotifications?: boolean;
  /** Honor the daily-rhythm quiet hours. */
  respectQuietHours?: boolean;
  tone?: FocusCheckInTone;
  /** Vary each interval by up to ±30% so check-ins can't be anticipated. */
  varyTiming?: boolean;
}

export const FOCUS_CHECKIN_INTERVALS = [10, 15, 20, 25, 30, 45, 60, 90, 120] as const;

export const DEFAULT_FOCUS_CHECKIN: Readonly<Required<FocusCheckInPreferences>> = {
  enabled: false,
  intervalMinutes: 30,
  scope: "focus",
  systemNotifications: false,
  respectQuietHours: true,
  tone: "coach",
  varyTiming: false,
};

export function normalizeFocusCheckInPreferences(value: unknown): Required<FocusCheckInPreferences> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const interval = Number(record.intervalMinutes);
  return {
    enabled: record.enabled === true,
    intervalMinutes: Number.isFinite(interval) ? Math.min(240, Math.max(5, Math.round(interval))) : DEFAULT_FOCUS_CHECKIN.intervalMinutes,
    scope: record.scope === "anytime" ? "anytime" : "focus",
    systemNotifications: record.systemNotifications === true,
    respectQuietHours: record.respectQuietHours !== false,
    tone: record.tone === "gentle" || record.tone === "intense" ? record.tone : "coach",
    varyTiming: record.varyTiming === true,
  };
}

// ---------------------------------------------------------------------------
// Device ledger
// ---------------------------------------------------------------------------

export interface FocusCheckInLedger {
  day: string;
  /** When the current eligible stretch began (focus started / app opened). */
  armedAt?: string;
  lastPromptAt?: string;
  lastResponseAt?: string;
  snoozedUntil?: string;
  prompts: number;
  lockedIn: number;
  drifted: number;
  breaks: number;
  /** Consecutive locked-in answers today — used for encouragement copy. */
  streak: number;
}

export function emptyFocusLedger(day: string): FocusCheckInLedger {
  return { day, prompts: 0, lockedIn: 0, drifted: 0, breaks: 0, streak: 0 };
}

function validIso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(10_000, Math.floor(number)) : 0;
}

export function parseFocusLedger(raw: string | null, day: string): FocusCheckInLedger {
  try {
    const record = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!record || record.day !== day) return emptyFocusLedger(day);
    return {
      day,
      armedAt: validIso(record.armedAt),
      lastPromptAt: validIso(record.lastPromptAt),
      lastResponseAt: validIso(record.lastResponseAt),
      snoozedUntil: validIso(record.snoozedUntil),
      prompts: count(record.prompts),
      lockedIn: count(record.lockedIn),
      drifted: count(record.drifted),
      breaks: count(record.breaks),
      streak: count(record.streak),
    };
  } catch {
    return emptyFocusLedger(day);
  }
}

type LedgerStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LedgerStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export const focusCheckInLedger = {
  read(day: string, storage: LedgerStorage | undefined = defaultStorage()): FocusCheckInLedger {
    try { return parseFocusLedger(storage?.getItem(STORAGE_KEYS.focusCheckIns) ?? null, day); } catch { return emptyFocusLedger(day); }
  },
  write(ledger: FocusCheckInLedger, storage: LedgerStorage | undefined = defaultStorage()): FocusCheckInLedger {
    try { storage?.setItem(STORAGE_KEYS.focusCheckIns, JSON.stringify(ledger)); } catch { /* device-only, best effort */ }
    return ledger;
  },
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface FocusCheckInContext {
  now: Date;
  preferences: Required<FocusCheckInPreferences>;
  ledger: FocusCheckInLedger;
  /** A Pomodoro focus sprint is running or a study session is active. */
  focusActive: boolean;
  quietHours?: Partial<DailyLoopReminderPreferences>;
}

export type FocusCheckInDecision =
  | { kind: "idle"; ledger: FocusCheckInLedger; reason: "disabled" | "not-focused" | "quiet-hours" | "snoozed" | "waiting" }
  | { kind: "prompt"; ledger: FocusCheckInLedger };

/**
 * Pure scheduler. Returns the (possibly re-armed) ledger and whether a prompt
 * is due now. The interval counts from the latest of: when the eligible
 * stretch began, the last prompt, and the last answer.
 */
export function evaluateFocusCheckIn(context: FocusCheckInContext): FocusCheckInDecision {
  const day = isoDate(context.now);
  let ledger = context.ledger.day === day ? context.ledger : emptyFocusLedger(day);
  const { preferences, now } = context;
  if (!preferences.enabled) return { kind: "idle", ledger: { ...ledger, armedAt: undefined }, reason: "disabled" };
  const eligible = preferences.scope === "anytime" || context.focusActive;
  if (!eligible) return { kind: "idle", ledger: { ...ledger, armedAt: undefined }, reason: "not-focused" };
  if (!ledger.armedAt) ledger = { ...ledger, armedAt: now.toISOString() };
  if (preferences.respectQuietHours && isWithinDailyLoopQuietHours(now, context.quietHours)) {
    return { kind: "idle", ledger, reason: "quiet-hours" };
  }
  if (ledger.snoozedUntil && Date.parse(ledger.snoozedUntil) > now.getTime()) {
    return { kind: "idle", ledger, reason: "snoozed" };
  }
  const anchors = [ledger.armedAt, ledger.lastPromptAt, ledger.lastResponseAt, ledger.snoozedUntil]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value) && value <= now.getTime());
  const anchor = anchors.length ? Math.max(...anchors) : now.getTime();
  const due = now.getTime() - anchor >= effectiveIntervalMinutes(preferences, ledger) * 60_000;
  return due ? { kind: "prompt", ledger } : { kind: "idle", ledger, reason: "waiting" };
}

/**
 * The interval for the next check-in. With varyTiming, a deterministic
 * per-prompt factor in [0.7, 1.3] (seeded by the day and prompt count) keeps
 * probes unpredictable, as in experience-sampling research, while staying
 * stable across reloads and never shorter than 5 minutes.
 */
export function effectiveIntervalMinutes(preferences: Required<FocusCheckInPreferences>, ledger: Pick<FocusCheckInLedger, "day" | "prompts">): number {
  if (!preferences.varyTiming) return preferences.intervalMinutes;
  let hash = 0x811c9dc5;
  for (const char of `${ledger.day}#${ledger.prompts}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const factor = 0.7 + ((hash % 1000) / 999) * 0.6;
  return Math.max(5, Math.round(preferences.intervalMinutes * factor));
}

export function markPrompted(ledger: FocusCheckInLedger, now: Date): FocusCheckInLedger {
  return { ...ledger, lastPromptAt: now.toISOString(), snoozedUntil: undefined, prompts: ledger.prompts + 1 };
}

export function recordResponse(ledger: FocusCheckInLedger, response: FocusCheckInResponse, now: Date): FocusCheckInLedger {
  return {
    ...ledger,
    lastResponseAt: now.toISOString(),
    lockedIn: ledger.lockedIn + (response === "locked-in" ? 1 : 0),
    drifted: ledger.drifted + (response === "drifted" ? 1 : 0),
    breaks: ledger.breaks + (response === "break" ? 1 : 0),
    streak: response === "locked-in" ? ledger.streak + 1 : response === "drifted" ? 0 : ledger.streak,
  };
}

export function snooze(ledger: FocusCheckInLedger, minutes: number, now: Date): FocusCheckInLedger {
  return { ...ledger, snoozedUntil: new Date(now.getTime() + minutes * 60_000).toISOString() };
}

// ---------------------------------------------------------------------------
// Copy — deterministic per prompt so StrictMode/rerenders never reshuffle.
// ---------------------------------------------------------------------------

export interface FocusProgressHint {
  /** e.g. "18 min left in this sprint" */
  sprint?: string;
  /** Explicitly a target, never a running countdown. */
  target?: string;
  /** All eligible study goals met. */
  targetsMet?: boolean;
}

const PROMPT_LINES: Record<FocusCheckInTone, readonly string[]> = {
  gentle: [
    "How is your focus holding up?",
    "A quick pulse check. Where’s your attention?",
    "Still with the material?",
    "Is this still the task you meant to do?",
    "A quiet check. Still here?",
    "Do you need a pause, or another few minutes?",
  ],
  coach: [
    "Quick check. Still on the work?",
    "Is your attention where you put it?",
    "Honest answer: are you on task right now?",
    "Still working on what matters next?",
    "Is the next step clear?",
    "One check before you continue.",
  ],
  intense: [
    "Eyes up. Are you actually working?",
    "Status report. Locked in or drifting?",
    "Are you moving the task forward?",
    "Check your attention. Then continue.",
    "On task, or time to reset?",
  ],
};

const LOCKED_IN_LINES: Record<FocusCheckInTone, readonly string[]> = {
  gentle: ["One good block at a time.", "Stay with the question in front of you.", "Keep a pace you can return to.", "Let this be a useful hour.", "There is room to think carefully.", "A little more clarity than before.", "Give the difficult part some time.", "Keep your attention close."],
  coach: ["Make this one count.", "Put in a clean session.", "Build the day.", "Do the work worth remembering.", "Make the next hour useful.", "Leave one question clearer.", "Finish the thought you started.", "Keep moving.", "Put your attention where it matters.", "A clear next step is enough."],
  intense: ["Stay on the work.", "Follow the question all the way through.", "Close the loop.", "Keep the standard precise.", "Give the hard part your full attention.", "Turn the next page with a reason.", "Bring the work into focus.", "One task. Your full attention."],
};

const DRIFTED_LINES: Record<FocusCheckInTone, readonly string[]> = {
  gentle: [
    "No judgment. One breath, one tab closed, one question.",
    "It happens. Come back gently. Start with something small.",
    "Choose one small place to begin again.",
    "A pause can help. Return when you are ready.",
  ],
  coach: [
    "No shame. Reset: close one tab, start one question.",
    "Noticing is the win. Now take the next small step.",
    "Name the next action, then take it.",
    "Pick up the last unfinished thought.",
  ],
  intense: [
    "Reset your attention. Start the next question.",
    "Drift noted. Reset and get back in.",
    "Make the next action specific.",
    "Clear one distraction. Resume one task.",
  ],
};

const BREAK_LINES: readonly string[] = [
  "Good. Rest is part of the protocol.",
  "Enjoy it. Stand up, drink water, look far away.",
  "Break well. I’ll check back in later.",
  "Let the break be a break.",
  "Leave the task somewhere easy to return to.",
  "Take the space you need.",
];

function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

export function promptLine(tone: FocusCheckInTone, seed: number): string {
  return pick(PROMPT_LINES[tone], seed);
}

/** The reply after an answer; progress-aware when AXOM knows what's left. */
export function responseLine(
  response: FocusCheckInResponse,
  tone: FocusCheckInTone,
  seed: number,
  progress: FocusProgressHint = {},
  streak = 0,
): string {
  if (response === "break") return pick(BREAK_LINES, seed);
  if (response === "drifted") return pick(DRIFTED_LINES[tone], seed);
  // Locked in: alternate between encouragement and "just this much to go".
  const specifics = [
    progress.target ? `${capitalize(progress.target)}.` : undefined,
    progress.sprint ? `${capitalize(progress.sprint)}.` : undefined,
    progress.targetsMet ? "Your study goals are already met." : undefined,
    streak >= 3 ? `${streak} check-ins locked in today.` : undefined,
  ].filter((line): line is string => Boolean(line));
  if (specifics.length && seed % 2 === 0) return pick(specifics, seed >>> 1);
  return pick(LOCKED_IN_LINES[tone], seed);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function lockedInRate(ledger: FocusCheckInLedger): number | null {
  const answered = ledger.lockedIn + ledger.drifted;
  return answered ? Math.round((ledger.lockedIn / answered) * 100) : null;
}
