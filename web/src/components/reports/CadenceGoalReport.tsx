import { useStore } from "../../lib/store";
import { addLocalDays } from "../../lib/dailyRollover";
import { namedSlotProgress, weekStartKey, weeklyHabitSummary } from "../../lib/goalCadence";
import "../../styles/goal-cadence.css";

/**
 * Private, source-backed personal rhythm report. No new write, no inferred
 * academic mastery, and no entry without explicit habit.includeInReports.
 */
export function CadenceGoalReport() {
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.habitEntries);
  const logs = useStore((s) => s.logs);
  const today = useStore((s) => s.activeDayKey);
  const visible = habits.filter((habit) => !habit.archived && habit.includeInReports === true
    && (habit.type === "weekly" || habit.type === "slots"));
  if (!visible.length) return <p className="goal-cadence-empty">
    No personal recurring goals are included in Reports. You can opt individual goals in from Productivity or Habit Tracker.
  </p>;

  return <section className="goal-cadence-reports" aria-label="Private recurring-goal reports">
    <h3>Personal rhythms</h3>
    {visible.map((habit) => {
      const own = entries.filter((e) => e.habitId === habit.id);
      if (habit.type === "weekly") {
        const current = weeklyHabitSummary(habit, own, today, logs);
        const previous = Array.from({ length: 8 }, (_, i) =>
          weeklyHabitSummary(habit, own, addLocalDays(weekStartKey(today), -1 - (7 - i) * 7), logs));
        const recorded = previous.filter((week) => week.minimum > 0);
        const met = recorded.filter((week) => week.metMinimum).length;
        return <div key={habit.id} className="goal-cadence-report-row">
          <div><strong>{habit.name}</strong><span>{current.completedDays}/{current.minimum} minimum this week · {current.preferred} preferred</span></div>
          <small>{met}/{recorded.length} completed eligible weeks met the minimum. Rest days are not failures.</small>
          <details><summary>Evidence</summary>
            <small>Linked habit check-ins and matching tracker activity, deduplicated by local day. {current.sourceEntryIds.length} source record references in this week.</small>
          </details>
        </div>;
      }
      const todayEntry = own.find((e) => e.date === today);
      const progress = namedSlotProgress(habit, todayEntry);
      const last7 = Array.from({ length: 7 }, (_, index) => addLocalDays(today, index - 6))
        .map((day) => namedSlotProgress(habit, own.find((entry) => entry.date === day)));
      const confirmed = last7.reduce((sum, day) => sum + day.completed, 0);
      return <div key={habit.id} className="goal-cadence-report-row">
        <div><strong>{habit.name}</strong><span>{progress.completed}/{progress.total} named occurrences confirmed today</span></div>
        <small>{confirmed} completed occurrences reported over seven days. Unreported is not the same as missed.</small>
        <details><summary>Evidence</summary>
          <small>Explicit named check-in receipts. Each occurrence is independently identified; no automatic prayer times or judgments.</small>
        </details>
      </div>;
    })}
  </section>;
}
