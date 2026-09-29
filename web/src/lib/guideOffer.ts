// Remembers, per device, whether the 8-stop guide has been offered. A UI
// courtesy, not workspace data, so it lives in localStorage (never synced).
//   pending  -> offer after the Promise flow settles
//   snoozed  -> "Later": offer once more after the learner has scrolled a bit
//   declined -> "Later" twice; Help and Settings keep "Replay tour"
//   taken    -> the tour started
export type GuideOfferState = "pending" | "snoozed" | "declined" | "taken";

const KEY = "axom.guideOffer.v1";
/** Cumulative scroll (px) after a "Later" before the one re-offer. */
export const GUIDE_REOFFER_SCROLL_PX = 900;

export function readGuideOffer(): GuideOfferState {
  try {
    const value = localStorage.getItem(KEY);
    return value === "snoozed" || value === "declined" || value === "taken" ? value : "pending";
  } catch {
    return "declined"; // storage blocked: never nag
  }
}

export function writeGuideOffer(state: GuideOfferState): void {
  try { localStorage.setItem(KEY, state); } catch { /* storage blocked */ }
}

/** Next state after "Later": the first Later snoozes, the second declines. */
export function afterLater(state: GuideOfferState): GuideOfferState {
  return state === "pending" ? "snoozed" : "declined";
}
