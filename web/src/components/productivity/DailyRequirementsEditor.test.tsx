// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDailyRequirement } from "../../lib/dailySuccess";
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

describe("Quick goal creation and check-off", () => {
  it("creates a self-reported activity goal with an exact label and no synthetic log", async () => {
    const state = makeSeed();
    today = state.activeDayKey;
    state.profile.dailySuccess = { version: 1, configuredAt: today, requirements: [] };
    state.logs = [];
    useStore.setState(state);
    render(<DailyRequirementsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    fireEvent.change(screen.getByLabelText("Goal type"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Renal question review" } });
    fireEvent.change(screen.getByLabelText("Goal amount"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("How progress is recorded"), { target: { value: "activity" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));

    const [goal] = useStore.getState().profile.dailySuccess!.requirements;
    expect(goal).toMatchObject({
      label: "Renal question review", target: 2, unit: "times",
      source: { kind: "activity-alias" }, aliases: ["Renal question review"],
      trackingStartsAt: today,
    });
    expect(useStore.getState().logs).toHaveLength(0);
    await act(async () => { useStore.getState().logActivity({ label: "RENAL QUESTION REVIEW", quantity: 1, quantityKind: "count" }); });
    expect(screen.getByText("1 of 2 times")).toBeTruthy();
  });

  it("checks a manual quick goal without inventing activity and allows undo", () => {
    const state = makeSeed();
    today = state.activeDayKey;
    state.profile.dailySuccess = { version: 1, configuredAt: today, requirements: [] };
    state.logs = [];
    useStore.setState(state);
    render(<DailyRequirementsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    fireEvent.change(screen.getByLabelText("Goal type"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Review flashcards" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Review flashcards" }));
    expect(currentRequirement().manualContributions?.at(-1)).toMatchObject({ value: 1, mode: "override", dayKey: today });
    expect(useStore.getState().logs).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Undo Review flashcards" }));
    expect(currentRequirement().manualContributions?.at(-1)?.value).toBe(0);
  });

  it("edits a goal directly and starts the changed target today", () => {
    render(<DailyRequirementsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Focused study goal" }));
    fireEvent.change(screen.getByLabelText("Change goal amount"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Update goal" }));
    expect(currentRequirement()).toMatchObject({ target: 90, trackingStartsAt: today });
  });

  it("does not offer duplicate standard goals in the quick form", () => {
    render(<DailyRequirementsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    const option = screen.getByRole("option", { name: "Study time (already set)" }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(useStore.getState().profile.dailySuccess?.requirements).toHaveLength(1);
  });
});

describe("DailyRequirementsEditor scoring boundaries", () => {
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
