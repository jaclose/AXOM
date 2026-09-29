import { beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { summarizeTracker } from "./trackerStats";

beforeEach(() => {
  useStore.setState(makeSeed());
});

function studyToday() {
  const s = useStore.getState();
  const tracker = s.productivityTrackers.find((item) => item.id === "tracker-study")!;
  const academicMinutes = s.logs
    .filter((log) => log.dayKey === s.activeDayKey && log.academic !== false)
    .reduce((sum, log) => sum + log.minutes, 0);
  return { tracker: summarizeTracker(tracker, s.logs, s.activeDayKey).today, academicMinutes };
}

describe("Pomodoro minutes reach the Study tracker (JD, Ideas 3: 384 -> 736)", () => {
  it("attributes auto-logged focus time to the Study tracker", () => {
    useStore.getState().logStudy({ type: "Pomodoro", minutes: 90, note: "Focus block" });
    // The tracker used to show 0 here, so JD topped it up by hand.
    expect(studyToday()).toEqual({ tracker: 90, academicMinutes: 90 });
  });

  it("keeps partial blocks and later blocks on the same tracker without double counting", () => {
    useStore.getState().logStudy({ type: "Pomodoro", minutes: 90 });
    useStore.getState().logStudy({ type: "Pomodoro", minutes: 37 });
    expect(studyToday()).toEqual({ tracker: 127, academicMinutes: 127 });
  });

  it("still routes named study types to their own trackers", () => {
    useStore.getState().logStudy({ type: "Study", minutes: 20 });
    expect(studyToday()).toEqual({ tracker: 20, academicMinutes: 20 });
  });
});
