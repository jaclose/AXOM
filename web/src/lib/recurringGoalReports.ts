import { addLocalDays } from "./dailyRollover";
import { evaluateDailySuccess } from "./dailySuccess";
import type { DailySuccessState } from "./dailySuccess";

/** A read-only view over the same goal configuration and source-backed ledger. */
export interface RecurringGoalSummary {
  id: string;
  label: string;
  cadence: "weekly-range" | "daily-slots";
  status: string;
  progress: string;
  periodLabel: string;
  history: Array<{ label: string; met: boolean; current: number; target: number }>;
  sourceRecordIds: string[];
}

function weekStartMonday(dateKey: string): string {
  const day = new Date(`${dateKey}T12:00:00`).getDay();
  return addLocalDays(dateKey, -((day + 6) % 7));
}

export function recurringGoalSummaries(
  state: DailySuccessState,
  today = state.activeDayKey,
): RecurringGoalSummary[] {
  const goals = state.profile.dailySuccess?.requirements ?? [];
  return goals.filter((goal) => goal.enabled && goal.showInReports !== false
    && (goal.schedule.kind === "weekly-range" || goal.schedule.kind === "daily-slots"))
    .map((goal) => {
      if (goal.schedule.kind === "weekly-range") {
        const start = weekStartMonday(today);
        const history = Array.from({length:8},(_,i)=>{
          const end = addLocalDays(start, 6 - 7*(7-i));
          if(end < goal.trackingStartsAt) return null;
          const result = evaluateDailySuccess(state, end, today)
            .requirements.find((item)=>item.requirement.id===goal.id);
          return result ? {label:end,met:result.status==="met",current:result.current,target:result.target} : null;
        }).filter((x): x is NonNullable<typeof x>=>x!==null);
        const current = evaluateDailySuccess(state, today, today)
          .requirements.find((item)=>item.requirement.id===goal.id);
        return {
          id:goal.id,label:goal.label,cadence:"weekly-range" as const,
          status:current?.status??"awaiting",
          progress:`${current?.current??0} days · minimum ${goal.schedule.minimum}, preferred ${goal.schedule.preferred}`,
          periodLabel:"This week",
          history,sourceRecordIds:current?.sourceRecordIds??[],
        };
      }
      const history = Array.from({length:7},(_,i)=>{
        const date=addLocalDays(today,i-6);
        if (date<goal.trackingStartsAt) return null;
        const result=evaluateDailySuccess(state,date,today)
          .requirements.find((item)=>item.requirement.id===goal.id);
        return result ? {label:date,met:result.status==="met",current:result.current,target:result.target} : null;
      }).filter((x): x is NonNullable<typeof x>=>x!==null);
      const current=evaluateDailySuccess(state,today,today)
        .requirements.find((item)=>item.requirement.id===goal.id);
      return {
        id:goal.id,label:goal.label,cadence:"daily-slots" as const,
        status:current?.status??"awaiting",
        progress:`${current?.current??0} of ${goal.schedule.slots.length} named check-ins reported`,
        periodLabel:"Last 7 days",
        history,sourceRecordIds:current?.sourceRecordIds??[],
      };
    });
}
