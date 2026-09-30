// Dependency-free so the always-loaded backup code can normalize these fields
// without pulling Daily Games code into the main bundle.
import type { DailyWordPuzzleState } from "./types";

/** Optional hint fields: absent when unused, so older records stay byte-identical. */
export function normalizeHintFields(value: Record<string, unknown>, completed: boolean, won: boolean): Pick<DailyWordPuzzleState, "hintsUsed" | "revealed"> {
  const raw = typeof value.hintsUsed === "number" && Number.isFinite(value.hintsUsed) ? Math.floor(value.hintsUsed) : 0;
  const hintsUsed = Math.min(3, Math.max(0, raw));
  const revealed = completed && !won && value.revealed === true;
  return { ...(hintsUsed ? { hintsUsed } : {}), ...(revealed ? { revealed: true } : {}) };
}
