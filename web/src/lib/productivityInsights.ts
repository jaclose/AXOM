import type { AxomState } from "./types";
import { evaluateDailySuccess } from "./dailySuccess";
import { buildTargetContributionLedger, canonicalStudyLogs } from "./targetContributions";
import { localDateKey } from "./dailyRollover";
import { quizPracticeLogId } from "./quizPracticeProgress";

export interface ProductivityInsight {
  title: string;
  detail: string;
  action: string;
  href: string;
}

/** Read-only recommendation based only on recorded sources and current targets. */
export function productivityInsight(state: AxomState, saveFailed: boolean, running: boolean): ProductivityInsight {
  if (saveFailed) return { title: "Check your save", detail: "Your latest workspace save did not complete. Review storage before continuing.", action: "Open settings", href: "#settings" };
  const result = evaluateDailySuccess(state);
  if (result.requirements.some((item) => item.status === "unavailable")) return { title: "Review a target source", detail: "A target's linked source is unavailable. Your activity remains in history.", action: "Review targets", href: "#productivity-targets" };
  const logs = canonicalStudyLogs(state.logs);
  const missingQuiz = state.quizSessions.some((session) => session.endedAt && Number.isFinite(Date.parse(session.endedAt)) && localDateKey(new Date(session.endedAt)) === state.activeDayKey && session.answers.some((answer) => answer.answerKey) && !logs.some((log) => log.id === quizPracticeLogId(session.id)));
  if (logs.length !== state.logs.length || missingQuiz) return { title: "Review activity records", detail: missingQuiz ? "A finished question session has no linked activity record." : "Some activity records share an identity. Review the activity history.", action: "Open activity", href: "#activity" };
  if (running) return { title: "Your focus session is running", detail: "Return to the timer when you are ready.", action: "Go to timer", href: "#productivity-focus" };
  const target = result.requirements.find((item) => item.eligible && item.status !== "met" && item.status !== "unavailable");
  if (target) {
    const weekly = target.requirement.schedule.kind === "times-per-week";
    const todayMet = weekly && buildTargetContributionLedger({ requirement: target.requirement, dayKey: state.activeDayKey, logs: state.logs, productivityTrackers: state.productivityTrackers, habits: state.habits, habitEntries: state.habitEntries, closeouts: state.closeouts }).value >= target.requirement.target;
    return { title: todayMet ? "Plan another day" : `Work toward ${target.requirement.label}`, detail: todayMet ? "Today's portion is recorded. Plan the remaining weekly sessions on other days." : `${target.current} of ${target.target} recorded using your current target.`, action: "Review targets", href: "#productivity-targets" };
  }
  return { title: "Choose your next step", detail: "Start a focus session or log an activity when you are ready.", action: "Log activity", href: "#productivity-log" };
}

export function formatStudyMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

/** Independent evidence sources; none implies time spent or mastery. */
export function recordedActivityEvidence(state: AxomState, dayKey: string) {
  return {
    cardReviews: datedEventCount(state.cardReviews, dayKey),
    trackerPasses: datedEventCount(state.tracker.flatMap((item) => item.passEvents ?? []), dayKey),
  };
}

function datedEventCount(events: readonly { id: string; at: string }[], dayKey: string): number {
  const times = new Map<string, number>();
  for (const event of events) {
    const time = Date.parse(event.at);
    if (Number.isFinite(time) && time > (times.get(event.id) ?? -Infinity)) times.set(event.id, time);
  }
  return [...times.values()].filter((time) => localDateKey(new Date(time)) === dayKey).length;
}
