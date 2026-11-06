import { create } from "zustand";
import { SoundscapeEngine, soundscapesSupported, type OutputMode } from "./engine";
import { appendListeningInterval } from "./listeningLog";
import { DEFAULT_SOUNDSCAPE_ID, DEFAULT_SOUNDSCAPE_VERSION, SOUNDSCAPES, isPlayable, isSoundscapeId, versionOf, type SoundscapeId } from "./presets";
import { EMPTY_TASTE, normalizeTaste, type Taste } from "./taste";

export type SoundscapeStatus = "idle" | "playing" | "paused";

export interface MainSound { presetId: SoundscapeId; versionId: string }

interface Prefs {
  preferenceVersion: number;
  mainSound: MainSound;
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
  supported: boolean;
  status: SoundscapeStatus;
  presetId: SoundscapeId | null;
  /** The version actually loaded in the engine, independent of a pending choice. */
  loadedVersionId: string | null;
  /** Bumps whenever your own files change the catalog, so version lists re-render. */
  catalog: number;
  bumpCatalog: () => void;
  /** Epoch ms when the stop timer ends playback (fades out). */
  stopAt?: number;
  error?: string;
  /** `preview` plays without touching preferences, the stop timer or the listening log. */
  play: (id: SoundscapeId, options?: { stopAfterMinutes?: number | null; version?: string; preview?: boolean }) => Promise<void>;
  previewing: boolean;
  /** Choose a version; crossfades immediately when that preset is playing. */
  setVersion: (id: SoundscapeId, version: string) => void;
  /**
   * One of your files changed what it plays for: it becomes the pick in its
   * new preset and stops being the pick in the old one. If it is the file
   * playing now, playback follows it instead of restarting.
   */
  moveVersion: (from: SoundscapeId, to: SoundscapeId, version: string) => void;
  /** Re-publish Now Playing (after a rename). */
  refreshNowPlaying: () => void;
  /** After your files change: never leave the player pointing at an empty preset. */
  settleCatalog: () => void;
  /** Choose the scene for a preset ("auto" clears the choice). */
  setScene: (id: SoundscapeId, scene: string) => void;
  setTaste: (taste: Partial<Taste>) => void;
  togglePin: (id: SoundscapeId) => void;
  setMainSound: (presetId: SoundscapeId, versionId: string) => void;
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
export const DEFAULT_MAIN_SOUND: MainSound = { presetId: DEFAULT_SOUNDSCAPE_ID, versionId: DEFAULT_SOUNDSCAPE_VERSION };
const DEFAULT_PREFS: Prefs = { preferenceVersion: 2, mainSound: DEFAULT_MAIN_SOUND, volume: 35, output: "headphones", followTimer: true, lastPresetId: DEFAULT_SOUNDSCAPE_ID, versions: {}, scenes: {}, taste: EMPTY_TASTE, pinned: [DEFAULT_SOUNDSCAPE_ID] };

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    const old = (raw?.preferenceVersion ?? 0) < 2;
    const main = raw?.mainSound;
    const prefs: Prefs = {
      preferenceVersion: 2,
      mainSound: main && isSoundscapeId(main.presetId) && typeof main.versionId === "string" ? main : DEFAULT_MAIN_SOUND,
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
      pinned: old ? [DEFAULT_SOUNDSCAPE_ID, ...(Array.isArray(raw?.pinned) ? raw.pinned.filter(isSoundscapeId).filter((id) => id !== DEFAULT_SOUNDSCAPE_ID) : [])] : Array.isArray(raw?.pinned) ? [...new Set(raw.pinned.filter(isSoundscapeId))] : [],
    };
    if (old) { try { window.localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify(prefs)); } catch { /* preference storage may be unavailable */ } }
    return prefs;
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
    const store = useSoundscape.getState();
    const version = versionOf(preset, store.loadedVersionId ?? store.versions[presetId]);
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
    // macOS Now Playing / Control Center and the media keys read this.
    const ownFile = "src" in version && (version.userFile || preset.band === "Yours" || preset.band === "Music");
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ownFile ? version.label : preset.name,
      artist: ownFile ? preset.name : version.label,
      album: "AXOM Soundscapes",
      artwork: [192, 512].map((size) => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
    });
    navigator.mediaSession.playbackState = status === "playing" ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => { void useSoundscape.getState().resume(); });
    navigator.mediaSession.setActionHandler("pause", () => { void useSoundscape.getState().pause(); });
    navigator.mediaSession.setActionHandler("stop", () => { void useSoundscape.getState().stop(); });
    // Next / previous step through the preset's versions.
    const step = (delta: number) => {
      const current = useSoundscape.getState();
      if (!current.presetId) return;
      const list = SOUNDSCAPES[current.presetId].versions;
      const index = list.findIndex((item) => item.id === versionOf(SOUNDSCAPES[current.presetId!], current.versions[current.presetId!]).id);
      current.setVersion(current.presetId, list[(index + delta + list.length) % list.length].id);
    };
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  } catch { /* Media Session is optional polish */ }
}

export const useSoundscape = create<SoundscapeState>((set, get) => {
  let request = 0;
  const persist = (patch: Partial<Prefs>) => {
    set(patch);
    const { preferenceVersion, mainSound, volume, output, followTimer, lastPresetId, versions, scenes, taste, pinned } = get();
    try {
      window.localStorage.setItem(SOUNDSCAPE_PREFS_KEY, JSON.stringify({ preferenceVersion, mainSound, volume, output, followTimer, lastPresetId, versions, scenes, taste, pinned }));
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
    loadedVersionId: null,
    previewing: false,
    catalog: 0,
    bumpCatalog() {
      set({ catalog: get().catalog + 1 });
    },

    async play(id, options = {}) {
      const preset = SOUNDSCAPES[id];
      if (!isPlayable(id)) {
        set({ error: "Add a file first. This shelf is empty." });
        return;
      }
      const currentRequest = ++request;
      const minutes = options.stopAfterMinutes === undefined ? preset.defaultStopMinutes : options.stopAfterMinutes ?? undefined;
      const keepTimer = get().status !== "idle" && options.stopAfterMinutes === undefined && !preset.defaultStopMinutes;
      const stopAt = keepTimer ? get().stopAt : minutes ? Date.now() + minutes * 60_000 : undefined;
      const versionId = versionOf(preset, options.version ?? get().versions[id]).id;
      const replacePaused = get().status === "paused";
      try {
        await getEngine().play(preset, { volume: get().volume, output: get().output, versionId, ...(replacePaused ? { replacePaused: true } : {}) });
      } catch (error) {
        if (currentRequest === request) set({ ...(replacePaused ? { loadedVersionId: null } : {}), error: error instanceof Error ? error.message : "Audio couldn’t start." });
        return;
      }
      if (currentRequest !== request) return;
      if (versionId.startsWith("user-") && !SOUNDSCAPES[id].versions.some((version) => version.id === versionId)) {
        // The file can be moved or removed while its media element buffers.
        const moved = Object.values(SOUNDSCAPES).find((entry) => entry.versions.some((version) => version.id === versionId));
        if (moved) id = moved.id;
        else {
          const stopping = get().stop();
          set({ error: "That sound is no longer available on this device." });
          await stopping;
          return;
        }
      }
      if (options.preview) {
        // A taste of the sound only: no preference, timer or log changes.
        closeInterval();
        clearTimeout(stopTimer);
        set({ status: "playing", presetId: id, loadedVersionId: versionId, stopAt: undefined, error: undefined, previewing: true });
        return;
      }
      openIntervalFor(id);
      persist({ lastPresetId: id, versions: { ...get().versions, [id]: versionId } });
      set({ status: "playing", presetId: id, loadedVersionId: versionId, stopAt, error: undefined, previewing: false });
      armStopTimer(stopAt);
      updateMediaSession(id, "playing");
    },
    async toggle() {
      const { status, presetId, lastPresetId } = get();
      if (status === "playing") await get().pause();
      else if (status === "paused") await get().resume();
      else {
        const target = presetId ?? lastPresetId;
        await get().play(isPlayable(target) ? target : DEFAULT_PREFS.lastPresetId);
      }
    },
    async pause() {
      if (get().status !== "playing") return;
      const currentRequest = ++request;
      closeInterval();
      try { await getEngine().pause(); } catch (error) {
        if (currentRequest === request) set({ error: error instanceof Error ? error.message : "Audio couldn’t pause." });
        return;
      }
      if (currentRequest !== request) return;
      set({ status: "paused" });
      updateMediaSession(get().presetId, "paused");
    },
    async resume() {
      const { status, presetId } = get();
      if (status !== "paused" || !presetId) return;
      const currentRequest = ++request;
      const chosen = versionOf(SOUNDSCAPES[presetId], get().previewing ? get().loadedVersionId ?? undefined : get().versions[presetId]).id;
      try {
        if (chosen !== get().loadedVersionId) {
          await getEngine().play(SOUNDSCAPES[presetId], { volume: get().volume, output: get().output, versionId: chosen, replacePaused: true });
        } else {
          await getEngine().resume();
        }
      } catch (error) {
        if (currentRequest === request) set({ loadedVersionId: chosen !== get().loadedVersionId ? null : get().loadedVersionId, error: error instanceof Error ? error.message : "Audio couldn’t resume." });
        return;
      }
      if (currentRequest !== request) return;
      if (!get().previewing) openIntervalFor(presetId);
      set({ status: "playing", loadedVersionId: chosen, error: undefined });
      updateMediaSession(presetId, "playing");
    },
    async stop(fadeSeconds) {
      ++request;
      closeInterval();
      clearTimeout(stopTimer);
      set({ status: "idle", loadedVersionId: null, stopAt: undefined, previewing: false });
      updateMediaSession(null, "idle");
      await engine?.stop(fadeSeconds);
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
    setTaste(patch) {
      persist({ taste: normalizeTaste({ ...get().taste, ...patch }) });
    },
    togglePin(id) {
      const pinned = get().pinned;
      persist({ pinned: pinned.includes(id) ? pinned.filter((item) => item !== id) : [id, ...pinned] });
    },
    setMainSound(presetId, versionId) {
      if (!SOUNDSCAPES[presetId].versions.some((version) => version.id === versionId)) return;
      persist({ mainSound: { presetId, versionId } });
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
      if (get().previewing && get().presetId === id) set({ previewing: false });
      const { status, presetId, stopAt } = get();
      if (status === "playing" && presetId === id) {
        void get().play(id, { version, stopAfterMinutes: stopAt ? Math.max(1, (stopAt - Date.now()) / 60_000) : null });
      }
    },
    moveVersion(from, to, version) {
      if (from === to) return;
      const { status, presetId, versions, stopAt } = get();
      const loaded = status !== "idle" && presetId === from && versionOf(SOUNDSCAPES[to], version).id === version && get().loadedVersionId === version;
      const next = { ...versions, [to]: version };
      if (next[from] === version) delete next[from];
      persist({ versions: next, ...(loaded ? { lastPresetId: to } : {}), ...(get().mainSound.presetId === from && get().mainSound.versionId === version ? { mainSound: { presetId: to, versionId: version } } : {}) });
      if (loaded) {
        // Same audio, new home: follow the file rather than restart it.
        set({ presetId: to });
        if (status === "playing") openIntervalFor(to);
        updateMediaSession(to, status);
      } else if (status === "playing" && presetId === to) {
        void get().play(to, { version, stopAfterMinutes: stopAt ? Math.max(1, (stopAt - Date.now()) / 60_000) : null });
      }
    },
    refreshNowPlaying() {
      const { presetId, status } = get();
      if (presetId && status !== "idle") updateMediaSession(presetId, status);
    },
    settleCatalog() {
      const { presetId, lastPresetId, status, mainSound } = get();
      if (presetId && !isPlayable(presetId)) {
        if (status !== "idle") void get().stop();
        set({ presetId: null });
      }
      if (!isPlayable(lastPresetId)) persist({ lastPresetId: DEFAULT_PREFS.lastPresetId });
      if (!SOUNDSCAPES[mainSound.presetId].versions.some((version) => version.id === mainSound.versionId)) {
        persist({ mainSound: DEFAULT_MAIN_SOUND });
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
