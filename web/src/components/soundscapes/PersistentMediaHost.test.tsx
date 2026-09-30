// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentMediaHost } from "./PersistentMediaHost";
import { detachSpotifyController, loadSpotifyAPI, PIANO_PLAYLIST, SPOTIFY_CATALOG, useSpotify, type SpotifyController, type SpotifyIframeAPI } from "../../lib/soundscapes/spotify";
import { useMediaSession } from "../../lib/soundscapes/mediaSession";

vi.mock("../../lib/soundscapes/spotify", async (original) => ({
  ...await original<typeof import("../../lib/soundscapes/spotify")>(),
  loadSpotifyAPI: vi.fn(),
}));

let connect: (controller: SpotifyController) => void;
let listeners: Map<string, (event: { data?: unknown }) => void>;
let controller: SpotifyController;
let createController: ReturnType<typeof vi.fn<SpotifyIframeAPI["createController"]>>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  detachSpotifyController();
  useSpotify.setState({ enabled: true, playlistId: PIANO_PLAYLIST.id, status: "idle", panelOpen: true, error: undefined });
  listeners = new Map();
  controller = { loadEntity: vi.fn(), play: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), addListener: (event, callback) => { listeners.set(event, callback); } };
  createController = vi.fn((_element, _options, callback) => { connect = callback; });
  vi.mocked(loadSpotifyAPI).mockResolvedValue({ createController });
});
afterEach(() => { cleanup(); detachSpotifyController(); vi.useRealTimers(); });

async function mountPlayer() {
  const view = render(<PersistentMediaHost />);
  await act(async () => {});
  expect(createController).toHaveBeenCalledOnce();
  return view;
}

it("loads the latest saved playlist when selection changes before controller readiness", async () => {
  await mountPlayer();
  act(() => useSpotify.getState().select(SPOTIFY_CATALOG[1].id));
  act(() => connect(controller));
  act(() => useSpotify.getState().select(SPOTIFY_CATALOG[2].id));
  expect(controller.loadEntity).not.toHaveBeenCalled();
  act(() => listeners.get("ready")!({}));
  expect(controller.loadEntity).toHaveBeenCalledExactlyOnceWith(`spotify:playlist:${SPOTIFY_CATALOG[2].id}`);
  expect(useSpotify.getState().status).toBe("ready");
});

it("keeps the same controller while hiding and reopening the panel", async () => {
  const view = await mountPlayer();
  act(() => { connect(controller); listeners.get("ready")!({}); });
  fireEvent.click(screen.getByRole("button", { name: "Hide Spotify player" }));
  act(() => useSpotify.getState().open());
  view.rerender(<PersistentMediaHost />);
  expect(createController).toHaveBeenCalledOnce();
  expect(controller.destroy).not.toHaveBeenCalled();
});

it("times out a silent embed, ignores its late events, and allows a clean retry", async () => {
  await mountPlayer();
  act(() => connect(controller));
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByRole("alert").textContent).toMatch(/Spotify/);
  expect(controller.destroy).toHaveBeenCalledOnce();
  act(() => listeners.get("ready")!({}));
  expect(useSpotify.getState().status).toBe("error");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => {});
  expect(createController).toHaveBeenCalledTimes(2);
  expect(useSpotify.getState().status).toBe("loading");
});

it("destroys a controller that arrives after disconnection without restoring playback", async () => {
  await mountPlayer();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  act(() => connect(controller));
  expect(controller.destroy).toHaveBeenCalledOnce();
  expect(useSpotify.getState()).toMatchObject({ enabled: false, status: "idle" });
  expect(useMediaSession.getState().sessions.spotify).toBeUndefined();
});
