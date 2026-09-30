// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDailyRequirement } from "../../lib/dailySuccess";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { useToasts } from "../../lib/toast";
import type { DailySuccessSchedule } from "../../lib/types";
import { DailyRequirementsEditor } from "./DailyRequirementsEditor";

let today = "";

function seedRequirement(schedule: DailySuccessSchedule = { kind: "daily" }) {
  const seed = makeSeed();
  today = seed.activeDayKey;
  seed.profile.dailySuccess = {
    version: 1,
    configuredAt: "2026-07-01",
    requirements: [makeDailyRequirement({
      id: "minutes",
      label: "Focused study",
      source: { kind: "study-minutes" },
      target: 60,
      unit: "minutes",
      schedule,
      trackingStartsAt: "2026-07-01",
    }, "2026-07-01")],
  };
  useStore.setState(seed);
}

function currentRequirement() {
  return useStore.getState().profile.dailySuccess!.requirements[0];
}

beforeEach(() => {
  seedRequirement();
  window.localStorage?.clear();
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("DailyRequirementsEditor scoring boundaries", () => {
  it("changes study display units without losing weekly history or manual corrections", () => {
    seedRequirement({ kind: "weekly-total", weekStartsOn: 1 });
    const state = useStore.getState();
    const day = "2026-09-30";
    today = day;
    const requirement = { ...currentRequirement(), target: 120, trackingStartsAt: "2026-09-28", manualContributions: [{ id: "adjustment", requirementId: "minutes", dayKey: day, value: 30, unit: "minutes", mode: "add" as const, createdAt: `${day}T12:00:00Z`, updatedAt: `${day}T12:00:00Z` }] };
    useStore.setState({ activeDayKey: day, logs: [{ id: "earlier", dayKey: "2026-09-29", ts: "2026-09-29T12:00:00Z", type: "Study", minutes: 90, cards: 0 }], profile: { ...state.profile, dailySuccess: { ...state.profile.dailySuccess!, requirements: [requirement] } } });
    render(<DailyRequirementsEditor expanded />);
    fireEvent.change(screen.getByLabelText("Study target unit"), { target: { value: "hours" } });
    expect(currentRequirement()).toMatchObject({ target: 2, unit: "hours", trackingStartsAt: "2026-09-28" });
    expect(evaluateDailySuccess(useStore.getState()).requirements[0]).toMatchObject({ current: 2, target: 2, status: "met" });
    fireEvent.change(screen.getByLabelText("Study target unit"), { target: { value: "minutes" } });
    expect(evaluateDailySuccess(useStore.getState()).requirements[0]).toMatchObject({ current: 120, target: 120, status: "met" });
  });

  it.each(["weekly-total", "times-per-week"] as const)("edits today's manual value separately from a %s result", (kind) => {
    const state = useStore.getState();
    today = "2026-09-30";
    const requirement = makeDailyRequirement({ id: "pages", label: "Pages", source: { kind: "manual" }, target: 5, unit: "pages", trackingStartsAt: "2026-09-28", schedule: kind === "weekly-total" ? { kind, weekStartsOn: 1 } : { kind, times: 3, weekStartsOn: 1 }, manualContributions: [
      { id: "yesterday", requirementId: "pages", dayKey: "2026-09-29", value: 5, unit: "pages", mode: "override", createdAt: "2026-09-29T12:00:00Z", updatedAt: "2026-09-29T12:00:00Z" },
      { id: "today", requirementId: "pages", dayKey: today, value: 2, unit: "pages", mode: "override", createdAt: `${today}T12:00:00Z`, updatedAt: `${today}T12:00:00Z` },
    ] });
    useStore.setState({ activeDayKey: today, profile: { ...state.profile, dailySuccess: { version: 1, configuredAt: today, requirements: [requirement] } } });
    render(<DailyRequirementsEditor expanded />);
    const input = screen.getByLabelText("Today’s value") as HTMLInputElement;
    expect(input.value).toBe("2");
    fireEvent.blur(input);
    expect(currentRequirement().manualContributions?.find((item) => item.dayKey === today)?.value).toBe(2);
  });
  it("starts a target change today instead of rescoring older dates", () => {
    render(<DailyRequirementsEditor />);
    fireEvent.change(screen.getAllByLabelText("Target")[0], { target: { value: "90" } });
    expect(currentRequirement()).toMatchObject({ target: 90, trackingStartsAt: today });
  });

  it("starts a schedule change today instead of rescoring older dates", () => {
    render(<DailyRequirementsEditor />);
    fireEvent.change(screen.getAllByLabelText("Schedule")[0], { target: { value: "weekdays" } });
    expect(currentRequirement()).toMatchObject({
      trackingStartsAt: today,
      schedule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] },
    });
  });

  it("never stores an empty selected-weekday schedule and starts weekday edits today", () => {
    seedRequirement({ kind: "weekdays", weekdays: [1, 2] });
    render(<DailyRequirementsEditor />);

    fireEvent.click(screen.getByLabelText("Monday"));
    expect(currentRequirement()).toMatchObject({
      trackingStartsAt: today,
      schedule: { kind: "weekdays", weekdays: [2] },
    });
    expect((screen.getByLabelText("Tuesday") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Tuesday"));
    expect(currentRequirement().schedule).toEqual({ kind: "weekdays", weekdays: [2] });
  });

  it("starts a changed weekly quota today", () => {
    seedRequirement({ kind: "times-per-week", times: 3, weekStartsOn: 1 });
    render(<DailyRequirementsEditor />);
    fireEvent.change(screen.getByLabelText("Times"), { target: { value: "4" } });
    expect(currentRequirement()).toMatchObject({
      trackingStartsAt: today,
      schedule: { kind: "times-per-week", times: 4, weekStartsOn: 1 },
    });
  });
});

describe("DailyRequirementsEditor completion sources", () => {
  function startNeutral() {
    const seed = makeSeed();
    today = seed.activeDayKey;
    seed.profile.dailySuccess = { version: 1, configuredAt: today, requirements: [] };
    seed.profile.experimentalFlags = { ...seed.profile.experimentalFlags, habits: false };
    seed.logs = [];
    seed.habits = [];
    seed.habitEntries = [];
    useStore.setState(seed);
  }

  function openCustomForm() {
    fireEvent.click(screen.getByText("Add a custom recurring requirement"));
  }

  function addNamedTarget(name: string) {
    fireEvent.change(screen.getByPlaceholderText("Gym, reading, prayer, steps…"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Add target" }));
  }

  it("lets a manual target be checked and undone without creating an activity record", () => {
    startNeutral();
    render(<DailyRequirementsEditor />);
    openCustomForm();
    addNamedTarget("Prayer");

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    const requirement = currentRequirement();
    expect(requirement.source).toEqual({ kind: "manual" });
    expect(requirement.manualContributions?.at(-1)).toMatchObject({
      requirementId: requirement.id,
      dayKey: today,
      value: 1,
      mode: "override",
    });
    expect(useStore.getState().logs).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(currentRequirement().manualContributions?.at(-1)?.value).toBe(0);
  });

  it("matches an activity alias exactly and does not use substring matches", async () => {
    startNeutral();
    render(<DailyRequirementsEditor />);
    openCustomForm();
    fireEvent.change(screen.getByLabelText("Completion source"), { target: { value: "activity" } });
    fireEvent.change(screen.getByPlaceholderText("gym, workout, lifting"), { target: { value: "workout" } });
    addNamedTarget("Gym");

    await act(async () => { useStore.getState().logActivity({ label: "Workout notes", quantity: 1, quantityKind: "count" }); });
    expect(screen.getByText("0 of 1 times")).toBeTruthy();
    await act(async () => { useStore.getState().logActivity({ label: "WORKOUT", quantity: 1, quantityKind: "count" }); });
    await waitFor(() => expect(screen.getByText("1 of 1 times")).toBeTruthy());
  });

  it("links one target to one Habit Tracker record and writes the check there", () => {
    startNeutral();
    render(<DailyRequirementsEditor />);
    openCustomForm();
    fireEvent.change(screen.getByLabelText("Completion source"), { target: { value: "habit" } });
    addNamedTarget("Read outside");

    const requirement = currentRequirement();
    expect(requirement.source.kind).toBe("habit");
    expect(useStore.getState().habits).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(useStore.getState().habitEntries).toHaveLength(1);
    expect(useStore.getState().habitEntries[0]).toMatchObject({
      habitId: requirement.source.kind === "habit" ? requirement.source.habitId : "",
      date: today,
      status: "done",
    });
  });

  it("offers Habit Tracker after a manual recurring target and cannot duplicate the target", () => {
    vi.useFakeTimers();
    startNeutral();
    render(<DailyRequirementsEditor />);
    openCustomForm();
    addNamedTarget("Walk");

    act(() => { vi.advanceTimersByTime(450); });
    const toast = useToasts.getState().toasts[0];
    expect(toast).toMatchObject({ title: "Track this as a recurring habit?" });
    const enable = toast.actions?.find((action) => action.label === "Enable Habit Tracker")?.onAction;
    expect(enable).toBeTypeOf("function");
    enable?.();
    enable?.();

    expect(useStore.getState().habits).toHaveLength(1);
    expect(useStore.getState().profile.dailySuccess?.requirements).toHaveLength(1);
    expect(useStore.getState().profile.dailySuccess?.requirements[0].source.kind).toBe("habit");
    expect(useStore.getState().profile.experimentalFlags?.habits).toBe(true);
  });

  it("can undo and reassign a matched activity while preserving its source log", () => {
    startNeutral();
    const state = useStore.getState();
    const createdAt = `${today}T09:00:00.000Z`;
    const gym = makeDailyRequirement({
      id: "gym",
      label: "Gym",
      source: { kind: "activity-alias" },
      aliases: ["Workout"],
      target: 1,
      unit: "times",
      trackingStartsAt: today,
      createdAt,
      updatedAt: createdAt,
    }, today);
    const movement = makeDailyRequirement({
      id: "movement",
      label: "Movement",
      source: { kind: "manual" },
      target: 1,
      unit: "times",
      trackingStartsAt: today,
      createdAt,
      updatedAt: createdAt,
    }, today);
    useStore.setState({
      profile: { ...state.profile, dailySuccess: { version: 1, configuredAt: today, requirements: [gym, movement] } },
      logs: [{ id: "workout-log", dayKey: today, ts: createdAt, type: "Workout", minutes: 0, cards: 0, quantity: 1, quantityKind: "count" }],
    });
    render(<DailyRequirementsEditor />);

    fireEvent.click(screen.getByText("Today’s matched activity"));
    fireEvent.change(screen.getByLabelText("Reassign Workout from Gym"), { target: { value: "movement" } });

    const [updatedGym, updatedMovement] = useStore.getState().profile.dailySuccess!.requirements;
    expect(updatedGym.excludedSourceRecordIds).toEqual(["workout-log"]);
    expect(updatedMovement.includedSourceRecordIds).toEqual(["workout-log"]);
    expect(useStore.getState().logs).toHaveLength(1);
    expect(useStore.getState().logs[0].type).toBe("Workout");
  });
});
