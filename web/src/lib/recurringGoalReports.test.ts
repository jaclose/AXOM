import { describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { makeDailyRequirement } from "./dailySuccess";
import { recurringGoalSummaries } from "./recurringGoalReports";

describe("recurring goal report projections", () => {
  it("does not expose private prayer check-ins in Reports without explicit consent", () => {
    const state=makeSeed(), today=state.activeDayKey;
    const goal=makeDailyRequirement({
      id:"prayer",label:"Prayer",source:{kind:"manual"},lane:"personal",
      target:5,unit:"prayers",showInReports:false,trackingStartsAt:today,
      schedule:{kind:"daily-slots",slots:["Fajr","Dhuhr","Asr","Maghrib","Isha"]},
    },today);
    state.profile.dailySuccess={version:1,configuredAt:today,requirements:[goal]};
    expect(recurringGoalSummaries(state)).toEqual([]);
    expect(recurringGoalSummaries(state,today,true)).toMatchObject([
      {id:"prayer",cadence:"daily-slots",progress:"0 of 5 named check-ins reported"},
    ]);
  });

  it("shows a linked gym week once in Reports without duplicating the underlying log", () => {
    const state=makeSeed(),today=state.activeDayKey;
    const goal=makeDailyRequirement({
      id:"gym",label:"Gym",source:{kind:"activity-alias"},aliases:["Gym"],lane:"personal",
      target:1,unit:"times",showInReports:true,trackingStartsAt:today,
      schedule:{kind:"weekly-range",minimum:4,preferred:5,weekStartsOn:1},
    },today);
    state.profile.dailySuccess={version:1,configuredAt:today,requirements:[goal]};
    state.logs=[];
    const rows=recurringGoalSummaries(state);
    expect(rows[0]?.progress).toContain("minimum 4, preferred 5");
    expect(rows[0]?.sourceRecordIds).toEqual([]);
  });
});
