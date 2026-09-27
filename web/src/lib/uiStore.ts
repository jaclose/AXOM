import { create } from "zustand";
import type { GuideStep } from "./guide/topics";

// Ephemeral (non-persisted) UI state. Used to hand a "focus this tracker item"
// request from a suggested-move click to the Course Tracker page, which then
// selects its scope, scrolls to it, and briefly highlights it.
interface UiState {
  focusItemId: string | null;
  focusItem: (id: string) => void;
  clearFocus: () => void;
  // A day the Journal page should open a standup editor for (remediation).
  journalDay: string | null;
  remediateStandup: (dayKey: string) => void;
  clearJournalDay: () => void;
  // A page-initiated request to open the Settings modal on a given tab.
  settingsRequest: string | null;
  requestSettings: (tab: string) => void;
  clearSettingsRequest: () => void;
  // Settings can request the non-destructive onboarding rerun without changing
  // the persisted `profile.onboarded` completion flag.
  onboardingRequested: boolean;
  requestOnboarding: () => void;
  clearOnboardingRequest: () => void;
  // One-shot handoff from the app-root reminder watcher to Dashboard.
  dailyLoopRequest: { kind: "check-in" | "closeout"; dayKey: string } | null;
  requestDailyLoop: (kind: "check-in" | "closeout", dayKey: string) => void;
  clearDailyLoopRequest: () => void;
  // The AXOM Guide: its question panel, and the pointer walking a topic (the
  // id remounts the pointer when a new walk starts).
  guideOpen: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  guideRun: { id: number; steps: readonly GuideStep[] } | null;
  startGuide: (steps: readonly GuideStep[]) => void;
  stopGuide: () => void;
}

export const useUi = create<UiState>((set) => ({
  focusItemId: null,
  focusItem: (id) => set({ focusItemId: id }),
  clearFocus: () => set({ focusItemId: null }),
  journalDay: null,
  remediateStandup: (dayKey) => set({ journalDay: dayKey }),
  clearJournalDay: () => set({ journalDay: null }),
  settingsRequest: null,
  requestSettings: (tab) => set({ settingsRequest: tab }),
  clearSettingsRequest: () => set({ settingsRequest: null }),
  onboardingRequested: false,
  requestOnboarding: () => set({ onboardingRequested: true }),
  clearOnboardingRequest: () => set({ onboardingRequested: false }),
  dailyLoopRequest: null,
  requestDailyLoop: (kind, dayKey) => set({ dailyLoopRequest: { kind, dayKey } }),
  clearDailyLoopRequest: () => set({ dailyLoopRequest: null }),
  guideOpen: false,
  openGuide: () => set({ guideOpen: true }),
  closeGuide: () => set({ guideOpen: false }),
  guideRun: null,
  startGuide: (steps) => set((state) => ({ guideOpen: false, guideRun: { id: (state.guideRun?.id ?? 0) + 1, steps } })),
  stopGuide: () => set({ guideRun: null }),
}));

/** Open setup in rerun mode without making App mistake it for first launch. */
export function requestOnboardingRerun() {
  useUi.getState().requestOnboarding();
}

/** Navigate to the Course Tracker focused on a specific item. */
export function gotoTrackerItem(id: string) {
  useUi.getState().focusItem(id);
  location.hash = "tracker";
}

/** Navigate to the Journal to write/remediate the standup for a given day. */
export function gotoJournalDay(dayKey: string) {
  useUi.getState().remediateStandup(dayKey);
  location.hash = "journal";
}
