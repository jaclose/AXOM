// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { TrackerManager } from "./TrackerManager";

beforeEach(() => {
  const seed = makeSeed();
  useStore.setState({ ...seed, logs: [], habits: [], habitEntries: [] });
});
afterEach(cleanup);

describe("TrackerManager", () => {
  it("logs a tracker in one tap", () => {
    render(<TrackerManager />);
    const gym = screen.getByRole("article", { name: "Gym" });
    fireEvent.click(within(gym).getByRole("button", { name: "Log 15 min of Gym" }));
    expect(useStore.getState().logs[0]).toMatchObject({ trackerId: "tracker-gym", minutes: 15 });
    expect(within(gym).getAllByText("15 min").length).toBeGreaterThan(0);
    expect(within(gym).getByText(/goal 45 min a day/)).toBeTruthy();
  });

  it("creates a limit tracker that explains what each switch does", () => {
    render(<TrackerManager />);
    fireEvent.click(screen.getByRole("button", { name: "New tracker" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Social media" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Keep it under/ }));
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /Daily limit/ }), { target: { value: "30" } });
    expect(within(dialog).getByText(/re-labels past entries too/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create tracker" }));
    const created = useStore.getState().productivityTrackers.find((tracker) => tracker.name === "Social media");
    expect(created).toMatchObject({ goal: "at-most", dailyTarget: 30, contributesToAcademicStudy: false, contributesToTotalProductiveTime: false });
    expect(screen.getByRole("article", { name: "Social media" })).toBeTruthy();
  });

  it("archives a tracker without losing its history", () => {
    useStore.getState().logProductivity({ trackerId: "tracker-writing", minutes: 30 });
    render(<TrackerManager />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Writing" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Archive/ }));
    expect(screen.queryByRole("article", { name: "Writing" })).toBeNull();
    expect(useStore.getState().logs).toHaveLength(1);
    expect(screen.getByRole("button", { name: /1 hidden or archived/ })).toBeTruthy();
  });
});
