// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HabitReportPanel } from "./HabitReportPanel";

const snapshot = {
  activeDayKey: "2026-11-07",
  profile: { experimentalFlags: { habits: true } },
  habits: [
    { id: "h1", name: "Daily retrieval", type: "binary", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" },
    { id: "h2", name: "Archived ritual", archived: true, type: "binary", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" },
    { id: "h3", name: "Three reviews this week", type: "weekly", weeklyTarget: 3, createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" },
  ],
  habitEntries: [
    { id: "e1", habitId: "h1", date: "2026-11-07", status: "done", createdAt: "2026-11-07T12:00:00Z" },
    { id: "e2", habitId: "h1", date: "2026-11-06", status: "skipped", createdAt: "2026-11-06T12:00:00Z" },
  ],
};
vi.mock("../../lib/store", () => ({ useStore: () => snapshot }));
afterEach(cleanup);

describe("Reports routine evidence", () => {
  it("shows only current recorded routines, distinguishing intentional skips", () => {
    render(<HabitReportPanel />);
    expect(screen.getByText("Daily retrieval")).toBeTruthy();
    expect(screen.getByText("Three reviews this week")).toBeTruthy();
    expect(screen.getByText("2 / 7")).toBeTruthy(); // Weekly-target goals are not seven daily obligations.
    expect(screen.queryByText("Archived ritual")).toBeNull();
    expect(screen.getByText(/1 done/)).toBeTruthy();
    expect(screen.getByText(/1 skipped/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review habits/ }).getAttribute("href")).toBe("#habits");
  });
});
