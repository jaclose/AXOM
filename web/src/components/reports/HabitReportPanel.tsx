import { useMemo } from "react";
import { ArrowUpRight, CalendarCheck2 } from "lucide-react";
import { useStore } from "../../lib/store";
import { addLocalDays } from "../../lib/dailyRollover";
import { statusOn, weekStats } from "../../lib/habits";
import { GlassCard } from "../ui/primitives";
import "../../styles/habit-report.css";

/** The routine ledger is a supporting signal, not a substitute for learning outcomes. */
export function HabitReportPanel() {
  const state = useStore();
  const enabled = state.profile.experimentalFlags?.habits === true;
  const activeHabits = state.habits.filter((habit) => !habit.archived);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addLocalDays(state.activeDayKey, -index)),
    [state.activeDayKey],
  );
  const entries = state.habitEntries;
  const summaries = enabled ? activeHabits.map((habit) => ({
    habit,
    stats: weekStats(habit, entries, days),
    current: statusOn(habit, entries, state.activeDayKey),
  })) : [];
  const counts = summaries.reduce((total, { stats }) => ({
    expected: total.expected + stats.scheduledDays,
    recorded: total.recorded + stats.done + stats.partial + stats.skipped + stats.missed,
  }), { expected: 0, recorded: 0 });

  return <section className="report-section" aria-labelledby="report-routines-title">
    <div className="report-section-heading">
      <div><span>Repeatable work</span><h2 id="report-routines-title">Routines and goals</h2></div>
      <p>Self-reported follow-through across the last seven days. Each status links to your saved habit ledger, not a prediction of mastery.</p>
    </div>
    <GlassCard pad className="habit-report">
      <div className="habit-report-heading">
        <div>
          <span className="habit-report-eyebrow"><CalendarCheck2 size={15} aria-hidden="true" /> AXOM / ROUTINE EVIDENCE</span>
          <strong>{enabled && activeHabits.length ? `${counts.recorded} / ${counts.expected}` : "No active signal"}</strong>
          <small>{enabled && activeHabits.length ? "Scheduled check-ins with a recorded status" : "Optional self-reporting"}</small>
        </div>
        <a className="habit-report-link" href="#habits">{enabled ? "Review habits" : "Configure habits"} <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div>
      {!enabled ? <p className="habit-report-empty">Habit tracking is switched off. No habit history is counted toward this report.</p>
        : activeHabits.length === 0 ? <p className="habit-report-empty">No active routines. Add one from the Daily workspace when it would be useful.</p>
          : <>
            <div className="habit-report-table" role="list" aria-label="Recent routine records">
              {summaries.slice(0, 6).map(({ habit, stats, current }) => (
                <div key={habit.id} className="habit-report-row" role="listitem">
                  <div className="habit-report-name">
                    <b>{habit.name}</b>
                    <small>Today: {current === "none" ? "No record" : current}</small>
                  </div>
                  <div className="habit-report-metrics">
                    <span>{stats.done} done</span>
                    {stats.partial > 0 && <span>{stats.partial} partial</span>}
                    <span>{stats.skipped} skipped</span>
                    <span>{Math.max(0, stats.scheduledDays - stats.done - stats.partial - stats.skipped - stats.missed)} unrecorded</span>
                  </div>
                </div>
              ))}
            </div>
            {summaries.length > 6 && <p className="habit-report-foot">Showing six of {summaries.length} active routines. Open the Daily workspace for the full ledger.</p>}
          </>}
      <p className="habit-report-foot">An intentional skip is recorded separately from a missed or unrecorded day. Historical check-ins are never inferred.</p>
    </GlassCard>
  </section>;
}
