import { create } from "zustand";

/**
 * Ephemeral UI state for the live study session, shared by the focus dock
 * (which shows the session) and the session overlay (focus mode + the
 * closing capture). Not persisted: a reload returns to the normal view.
 */
interface SessionUiState {
  focusMode: boolean;
  capturing: boolean;
  setFocusMode: (value: boolean) => void;
  toggleFocusMode: () => void;
  openCapture: () => void;
  closeCapture: () => void;
}

export const useSessionUi = create<SessionUiState>((set) => ({
  focusMode: false,
  capturing: false,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  openCapture: () => set({ capturing: true }),
  closeCapture: () => set({ capturing: false }),
}));
