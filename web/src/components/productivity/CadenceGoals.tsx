import { useStore } from "../../lib/store";
import { GlassCard, GButton, PanelHeader } from "../ui/primitives";
import { namedSlotProgress, PRAYER_OCCURRENCE_SLOTS, weeklyHabitSummary } from "../../lib/goalCadence";
import { newHabitDefaults } from "../../lib/habits";
import "../../styles/goal-cadence.css";

/** One shared projection of Habit receipts in Productivity. Does not duplicate an event ledger. */
export function CadenceGoals() {
  const state = useStore();
  const habits = state.habits.filter((habit) => !habit.archived && (habit.type === "weekly" || habit.type === "slots"));
  const today = state.activeDayKey;
  const gymExists = habits.some((habit) => habit.type === "weekly" && habit.name.toLowerCase() === "gym");
  const prayersExist = habits.some((habit) => habit.type === "slots" && habit.name.toLowerCase() === "daily prayers");

  function createGym() {
    if (gymExists) return;
    const linkedTrackerId = state.productivityTrackers.find((item) => item.id === "tracker-gym" && !item.archived)?.id;
    state.addHabit({
      ...newHabitDefaults("Gym", "weekly"),
      name: "Gym", type: "weekly", weeklyTarget: 4, weeklyMinimum: 4, weeklyPreferred: 5,
      linkedTrackerId, category: "Wellness", target: 1, unit: "visit",
      includeInReports: true, trackingStartsAt: today,
    });
  }

  function createPrayers() {
    if (prayersExist) return;
    state.addHabit({
      ...newHabitDefaults("Daily prayers", "slots"),
      name: "Daily prayers", type: "slots",
      occurrenceSlots: PRAYER_OCCURRENCE_SLOTS.map((slot) => ({ ...slot })),
      target: 5, unit: "occurrences", category: "Personal",
      includeInReports: false, quietMode: true, trackingStartsAt: today,
    });
  }

  return (
    <GlassCard pad className="goal-cadence-panel" aria-label="Recurring personal goals">
      <PanelHeader title="Personal rhythms" headingLevel={2}
        sub="Flexible weekly commitments and named daily check-ins. A report is recorded once, then used wherever you allow." />
      <div className="goal-preset-choices" role="group" aria-label="Add a recurring goal">
        {!gymExists && <GButton size="sm" onClick={createGym}>Gym: 4 minimum, 5 preferred</GButton>}
        {!prayersExist && <GButton size="sm" onClick={createPrayers}>Five named daily prayers</GButton>}
      </div>
      {habits.length === 0 && <p className="goal-cadence-empty">No recurring personal goals yet. Choose a template or create another type in Habit Tracker.</p>}
      <div className="goal-cadence-list">
        {habits.map((habit) => {
          const entries = state.habitEntries.filter((entry) => entry.habitId === habit.id);
          const todayEntry = entries.find((item) => item.date === today);
          const week = habit.type === "weekly" ? weeklyHabitSummary(habit, entries, today, state.logs) : null;
          const named = habit.type === "slots" ? namedSlotProgress(habit, todayEntry) : null;
          return <section key={habit.id} className="goal-cadence-card" aria-label={habit.name}>
            <div className="goal-cadence-card-head">
              <b>{habit.name}</b>
              <small>{habit.type === "weekly" ? "Flexible week" : "Named daily occurrences"}</small>
            </div>
            {week && <div className="habit-weekly-cadence">
              <p><strong>{week.completedDays} / {week.minimum}</strong> minimum · {week.preferred} preferred
                {week.metPreferred ? " · Preferred reached" : week.metMinimum ? " · Minimum met" : " · Week in progress"}
              </p>
              <div className="habit-weekly-meter" role="progressbar" aria-label={habit.name + " weekly minimum"}
                aria-valuemin={0} aria-valuemax={Math.max(1,week.minimum)}
                aria-valuenow={Math.min(week.completedDays,Math.max(1,week.minimum))}>
                <span style={{ width: String(week.minimum ? Math.min(100,week.completedDays / week.minimum * 100) : 0) + "%" }}/>
              </div>
              <div className="goal-cadence-card-foot">
                <GButton size="sm" onClick={() => {
                  if (todayEntry?.status === "done") state.clearHabitCheck(habit.id, today);
                  else state.checkHabit(habit.id, today, "done", 1);
                }}>{todayEntry?.status === "done" ? "Undo today" : "Log today"}</GButton>
                <small>Rest days do not reduce this week's result. Linked activity counts once per date.</small>
              </div>
              <details className="goal-cadence-options">
                <summary>Adjust weekly goal</summary>
                <div className="goal-cadence-config">
                  <label>Minimum days <input className="field" aria-label={habit.name + " minimum days"} type="number" min="1" max="7" value={habit.weeklyMinimum ?? habit.weeklyTarget ?? 3}
                    onChange={(e) => {
                      const minimum = Math.max(1,Math.min(7,Number(e.target.value) || 1));
                      state.updateHabit(habit.id,{
                        weeklyTarget: minimum, weeklyMinimum: minimum,
                        weeklyPreferred: Math.max(minimum,habit.weeklyPreferred ?? minimum),
                      });
                    }}/></label>
                  <label>Preferred days <input className="field" aria-label={habit.name + " preferred days"} type="number"
                    min={habit.weeklyMinimum ?? habit.weeklyTarget ?? 1} max="7"
                    value={habit.weeklyPreferred ?? habit.weeklyMinimum ?? habit.weeklyTarget ?? 3}
                    onChange={(e) => state.updateHabit(habit.id,{ weeklyPreferred: Math.max(
                      habit.weeklyMinimum ?? habit.weeklyTarget ?? 1,Math.min(7,Number(e.target.value)||1)
                    )})}/></label>
                </div>
              </details>
            </div>}
            {named && <div className="habit-named-slots" role="group" aria-label={habit.name + " named daily occurrences"}>
              <p>{named.completed} of {named.total} confirmed · {named.unreported} unreported</p>
              <div className="habit-named-slot-grid">
                {named.slots.map((slot) => <div className="habit-named-slot" key={slot.id}>
                  <button type="button" className={slot.status === "done" ? "is-done" : ""}
                    aria-label={(slot.status === "done" ? "Undo " : "Complete ") + slot.label}
                    aria-pressed={slot.status === "done"}
                    onClick={() => state.setHabitSlot(habit.id,today,slot.id,slot.status==="done"?undefined:"done")}>
                    {slot.status === "done" ? "✓ " : ""}{slot.label}
                  </button>
                  <button type="button" className="habit-slot-skip" aria-label={"Toggle skipped "+slot.label}
                    onClick={() => state.setHabitSlot(habit.id,today,slot.id,slot.status==="skipped"?undefined:"skipped")}>
                    {slot.status === "skipped" ? "Skipped" : "Skip"}
                  </button>
                </div>)}
              </div>
              <small>Unreported means unknown. Times are never inferred and private details remain local unless you enable sync.</small>
            </div>}
            <label className="habit-target-option">
              <input type="checkbox" checked={habit.includeInReports === true}
                onChange={(e) => state.updateHabit(habit.id,{includeInReports:e.target.checked})}/>
              <span>Include in my private Reports. This never shares the goal publicly.</span>
            </label>
          </section>;
        })}
      </div>
    </GlassCard>
  );
}
