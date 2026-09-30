// Guided-tour resume state (per tab). First-run setup keeps its own draft in
// lib/setupPlan.ts.
export type OnboardingMode = "first-run" | "rerun";
export type OnboardingDestination = "dashboard" | "tracker" | "questions";

export const TOUR_PROGRESS_KEY = "axom.guided-tour-step.v1";

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserSessionStorage(): SessionStore | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readTourStep(
  total: number,
  storage: Pick<Storage, "getItem"> | undefined = browserSessionStorage(),
): number {
  if (!storage || total <= 0) return 0;
  try {
    const value = Number(storage.getItem(TOUR_PROGRESS_KEY));
    return Number.isInteger(value) && value >= 0 && value < total ? value : 0;
  } catch {
    return 0;
  }
}

export function writeTourStep(
  step: number,
  storage: Pick<Storage, "setItem"> | undefined = browserSessionStorage(),
) {
  try {
    if (Number.isInteger(step) && step >= 0) storage?.setItem(TOUR_PROGRESS_KEY, String(step));
  } catch {
    // Best effort.
  }
}

export function clearTourProgress(
  storage: Pick<Storage, "removeItem"> | undefined = browserSessionStorage(),
) {
  try {
    storage?.removeItem(TOUR_PROGRESS_KEY);
  } catch {
    // Best effort.
  }
}
