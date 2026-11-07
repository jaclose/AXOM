// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { HabitTrackerPage } from "./HabitTrackerPage";
import { useStore } from "../lib/store";

beforeEach(() => {
  cleanup();
  // Reset to a known baseline: flag off, no habits.
  useStore.setState((s) => ({
    profile: { ...s.profile, experimentalFlags: undefined },
    habits: [],
    habitEntries: [],
  }));
});

describe("recurring cadence goals", () => {
  it("creates a rest-aware gym goal with a four-day minimum and five-day preference", () => {
    useStore.getState().updateProfile({ experimentalFlags: { habits: true } });
    render(<HabitTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Gym · 4–5 days/week" }));
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    const gym = useStore.getState().habits.find((habit) => habit.name === "Gym");
    expect(gym).toMatchObject({ type: "weekly", weeklyMinimum: 4, weeklyPreferred: 5, includeInReports: true });
    expect(screen.getByText(/minimum days/i)).toBeTruthy();
  });

  it("records five named prayer slots without generating activity logs or duplicate check-ins", () => {
    useStore.getState().updateProfile({ experimentalFlags: { habits: true } });
    render(<HabitTrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Five named daily prayers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    const prayer = useStore.getState().habits.find((habit) => habit.name === "Daily prayers")!;
    expect(prayer).toMatchObject({ type: "slots", includeInReports: false });
    expect(prayer.occurrenceSlots?.map((slot) => slot.label)).toEqual(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]);
    fireEvent.click(screen.getByRole("button", { name: "Complete Fajr" }));
    expect(useStore.getState().habitEntries[0]?.slotCheckIns).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo Fajr" }));
    expect(useStore.getState().habitEntries).toHaveLength(0);
    expect(useStore.getState().logs).toHaveLength(0);
  });
});

describe("HabitTrackerPage (render smoke)", () => {
  it("shows the opt-in empty state when the flag is off", () => {
    render(<HabitTrackerPage />);
    expect(screen.getByText(/this is an early feature/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /enable habit tracker/i })).toBeTruthy();
  });

  it("renders the tracker, a created habit, and its check-in controls when enabled", () => {
    useStore.getState().updateProfile({ experimentalFlags: { habits: true } });
    useStore.getState().addHabit({ name: "Morning sunlight", type: "binary" });
    render(<HabitTrackerPage />);
    expect(screen.getByText("Morning sunlight")).toBeTruthy();
    // Non-punitive check-in options must all be present.
    for (const label of ["Done", "Partial", "Skipped", "Missed"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});
