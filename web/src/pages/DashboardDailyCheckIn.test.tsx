// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyLoopReminderLedger } from "../lib/dailyLoopReminders";
import { makeDailyRequirement } from "../lib/dailySuccess";
import { DEFAULT_DASHBOARD_WIDGETS, makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { DashboardPage } from "./DashboardPage";

const localValues = new Map<string, string>();
const memoryLocalStorage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key: string) => localValues.get(key) ?? null,
  key: (index: number) => [...localValues.keys()][index] ?? null,
  removeItem: (key: string) => { localValues.delete(key); },
  setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
};

beforeEach(() => {
  localValues.clear();
  vi.stubGlobal("localStorage", memoryLocalStorage);
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  useUi.setState({ dailyLoopRequest: null, journalDay: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard Daily Check-In", () => {
  it("is optional and can be skipped, then reopened without creating a plan", () => {
    const day = "2035-04-10";
    setCheckInState(day);

    render(<DashboardPage />);
    expect(useStore.getState().dayPlans).toEqual([]);
    expect(screen.getByText("One to three win conditions (optional)")).toBeTruthy();
    expect(screen.getByText("Add context (optional)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(useStore.getState().dayPlans).toEqual([]);
    expect(dailyLoopReminderLedger.read(day).checkIn.disposition).toBe("skipped");
    expect(screen.getByText("Optional. Add direction whenever it would help.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));

    expect(screen.getByLabelText("Primary intention")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    expect(useStore.getState().dayPlans).toEqual([]);
  });

  it("saves the optional context fields on the canonical DayPlan and supports review reopening", () => {
    const day = "2035-04-11";
    setCheckInState(day);
    render(<DashboardPage />);

    fireEvent.change(screen.getByLabelText("Primary intention"), {
      target: { value: "Finish the renal review" },
    });
    fireEvent.change(screen.getByLabelText("One to three win conditions (optional)"), {
      target: { value: "Review filtration\nComplete 20 cards\nWrite summary\nIgnored fourth win" },
    });

    const context = screen.getByText("Add context (optional)").closest("details");
    expect(context).toBeTruthy();
    fireEvent.click(within(context!).getByText("Add context (optional)"));
    fireEvent.change(within(context!).getByLabelText("Expected study block"), { target: { value: "95" } });
    fireEvent.change(within(context!).getByLabelText("Priority course or topic"), { target: { value: "Renal physiology" } });
    fireEvent.change(within(context!).getByLabelText("Anticipated obstacle"), { target: { value: "Late lab" } });
    fireEvent.change(within(context!).getByLabelText("Personal note"), { target: { value: "Take a short break first" } });
    fireEvent.click(within(context!).getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Set today’s focus" }));

    expect(useStore.getState().dayPlans).toHaveLength(1);
    expect(useStore.getState().dayPlans[0]).toMatchObject({
      dayKey: day,
      intention: "Finish the renal review",
      wins: ["Review filtration", "Complete 20 cards", "Write summary"],
      expectedStudyMinutes: 95,
      priority: "Renal physiology",
      anticipatedObstacle: "Late lab",
      personalNote: "Take a short break first",
      commitmentLevel: 5,
    });
    expect(screen.getByText("95 min")).toBeTruthy();
    // Up next may also suggest the priority; this checks the check-in summary.
    expect(screen.getByText("Renal physiology", { selector: ":not(.up-next-title)" })).toBeTruthy();
    expect(screen.getByText("Late lab")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("End-of-day note (optional)"), {
      target: { value: "One section remains" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Partial" }));
    expect(useStore.getState().dayPlans[0]).toMatchObject({
      outcome: "partial",
      reviewNote: "One section remains",
    });

    fireEvent.click(screen.getByTitle("Re-open review"));
    expect(useStore.getState().dayPlans[0].outcome).toBeUndefined();
    expect(useStore.getState().dayPlans[0].reviewNote).toBeUndefined();
    expect(screen.getByPlaceholderText("End-of-day note (optional)")).toBeTruthy();
  });

  it("uses the eligible configured target labels without inventing extra wins", () => {
    const day = "2035-04-12";
    const requirements = [
      makeDailyRequirement({
        id: "focus-target",
        label: "Focused study",
        source: { kind: "study-minutes" },
        target: 60,
        unit: "minutes",
        trackingStartsAt: day,
      }, day),
      makeDailyRequirement({
        id: "cards-target",
        label: "Review cards",
        source: { kind: "cards-reviewed" },
        target: 30,
        unit: "cards",
        trackingStartsAt: day,
      }, day),
    ];
    setCheckInState(day, requirements);
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Use my targets" }));

    expect(useStore.getState().dayPlans).toHaveLength(1);
    expect(useStore.getState().dayPlans[0]).toMatchObject({
      intention: "Complete today’s chosen targets",
      wins: ["Focused study", "Review cards"],
      commitmentLevel: 3,
    });
    expect(dailyLoopReminderLedger.read(day).checkIn.disposition).toBe("shown");
    expect(screen.getByText("Focused study")).toBeTruthy();
    expect(screen.getByText("Review cards")).toBeTruthy();
  });

  it("marks a freshly set intention with a short status", () => {
    setCheckInState("2035-04-13");
    render(<DashboardPage />);
    fireEvent.change(screen.getByLabelText("Primary intention"), { target: { value: "Cardio block" } });
    fireEvent.click(screen.getByRole("button", { name: "Set today’s focus" }));
    expect(screen.getByText("Today’s intention")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Intention set");
    expect(screen.getByText("Cardio block", { selector: ".daily-checkin-intent span" }).parentElement?.classList.contains("is-new")).toBe(true);
  });

  it("turns on the writing prompt from the check-in's own settings", () => {
    setCheckInState("2035-04-14");
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Customize Daily Check-In" }));
    const option = screen.getByRole("checkbox", { name: /A short note after an energy check/ }) as HTMLInputElement;
    expect(option.checked).toBe(false);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().profile.dashboardLayout?.widgets.winDay?.preferences).toMatchObject({ writing: true });

    fireEvent.click(screen.getByRole("button", { name: "Log energy: Low" }));
    fireEvent.change(screen.getByLabelText(/weighing|eating|lighter/), { target: { value: "Too little sleep" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(useStore.getState().profile.energyChecks?.at(-1)).toMatchObject({ score: 35, note: "Too little sleep" });
  });
});

function setCheckInState(
  day: string,
  requirements: NonNullable<ReturnType<typeof makeSeed>["profile"]["dailySuccess"]>["requirements"] = [],
) {
  const seed = makeSeed();
  useStore.setState({
    ...seed,
    activeDayKey: day,
    profile: {
      ...seed.profile,
      dashboardWidgetOrder: [...DEFAULT_DASHBOARD_WIDGETS],
      hiddenDashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.filter((id) => id !== "winDay"),
      journalReviewTime: "23:59",
      dailyLoopReminders: {
        checkInEnabled: false,
        checkInTime: "08:00",
        closeoutEnabled: false,
        closeoutTime: "20:30",
      },
      dailySuccess: { version: 1, configuredAt: day, requirements },
    },
    tracker: [],
    logs: [],
    tasks: [],
    sessions: [],
    dayPlans: [],
    closeouts: [],
    recoveryPlans: [],
    questions: [],
    ankiCards: [],
    habits: [],
    habitEntries: [],
    journal: [],
    energyFactors: [],
  });
}
