// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptSpotifyPlayback, attachSpotifyController, detachSpotifyController, PIANO_PLAYLIST, readSpotifyListening, SPOTIFY_CATALOG, SPOTIFY_PREFS_KEY, useSpotify, type SpotifyController } from "./spotify";
import { activeMediaSession, useMediaSession } from "./mediaSession";

beforeEach(() => {
  localStorage.clear(); detachSpotifyController();
  useMediaSession.setState({ sessions: {} });
  useSpotify.setState({ enabled: false, playlistId: PIANO_PLAYLIST.id, status: "idle", panelOpen: false });
});
afterEach(() => detachSpotifyController());
const update = (position: number, patch = {}) => ({ position, duration: 180000, isPaused: false, isBuffering: false, playingURI: `spotify:playlist:${PIANO_PLAYLIST.id}`, ...patch });

it("uses playback evidence, ignores invalid events, and does not fake metadata", () => {
  useSpotify.getState().open();
  expect(activeMediaSession(useMediaSession.getState().sessions)).toBeUndefined();
  acceptSpotifyPlayback({ isPaused: false });
  expect(useMediaSession.getState().sessions.spotify).toBeUndefined();
  acceptSpotifyPlayback(update(0), 1000);
  expect(useMediaSession.getState().sessions.spotify).toMatchObject({ isPlaying: true, title: PIANO_PLAYLIST.title, subtitle: "Spotify playlist" });
  acceptSpotifyPlayback(update(1000, { isBuffering: true }), 2000);
  expect(useMediaSession.getState().sessions.spotify.isPlaying).toBe(false);
});
it("counts observed progression once, excluding seeks, paused time and long telemetry gaps", () => {
  acceptSpotifyPlayback(update(0), 1000);
  acceptSpotifyPlayback(update(1000), 2000);
  acceptSpotifyPlayback(update(1000), 2000);
  acceptSpotifyPlayback(update(90000), 3000);
  acceptSpotifyPlayback(update(91000, { isPaused: true }), 4000);
  acceptSpotifyPlayback(update(91000), 64000);
  acceptSpotifyPlayback(update(92000), 65000);
  acceptSpotifyPlayback(update(153000), 126000);
  expect(readSpotifyListening().reduce((sum, day) => sum + day.seconds, 0)).toBe(3);
});
it("reuses its controller for playlist changes and ignores events after disconnect", () => {
  const listeners = new Map<string, (event: { data?: unknown }) => void>();
  const controller: SpotifyController = { loadEntity: vi.fn(), play: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), addListener: (event, callback) => { listeners.set(event, callback); } };
  attachSpotifyController(controller);
  listeners.get("ready")!({});
  expect(useSpotify.getState().status).toBe("ready");
  useSpotify.getState().select(SPOTIFY_CATALOG[1].id);
  expect(controller.loadEntity).toHaveBeenCalledWith(`spotify:playlist:${SPOTIFY_CATALOG[1].id}`);
  expect(JSON.parse(localStorage.getItem(SPOTIFY_PREFS_KEY)!)).toMatchObject({ enabled: true, playlistId: SPOTIFY_CATALOG[1].id });
  expect(controller.destroy).not.toHaveBeenCalled();
  detachSpotifyController();
  listeners.get("playback_update")!({ data: update(1000) });
  expect(useMediaSession.getState().sessions.spotify).toBeUndefined();
});
it("pauses another observed source when Spotify actually starts", () => {
  const pause = vi.fn();
  useMediaSession.getState().publish({ id: "native", source: "soundscape", title: "Rain", subtitle: "Nature", isPlaying: true, controls: { play: vi.fn(), pause, stop: vi.fn(), open: vi.fn() } });
  useSpotify.getState().open();
  expect(pause).not.toHaveBeenCalled();
  acceptSpotifyPlayback(update(0));
  expect(pause).toHaveBeenCalledOnce();
});
