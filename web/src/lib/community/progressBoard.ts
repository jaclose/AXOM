import type { CommunityPost } from "./community";
import type { StudyLog } from "../types";

/** Whether AXOM keeps a learner's daily totals shared without a manual post.
 * Stored on the account (user metadata) so every signed-in device agrees. */
export type ShareMode = "off" | "friends" | "community";
export const SHARE_MODE_KEY = "axom_community_share";
export type BoardScope = "friends" | "community";
export type BoardMetric = "minutes" | "questions" | "cards";
export interface DayTotals { minutes: number; cards: number; questions: number }
export interface BoardRow extends DayTotals {
  userId: string;
  /** Standard competition rank on the chosen metric: equal values share a rank. */
  rank: number;
  /** Shared days inside the period. */
  days: number;
  /** Today's shared totals, when today is shared. */
  today: DayTotals | null;
  /** Consecutive shared days ending today, or yesterday while today is still open. */
  streak: number;
  lastDay: string;
}

export function shareModeFrom(meta: unknown): ShareMode {
  const value = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[SHARE_MODE_KEY] : undefined;
  return value === "friends" || value === "community" ? value : "off";
}

/** One day's academic totals from the learner's own study logs. Only this aggregate
 * is ever shared; duplicate log IDs are ignored as in the personal leaderboard. */
export function dayProgress(logs: readonly StudyLog[], dayKey: string): DayTotals {
  const ids = new Set<string>();
  let minutes = 0, cards = 0, questions = 0;
  for (const log of logs) {
    if (log.dayKey !== dayKey || log.academic === false || ids.has(log.id)) continue;
    ids.add(log.id);
    if (Number.isFinite(log.minutes)) minutes += Math.max(0, log.minutes);
    if (Number.isFinite(log.cards)) cards += Math.max(0, log.cards);
    if (log.quantityKind === "questions" && Number.isFinite(log.quantity)) questions += Math.max(0, log.quantity ?? 0);
  }
  return { minutes: Math.min(1440, Math.round(minutes)), cards: Math.min(20000, Math.round(cards)), questions: Math.min(20000, Math.round(questions)) };
}

/** Calendar arithmetic on YYYY-MM-DD keys at local noon, so DST never skips a day. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/** Who competes: friends boards hold you and accepted friends; the community board
 * holds only days their owners shared with everyone. Private days never count. */
export function progressBoard(posts: readonly CommunityPost[], options: {
  scope: BoardScope; metric: BoardMetric; periodDays: number; today: string; me: string; friendIds: ReadonlySet<string>;
}): BoardRow[] {
  const periodDays = Math.max(1, Math.min(60, Math.round(options.periodDays)));
  const from = addDays(options.today, -(periodDays - 1));
  const sharedDays = new Map<string, Map<string, DayTotals>>();
  for (const post of posts) {
    if (post.kind !== "progress" || !post.activity_day || post.visibility === "private") continue;
    if (post.activity_day > options.today) continue;
    if (options.scope === "community" && post.visibility !== "community") continue;
    if (options.scope === "friends" && post.user_id !== options.me && !options.friendIds.has(post.user_id)) continue;
    const days = sharedDays.get(post.user_id) ?? new Map<string, DayTotals>();
    if (!days.has(post.activity_day)) days.set(post.activity_day, { minutes: post.minutes, cards: post.cards, questions: post.questions });
    sharedDays.set(post.user_id, days);
  }
  const rows: Omit<BoardRow, "rank">[] = [];
  for (const [userId, days] of sharedDays) {
    const inPeriod = [...days.entries()].filter(([day]) => day >= from);
    if (!inPeriod.length) continue;
    const totals = inPeriod.reduce((sum, [, value]) => ({
      minutes: sum.minutes + value.minutes, cards: sum.cards + value.cards, questions: sum.questions + value.questions,
    }), { minutes: 0, cards: 0, questions: 0 });
    let cursor = days.has(options.today) ? options.today : addDays(options.today, -1);
    let streak = 0;
    while (days.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
    rows.push({
      userId, ...totals, days: inPeriod.length, today: days.get(options.today) ?? null, streak,
      lastDay: inPeriod.map(([day]) => day).sort().at(-1)!,
    });
  }
  const order: BoardMetric[] = [options.metric, ...(["minutes", "questions", "cards"] as const).filter(item => item !== options.metric)];
  rows.sort((a, b) => {
    for (const key of order) if (b[key] !== a[key]) return b[key] - a[key];
    return b.days - a.days || a.userId.localeCompare(b.userId);
  });
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || rows[index - 1][options.metric] !== row[options.metric]) rank = index + 1;
    return { ...row, rank };
  });
}

/** "45 min" below an hour and a half, then hours with one decimal. */
export function formatBoardValue(value: number, metric: BoardMetric): string {
  if (metric === "minutes") return value < 90 ? `${Math.round(value)} min` : `${Number((value / 60).toFixed(1))} h`;
  return `${value.toLocaleString()} ${metric === "cards" ? (value === 1 ? "card" : "cards") : (value === 1 ? "question" : "questions")}`;
}
