// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { ProductivityPage } from "./ProductivityPage";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  useStore.setState(makeSeed());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProductivityPage daily console", () => {
  it("starts neutral and logs a practice-question quantity through the fast path", () => {
    render(<ProductivityPage />);
    expect(screen.getByText("No targets selected")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Log an activity" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Practice questions" } });
    fireEvent.change(screen.getByLabelText("How long in minutes?"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Quantity type"), { target: { value: "questions" } });
    fireEvent.change(screen.getByLabelText("Questions"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));

    expect(useStore.getState().logs[0]).toMatchObject({
      type: "Practice questions",
      minutes: 25,
      cards: 0,
      quantity: 30,
      quantityKind: "questions",
    });
  });

  it("accepts a named completion without inventing minutes or cards", () => {
    render(<ProductivityPage />);
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Prayer" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(useStore.getState().logs[0]).toMatchObject({
      type: "Prayer",
      minutes: 0,
      cards: 0,
      unitType: "yesno",
      quantity: 1,
    });
  });

  it("keeps historical views read-only", () => {
    render(<ProductivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(screen.queryByLabelText("What did you do?")).toBeNull();
    expect(screen.getByText("History is read-only.")).toBeTruthy();
    expect(useStore.getState().logs).toHaveLength(0);
  });

  it("stores pages and repetitions as labeled general quantities", () => {
    render(<ProductivityPage />);
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Read a chapter" } });
    fireEvent.change(screen.getByLabelText("Quantity type"), { target: { value: "pages" } });
    const pages = screen.getByLabelText("Pages") as HTMLInputElement;
    expect(pages.placeholder).toBe("12 pages");
    fireEvent.change(pages, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(useStore.getState().logs[0]).toMatchObject({ quantity: 18, quantityKind: "count", quantityLabel: "pages" });
    expect(screen.getByText("What makes today successful")).toBeTruthy();
    expect(screen.getByText("Choose targets")).toBeTruthy();
  });

  it("shows the saved page label instead of the internal count kind in shortcuts", () => {
    const state = makeSeed();
    state.logs = [{
      id: "pages-log",
      dayKey: state.activeDayKey,
      ts: "2026-07-12T12:00:00.000Z",
      type: "Read a chapter",
      minutes: 0,
      cards: 0,
      quantity: 18,
      quantityKind: "count",
      quantityLabel: "pages",
    }];
    useStore.setState(state);
    render(<ProductivityPage />);
    expect(screen.getByText("18 pages")).toBeTruthy();
    expect(screen.queryByText("18 count")).toBeNull();
  });

  it("opens a same-route tour and keeps low-data trends missing-target safe", () => {
    render(<ProductivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open Productivity help tour" }));
    expect(screen.getByRole("dialog", { name: "Log activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Choose targets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Use the focus timer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Read trends" }).classList.contains("centered")).toBe(true);
  });

  it("places a five-entry Activity Log preview directly after the focus timer", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 8 }, (_, index) => ({
      id: `activity-${index}`, dayKey: state.activeDayKey, ts: `2026-10-20T12:0${7 - index}:00.000Z`,
      type: `Review block ${index + 1}`, minutes: 10, cards: 0,
    }));
    useStore.setState(state);
    const original = structuredClone(state.logs);
    const { container } = render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(container.querySelector('[data-module-tour="productivity-focus"]')?.nextElementSibling).toBe(log);
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(within(log).getByText("Showing 5 of 8 events.")).toBeTruthy();
    expect(within(log).queryByText(/Review block 6/)).toBeNull();
    const toggle = within(log).getByRole("button", { name: "Show all 8 events" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(log.querySelector(".activity-feed"));
    fireEvent.click(toggle);
    expect(log.querySelectorAll(".activity-row")).toHaveLength(8);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(log).getByRole("button", { name: "Show less" }));
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(useStore.getState().logs).toEqual(original);
  });

  it("labels the 200-event expanded cap honestly and preserves all 343 entries", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 343 }, (_, index) => ({
      id: `long-history-${index}`, dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z",
      type: `Recorded activity ${index + 1}`, minutes: 1, cards: 0,
    }));
    useStore.setState(state);
    const original = structuredClone(state.logs);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(within(log).queryByRole("button", { name: "Show all 343 events" })).toBeNull();
    fireEvent.click(within(log).getByRole("button", { name: "Show latest 200 events" }));
    expect(log.querySelectorAll(".activity-row")).toHaveLength(200);
    expect(within(log).getByText("Showing 200 of 343 events. Open full activity for older entries.")).toBeTruthy();
    expect(within(log).getByRole("link", { name: "View full activity" }).getAttribute("href")).toBe("#activity");
    expect(useStore.getState().logs).toEqual(original);
  });

  it("allows notes to expand even when the history fits in the five-entry preview", () => {
    const state = makeSeed();
    state.logs = [{
      id: "note-log", dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z", type: "Lecture review",
      minutes: 20, cards: 0, note: "First line of a detailed note.\nA second line that must remain available.",
    }];
    useStore.setState(state);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(log.classList.contains("is-preview")).toBe(true);
    fireEvent.click(within(log).getByRole("button", { name: "Expand notes" }));
    expect(log.classList.contains("is-expanded")).toBe(true);
    expect(log.querySelector(".activity-note")?.textContent).toBe(state.logs[0].note);
    fireEvent.click(within(log).getByRole("button", { name: "Show less" }));
    expect(log.classList.contains("is-preview")).toBe(true);
  });

  it("does not offer redundant expansion for exactly five note-free events", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 5 }, (_, index) => ({
      id: `small-history-${index}`, dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z",
      type: "Study", minutes: 1, cards: 0,
    }));
    useStore.setState(state);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(within(log).queryByRole("button")).toBeNull();
  });
});
