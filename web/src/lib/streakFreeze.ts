export const STARTER_STREAK_FREEZES = 2;
export const FREEZE_REFILL_EARNED_DAYS = 2;

/** Each pair of earned days restores one spent shield, up to the visible cap. */
export function advanceRefill(freezesLeft: number, progress: number): { freezesLeft: number; progress: number; refilled: boolean } {
  const next = progress + 1;
  if (next < FREEZE_REFILL_EARNED_DAYS) return { freezesLeft, progress: next, refilled: false };
  return {
    freezesLeft: Math.min(STARTER_STREAK_FREEZES, freezesLeft + 1),
    progress: 0,
    refilled: freezesLeft < STARTER_STREAK_FREEZES,
  };
}

export function safeFreezeCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(0, Math.min(STARTER_STREAK_FREEZES, value))
    : STARTER_STREAK_FREEZES;
}

export function safeRefillProgress(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < FREEZE_REFILL_EARNED_DAYS
    ? value : 0;
}
