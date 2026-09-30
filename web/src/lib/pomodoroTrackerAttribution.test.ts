import { beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { summarizeTracker } from "./trackerStats";

beforeEach(() => useStore.setState(makeSeed()));

function totals() {
  const state = useStore.getState();
  const study = state.productivityTrackers.find((tracker) => tracker.id === "tracker-study")!;
  return {
    tracker: summarizeTracker(study, state.logs, state.activeDayKey).today,
    academic: state.logs.filter((log) => log.dayKey === state.activeDayKey && log.academic !== false)
      .reduce((sum, log) => sum + log.minutes, 0),
  };
}

describe("timer attribution (I3-39: 384 to 736)", () => {
  it("shows all 384 minutes on Study so 352 timer minutes do not need manual re-entry", () => {
    useStore.getState().logStudy({ type: "Study", minutes: 32 });
    useStore.getState().logStudy({ type: "Pomodoro", minutes: 352 });
    expect(totals()).toEqual({ tracker: 384, academic: 384 });
    expect(useStore.getState().logs).toHaveLength(2);
  });

  it.each(["Pomodoro", "Focus session"])("attributes %s partial and subsequent blocks once", (type) => {
    useStore.getState().logStudy({ type, minutes: 90 });
    useStore.getState().logStudy({ type, minutes: 37 });
    expect(totals()).toEqual({ tracker: 127, academic: 127 });
  });

  it("preserves the destination of a different named activity", () => {
    const tracker = useStore.getState().productivityTrackers.find((item) => item.id !== "tracker-study" && item.unitType === "minutes")!;
    useStore.getState().logStudy({ type: tracker.name, minutes: 20 });
    expect(useStore.getState().logs[0].trackerId).toBe(tracker.id);
    expect(totals().tracker).toBe(0);
  });
});
