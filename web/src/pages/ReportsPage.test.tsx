// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { ReportsPage } from "./ReportsPage";

beforeEach(() => {
  const seed = makeSeed();
  seed.logs = [];
  seed.tasks = [];
  seed.tracker = [];
  seed.journal = [];
  seed.energyFactors = [];
  seed.profile.dailySuccess = { version: 1, configuredAt: seed.activeDayKey, requirements: [] };
  useStore.setState(seed);
});

afterEach(cleanup);

describe("ReportsPage", () => {
  it("uses honest low-data states and removes future/developer placeholders", () => {
    render(<ReportsPage />);
    expect(screen.getByText("No targets", { selector: ".stat-value" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Trend" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Study system" })).toBeTruthy();
    expect(screen.getAllByText("No readiness input yet").length).toBeGreaterThan(0);
    expect(screen.queryByText(/31 failed days/i)).toBeNull();
    expect(screen.queryByText("Hourly week map")).toBeNull();
    expect(screen.queryByText("Traceability")).toBeNull();
  });

  it("explains a metric on explicit request and falls back to activity rhythm without targets", () => {
    render(<ReportsPage />);
    const trigger = screen.getByRole("button", { name: /Active days: show how this is calculated/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(detail?.textContent).toContain("What changed");
    expect(detail?.textContent).toContain("Calculation");
    expect(detail?.textContent).toContain("Source");
    expect(screen.getByText("Activity streak")).toBeTruthy();
  });

  it("charts the last seven calendar days from logs even without daily targets", () => {
    const today = useStore.getState().activeDayKey;
    useStore.setState({
      logs: [{ id: "today-study", dayKey: today, ts: `${today}T12:00:00.000Z`, type: "Deep Study", minutes: 95, cards: 0, academic: true, productive: true }],
    });
    render(<ReportsPage />);
    expect(screen.getByRole("group", { name: "Minutes for the last seven days" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /: 1h 35m; last week 0m/ }).length).toBe(1);
    expect(screen.getByText(/Study time: 1h 35m this week/)).toBeTruthy();
  });

  it("gives trend columns keyboard-focusable accessible names", () => {
    render(<ReportsPage />);
    const trend = screen.getAllByRole("button", { name: /: 0m; last week 0m/ })[0];
    expect(trend.tagName).toBe("BUTTON");
  });

  it("does not treat a trivial activity as readiness evidence", () => {
    const dayKey = useStore.getState().activeDayKey;
    useStore.setState({
      logs: [{
        id: "one-minute",
        dayKey,
        ts: `${dayKey}T12:00:00.000Z`,
        type: "Study",
        minutes: 1,
        cards: 0,
        academic: true,
        productive: true,
      }],
    });
    render(<ReportsPage />);
    expect(screen.getAllByText("No readiness input yet").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Completed meaningful work/)).toBeNull();
  });

  it("accepts an activity only when it produces a real readiness contribution", () => {
    const dayKey = useStore.getState().activeDayKey;
    useStore.setState({
      logs: [{
        id: "meaningful-work",
        dayKey,
        ts: `${dayKey}T12:00:00.000Z`,
        type: "Study",
        minutes: 60,
        cards: 0,
        academic: true,
        productive: true,
      }],
    });
    render(<ReportsPage />);
    expect(screen.queryByText("No readiness input yet")).toBeNull();
    expect(screen.getAllByText(/Completed meaningful work/).length).toBeGreaterThan(0);
  });

  it("keeps performance preliminary when only lifetime journal history has enough days", () => {
    useStore.setState({
      journal: Array.from({ length: 5 }, (_, index) => ({
        id: `old-journal-${index}`,
        date: `2026-06-0${index + 1}T20:00:00.000Z`,
        today: "Completed old work",
        tomorrow: "Continue",
        blockers: "",
        energy: "High",
        rating: "Useful",
      })),
    });
    render(<ReportsPage />);
    fireEvent.click(screen.getByText("More reports and technical detail"));
    expect(screen.getByText(/Building baseline/)).toBeTruthy();
    expect(screen.getByText(/0\/5 active days with signal/)).toBeTruthy();
  });
});
