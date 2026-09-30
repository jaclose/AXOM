// Sidebar meta for the daily games (JD, Ideas 3): time until the next puzzle
// and, for Daily Word, the current streak. Bundle-light on purpose: it imports
// the shell-safe stats selector, never the game or its dictionary.
import { Flame } from "lucide-react";
import { useClockNow } from "../../lib/clock";
import { deriveDailyWordStatsFromNormalizedHistory } from "../../lib/dailyWordStats";
import { useStore } from "../../lib/store";

/** Daily Word turns over at local midnight. */
export function msUntilLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Doctordle's own script numbers cases as whole days since
 * 2025-07-16T00:00:00-05:00 (doctordle.js, getTodaysDiseaseNumber), so a new
 * case lands at 05:00 UTC every day (1:00 AM in Grenada), not local midnight.
 */
export function msUntilDoctordle(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(5, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function compactCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}

export function DailyGameNavMeta({ id }: { id: string }) {
  if (id !== "daily-word" && id !== "doctordle") return null;
  return <GameMeta game={id} />;
}

function GameMeta({ game }: { game: "daily-word" | "doctordle" }) {
  const now = useClockNow("minute");
  const puzzles = useStore((state) => state.dailyWordPuzzles);
  const streak = game === "daily-word" ? deriveDailyWordStatsFromNormalizedHistory(puzzles).currentStreak : 0;
  const left = compactCountdown(game === "daily-word" ? msUntilLocalMidnight(now) : msUntilDoctordle(now));
  const title = `${game === "daily-word" ? "New word" : "New case"} in ${left}${streak ? ` · ${streak}-day streak` : ""}`;
  return (
    <span className="nav-game-meta" title={title} aria-hidden="true">
      {streak > 0 && <span className="nav-game-streak"><Flame size={11} /> {streak}</span>}
      <span>{left}</span>
    </span>
  );
}
