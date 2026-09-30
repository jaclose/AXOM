import { create } from "zustand";

export type MediaSource = "spotify" | "soundscape" | "frequency" | "local";
export interface AxomMediaSession {
  id: string;
  source: MediaSource;
  title: string;
  subtitle: string;
  isPlaying: boolean;
  isBuffering?: boolean;
  currentTime?: number;
  duration?: number;
  /** A source identifier is not a track title. Metadata stays unknown until supplied. */
  playingURI?: string;
  updatedAt: number;
  controls: { play: () => void; pause: () => void; stop: () => void; open: () => void };
}

interface MediaState {
  sessions: Record<string, AxomMediaSession>;
  publish: (session: Omit<AxomMediaSession, "updatedAt">) => void;
  remove: (id: string) => void;
}

/** Transport adapters publish observed state; clicking Play never implies playback. */
export const useMediaSession = create<MediaState>((set) => ({
  sessions: {},
  publish: (session) => set((state) => ({ sessions: { ...state.sessions, [session.id]: { ...session, updatedAt: Date.now() } } })),
  remove: (id) => set((state) => ({ sessions: Object.fromEntries(Object.entries(state.sessions).filter(([key]) => key !== id)) })),
}));

export function activeMediaSession(sessions: Record<string, AxomMediaSession>): AxomMediaSession | undefined {
  return Object.values(sessions).sort((a, b) => Number(b.isPlaying) - Number(a.isPlaying) || b.updatedAt - a.updatedAt)[0];
}

export function pauseOtherMedia(id: string): void {
  for (const session of Object.values(useMediaSession.getState().sessions)) {
    if (session.id !== id && session.isPlaying) session.controls.pause();
  }
}
