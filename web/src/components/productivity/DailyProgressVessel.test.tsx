// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DailySuccessResult } from "../../lib/dailySuccess";
import { DailyProgressVessel } from "./DailyProgressVessel";

const neutral: DailySuccessResult = {
  mode: "configured",
  dayKey: "2026-07-12",
  requirements: [],
  eligibleCount: 0,
  metCount: 0,
  progress: 0,
  status: "neutral",
  statusLabel: "No requirements selected",
};

afterEach(cleanup);

describe("DailyProgressVessel", () => {
  it("exposes deterministic textual progress and a neutral initial state", () => {
    const { rerender, container } = render(<DailyProgressVessel result={neutral} />);
    const progress = screen.getByRole("progressbar", { name: "Daily success progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(progress.getAttribute("aria-valuetext")).toContain("No targets selected");

    rerender(<DailyProgressVessel result={{ ...neutral, eligibleCount: 2, metCount: 1, progress: 50, status: "in-progress", statusLabel: "In progress" }} />);
    expect(progress.getAttribute("aria-valuenow")).toBe("50");
    expect(progress.getAttribute("aria-valuetext")).toContain("1 of 2");
    expect(container.querySelector(".daily-progress-fill")?.getAttribute("style")).toContain("50%");
  });

  it("shows the selected-day context and the streak threshold only for scored targets", () => {
    const { rerender, container } = render(<DailyProgressVessel result={neutral} dayLabel="Selected day" />);
    expect(screen.getByText("Selected day")).toBeTruthy();
    expect(container.querySelector(".daily-progress-threshold")).toBeNull();
    rerender(<DailyProgressVessel dayLabel="Today" result={{ ...neutral, eligibleCount: 1, metCount: 0, progress: 43, status: "in-progress", statusLabel: "In progress" }} />);
    expect(screen.getByText("Today")).toBeTruthy();
    expect(container.querySelector(".daily-progress-threshold")).toBeTruthy();
    expect(screen.getByText("80% streak threshold")).toBeTruthy();
  });

  it("reveals native, weighted, source, and remaining progress for keyboard and touch users", () => {
    const result: DailySuccessResult = {
      ...neutral,
      eligibleCount: 1,
      metCount: 0,
      progress: 38,
      status: "in-progress",
      statusLabel: "In progress",
      requirements: [{
        requirement: {
          id: "focus",
          label: "Focused study",
          enabled: true,
          source: { kind: "study-minutes" },
          weight: 2,
          target: 60,
          unit: "minutes",
          schedule: { kind: "daily" },
          trackingStartsAt: "2026-07-12",
          createdAt: "2026-07-12T08:00:00.000Z",
          updatedAt: "2026-07-12T08:00:00.000Z",
        },
        eligible: true,
        current: 45,
        target: 60,
        ratio: .75,
        status: "in-progress",
        sourceLabel: "Study activity",
        sourceRecordIds: ["log-1"],
        contributions: [{
          event: "activity",
          eventId: "log-1",
          sourceRecord: "study-log",
          sourceRecordId: "log-1",
          targetId: "focus",
          value: 45,
          unit: "minutes",
          dayKey: "2026-07-12",
          dedupeKey: "focus:study-log:log-1",
          confidence: .99,
          manualOverride: false,
          correction: false,
          matchedBy: "native",
        }],
        calculation: "45 of 60 minutes",
      }],
    };

    render(<DailyProgressVessel result={result} />);
    const control = screen.getByRole("button", { name: "Where today’s progress came from" });
    fireEvent.focus(control);
    expect(control.classList.contains("peek")).toBe(true);
    fireEvent.keyDown(control, { key: "Enter" });

    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(control.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Daily target contribution breakdown" })).toBeTruthy();
    expect(screen.getByText("45 of 60 minutes")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("75 points")).toBeTruthy();
    expect(screen.getByText("Activity log")).toBeTruthy();
    expect(screen.getByText("15 minutes")).toBeTruthy();

    fireEvent.keyDown(control, { key: "Escape" });
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });
});
