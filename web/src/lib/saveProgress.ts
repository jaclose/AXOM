// "Save your progress" (JD, Ideas 3 / Wave 2 P3): once a student without an
// account has saved something real, AXOM invites them, once and elegantly, to
// protect it with an account. Pure rules here; SaveProgressBanner renders.
// A UI courtesy, so the ledger lives in localStorage per device.
import type { AccountPhase } from "./account/accountStore";
import { isStarterTaskTitle } from "./starterContent";

const KEY = "axom.saveProgress.v1";
/** "Not now" the first time waits a week; the second time retires the banner to Settings. */
export const SAVE_PROGRESS_SNOOZE_DAYS = 7;

export type SaveProgressState = "pending" | "snoozed" | "retired" | "done";
export interface SaveProgressLedger { state: SaveProgressState; snoozedUntil?: string }

/** What counts as "your first bit of data": anything the student made, not our seed. */
export interface MeaningfulDataInput {
  logs: ReadonlyArray<{ minutes?: number; cards?: number; quantity?: number }>;
  questions: ReadonlyArray<unknown>;
  questionSets?: ReadonlyArray<unknown>;
  documents?: ReadonlyArray<unknown>;
  tracker: ReadonlyArray<{ label: string }>;
  journal: ReadonlyArray<{ rating?: string }>;
  dayPlans?: ReadonlyArray<unknown>;
  userSounds: number;
}

export function hasMeaningfulData(input: MeaningfulDataInput): boolean {
  if (input.logs.some((log) => (log.minutes ?? 0) > 0 || (log.cards ?? 0) > 0 || (log.quantity ?? 0) > 0)) return true;
  if (input.questions.length > 0 || (input.questionSets?.length ?? 0) > 0 || (input.documents?.length ?? 0) > 0) return true;
  if (input.userSounds > 0 || (input.dayPlans?.length ?? 0) > 0) return true;
  if (input.tracker.some((row) => !/^example(?:[:\s]|$)/i.test(row.label.trim()))) return true;
  // The signed Promise is the journal's first page, not the student's own entry.
  return input.journal.some((entry) => entry.rating !== "Promise");
}

export function shouldOfferSaveProgress(input: { phase: AccountPhase; meaningful: boolean; ledger: SaveProgressLedger; now?: Date }): boolean {
  if (input.phase !== "signed-out" || !input.meaningful) return false;
  const { ledger } = input;
  if (ledger.state === "retired" || ledger.state === "done") return false;
  if (ledger.state === "snoozed" && ledger.snoozedUntil) return (input.now ?? new Date()).getTime() >= Date.parse(ledger.snoozedUntil);
  return true;
}

export function afterNotNow(ledger: SaveProgressLedger, now: Date = new Date()): SaveProgressLedger {
  if (ledger.state === "snoozed") return { state: "retired" };
  return snoozed(now);
}

/** "Make an account" opens sign-up; if the student backs out, ask again in a week (signed in, it never shows). */
export function afterCreate(now: Date = new Date()): SaveProgressLedger {
  return snoozed(now);
}

function snoozed(now: Date): SaveProgressLedger {
  return { state: "snoozed", snoozedUntil: new Date(now.getTime() + SAVE_PROGRESS_SNOOZE_DAYS * 86_400_000).toISOString() };
}

export function readSaveProgress(): SaveProgressLedger {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SaveProgressLedger> | null;
    if (raw && (raw.state === "pending" || raw.state === "snoozed" || raw.state === "retired" || raw.state === "done")) {
      return { state: raw.state, snoozedUntil: typeof raw.snoozedUntil === "string" ? raw.snoozedUntil : undefined };
    }
  } catch { /* storage blocked: offer normally */ }
  return { state: "pending" };
}

export function writeSaveProgress(ledger: SaveProgressLedger): void {
  try { localStorage.setItem(KEY, JSON.stringify(ledger)); } catch { /* storage blocked */ }
}

/**
 * Stricter than the banner's test: may signing in replace this workspace with
 * the account's saved version? Only when nothing here is the student's own.
 * Anything uncertain keeps the choice with the student.
 */
export function deviceHasOwnWork(input: MeaningfulDataInput & {
  tasks?: ReadonlyArray<{ title: string }>;
  habitEntries?: ReadonlyArray<unknown>;
  closeouts?: ReadonlyArray<unknown>;
}): boolean {
  if (hasMeaningfulData(input)) return true;
  if ((input.habitEntries?.length ?? 0) > 0 || (input.closeouts?.length ?? 0) > 0) return true;
  return (input.tasks ?? []).some((task) => task.title.trim() && !isStarterTaskTitle(task.title));
}
