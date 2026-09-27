import { create } from "zustand";
import { SoundscapeEngine, soundscapesSupported, type OutputMode } from "./engine";
import { appendListeningInterval } from "./listeningLog";
import { SOUNDSCAPES, isSoundscapeId, versionOf, type SoundscapeId } from "./presets";

export type SoundscapeStatus = "idle" | "playing" | "paused";

interface Prefs {
  volume: number;
  output: OutputMode;
  followTimer: boolean;
  lastPresetId: SoundscapeId;
  /** The version chosen for each preset (defaults to the first). */
  versions: Partial<Record<SoundscapeId, string>>;
}

interface SoundscapeState extends Prefs {
  supported: boolean;
  status: SoundscapeStatus;
  presetId: SoundscapeId | null;
  /** Epoch ms when the stop timer ends playback (fades out). */
  stopAt?: number;
  error?: string;
  play: (id: SoundscapeId, options?: { stopAfterMinutes?: number | null; version?: string }) => Promise<void>;
  /** Choose a version; crossfades immediately when that preset is playing. */
  setVersion: (id: SoundscapeId, version: string) => void;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: (fadeSeconds?: number) => Promise<void>;
  setVolume: (volume: number) => void;
  setOutput: (output: OutputMode) => void;
  setFollowTimer: (value: boolean) => void;
  setStopAfter: (minutes: number | null) => void;
}

export const SOUNDSCAPE_PREFS_KEY = "axom.soundscapes.v1";
export const STOP_TIMER_CHOICES = [15, 20, 30, 45, 60, 90] as const;
const DEFAULT_PREFS: Prefs = { volume: 35, output: "headphones", followTimer: true, lastPresetId: "gamma-40", versions: {} };

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    return {
      volume: typeof raw?.volume === "number" && raw.volume >= 0 && raw.volume <= 100 ? raw.volume : DEFAULT_PREFS.volume,
      output: raw?.output === "speakers" ? "speakers" : "headphones",
      followTimer: typeof raw?.followTimer === "boolean" ? raw.followTimer : DEFAULT_PREFS.followTimer,
      lastPresetId: isSoundscapeId(raw?.lastPresetId) ? raw.lastPresetId : DEFAULT_PREFS.lastPresetId,
      versions: raw?.versions && typeof raw.versions === "object"
        ? Object.fromEntries(Object.entries(raw.versions).filter(([id, version]) => isSoundscapeId(id) && typeof version === "string"))
        : {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let engine: SoundscapeEngine | null = null;
/** Test seam: swap the audio engine (jsdom has no Web Audio). */
export function setSoundscapeEngineForTests(next: SoundscapeEngine | null): void {
  engine = next;
}
function getEngine(): SoundscapeEngine {
  engine ??= new SoundscapeEngine();
  return engine;
}

export function soundscapeAnalyser(): AnalyserNode | null {
  return engine?.analyserNode ?? null;
}

let stopTimer: ReturnType<typeof setTimeout> | undefined;
let openInterval: { presetId: SoundscapeId; start: string } | null = null;

function closeInterval(): void {
  if (!openInterval) return;
  appendListeningInterval({ ...openInterval, end: new Date().toISOString() });
  openInterval = null;
}

function openIntervalFor(presetId: SoundscapeId): void {
  closeInterval();
  openInterval = { presetId, start: new Date().toISOString() };
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", closeInterval);
}

function updateMediaSession(presetId: SoundscapeId | null, status: SoundscapeStatus): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    if (!presetId || status === "idle") {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    const preset = SOUNDSCAPES[presetId];
    navigator.mediaSession.metadata = new MediaMetadata({ title: preset.name, artist: "AXOM Soundscapes", album: preset.band });
    navigator.mediaSession.playbackState = status === "playing" ? "playing" : "paused";
    const store = useSoundscape.getState();
    navigator.mediaSession.setActionHandler("play", () => { void store.resume(); });
    navigator.mediaSession.setActionHandler("pause", () => { void store.pause(); });
    navigator.mediaSession.setActionHandler("stop", () => { void store.stop(); });
  } catch { /* Media Session is optional polish */ }
}

export const useSoundscape = create<SoundscapeState>((set, get) => {
  const persist = (patch: Partial<Prefs>) => {
    set(patch);
    const { volume, output, followTimer, lastPresetId, versions } = get();
    try {
      window.localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ volume, output, followTimer, lastPresetId, versions }));
    } catch { /* device preference only */ }
  };

  const armStopTimer = (stopAt?: number) => {
    clearTimeout(stopTimer);
    if (!stopAt) return;
    // A long, gentle fade — the sleep timer should never end with a click.
    stopTimer = setTimeout(() => { void get().stop(8); }, Math.max(0, stopAt - Date.now()));
  };

  return {
    ...readPrefs(),
    supported: typeof window !== "undefined" && soundscapesSupported(),
    status: "idle",
    presetId: null,

    async play(id, options = {}) {
      const preset = SOUNDSCAPES[id];
      const minutes = options.stopAfterMinutes === undefined ? preset.defaultStopMinutes : options.stopAfterMinutes ?? undefined;
      const keepTimer = get().status !== "idle" && options.stopAfterMinutes === undefined && !preset.defaultStopMinutes;
      const stopAt = keepTimer ? get().stopAt : minutes ? Date.now() + minutes * 60_000 : undefined;
      const versionId = versionOf(preset, options.version ?? get().versions[id]).id;
      try {
        await getEngine().play(preset, { volume: get().volume, output: get().output, versionId });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Audio couldn’t start." });
        return;
      }
      openIntervalFor(id);
      persist({ lastPresetId: id, versions: { ...get().versions, [id]: versionId } });
      set({ status: "playing", presetId: id, stopAt, error: undefined });
      armStopTimer(stopAt);
      updateMediaSession(id, "playing");
    },
    async toggle() {
      const { status, presetId, lastPresetId } = get();
      if (status === "playing") await get().pause();
      else if (status === "paused") await get().resume();
      else await get().play(presetId ?? lastPresetId);
    },
    async pause() {
      if (get().status !== "playing") return;
      closeInterval();
      await getEngine().pause();
      set({ status: "paused" });
      updateMediaSession(get().presetId, "paused");
    },
    async resume() {
      const { status, presetId } = get();
      if (status !== "paused" || !presetId) return;
      await getEngine().resume();
      openIntervalFor(presetId);
      set({ status: "playing" });
      updateMediaSession(presetId, "playing");
    },
    async stop(fadeSeconds) {
      if (get().status === "idle") return;
      closeInterval();
      clearTimeout(stopTimer);
      set({ status: "idle", stopAt: undefined });
      updateMediaSession(null, "idle");
      await getEngine().stop(fadeSeconds);
    },
    setVolume(volume) {
      persist({ volume });
      engine?.setVolume(volume);
    },
    setOutput(output) {
      persist({ output });
      const { status, presetId } = get();
      // Rebuild the graph for the new routing (a quick crossfade).
      if (status === "playing" && presetId) void get().play(presetId, { stopAfterMinutes: get().stopAt ? Math.max(1, (get().stopAt! - Date.now()) / 60_000) : null });
    },
    setVersion(id, version) {
      persist({ versions: { ...get().versions, [id]: version } });
      const { status, presetId, stopAt } = get();
      if (status === "playing" && presetId === id) {
        void get().play(id, { version, stopAfterMinutes: stopAt ? Math.max(1, (stopAt - Date.now()) / 60_000) : null });
      }
    },
    setFollowTimer(value) {
      persist({ followTimer: value });
    },
    setStopAfter(minutes) {
      const stopAt = minutes ? Date.now() + minutes * 60_000 : undefined;
      set({ stopAt });
      armStopTimer(stopAt);
    },
  };
});

/** Rest preset used between Pomodoro blocks when "follow my timer" is on. */
export const REST_PRESET: SoundscapeId = "alpha-10";
