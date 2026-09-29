// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeSeed } from "./lib/seed";
import { useStore } from "./lib/store";
import { GUIDED_TOUR_STEPS } from "./components/shell/GuidedTour";

beforeEach(() => {
  sessionStorage.clear();
  const seed = makeSeed();
  seed.profile.onboarded = true;
  seed.profile.tourDone = false;
  seed.profile.promise = undefined;
  seed.profile.promisePromptStatus = undefined;
  useStore.setState(seed);
  window.location.hash = "dashboard";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  Element.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("post-global-guide promise flow", () => {
  it("offers after the global guide is completed", () => {
    render(<App />);
    for (let step = 0; step < GUIDED_TOUR_STEPS.length - 1; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(useStore.getState().profile.tourDone).toBe(true);
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
  });

  it("offers after the global guide is skipped and persists Review later", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Skip guided tour" }));
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    expect(useStore.getState().profile.promisePromptStatus).toMatchObject({ state: "deferred", promptVersion: "promise-prompt-v1" });
  });

  it("does not offer after global exit when already signed", () => {
    useStore.setState((state) => ({
      profile: { ...state.profile, promise: { signedName: "Ada", signedAt: "2026-07-12T12:00:00.000Z" } },
    }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Skip guided tour" }));
    expect(screen.queryByRole("dialog", { name: "A promise to yourself" })).toBeNull();
  });

  it("opens the signing flow and versions Skip for now", () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Skip guided tour" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign now" }));
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useStore.getState().profile.promisePromptStatus?.state).toBe("deferred");
    first.unmount();

    const seed = makeSeed();
    seed.profile.onboarded = true;
    seed.profile.tourDone = false;
    useStore.setState(seed);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Skip guided tour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "A promise to yourself" })).getByRole("button", { name: "Skip for now" }));
    expect(useStore.getState().profile.promisePromptStatus).toMatchObject({ state: "skipped", promptVersion: "promise-prompt-v1" });
  });

  it("treats Escape from the global guide as a guide decision and presents immediately", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().profile.tourDone).toBe(true);
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
  });

  it("does not treat unrelated Escape or ordinary navigation as a Promise trigger", () => {
    const status = {
      state: "deferred" as const,
      updatedAt: new Date().toISOString(),
      promptVersion: "promise-prompt-v1",
    };
    useStore.setState((state) => ({
      profile: { ...state.profile, tourDone: true, promisePromptStatus: status },
    }));

    render(<App />);
    fireEvent.keyDown(document, { key: "Escape" });
    window.location.hash = "productivity";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(screen.queryByRole("dialog", { name: "A promise to yourself" })).toBeNull();
    expect(useStore.getState().profile.promisePromptStatus).toEqual(status);
  });

  it("presents after finishing onboarding without the optional global guide", () => {
    const seed = makeSeed();
    seed.profile.onboarded = false;
    seed.profile.tourDone = undefined;
    seed.profile.promise = undefined;
    seed.profile.promisePromptStatus = undefined;
    useStore.setState(seed);

    render(<App />);
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }
    expect((screen.getByRole("checkbox", { name: /Show the optional seven-step guide after setup/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(useStore.getState().profile).toMatchObject({ onboarded: true, tourDone: true });
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
  });

  it("presents after onboarding is skipped entirely", () => {
    const seed = makeSeed();
    seed.profile.onboarded = false;
    seed.profile.tourDone = undefined;
    seed.profile.promise = undefined;
    seed.profile.promisePromptStatus = undefined;
    useStore.setState(seed);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));

    expect(useStore.getState().profile).toMatchObject({ onboarded: true, tourDone: true });
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
  });

  it("offers an unpresented Promise at startup without waiting for navigation", () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        tourDone: true,
        promise: undefined,
        promisePromptStatus: undefined,
      },
    }));

    render(<App />);
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
  });
});
