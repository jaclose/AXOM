// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMIZE_SIDEBAR_EVENT, FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS, OVERWHELMED_AFTER_SAMPLE_MS, OVERWHELMED_ID, readCoachLedger, writeCoachLedger } from "../../lib/coach";
import { FIRST_VISIT_LOCKIN_CLOSED_EVENT, FIRST_VISIT_LOCKIN_PREVIEW_EVENT } from "./FocusCheckIn";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { CoachLayer } from "./CoachLayer";

function placeElement(className: string, rect: { left: number; top: number; width: number; height: number }, tag = "button") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = className;
  element.getBoundingClientRect = () => ({
    ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}),
  });
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("axom.guideOffer.v1", "declined");
  const seed = makeSeed();
  seed.profile.onboarded = true;
  seed.profile.tourDone = true;
  useStore.setState(seed);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, intersectionRatio: 1, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
    unobserve() {}
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CoachLayer", () => {
  it("starts when the page was scrolled before the coach listener mounted", () => {
    const scroller = placeElement("surface-scroll", { left: 0, top: 0, width: 600, height: 700 }, "div");
    scroller.scrollTop = 12;
    const preview = vi.fn((event: Event) => { (event as CustomEvent<{ accepted: boolean }>).detail.accepted = true; });
    window.addEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
    render(<CoachLayer route="reports" suspended={false} />);
    act(() => vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS));
    expect(preview).toHaveBeenCalledOnce();
    window.removeEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
  });

  it("starts on first scroll, previews at exactly 60 seconds, then says Overwhelmed after the sample closes", () => {
    const scroller = placeElement("surface-scroll", { left: 0, top: 0, width: 600, height: 700 }, "div");
    placeElement("nav-manage-btn", { left: 31, top: 83, width: 229, height: 50 });
    const opened = vi.fn();
    const preview = vi.fn((event: Event) => { (event as CustomEvent<{ accepted: boolean }>).detail.accepted = true; });
    window.addEventListener(CUSTOMIZE_SIDEBAR_EVENT, opened);
    window.addEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
    render(<CoachLayer route="reports" suspended={false} />);

    fireEvent.scroll(scroller);
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(preview).not.toHaveBeenCalled();
    scroller.scrollTop = 1;
    fireEvent.scroll(scroller);
    act(() => { vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS - 1); });
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview).toHaveBeenCalledOnce();
    expect(readCoachLedger().lockInSampleShownAt).toBeDefined();
    act(() => window.dispatchEvent(new Event(FIRST_VISIT_LOCKIN_CLOSED_EVENT)));
    act(() => { vi.advanceTimersByTime(OVERWHELMED_AFTER_SAMPLE_MS - 1); });
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText("Overwhelmed?")).toBeTruthy();
    expect(readCoachLedger().seen).toContain(OVERWHELMED_ID);

    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); }); // the bubble waits for the arrow to land
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    act(() => { vi.advanceTimersByTime(10); });
    expect(opened).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Make AXOM yours" })).toBeNull();
    window.removeEventListener(CUSTOMIZE_SIDEBAR_EVENT, opened);
    window.removeEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
  });

  it("pauses the sample clock while a dialog is up", async () => {
    const scroller = placeElement("surface-scroll", { left: 0, top: 0, width: 600, height: 700 }, "div");
    placeElement("nav-manage-btn", { left: 31, top: 83, width: 229, height: 50 });
    const scrim = placeElement("modal-scrim", { left: 0, top: 0, width: 10, height: 10 }, "div");
    const preview = vi.fn((event: Event) => { (event as CustomEvent<{ accepted: boolean }>).detail.accepted = true; });
    window.addEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
    render(<CoachLayer route="reports" suspended={false} />);
    scroller.scrollTop = 1;
    fireEvent.scroll(scroller);
    act(() => { vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS + 5_000); });
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    await act(async () => { scrim.remove(); await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS - 1); });
    expect(preview).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event(FIRST_VISIT_LOCKIN_CLOSED_EVENT)));
    act(() => { vi.advanceTimersByTime(OVERWHELMED_AFTER_SAMPLE_MS); });
    expect(screen.getByText("Overwhelmed?")).toBeTruthy();
    window.removeEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
  });

  it("pauses the sample clock while the page is hidden", () => {
    const scroller = placeElement("surface-scroll", { left: 0, top: 0, width: 600, height: 700 }, "div");
    let hidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    const preview = vi.fn((event: Event) => { (event as CustomEvent<{ accepted: boolean }>).detail.accepted = true; });
    window.addEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
    try {
      render(<CoachLayer route="reports" suspended={false} />);
      scroller.scrollTop = 1;
      fireEvent.scroll(scroller);
      act(() => vi.advanceTimersByTime(20_000));
      hidden = true;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      act(() => vi.advanceTimersByTime(120_000));
      expect(preview).not.toHaveBeenCalled();
      hidden = false;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      act(() => vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS - 20_000 - 1));
      expect(preview).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(preview).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("pauses the sample clock while a regular check-in is open", async () => {
    const scroller = placeElement("surface-scroll", { left: 0, top: 0, width: 600, height: 700 }, "div");
    const preview = vi.fn((event: Event) => { (event as CustomEvent<{ accepted: boolean }>).detail.accepted = true; });
    window.addEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
    render(<CoachLayer route="reports" suspended={false} />);
    scroller.scrollTop = 1;
    fireEvent.scroll(scroller);
    act(() => vi.advanceTimersByTime(20_000));
    const regularPrompt = placeElement("focus-checkin", { left: 0, top: 0, width: 300, height: 200 }, "div");
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(60_000));
    expect(preview).not.toHaveBeenCalled();
    await act(async () => { regularPrompt.remove(); await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(FIRST_VISIT_LOCKIN_AFTER_SCROLL_MS - 20_000));
    expect(preview).toHaveBeenCalledOnce();
    window.removeEventListener(FIRST_VISIT_LOCKIN_PREVIEW_EVENT, preview);
  });

  it("shows one page hint once its target is on screen, and No more hints turns them off", () => {
    writeCoachLedger({ seen: [OVERWHELMED_ID] });
    placeElement("dashboard-edit-toggle", { left: 800, top: 240, width: 160, height: 34 });
    render(<CoachLayer route="dashboard" suspended={false} />);
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(screen.getByRole("dialog", { name: "Make this dashboard yours" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No more hints" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readCoachLedger()).toMatchObject({ off: true, seen: [OVERWHELMED_ID, "dashboard-edit"] });
  });

  it("skips a hint the learner no longer needs", () => {
    writeCoachLedger({ seen: [OVERWHELMED_ID] });
    const layout = { version: 1 as const, preset: "custom" as const, order: [], hiddenWidgetIds: [], widgets: {} };
    useStore.getState().updateProfile({ dashboardLayout: layout });
    placeElement("dashboard-edit-toggle", { left: 800, top: 240, width: 160, height: 34 });
    render(<CoachLayer route="dashboard" suspended={false} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
