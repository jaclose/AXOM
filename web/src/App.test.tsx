// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeSeed } from "./lib/seed";
import { useStore } from "./lib/store";
import { useUi } from "./lib/uiStore";
import { GUIDED_TOUR_STEPS } from "./components/shell/GuidedTour";
import * as localVault from "./lib/localVault";
import { localDateKey } from "./lib/dailyRollover";
import type { CommunicationsSettings } from "./lib/communications/client";
import { preferences } from "./lib/communications/model";

const communicationsMocks = vi.hoisted(() => ({
  request: vi.fn(),
  remote: {
    data: null as CommunicationsSettings | null,
    loading: false,
    error: "",
    reload: vi.fn(),
  },
}));

vi.mock("./lib/communications/client", () => ({
  communicationsRequest: communicationsMocks.request,
  useCommunications: () => communicationsMocks.remote,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const seed = makeSeed();
  seed.profile.onboarded = true;
  seed.profile.tourDone = false;
  seed.profile.promise = undefined;
  seed.profile.promisePromptStatus = undefined;
  useStore.setState(seed);
  useUi.setState({ settingsRequest: null, onboardingRequested: false, journalDay: null });
  communicationsMocks.request.mockReset();
  communicationsMocks.remote.data = null;
  communicationsMocks.remote.loading = false;
  communicationsMocks.remote.error = "";
  communicationsMocks.remote.reload.mockReset();
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
    for (let step = 0; step < 2; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Enter AXOM" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

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

describe("Journal route durability", () => {
  function openJournalShell() {
    useStore.setState((state) => ({
      // The app rolls the study day over at local midnight, so seed the same day it opens on.
      activeDayKey: localDateKey(),
      journal: [],
      dayPlans: [],
      logs: [],
      profile: {
        ...state.profile,
        onboarded: true,
        tourDone: true,
        promisePromptStatus: {
          state: "deferred",
          updatedAt: "2026-10-15T12:00:00.000Z",
          promptVersion: "promise-prompt-v1",
        },
      },
    }));
    window.history.replaceState(null, "", "#journal");
  }

  it("keeps the Journal mounted until a sidebar route change confirms the draft write", async () => {
    openJournalShell();
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), {
      target: { value: "Persist before leaving the Journal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#journal");
    expect(screen.getByDisplayValue("Persist before leaving the Journal")).toBeTruthy();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    await waitFor(() => expect(window.location.hash).toBe("#dashboard"));
    expect(useStore.getState().journal.find(entry => entry.date.startsWith(useStore.getState().activeDayKey)))
      .toMatchObject({ freeWriting: "Persist before leaving the Journal" });
  });

  it("restores an external hash route and keeps the draft visible when durability fails", async () => {
    openJournalShell();
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced route write failure"));

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), {
      target: { value: "Do not leave this route" },
    });

    act(() => {
      window.location.hash = "tasks";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#journal"));
    expect(screen.getByDisplayValue("Do not leave this route")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull();
  });

  it("keeps Journal and Settings mounted until Run setup again confirms durability", async () => {
    openJournalShell();
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), {
      target: { value: "Persist before setup replaces the shell" },
    });
    act(() => useUi.getState().requestSettings("program"));
    const settings = await screen.findByRole("dialog", { name: "Your AXOM Setup" });
    fireEvent.click(within(settings).getByRole("button", { name: "Run setup again" }));

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "Your AXOM Setup" })).toBeTruthy();
    expect(screen.getByDisplayValue("Persist before setup replaces the shell")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Who are you studying as?" })).toBeNull();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "Who are you studying as?" })).toBeTruthy();
    expect(screen.queryByDisplayValue("Persist before setup replaces the shell")).toBeNull();
    expect(useStore.getState().journal.find(entry => entry.date.startsWith(useStore.getState().activeDayKey)))
      .toMatchObject({ freeWriting: "Persist before setup replaces the shell" });
  });

  it("keeps Journal, Settings, and draft intact when Run setup again cannot be saved", async () => {
    openJournalShell();
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced setup transition failure"));

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open My AXOM Journal/i }));
    fireEvent.change(screen.getByLabelText("Free writing"), {
      target: { value: "Keep this draft if setup cannot begin" },
    });
    act(() => useUi.getState().requestSettings("program"));
    const settings = await screen.findByRole("dialog", { name: "Your AXOM Setup" });
    fireEvent.click(within(settings).getByRole("button", { name: "Run setup again" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Your AXOM Setup" })).toBeTruthy();
    expect(screen.getByDisplayValue("Keep this draft if setup cannot begin")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Who are you studying as?" })).toBeNull();
    expect(useUi.getState().onboardingRequested).toBe(false);
  });
});

describe("Communications route protection", () => {
  it("guards browser history and direct hash changes until dirty preferences are confirmed", async () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        onboarded: true,
        tourDone: true,
        promisePromptStatus: {
          state: "deferred",
          updatedAt: "2026-10-15T12:00:00.000Z",
          promptVersion: "promise-prompt-v1",
        },
      },
    }));
    communicationsMocks.remote.data = {
      preferences: preferences("America/Grenada").map((preference) => (
        preference.category === "essays_from_jafar" ? { ...preference, enabled: true } : preference
      )),
      identity: { accent: "#c8a96a", theme: "dark" },
      history: [],
      privacy: [],
      admin: false,
      deliveryMode: "live",
      deletionEnabled: false,
      hasProtectedCopy: true,
    };
    window.history.replaceState(null, "", "#communications");

    render(<App />);
    const essays = await screen.findByRole("switch", { name: /Essays & Notes/ });
    await waitFor(() => expect((essays as HTMLInputElement).checked).toBe(true));
    fireEvent.click(essays);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    essays.focus();

    act(() => {
      window.history.pushState(null, "", "#privacy");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    const historyNotice = await screen.findByRole("alertdialog");
    expect(historyNotice.textContent).toMatch(/Leave without saving/);
    expect(screen.getByRole("heading", { name: "An inbox with intention." })).toBeTruthy();
    expect((essays as HTMLInputElement).checked).toBe(false);
    fireEvent.keyDown(historyNotice, { key: "Escape" });

    await waitFor(() => expect(window.location.hash).toBe("#communications"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((essays as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(essays));

    act(() => {
      window.history.replaceState(null, "", "#privacy");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const hashNotice = await screen.findByRole("alertdialog");
    expect(hashNotice.textContent).toContain("Privacy & Data");
    fireEvent.click(within(hashNotice).getByRole("button", { name: "Discard changes and continue" }));

    expect(await screen.findByRole("heading", { name: "Your data stays yours." })).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});
