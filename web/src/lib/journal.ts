// Standup / journal status helpers. A "standup" is a journal entry for a given
// calendar day. These compute when today's standup is due on the dashboard, when
// the window has lapsed (missed), and which recent active days can be remediated.
import type { DayPlan, JournalEntry, AxomState } from "./types";
import { isoDate } from "./scoring";

// The standup prompt is visible on the dashboard from the user's review time for
// this many hours, then it disappears and the day becomes "missed".
export const STANDUP_WINDOW_HOURS = 10;
// How far back we offer remediation for active days with no standup.
export const STANDUP_LOOKBACK_DAYS = 10;

export type StandupStatus = "before" | "due" | "missed" | "done";

/** The local calendar day a journal entry belongs to. */
export function entryDayKey(entry: JournalEntry): string {
  const date = new Date(entry.date);
  return Number.isNaN(date.getTime()) ? entry.date.slice(0, 10) : isoDate(date);
}

export function standupDays(journal: JournalEntry[]): Set<string> {
  return new Set(journal.map(entryDayKey));
}

function parseReviewTime(value: string | undefined): { h: number; m: number } {
  const match = (value ?? "20:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { h: 20, m: 0 };
  return { h: Math.min(23, Number(match[1])), m: Math.min(59, Number(match[2])) };
}

function dayHadActivity(state: Pick<AxomState, "logs" | "dayPlans">, key: string): boolean {
  if (state.logs.some((log) => log.dayKey === key && (log.minutes !== 0 || log.cards !== 0))) return true;
  if (state.dayPlans.some((plan) => plan.dayKey === key)) return true;
  return false;
}

/** Today's standup status, given the user's review time + a clock. */
export function standupStatusToday(
  state: Pick<AxomState, "journal" | "profile">,
  now: Date = new Date(),
): StandupStatus {
  const todayKey = isoDate(now);
  if (standupDays(state.journal).has(todayKey)) return "done";
  const { h, m } = parseReviewTime(state.profile.journalReviewTime);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  if (now < start) return "before";
  const end = new Date(start);
  end.setTime(start.getTime() + STANDUP_WINDOW_HOURS * 3600 * 1000);
  return now > end ? "missed" : "due";
}

/**
 * Recent days (most recent first) that had real activity but no standup — the
 * set the user can still go back and remediate.
 */
export function missedStandupDays(
  state: Pick<AxomState, "journal" | "logs" | "dayPlans">,
  todayKey: string = isoDate(new Date()),
  lookback: number = STANDUP_LOOKBACK_DAYS,
): string[] {
  const done = standupDays(state.journal);
  const today = new Date(`${todayKey}T00:00:00`);
  const out: string[] = [];
  for (let i = 1; i <= lookback; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = isoDate(date);
    if (done.has(key)) continue;
    if (dayHadActivity(state, key)) out.push(key);
  }
  return out;
}

/** The intention that was set for a given day, if any (for read-only carry-over). */
export function planForDay(dayPlans: DayPlan[], key: string): DayPlan | undefined {
  return dayPlans.find((plan) => plan.dayKey === key);
}

/** A local "did you do what you set out to do?" reflection from the day's plan. */
export function reflectionPrompts(plan: DayPlan | undefined): string[] {
  if (!plan || !plan.intention.trim()) {
    return [
      "What actually got done on this day — be specific?",
      "What slipped, and what was the real reason?",
      "What is the one thing tomorrow that protects the floor?",
    ];
  }
  const intention = plan.intention.trim();
  const prompts = [`Did you do what you set out to do — “${intention}”?`];
  if (plan.wins.length) prompts.push(`Of your win conditions (${plan.wins.join("; ")}), which held and which didn't?`);
  prompts.push("What got in the way, and was it avoidable?");
  prompts.push("What's the single most useful carry-forward into tomorrow?");
  return prompts;
}
