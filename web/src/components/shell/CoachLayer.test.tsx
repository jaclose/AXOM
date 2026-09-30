// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMIZE_SIDEBAR_EVENT, OVERWHELMED_AFTER_MS, OVERWHELMED_ID, readCoachLedger, writeCoachLedger } from "../../lib/coach";
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
  it("says Overwhelmed? after 90 visible seconds, then points at Customize and opens it", () => {
    placeElement("nav-manage-btn", { left: 31, top: 83, width: 229, height: 50 });
    const opened = vi.fn();
    window.addEventListener(CUSTOMIZE_SIDEBAR_EVENT, opened);
    render(<CoachLayer route="reports" suspended={false} />);

    act(() => { vi.advanceTimersByTime(OVERWHELMED_AFTER_MS - 1_000); });
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
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
  });

  it("waits while another first-run layer or a dialog is up", () => {
    placeElement("nav-manage-btn", { left: 31, top: 83, width: 229, height: 50 });
    const scrim = placeElement("modal-scrim", { left: 0, top: 0, width: 10, height: 10 }, "div");
    render(<CoachLayer route="reports" suspended={false} />);
    act(() => { vi.advanceTimersByTime(OVERWHELMED_AFTER_MS + 5_000); });
    expect(screen.queryByText("Overwhelmed?")).toBeNull();
    scrim.remove();
    act(() => { vi.advanceTimersByTime(OVERWHELMED_AFTER_MS); });
    expect(screen.getByText("Overwhelmed?")).toBeTruthy();
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
