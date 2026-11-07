// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { CadenceGoalReport } from "./CadenceGoalReport";

beforeEach(() => {
  const seed = makeSeed();
  useStore.setState({ ...seed, habits: [], habitEntries: [], logs: [] });
});
afterEach(cleanup);

describe("private cadence reporting", () => {
  it("shows eligible gym weekly data from a single check-in, without inventing skipped days", () => {
    const state = useStore.getState();
    const id = state.addHabit({
      name: "Gym", type: "weekly", weeklyTarget: 4, weeklyMinimum: 4, weeklyPreferred: 5,
      trackingStartsAt: state.activeDayKey, includeInReports: true,
    });
    useStore.getState().checkHabit(id, state.activeDayKey, "done", 1);
    render(<CadenceGoalReport />);
    expect(screen.getByText("Gym")).toBeTruthy();
    expect(screen.getByText(/minimum this week/)).toBeTruthy();
    expect(screen.getByText(/Rest days are not failures/)).toBeTruthy();
  });

  it("keeps named spiritual goals absent from Reports unless explicitly opted in", () => {
    const state = useStore.getState();
    const id = state.addHabit({
      name: "Daily prayers", type: "slots", includeInReports: false,
      occurrenceSlots: [
        { id:"fajr",label:"Fajr" },{ id:"dhuhr",label:"Dhuhr" },
        { id:"asr",label:"Asr" },{ id:"maghrib",label:"Maghrib" },{ id:"isha",label:"Isha" },
      ],
    });
    const { rerender } = render(<CadenceGoalReport />);
    expect(screen.queryByText("Daily prayers")).toBeNull();
    useStore.getState().updateHabit(id, { includeInReports: true });
    rerender(<CadenceGoalReport />);
    expect(screen.getByText("Daily prayers")).toBeTruthy();
    expect(screen.getByText(/Unreported is not the same as missed/)).toBeTruthy();
  });
});
