// @vitest-environment jsdom
import { expect, it } from "vitest";
import { recordObservedActivity, type StudyActivity } from "./studyActivity";
import { makeSeed } from "./seed";
import { makeDailyRequirement, evaluateDailySuccess, normalizeDailySuccessConfig } from "./dailySuccess";
import { localDateKey } from "./dailyRollover";
const timestamp = (hour: number) => new Date(2026, 8, 28, hour).toISOString();
const today = localDateKey(new Date(timestamp(12)));
const event = (patch: Partial<StudyActivity>): StudyActivity => ({ eventId: "weekly-study", kind: "focus", source: "axom", endedAt: timestamp(12), ...patch });

it("sums weekly hours without requiring daily completions", () => {
  const state = makeSeed(); state.activeDayKey = today;
  const requirement = makeDailyRequirement({ id: "weekly-study", label: "Study", source: { kind: "study-minutes" }, target: 5, unit: "hours", schedule: { kind: "weekly-total", weekStartsOn: 1 }, trackingStartsAt: today });
  state.profile.dailySuccess = normalizeDailySuccessConfig({ version: 1, configuredAt: today, requirements: [requirement] });
  state.logs = recordObservedActivity([], event({ kind: "pomodoro", durationSeconds: 7200, quantity: undefined }));
  const result = evaluateDailySuccess(state).requirements[0];
  expect(result).toMatchObject({ current: 2, target: 5, ratio: 0.4, status: "in-progress" });
  expect(result.calculation).toContain("this week");
});
