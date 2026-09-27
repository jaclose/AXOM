// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideStep } from "../../lib/guide/topics";
import { GuidePointer } from "./GuidePointer";

const STEPS: GuideStep[] = [
  { route: "anki", target: "guide-test-open", title: "Open the tab", body: "Click the tab." },
  { route: "anki", target: "guide-test-form", title: "Fill the form", body: "Paste your notes." },
];

function Page({ showForm = false }: { showForm?: boolean }) {
  return (
    <div>
      <button type="button" data-guide="guide-test-open">Open</button>
      <button type="button">Elsewhere</button>
      {showForm && <form data-guide="guide-test-form"><textarea aria-label="Notes" /></form>}
    </div>
  );
}

function renderPointer(props: { route?: string; steps?: GuideStep[]; showForm?: boolean } = {}) {
  const onNavigate = vi.fn();
  const onExit = vi.fn();
  const view = render(
    <>
      <Page showForm={props.showForm} />
      <GuidePointer steps={props.steps ?? STEPS} currentRoute={props.route ?? "anki"} onNavigate={onNavigate} onExit={onExit} />
    </>,
  );
  const rerender = (route: string, showForm = props.showForm) => view.rerender(
    <>
      <Page showForm={showForm} />
      <GuidePointer steps={props.steps ?? STEPS} currentRoute={route} onNavigate={onNavigate} onExit={onExit} />
    </>,
  );
  return { onNavigate, onExit, rerender };
}

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("GuidePointer", () => {
  it("opens the step's page once, without veiling the app", () => {
    const { onNavigate } = renderPointer({ route: "dashboard" });
    expect(onNavigate).toHaveBeenCalledWith("anki");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const callout = screen.getByRole("dialog", { name: "Open the tab" });
    expect(callout.getAttribute("aria-modal")).toBe("false");
  });

  it("rings and focuses the real control, and continues when it is clicked", () => {
    const { onExit } = renderPointer({ showForm: true });
    const target = screen.getByRole("button", { name: "Open" });
    expect(document.querySelector(".guide-ring")).not.toBeNull();
    expect(document.activeElement).toBe(target);
    expect(screen.getByText("Click the highlighted control to continue.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("dialog", { name: "Open the tab" })).toBeTruthy();

    fireEvent.click(target);
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("dialog", { name: "Fill the form" })).toBeTruthy();
    expect(screen.getByText("Guide · 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("says so when a target never appears, and still lets the learner move on", () => {
    renderPointer();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/This isn't on screen right now\. Paste your notes\./)).toBeTruthy();
    expect(document.querySelector(".guide-ring")).toBeNull();
  });

  it("finds a target that renders late, such as after a tab switch", () => {
    const { rerender } = renderPointer();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector(".guide-ring")).toBeNull();
    rerender("anki", true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.querySelector(".guide-ring")).not.toBeNull();
    expect(screen.queryByText(/isn't on screen/)).toBeNull();
  });

  it("gets out of the way when the learner leaves the page or presses Escape", () => {
    const left = renderPointer();
    left.rerender("reports");
    expect(left.onExit).toHaveBeenCalledTimes(1);
    expect(left.onNavigate).not.toHaveBeenCalled();
    cleanup();

    const escaped = renderPointer();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(escaped.onExit).not.toHaveBeenCalled();
    modal.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(escaped.onExit).toHaveBeenCalledTimes(1);
  });

  it("closes from its own close button", () => {
    const { onExit } = renderPointer();
    fireEvent.click(screen.getByRole("button", { name: "Stop the guide" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
