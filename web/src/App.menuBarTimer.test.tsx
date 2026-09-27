// @vitest-environment jsdom
// The menu bar timer bridge sits in the same child slot of both App branches,
// so re-running setup mid-sprint must not remount it: a remount clears the
// native menu bar item and briefly makes closing the window quit the app.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { makeSeed } from "./lib/seed";
import { useStore } from "./lib/store";
import { useUi } from "./lib/uiStore";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined),
  listen: vi.fn(async (_event: string, _handler?: unknown) => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

function commands(name: string) {
  return tauri.invoke.mock.calls.filter(([command]) => command === name);
}

/** The update watcher also listens (native "Check for Updates…" menu item). */
function menuBarListeners() {
  return (tauri.listen.mock.calls as unknown as Array<[string]>).filter(([event]) => event !== "axom:check-for-updates");
}

async function flushBridge() {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  sessionStorage.clear();
  const seed = makeSeed();
  seed.profile.onboarded = true;
  seed.profile.tourDone = true;
  useStore.setState(seed);
  useUi.getState().clearOnboardingRequest();
  window.location.hash = "dashboard";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  Element.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  Object.defineProperty(window.navigator, "platform", { configurable: true, get: () => "MacIntel" });
  tauri.invoke.mockClear();
  tauri.listen.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window.navigator as { platform?: string }).platform;
});

it("keeps the menu bar timer bridge mounted while setup is re-run", async () => {
  render(<App />);
  await flushBridge();
  expect(menuBarListeners()).toHaveLength(1);
  expect(commands("menu_bar_timer_update")).toHaveLength(1);

  act(() => { useUi.getState().requestOnboarding(); });
  await flushBridge();
  expect(document.querySelector(".shell")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await flushBridge();
  expect(document.querySelector(".shell")).not.toBeNull();

  expect(commands("menu_bar_timer_clear")).toHaveLength(0);
  expect(menuBarListeners()).toHaveLength(1);
});
