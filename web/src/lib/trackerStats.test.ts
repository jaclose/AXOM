import { beforeEach, describe, expect, it } from "vitest";
import { addLocalDays } from "./dailyRollover";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { dayMet, habitCheckForDay, summarizeTracker, trackerDayTotals } from "./trackerStats";
import type { ProductivityTracker, StudyLog } from "./types";

const TODAY = "2026-09-20";

function tracker(patch: Partial<ProductivityTracker> = {}): ProductivityTracker {
  return {
    id: "t1", name: "Reading", icon: "BookOpen", color: "var(--cyan)", unitType: "count", dailyTarget: 10, category: "Personal",
    contributesToAcademicStudy: false, contributesToTotalProductiveTime: true, contributesToEnergy: true, contributesToReports: true,
    contributesToHabitTracking: false, visible: true, archived: false, createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z",
    ...patch,
  };
}

function log(day: string, patch: Partial<StudyLog> = {}): StudyLog {
  return { id: `${day}-${Math.random()}`, dayKey: day, ts: `${day}T12:00:00.000Z`, type: "Reading", minutes: 0, cards: 0, trackerId: "t1", quantity: 5, ...patch };
}

describe("tracker stats", () => {
  it("totals per day in the tracker's unit and caps yes/no at one", () => {
    expect(trackerDayTotals(tracker(), [log(TODAY), log(TODAY, { quantity: 7 })]).get(TODAY)).toBe(12);
    expect(trackerDayTotals(tracker({ unitType: "yesno" }), [log(TODAY), log(TODAY)]).get(TODAY)).toBe(1);
    expect(trackerDayTotals(tracker({ unitType: "minutes" }), [log(TODAY, { minutes: 25 })]).get(TODAY)).toBe(25);
  });

  it("counts a build-up streak through today once met, and a limit streak through yesterday", () => {
    const logs = [-3, -2, -1, 0].map((offset) => log(addLocalDays(TODAY, offset), { quantity: 10 }));
    expect(summarizeTracker(tracker(), logs, TODAY)).toMatchObject({ today: 10, todayMet: true, streak: 4 });
    const limit = tracker({ goal: "at-most", dailyTarget: 30, unitType: "minutes", createdAt: `${addLocalDays(TODAY, -5)}T08:00:00` });
    const limitLogs = [log(addLocalDays(TODAY, -3), { minutes: 50 }), log(addLocalDays(TODAY, -1), { minutes: 20 })];
    const summary = summarizeTracker(limit, limitLogs, TODAY);
    expect(summary.streak).toBe(2);
    expect(summary.last14.find((day) => day.day === addLocalDays(TODAY, -3))?.met).toBe(false);
  });

  it("maps a day onto a habit check without inventing entries", () => {
    const build = tracker();
    expect(habitCheckForDay(build, 0)).toBeNull();
    expect(habitCheckForDay(build, 4)).toEqual({ status: "partial", value: 4 });
    expect(habitCheckForDay(build, 12)).toEqual({ status: "done", value: 12 });
    expect(habitCheckForDay(tracker({ goal: "at-most", dailyTarget: 30 }), 45)).toEqual({ status: "missed", value: 45 });
    expect(dayMet(tracker({ dailyTarget: undefined }), 0)).toBeNull();
  });
});

describe("unlinked self-report attribution", () => {
  it("does not treat gym, prayer or unclassified named minutes as academic study", () => {
    const seed = makeSeed();
    useStore.setState({ ...seed, logs: [] });
    for (const label of ["Gym", "Fajr", "Private journal"]) {
      useStore.getState().logActivity({ label, minutes: 30 });
      expect(useStore.getState().logs[0]).toMatchObject({ type: label, academic: false });
    }
    useStore.getState().logActivity({ label: "Focused study", minutes: 30, trackerId: "tracker-study" });
    expect(useStore.getState().logs[0]).toMatchObject({ academic: true, trackerId: "tracker-study" });
  });
});

describe("effective-dated weekly goal revisions", () => {
  it("preserves the old weekly target before a later edit, rather than rewriting history", () => {
    const seed = makeSeed();
    const oldHabit = {
      id: "gym-habit", name: "Gym", type: "weekly" as const,
      weeklyMinimum: 4, weeklyPreferred: 5, weeklyTarget: 4,
      trackingStartsAt: "2026-10-26",
      createdAt: "2026-10-26T10:00:00.000Z", updatedAt: "2026-10-26T10:00:00.000Z",
    };
    useStore.setState({ ...seed, activeDayKey: "2026-11-07", habits: [oldHabit], habitEntries: [] });
    useStore.getState().updateHabit("gym-habit", { weeklyMinimum: 3, weeklyPreferred: 4 });
    const revisions = useStore.getState().habits[0].weeklyRevisions;
    expect(revisions).toEqual([
      { effectiveWeek: "2026-10-26", minimum: 4, preferred: 5, linkedTrackerId: undefined },
      { effectiveWeek: "2026-11-02", minimum: 3, preferred: 4, linkedTrackerId: undefined },
    ]);
  });
});

describe("named occurrence store receipts", () => {
  it("upserts one event per named slot and does not create an academic time log", () => {
    const seed = makeSeed();
    useStore.setState({ ...seed, logs: [], habits: [], habitEntries: [] });
    const store = useStore.getState();
    const id = store.addHabit({
      name: "Prayers", type: "slots", category: "Personal", includeInReports: false,
      occurrenceSlots: [{ id: "fajr", label: "Fajr" }, { id: "dhuhr", label: "Dhuhr" }],
    });
    const today = useStore.getState().activeDayKey;
    useStore.getState().setHabitSlot(id, today, "fajr", "done");
    const first = useStore.getState().habitEntries[0];
    expect(first).toMatchObject({ status: "partial", value: 1 });
    expect(first.slotCheckIns).toHaveLength(1);
    useStore.getState().setHabitSlot(id, today, "fajr", "done");
    expect(useStore.getState().habitEntries[0].slotCheckIns).toHaveLength(1);
    useStore.getState().setHabitSlot(id, today, "dhuhr", "done");
    expect(useStore.getState().habitEntries[0]).toMatchObject({ status: "done", value: 2 });
    useStore.getState().setHabitSlot(id, today, "fajr", undefined);
    expect(useStore.getState().habitEntries[0]).toMatchObject({ status: "partial", value: 1 });
    expect(useStore.getState().logs).toHaveLength(0);
  });
});

describe("tracker store wiring", () => {
  beforeEach(() => {
    const seed = makeSeed();
    useStore.setState({ ...seed, logs: [], habits: [], habitEntries: [] });
  });

  it("re-labels past entries when a tracker's study flag changes", () => {
    const store = useStore.getState();
    const id = store.addProductivityTracker(tracker({ name: "Coding", unitType: "minutes", dailyTarget: 60 }));
    store.logProductivity({ trackerId: id, minutes: 40 });
    expect(useStore.getState().logs[0]).toMatchObject({ trackerId: id, academic: false });
    store.updateProductivityTracker(id, { contributesToAcademicStudy: true });
    expect(useStore.getState().logs[0].academic).toBe(true);
  });

  it("links a habit and keeps it checked from tracker entries", () => {
    const store = useStore.getState();
    const id = store.addProductivityTracker({ ...tracker(), name: "Pages read", dailyTarget: 10, contributesToHabitTracking: true });
    const created = useStore.getState().productivityTrackers.find((item) => item.id === id)!;
    expect(created.linkedHabitId).toBeTruthy();
    expect(useStore.getState().habits.find((habit) => habit.id === created.linkedHabitId)).toMatchObject({ name: "Pages read", type: "count", target: 10 });
    const day = useStore.getState().activeDayKey;
    useStore.getState().logProductivity({ trackerId: id, quantity: 4 });
    expect(useStore.getState().habitEntries).toEqual([expect.objectContaining({ habitId: created.linkedHabitId, date: day, status: "partial", value: 4 })]);
    useStore.getState().logProductivity({ trackerId: id, quantity: 6 });
    expect(useStore.getState().habitEntries).toEqual([expect.objectContaining({ status: "done", value: 10 })]);
  });

  it("never overrides a check the learner set by hand", () => {
    const store = useStore.getState();
    const id = store.addProductivityTracker({ ...tracker(), name: "Walk", contributesToHabitTracking: true });
    const habitId = useStore.getState().productivityTrackers.find((item) => item.id === id)!.linkedHabitId!;
    const day = useStore.getState().activeDayKey;
    useStore.getState().checkHabit(habitId, day, "skipped");
    useStore.getState().logProductivity({ trackerId: id, quantity: 20 });
    expect(useStore.getState().habitEntries).toEqual([expect.objectContaining({ status: "skipped" })]);
  });
});
