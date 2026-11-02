import { Flame, Sparkles } from "lucide-react";
import { addLocalDays } from "../../lib/dailyRollover";
import type { DailySuccessResult } from "../../lib/dailySuccess";
import { ICON_SIZE } from "../../lib/iconSize";
import {
  normalizeStudyStreaks,
  protectedCalendarStreak,
  reachedProductivityGoal,
  studyCreditsBalance,
} from "../../lib/studyStreaks";
import type { NoctyriumState } from "../../lib/types";
import "../../styles/study-streaks.css";
import { StreakFreezeMeter } from "./StreakFreezeMeter";

export function StudyStreakMonitor({ state, result }: {
  state: NoctyriumState;
  result: DailySuccessResult;
}) {
  const today = state.activeDayKey;
  const lane = normalizeStudyStreaks(state.profile.studyStreaks, today).productivity;
  const streak = protectedCalendarStreak(lane.creditedDays, lane.frozenDays, today);
  const days = Array.from({ length: 7 }, (_, index) => addLocalDays(today, index - 6));
  const credited = new Set(lane.creditedDays);
  const frozen = new Set(lane.frozenDays);
  const todayCounts = reachedProductivityGoal(result);
  const credits = studyCreditsBalance(state);
  return (
    <section className="study-streak-monitor" aria-label="Study streak monitor">
      <div className="study-streak-monitor__lead">
        <span className="study-streak-monitor__glyph"><Flame size={ICON_SIZE.control} aria-hidden="true" /></span>
        <div><span className="study-streak-monitor__eyebrow">STUDY STREAK</span><strong>{streak} {streak === 1 ? "day" : "days"}</strong></div>
        <span className="study-streak-monitor__credits" title="AXOM Credits" aria-label={`${credits} AXOM Credits`}><Sparkles size={ICON_SIZE.body} aria-hidden="true" /> {credits} AC</span>
      </div>
      <div className="study-streak-monitor__week" aria-label="Last seven days">
        {days.map((day) => {
          const status = credited.has(day) ? "earned" : frozen.has(day) ? "frozen" : day === today ? "today" : "open";
          return <span key={day} className={`study-streak-monitor__day is-${status}`} title={`${day}: ${status === "earned" ? "80% reached" : status === "frozen" ? "one-day freeze used" : status === "today" ? "today" : "not reached"}`} aria-label={`${day}: ${status === "earned" ? "80% reached" : status === "frozen" ? "freeze used" : status === "today" ? "today in progress" : "not reached"}`} />;
        })}
      </div>
      <div className="study-streak-monitor__foot">
        <p>{result.eligibleCount === 0
          ? "Choose a target to begin a study streak."
          : todayCounts
            ? "Today counts. Every third earned day adds a bonus AXOM Credit."
            : lane.startedOn === today && lane.creditedDays.length === 0
              ? "Your 80% study streak starts today. Reach the mark to earn an AXOM Credit."
              : `${Math.max(0, 80 - result.progress)} more percentage points on today's bar reaches the 80% streak mark.`}</p>
        <StreakFreezeMeter available={lane.freezesLeft} progress={lane.refillProgress} label="Study streak" />
      </div>
    </section>
  );
}
