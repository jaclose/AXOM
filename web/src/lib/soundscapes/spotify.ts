import { create } from "zustand";
import { pauseOtherMedia, useMediaSession } from "./mediaSession";

export interface SpotifyPlaylist { id: string; title: string; note: string; url: string; category: "Jazz" | "Lo-fi" | "Deep Focus" }
export const PIANO_PLAYLIST: SpotifyPlaylist = { id: "0KAHoInyGB8kJ0NplpAP3h", title: "Exquisite chess — piano", note: "Your piano playlist for a quieter block.", url: "https://open.spotify.com/playlist/0KAHoInyGB8kJ0NplpAP3h", category: "Deep Focus" };
export const JAZZ_PLAYLISTS: SpotifyPlaylist[] = [
  { id: "37i9dQZF1DX3SiCzCxMDOH", title: "Jazz for Study", note: "Instrumental study jazz.", url: "https://open.spotify.com/playlist/37i9dQZF1DX3SiCzCxMDOH", category: "Jazz" },
  { id: "37i9dQZF1DWVqfgj8NZEp1", title: "Coffee Table Jazz", note: "Piano trios and brushed drums.", url: "https://open.spotify.com/playlist/37i9dQZF1DWVqfgj8NZEp1", category: "Jazz" },
];
export const SPOTIFY_CATALOG: SpotifyPlaylist[] = [PIANO_PLAYLIST, ...JAZZ_PLAYLISTS,
  { id: "0vvXsWCC9xrXsKd4FyS8kM", title: "Lofi Girl — beats to study to", note: "Low-key instrumental beats.", url: "https://open.spotify.com/playlist/0vvXsWCC9xrXsKd4FyS8kM", category: "Lo-fi" },
];
export const SPOTIFY_PROFILE_URL = "https://open.spotify.com/user/mlgxgetxnoscoped";
export const SPOTIFY_PREFS_KEY = "axom.spotify.v1";
export const SPOTIFY_LISTENING_KEY = "axom.spotify.listening.v1";

export function spotifyEmbedUrl(id: string): string {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error("Invalid Spotify playlist.");
  return `https://open.spotify.com/embed/playlist/${id}?utm_source=axom`;
}
export function validSpotifyURI(value: unknown): value is string {
  return typeof value === "string" && /^spotify:(track|episode|playlist|album):[A-Za-z0-9]{22}$/.test(value);
}

interface SpotifyPrefs { enabled: boolean; playlistId: string }
function readPrefs(): SpotifyPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SPOTIFY_PREFS_KEY) ?? "null");
    return { enabled: raw?.enabled === true, playlistId: SPOTIFY_CATALOG.some((entry) => entry.id === raw?.playlistId) ? raw.playlistId : PIANO_PLAYLIST.id };
  } catch { return { enabled: false, playlistId: PIANO_PLAYLIST.id }; }
}
export interface SpotifyPlaybackUpdate { playingURI?: string; isPaused: boolean; isBuffering: boolean; duration: number; position: number }
export interface SpotifyController {
  loadEntity: (uri: string) => void;
  play: () => void;
  pause: () => void;
  resume: () => void;
  destroy: () => void;
  addListener: (event: "ready" | "playback_update" | "playback_started", callback: (event: { data?: unknown }) => void) => void;
}
export interface SpotifyIframeAPI { createController: (element: HTMLElement, options: { uri: string; width: string; height: number }, callback: (controller: SpotifyController) => void) => void }
declare global { interface Window { onSpotifyIframeApiReady?: (api: SpotifyIframeAPI) => void } }

let apiPromise: Promise<SpotifyIframeAPI> | undefined;
/** Official loader only. Never read iframe DOM or rely on undocumented postMessage payloads. */
export function loadSpotifyAPI(): Promise<SpotifyIframeAPI> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => { script.remove(); apiPromise = undefined; reject(new Error("Spotify didn’t respond. Check your connection or open it directly.")); }, 20_000);
    window.onSpotifyIframeApiReady = (api) => { clearTimeout(timeout); resolve(api); };
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    script.dataset.axomSpotifyApi = "true";
    script.onerror = () => { clearTimeout(timeout); script.remove(); apiPromise = undefined; reject(new Error("Spotify is unavailable here. Open it directly or try again.")); };
    document.head.append(script);
  });
  return apiPromise;
}

interface SpotifyState extends SpotifyPrefs {
  panelOpen: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  select: (id: string) => void;
  open: () => void;
  disconnect: () => void;
}
let controller: SpotifyController | undefined;
let lastObservation: { at: number; position: number; uri: string; playing: boolean } | undefined;

export interface SpotifyListeningDay { day: string; seconds: number }
export function readSpotifyListening(): SpotifyListeningDay[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SPOTIFY_LISTENING_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((row): row is SpotifyListeningDay => !!row && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(row.seconds) && row.seconds >= 0) : [];
  } catch { return []; }
}
function recordObservedSeconds(seconds: number, at: number): void {
  const date = new Date(at);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const rows = readSpotifyListening();
  const row = rows.find((entry) => entry.day === day);
  if (row) row.seconds += seconds; else rows.push({ day, seconds });
  try { localStorage.setItem(SPOTIFY_LISTENING_KEY, JSON.stringify(rows.slice(-366))); } catch { /* optional device listening history */ }
}

/** Count only successive, advancing playback observations; never seeks, wall time, or button taps. */
export function acceptSpotifyPlayback(value: unknown, now = Date.now()): void {
  if (!value || typeof value !== "object") return;
  const data = value as Partial<SpotifyPlaybackUpdate>;
  if (typeof data.isPaused !== "boolean" || typeof data.isBuffering !== "boolean" || !Number.isFinite(data.position) || !Number.isFinite(data.duration) || data.position! < 0 || data.duration! < 0) return;
  const playlist = SPOTIFY_CATALOG.find((entry) => entry.id === useSpotify.getState().playlistId) ?? PIANO_PLAYLIST;
  const uri = validSpotifyURI(data.playingURI) ? data.playingURI : `spotify:playlist:${playlist.id}`;
  const playing = !data.isPaused && !data.isBuffering;
  if (lastObservation?.playing && lastObservation.uri === uri) {
    const delta = (data.position! - lastObservation.position) / 1000;
    const wall = (now - lastObservation.at) / 1000;
    if (delta > 0 && wall >= 0 && wall <= 30 && delta <= wall + 1.5) recordObservedSeconds(Math.min(delta, wall), now);
  }
  lastObservation = { at: now, position: data.position!, uri, playing };
  if (playing) pauseOtherMedia("spotify");
  useMediaSession.getState().publish({
    id: "spotify", source: "spotify", title: playlist.title, subtitle: data.isBuffering ? "Spotify · buffering" : "Spotify playlist", isPlaying: playing, isBuffering: data.isBuffering,
    playingURI: uri, currentTime: data.position! / 1000, duration: data.duration! > 0 ? data.duration! / 1000 : undefined,
    controls: { play: () => controller?.resume(), pause: () => controller?.pause(), stop: () => controller?.pause(), open: () => useSpotify.getState().open() },
  });
}

export function attachSpotifyController(next: SpotifyController, loadedPlaylistId = useSpotify.getState().playlistId): void {
  controller = next;
  next.addListener("ready", () => {
    if (controller !== next) return;
    // Selection can change while Spotify creates the iframe or initializes it.
    // Wait for readiness before bringing the player up to the saved selection.
    const selected = useSpotify.getState().playlistId;
    if (selected !== loadedPlaylistId) {
      loadedPlaylistId = selected;
      next.loadEntity(`spotify:playlist:${selected}`);
    }
    useSpotify.setState({ status: "ready", error: undefined });
  });
  next.addListener("playback_update", (event) => { if (controller === next) acceptSpotifyPlayback(event.data); });
  // Track URI alone cannot tell us track title/artist/artwork. Do not manufacture them.
  next.addListener("playback_started", () => { if (controller === next) lastObservation = undefined; });
}
export function detachSpotifyController(expected?: SpotifyController): void {
  if (expected && controller !== expected) return;
  const previous = controller;
  controller = undefined;
  previous?.destroy();
  lastObservation = undefined;
  useMediaSession.getState().remove("spotify");
}

export const useSpotify = create<SpotifyState>((set, get) => {
  const save = (prefs: SpotifyPrefs) => {
    set(prefs);
    try { localStorage.setItem(SPOTIFY_PREFS_KEY, JSON.stringify(prefs)); } catch { /* device-only preference */ }
  };
  return {
    ...readPrefs(), panelOpen: false, status: "idle",
    select(id) {
      if (!SPOTIFY_CATALOG.some((entry) => entry.id === id)) return;
      const changed = id !== get().playlistId;
      save({ playlistId: id, enabled: true });
      set({ panelOpen: true });
      if (changed && controller && get().status === "ready") {
        controller.pause();
        lastObservation = undefined;
        useMediaSession.getState().remove("spotify");
        controller.loadEntity(`spotify:playlist:${id}`);
      }
    },
    open() { save({ playlistId: get().playlistId, enabled: true }); set({ panelOpen: true }); },
    disconnect() { detachSpotifyController(); save({ playlistId: get().playlistId, enabled: false }); set({ panelOpen: false, status: "idle", error: undefined }); },
  };
});
