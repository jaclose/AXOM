// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SpotifyIframeAPI } from "./spotify";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => {
  document.querySelectorAll("script[data-axom-spotify-api]").forEach((script) => script.remove());
  delete window.onSpotifyIframeApiReady;
  vi.useRealTimers();
});
const api: SpotifyIframeAPI = { createController: vi.fn() };
const scriptElement = () => document.querySelector<HTMLScriptElement>("script[data-axom-spotify-api]")!;

it("shares a single API load and retains the successful connection", async () => {
  const { loadSpotifyAPI } = await import("./spotify");
  const pending = loadSpotifyAPI();
  expect(loadSpotifyAPI()).toBe(pending);
  expect(document.querySelectorAll("script[data-axom-spotify-api]")).toHaveLength(1);
  window.onSpotifyIframeApiReady!(api);
  await expect(pending).resolves.toBe(api);
  expect(loadSpotifyAPI()).toBe(pending);
  expect(window.onSpotifyIframeApiReady).toBeUndefined();
});

it("recovers from network failure and ignores the failed attempt's delayed callback", async () => {
  const { loadSpotifyAPI } = await import("./spotify");
  const failed = loadSpotifyAPI();
  const rejection = expect(failed).rejects.toThrow(/unavailable/);
  const oldReady = window.onSpotifyIframeApiReady!;
  scriptElement().dispatchEvent(new Event("error"));
  await rejection;
  expect(window.onSpotifyIframeApiReady).toBeUndefined();
  const retry = loadSpotifyAPI();
  let resolved = false;
  void retry.then(() => { resolved = true; });
  oldReady(api);
  await Promise.resolve();
  expect(resolved).toBe(false);
  window.onSpotifyIframeApiReady!(api);
  await expect(retry).resolves.toBe(api);
});

it("retries the shared bootstrap after timeout and accepts its late API response", async () => {
  const previous = vi.fn();
  window.onSpotifyIframeApiReady = previous;
  const { loadSpotifyAPI } = await import("./spotify");
  const first = loadSpotifyAPI();
  const rejection = expect(first).rejects.toThrow(/didn’t respond/);
  const lateReady = window.onSpotifyIframeApiReady!;
  await vi.advanceTimersByTimeAsync(20_000);
  await rejection;
  expect(scriptElement()).not.toBeNull();
  const retry = loadSpotifyAPI();
  expect(retry).not.toBe(first);
  expect(document.querySelectorAll("script[data-axom-spotify-api]")).toHaveLength(1);
  lateReady(api);
  await expect(retry).resolves.toBe(api);
  expect(window.onSpotifyIframeApiReady).toBe(previous);
});
