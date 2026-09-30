// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("opens a four-stop Help guide on the page itself (I1-17)", () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open Reports help tour" }));
    for (const title of ["Start with today", "Find your best hours", "Read the trend, not one day"]) {
      expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("dialog", { name: "Your own variables" })).toBeTruthy();
  });

  it("uses honest low-data states and removes future/developer placeholders", () => {
    render(<ReportsPage />);
    expect(screen.getByText("No targets", { selector: ".stat-value" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Trend" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Study system" })).toBeTruthy();
    expect(screen.getByText("No energy check today")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your rhythm" })).toBeTruthy();
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

  it("does not invent capacity from today's activity alone", () => {
    const dayKey = useStore.getState().activeDayKey;
    useStore.setState({
      logs: [{ id: "meaningful-work", dayKey, ts: `${dayKey}T12:00:00.000Z`, type: "Study", minutes: 60, cards: 0, academic: true, productive: true }],
    });
    render(<ReportsPage />);
    expect(screen.getByText("No signal", { selector: ".stat-value" })).toBeTruthy();
    expect(screen.getByText("No energy check today")).toBeTruthy();
  });

  it("reads capacity from an energy check against the learner's own usual", () => {
    const today = useStore.getState().activeDayKey;
    const day = (offset: number) => shiftDay(today, offset);
    useStore.setState({
      logs: [-5, -4, -3].map((offset) => ({ id: `log-${offset}`, dayKey: day(offset), ts: `${day(offset)}T12:00:00.000Z`, type: "Study", minutes: 120, cards: 0, academic: true, productive: true })),
      profile: {
        ...useStore.getState().profile,
        energyChecks: [
          ...[-5, -4, -3].map((offset) => ({ at: `${day(offset)}T10:00:00`, score: 55 })),
          { at: `${today}T09:00:00`, score: 92 },
        ],
      },
    });
    render(<ReportsPage />);
    expect(screen.getByText("Room to push", { selector: ".stat-value" })).toBeTruthy();
    expect(screen.getByText("Aim for about 130 min of study")).toBeTruthy();
    expect(screen.getAllByText(/above your usual/).length).toBeGreaterThan(0);
  });

  it("suggests a lighter day after an unusually long one", () => {
    const today = useStore.getState().activeDayKey;
    const day = (offset: number) => shiftDay(today, offset);
    useStore.setState({
      logs: [
        ...[-6, -5, -4, -3, -2].map((offset) => ({ id: `log-${offset}`, dayKey: day(offset), ts: `${day(offset)}T12:00:00.000Z`, type: "Study", minutes: 100, cards: 0, academic: true, productive: true })),
        { id: "long-day", dayKey: day(-1), ts: `${day(-1)}T12:00:00.000Z`, type: "Study", minutes: 260, cards: 0, academic: true, productive: true },
      ],
    });
    render(<ReportsPage />);
    expect(screen.getByText("Go lighter", { selector: ".stat-value" })).toBeTruthy();
    expect(screen.getAllByText(/Yesterday ran long \(260 min vs a typical 100\)/).length).toBeGreaterThan(0);
  });

  it("logs a one-tap energy check from the rhythm panel", () => {
    render(<ReportsPage />);
    const group = screen.getAllByRole("group", { name: "Log your energy right now" })[0];
    fireEvent.click(within(group).getByRole("button", { name: "Log energy: Good" }));
    expect(useStore.getState().profile.energyChecks).toEqual([expect.objectContaining({ score: 75 })]);
    expect(screen.queryByText("No energy check today")).toBeNull();
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

function shiftDay(dayKey: string, offset: number) {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
