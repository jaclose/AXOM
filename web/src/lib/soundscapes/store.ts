import { create } from "zustand";
import { SoundscapeEngine, soundscapesSupported, type OutputMode } from "./engine";
import { appendListeningInterval } from "./listeningLog";
import { SOUNDSCAPES, isSoundscapeId, versionOf, type SoundscapeId } from "./presets";
import { EMPTY_TASTE, normalizeTaste, type Taste } from "./taste";
import { pauseOtherMedia, useMediaSession } from "./mediaSession";
import { useMediaLibrary } from "./library";

export type SoundscapeStatus = "idle" | "playing" | "paused";

interface Prefs {
  volume: number;
  output: OutputMode;
  followTimer: boolean;
  lastPresetId: SoundscapeId;
  /** The version chosen for each preset (defaults to the first). */
  versions: Partial<Record<SoundscapeId, string>>;
  /** Scene chosen per preset: a scene id, or "generative" for the shader visual (absent = the version's own scene). */
  scenes: Partial<Record<SoundscapeId, string>>;
  /** What the learner said they're into (the opener); drives ordering and scene choice. */
  taste: Taste;
  /** Pinned presets, shown first. */
  pinned: SoundscapeId[];
}

interface SoundscapeState extends Prefs {
  /** Temporary attenuation (rest/alarm); never changes the saved volume. */
  ducking: number;
  setDucking: (multiplier: number) => void;
  supported: boolean;
  status: SoundscapeStatus;
  presetId: SoundscapeId | null;
  /** Epoch ms when the stop timer ends playback (fades out). */
  stopAt?: number;
  error?: string;
  /** `preview` plays without touching preferences, the stop timer or the listening log. */
  play: (id: SoundscapeId, options?: { stopAfterMinutes?: number | null; version?: string; preview?: boolean }) => Promise<void>;
  previewing: boolean;
  /** Choose a version; crossfades immediately when that preset is playing. */
  setVersion: (id: SoundscapeId, version: string) => void;
  /** Choose the scene for a preset ("auto" clears the choice). */
  setScene: (id: SoundscapeId, scene: string) => void;
  setTaste: (taste: Partial<Taste>, lastPresetId?: SoundscapeId) => void;
  togglePin: (id: SoundscapeId) => void;
  /** Start the audio context inside a click so hover previews can play. */
  unlockAudio: () => Promise<boolean>;
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
const DEFAULT_PREFS: Prefs = { volume: 35, output: "headphones", followTimer: true, lastPresetId: "gamma-40", versions: {}, scenes: {}, taste: EMPTY_TASTE, pinned: [] };

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
      scenes: raw?.scenes && typeof raw.scenes === "object"
        ? Object.fromEntries(Object.entries(raw.scenes).filter(([id, scene]) => isSoundscapeId(id) && typeof scene === "string"))
        : {},
      taste: normalizeTaste(raw?.taste),
      pinned: Array.isArray(raw?.pinned) ? [...new Set(raw.pinned.filter(isSoundscapeId))] : [],
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
  if (!presetId || status === "idle") useMediaSession.getState().remove("native");
  else {
    const preset = SOUNDSCAPES[presetId];
    useMediaSession.getState().publish({ id: "native", source: preset.beatHz ? "frequency" : "soundscape", title: preset.name, subtitle: preset.band, isPlaying: status === "playing",
      controls: { play: () => void useSoundscape.getState().resume(), pause: () => void useSoundscape.getState().pause(), stop: () => void useSoundscape.getState().stop(), open: () => { window.location.hash = "soundscapes"; } },
    });
  }
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
    const { volume, output, followTimer, lastPresetId, versions, scenes, taste, pinned } = get();
    try {
      window.localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ volume, output, followTimer, lastPresetId, versions, scenes, taste, pinned }));
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
    ducking: 1,
    supported: typeof window !== "undefined" && soundscapesSupported(),
    status: "idle",
    presetId: null,
    previewing: false,

    async play(id, options = {}) {
      const preset = SOUNDSCAPES[id];
      const minutes = options.stopAfterMinutes === undefined ? preset.defaultStopMinutes : options.stopAfterMinutes ?? undefined;
      const keepTimer = get().status !== "idle" && options.stopAfterMinutes === undefined && !preset.defaultStopMinutes;
      const stopAt = keepTimer ? get().stopAt : minutes ? Date.now() + minutes * 60_000 : undefined;
      const versionId = versionOf(preset, options.version ?? get().versions[id]).id;
      try {
        await getEngine().play(preset, { volume: get().volume * get().ducking, output: get().output, versionId });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Audio couldn’t start." });
        return;
      }
      pauseOtherMedia("native");
      if (options.preview) {
        // A taste of the sound only: no preference, timer or log changes.
        closeInterval();
        clearTimeout(stopTimer);
        set({ status: "playing", presetId: id, stopAt: undefined, error: undefined, previewing: true });
        return;
      }
      openIntervalFor(id);
      useMediaLibrary.getState().remember(id);
      persist({ lastPresetId: id, versions: { ...get().versions, [id]: versionId } });
      set({ status: "playing", presetId: id, stopAt, error: undefined, previewing: false });
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
      pauseOtherMedia("native");
      openIntervalFor(presetId);
      set({ status: "playing" });
      updateMediaSession(presetId, "playing");
    },
    async stop(fadeSeconds) {
      if (get().status === "idle") return;
      closeInterval();
      clearTimeout(stopTimer);
      set({ status: "idle", stopAt: undefined, previewing: false });
      updateMediaSession(null, "idle");
      await getEngine().stop(fadeSeconds);
    },
    setVolume(volume) {
      persist({ volume });
      engine?.setVolume(volume * get().ducking);
    },
    setDucking(multiplier) {
      const ducking = Number.isFinite(multiplier) ? Math.max(0, Math.min(1, multiplier)) : 1;
      set({ ducking });
      engine?.setVolume(get().volume * ducking);
    },
    setOutput(output) {
      persist({ output });
      const { status, presetId } = get();
      // Rebuild the graph for the new routing (a quick crossfade).
      if (status === "playing" && presetId) void get().play(presetId, { stopAfterMinutes: get().stopAt ? Math.max(1, (get().stopAt! - Date.now()) / 60_000) : null });
    },
    setTaste(patch, lastPresetId) {
      persist({ taste: normalizeTaste({ ...get().taste, ...patch }), ...(lastPresetId ? { lastPresetId } : {}) });
    },
    togglePin(id) {
      const pinned = get().pinned;
      persist({ pinned: pinned.includes(id) ? pinned.filter((item) => item !== id) : [id, ...pinned] });
    },
    async unlockAudio() {
      try { return await getEngine().unlock(); } catch { return false; }
    },
    setScene(id, scene) {
      const next = { ...get().scenes };
      if (scene === "auto") delete next[id]; else next[id] = scene;
      persist({ scenes: next });
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
