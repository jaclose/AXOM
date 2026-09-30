// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Targets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configure targets" }));
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
});
