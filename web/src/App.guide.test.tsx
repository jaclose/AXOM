// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeSeed } from "./lib/seed";
import { useStore } from "./lib/store";
import { useUi } from "./lib/uiStore";

beforeEach(() => {
  sessionStorage.clear();
  const seed = makeSeed();
  seed.profile.onboarded = true;
  seed.profile.tourDone = true;
  seed.profile.promise = { signedName: "Ada", signedAt: "2026-07-12T12:00:00.000Z" };
  useStore.setState(seed);
  useUi.setState({ guideOpen: false, guideRun: null });
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

const guideDialog = () => screen.queryByRole("dialog", { name: "AXOM Guide" });

describe("AXOM Guide in the app", () => {
  it("opens from the top bar and toggles with Ctrl/⌘ + /", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open the AXOM Guide" }));
    expect(guideDialog()).toBeTruthy();
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(guideDialog()).toBeNull();
    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(guideDialog()).toBeTruthy();
    fireEvent.keyDown(window, { key: "/" });
    expect(guideDialog()).toBeTruthy();
  });

  it("opens Settings on the right section for settings topics", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Ask how to do something in AXOM"), { target: { value: "dark mode" } });
    const topic = screen.getByText("Change the theme or appearance").closest("li")!;
    fireEvent.click(within(topic).getByRole("button", { name: "Open settings" }));
    expect(guideDialog()).toBeNull();
    const settings = screen.getByRole("dialog", { name: "Your AXOM Setup" });
    expect(within(settings).getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
  });

  it("walks to Anki Lab and points at each control in turn", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Ask how to do something in AXOM"), { target: { value: "make flashcards from my notes" } });
    const topic = screen.getByText("Generate Anki cards with AI").closest("li")!;
    fireEvent.click(within(topic).getByRole("button", { name: "Show me" }));

    expect(guideDialog()).toBeNull();
    expect(window.location.hash).toBe("#anki");
    expect(await screen.findByRole("dialog", { name: "Open AI generate" })).toBeTruthy();
    const tab = await screen.findByRole("button", { name: "AI generate" });

    await act(async () => {
      fireEvent.click(tab);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByRole("dialog", { name: "Paste and generate" })).toBeTruthy();
    expect(document.querySelector('[data-guide="anki-ai-generator"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Paste and generate" })).toBeNull();
    expect(useUi.getState().guideRun).toBeNull();
  });
});
