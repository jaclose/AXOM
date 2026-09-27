// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_PROGRESS_KEY } from "../../lib/onboardingProgress";
import { GUIDED_TOUR_STEPS, GuidedTour } from "./GuidedTour";

const sessionValues = new Map<string, string>();
const memorySession = {
  get length() { return sessionValues.size; },
  clear: () => sessionValues.clear(),
  getItem: (key: string) => sessionValues.get(key) ?? null,
  key: (index: number) => [...sessionValues.keys()][index] ?? null,
  removeItem: (key: string) => { sessionValues.delete(key); },
  setItem: (key: string, value: string) => { sessionValues.set(key, String(value)); },
};

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memorySession);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function TourHarness({ onExit = () => {} }: { onExit?: () => void }) {
  const [route, setRoute] = useState("dashboard");
  return (
    <>
      <div data-tour="question-bank-entry">Question Bank entry target</div>
      <output aria-label="Current tour route">{route}</output>
      <GuidedTour onExit={onExit} onNavigate={setRoute} currentRoute={route} />
    </>
  );
}

function next(count: number) {
  for (let index = 0; index < count; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

describe("GuidedTour", () => {
  it("contains exactly seven meaningful steps and retains the accepted Question Bank workflow", () => {
    expect(GUIDED_TOUR_STEPS).toHaveLength(7);
    expect(GUIDED_TOUR_STEPS.map((step) => step.title)).toEqual([
      "Up next",
      "Course Tracker",
      "Question Bank",
      "Why AXOM suggested this",
      "Reports",
      "Customize",
      "Data safety",
    ]);
    expect(GUIDED_TOUR_STEPS[2]).toMatchObject({
      route: "questions",
      target: "question-bank-entry",
      body: expect.stringContaining("Import → Review → Practice → Understand"),
    });
    expect(GUIDED_TOUR_STEPS[3].target).toBe("recommendation-provenance");
    expect(GUIDED_TOUR_STEPS[6].target).toBeUndefined();
  });

  it.each([
    { reducedMotion: true, expectedBehavior: "auto" as const },
    { reducedMotion: false, expectedBehavior: "smooth" as const },
  ])("uses $expectedBehavior scrolling for the Question Bank step", async ({ reducedMotion, expectedBehavior }) => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    render(<TourHarness />);
    next(2);

    expect(screen.getByText("Question Bank", { selector: ".tour-tip-title" })).toBeTruthy();
    expect(screen.getByText(/Import → Review → Practice → Understand/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Current tour route" }).textContent).toBe("questions");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: expectedBehavior });
    });
  });

  it("resumes a valid session step and clamps stale progress", async () => {
    sessionStorage.setItem(TOUR_PROGRESS_KEY, "4");
    const { unmount } = render(<TourHarness />);
    expect(screen.getByText("Reports", { selector: ".tour-tip-title" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status", { name: "Current tour route" }).textContent).toBe("reports"));

    unmount();
    sessionStorage.setItem(TOUR_PROGRESS_KEY, "99");
    render(<TourHarness />);
    expect(screen.getByText("Up next", { selector: ".tour-tip-title" })).toBeTruthy();
  });

  it("keeps controls reachable when a target is missing and supports Escape", () => {
    const onExit = vi.fn();
    render(<TourHarness onExit={onExit} />);

    const dialog = screen.getByRole("dialog", { name: "Up next" });
    expect(dialog.classList.contains("centered")).toBe(true);
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledWith("escape");
    expect(sessionStorage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
  });

  it("skips immediately and finishes on the centered data-safety step", () => {
    const onExit = vi.fn();
    const first = render(<TourHarness onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip guided tour" }));
    expect(onExit).toHaveBeenCalledWith("skip");
    first.unmount();

    onExit.mockClear();
    render(<TourHarness onExit={onExit} />);
    next(6);
    const dialog = screen.getByRole("dialog", { name: "Data safety" });
    expect(dialog.classList.contains("centered")).toBe(true);
    expect(screen.getByText(/Settings → Data and Backup/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onExit).toHaveBeenCalledWith("complete");
  });
});
