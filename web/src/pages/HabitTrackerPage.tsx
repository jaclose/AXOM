// Habit Tracker (directive §6) — experimental, opt-in via Settings → Early
// Features. Calm and recovery-friendly: non-punitive streaks, intentional skips,
// and gentle restart messaging. All logic lives in lib/habits.ts (unit-tested).
import { useMemo, useState } from "react";
import { Plus, Trash2, Archive, ArchiveRestore, FlaskConical, Settings2, Target, Check } from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../components/ui/primitives";
import { StreakEmber } from "../components/ui/motion";
import {
  HABIT_TYPE_META, STATUS_META, currentStreak, weekStats, heatmapCells, recoveryMessage,
  statusOn, newHabitDefaults, todayKey,
} from "../lib/habits";
import { addLocalDays } from "../lib/dailyRollover";
import type { Habit, HabitCheckStatus, HabitType } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";
import { linkHabitToTargets, linkedRequirement, unlinkHabitFromTargets } from "../lib/habitTargets";
import { evaluateDailySuccess } from "../lib/dailySuccess";

const CHECK_OPTIONS: HabitCheckStatus[] = ["done", "partial", "skipped", "missed"];

export function HabitTrackerPage() {
  const enabled = useStore((s) => s.profile.experimentalFlags?.habits === true);
  const updateProfile = useStore((s) => s.updateProfile);
  const habits = useStore((s) => s.habits);
  const [showArchived, setShowArchived] = useState(false);

  if (!enabled) {
    return (
      <GlassCard pad>
        <PanelHeader title="Habit Tracker" sub="Experimental — currently turned off" />
        <EmptyState
          title="This is an early feature"
          hint="Enable the Habit Tracker in Settings → Personalization → Early Features. Your data stays local."
        />
        <GButton variant="primary" onClick={() => updateProfile({ experimentalFlags: { habits: true } })}>
          <FlaskConical size={ICON_SIZE.body} /> Enable Habit Tracker
        </GButton>
      </GlassCard>
    );
  }

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);
  const list = showArchived ? archived : active;

  return (
    <>
      <HabitCreate />
      <HabitTargetsSummary />
      <GlassCard pad>
        <PanelHeader
          title="Habits"
          sub={`${active.length} active${archived.length ? ` · ${archived.length} archived` : ""}`}
          action={
            <div className="filter-bar">
              <button type="button" className={`filter-pill ${!showArchived ? "on" : ""}`} onClick={() => setShowArchived(false)}>Active</button>
              <button type="button" className={`filter-pill ${showArchived ? "on" : ""}`} onClick={() => setShowArchived(true)}>Archived</button>
            </div>
          }
        />
        {list.length === 0 && (
          <EmptyState
            title={showArchived ? "Nothing archived" : "No habits yet"}
            hint={showArchived ? "Archived habits keep their history and can be restored." : "Start with one small, repeatable habit you can't say no to."}
          />
        )}
        <div className="stack gap12">
          {list.map((h) => <HabitRow key={h.id} habit={h} />)}
        </div>
      </GlassCard>
    </>
  );
}

const HABIT_TYPES: HabitType[] = ["binary", "duration", "count", "avoidance", "weekly", "scheduled", "recovery", "milestone"];

function HabitCreate() {
  const addHabit = useStore((s) => s.addHabit);
  const [name, setName] = useState("");
  const [type, setType] = useState<HabitType>("binary");
  const [countInTargets, setCountInTargets] = useState(true);

  function add() {
    if (!name.trim()) return;
    const id = addHabit(newHabitDefaults(name, type));
    if (countInTargets && type !== "avoidance" && type !== "milestone") {
      const state = useStore.getState();
      const habit = state.habits.find((candidate) => candidate.id === id);
      if (habit) state.updateProfile({ dailySuccess: linkHabitToTargets(state.profile.dailySuccess, habit) });
    }
    setName("");
    setType("binary");
  }

  return (
    <GlassCard pad>
      <PanelHeader title="New habit" sub="Self-monitoring with realistic, flexible recovery — not shame-driven streaks." />
      <div className="row wrap gap8">
        <input className="field grow" placeholder="e.g. Morning sunlight, 20 min of cardio, no doomscrolling"
          value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select className="field" value={type} onChange={(e) => setType(e.target.value as HabitType)} style={{ width: 190 }} aria-label="Habit type">
          {HABIT_TYPES.map((t) => <option key={t} value={t}>{HABIT_TYPE_META[t].label}</option>)}
        </select>
        <GButton variant="primary" onClick={add}><Plus size={ICON_SIZE.body} /> Add</GButton>
      </div>
      <div className="sub" style={{ marginTop: 10 }}>{HABIT_TYPE_META[type].hint}</div>
      <label className="habit-target-option">
        <input type="checkbox" checked={countInTargets} onChange={(event) => setCountInTargets(event.target.checked)} />
        <span>Count it in <b>Today’s targets</b> on Productivity — checking the habit fills the target automatically.</span>
      </label>
    </GlassCard>
  );
}

/** One line summarizing how habits feed the Productivity targets today. */
function HabitTargetsSummary() {
  const state = useStore();
  const linked = (state.profile.dailySuccess?.requirements ?? []).filter((requirement) => requirement.source.kind === "habit" && requirement.enabled);
  if (!linked.length) return null;
  const result = evaluateDailySuccess(state);
  const habitResults = result.requirements.filter((item) => item.requirement.source.kind === "habit" && item.eligible);
  const met = habitResults.filter((item) => item.status === "met").length;
  return (
    <div className="habit-targets-summary">
      <Target size={ICON_SIZE.body} aria-hidden="true" />
      <span><b>{met} of {habitResults.length}</b> habit targets met today · shared with Productivity’s daily targets ({result.progress}% overall)</span>
      <a href="#productivity">Open targets</a>
    </div>
  );
}

function HabitRow({ habit }: { habit: Habit }) {
  const entries = useStore((s) => s.habitEntries);
  const checkHabit = useStore((s) => s.checkHabit);
  const clearHabitCheck = useStore((s) => s.clearHabitCheck);
  const updateHabit = useStore((s) => s.updateHabit);
  const removeHabit = useStore((s) => s.removeHabit);
  const dailySuccess = useStore((s) => s.profile.dailySuccess);
  const updateProfile = useStore((s) => s.updateProfile);
  const [editing, setEditing] = useState(false);
  const linked = linkedRequirement(dailySuccess, habit.id);
  const inTargets = Boolean(linked?.enabled);

  function toggleTarget() {
    updateProfile({ dailySuccess: inTargets ? unlinkHabitFromTargets(dailySuccess, habit.id) : linkHabitToTargets(dailySuccess, habit) });
  }

  const today = todayKey();
  const myEntries = useMemo(() => entries.filter((e) => e.habitId === habit.id), [entries, habit.id]);
  const streak = currentStreak(habit, myEntries, today);
  const todayStatus = statusOn(habit, myEntries, today);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addLocalDays(today, -i)), [today]);
  const week = weekStats(habit, myEntries, weekDates);
  const cells = useMemo(() => heatmapCells(habit, myEntries, 35, today), [habit, myEntries, today]);
  const targeted = HABIT_TYPE_META[habit.type].needsTarget;

  function setStatus(status: HabitCheckStatus) {
    if (todayStatus === status) clearHabitCheck(habit.id, today);
    else checkHabit(habit.id, today, status);
  }

  function setValue(raw: string) {
    const value = Math.max(0, Number(raw) || 0);
    const target = habit.target ?? 1;
    if (value <= 0) { clearHabitCheck(habit.id, today); return; }
    checkHabit(habit.id, today, value >= target ? "done" : "partial", value);
  }

  const todayEntry = myEntries.find((e) => e.date === today);

  return (
    <div className="habit-card">
      <div className="habit-card-head">
        <div className="habit-title">
          {habit.color && <span style={{ width: 10, height: 10, borderRadius: 999, background: habit.color, display: "inline-block" }} />}
          <b>{habit.name}</b>
          <Tag tone="neutral">{HABIT_TYPE_META[habit.type].label}</Tag>
          {habit.examMode && <Tag tone="orange">Exam mode</Tag>}
          {!habit.archived && (
            <button
              type="button"
              className={`habit-target-chip ${inTargets ? "on" : ""}`}
              aria-pressed={inTargets}
              title={inTargets ? "Counts toward Today’s targets on Productivity. Click to stop counting it." : "Add this habit to Today’s targets on Productivity"}
              onClick={toggleTarget}
            >
              {inTargets ? <Check size={ICON_SIZE.microInline} aria-hidden="true" /> : <Target size={ICON_SIZE.microInline} aria-hidden="true" />}
              {inTargets ? "In daily targets" : "Add to daily targets"}
            </button>
          )}
        </div>
        <div className="row gap8" style={{ alignItems: "center" }}>
          <StreakEmber count={streak} />
          <GhostButton onClick={() => setEditing((v) => !v)} title="Settings"><Settings2 size={ICON_SIZE.body} /></GhostButton>
          <GhostButton onClick={() => updateHabit(habit.id, { archived: !habit.archived })} title={habit.archived ? "Restore" : "Archive"}>
            {habit.archived ? <ArchiveRestore size={ICON_SIZE.body} /> : <Archive size={ICON_SIZE.body} />}
          </GhostButton>
          <GhostButton className="danger" onClick={() => {
            if (!confirm(`Delete “${habit.name}” and its history? A linked daily target is removed too. Archive keeps the history instead.`)) return;
            if (linked) updateProfile({ dailySuccess: unlinkHabitFromTargets(dailySuccess, habit.id) });
            removeHabit(habit.id);
          }} title="Delete"><Trash2 size={ICON_SIZE.body} /></GhostButton>
        </div>
      </div>

      {!habit.archived && (
        <div className="habit-checkin">
          {targeted && (
            <input className="field habit-value-input" type="number" min={0} inputMode="numeric"
              placeholder={`${habit.target ?? ""}${habit.unit ? ` ${habit.unit}` : ""}`}
              defaultValue={todayEntry?.value ?? ""} key={todayEntry?.value ?? "empty"}
              onBlur={(e) => setValue(e.target.value)}
              aria-label={`Log ${habit.name} value`} />
          )}
          {CHECK_OPTIONS.map((status) => (
            <button key={status} type="button"
              className={`habit-status-btn tone-${STATUS_META[status].tone} ${todayStatus === status ? "on" : ""}`}
              onClick={() => setStatus(status)}
              aria-pressed={todayStatus === status}>
              {STATUS_META[status].label}
            </button>
          ))}
        </div>
      )}

      <div className="habit-heat" aria-hidden="true">
        {cells.map((cell) => {
          const tone = cell.status === "none" ? undefined : STATUS_META[cell.status].tone;
          const bg = tone === "green" ? `color-mix(in srgb, var(--grade-green) ${Math.round((0.25 + cell.intensity * 0.6) * 100)}%, transparent)`
            : tone === "cyan" ? `color-mix(in srgb, var(--cyan) ${Math.round((0.25 + cell.intensity * 0.6) * 100)}%, transparent)`
              : tone === "orange" ? `color-mix(in srgb, var(--grade-orange) ${Math.round((0.2 + cell.intensity * 0.5) * 100)}%, transparent)`
                : tone === "neutral" ? "color-mix(in srgb, var(--bone) 18%, transparent)"
                  : undefined;
          return (
            <span key={cell.date}
              className={`habit-heat-cell ${cell.scheduled ? "" : "unscheduled"}`}
              style={bg ? { background: bg } : undefined}
              title={`${cell.date}${cell.status !== "none" ? ` · ${STATUS_META[cell.status].label}` : ""}`} />
          );
        })}
      </div>

      <div className="habit-meta-row">
        <span>This week: <b>{week.adherence}%</b> adherence</span>
        <span>{week.done} done · {week.partial} partial · {week.skipped} skipped · {week.missed} missed</span>
        {habit.type === "scheduled" && habit.schedule?.length ? <span>Scheduled {scheduleLabel(habit.schedule)}</span> : null}
      </div>
      {!habit.archived && <div className="habit-recovery">{recoveryMessage(habit, myEntries, today)}</div>}

      {editing && <HabitEditor habit={habit} onClose={() => setEditing(false)} />}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function scheduleLabel(schedule: number[]): string {
  return schedule.slice().sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(" ");
}

function HabitEditor({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const updateHabit = useStore((s) => s.updateHabit);
  const scheduled = habit.type === "scheduled";
  const sched = new Set(habit.schedule ?? []);

  function toggleDay(d: number) {
    const next = new Set(sched);
    if (next.has(d)) next.delete(d); else next.add(d);
    updateHabit(habit.id, { schedule: [...next].sort((a, b) => a - b) });
  }

  return (
    <div className="habit-subpanel">
      <div className="row wrap gap12" style={{ alignItems: "center" }}>
        {HABIT_TYPE_META[habit.type].needsTarget && (
          <label className="stack gap6">
            <span className="field-label">Daily target {habit.unit ? `(${habit.unit})` : ""}</span>
            <input className="field" type="number" min={0} style={{ width: 120 }} defaultValue={habit.target ?? 1}
              onBlur={(e) => updateHabit(habit.id, { target: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        )}
        <label className="stack gap6">
          <span className="field-label">Category</span>
          <input className="field" style={{ width: 160 }} defaultValue={habit.category ?? ""}
            placeholder="Health, Spiritual…" onBlur={(e) => updateHabit(habit.id, { category: e.target.value.trim() || undefined })} />
        </label>
        <label className="stack gap6">
          <span className="field-label">Reminder window</span>
          <span className="row gap6">
            <input className="field" type="time" style={{ width: 110 }} defaultValue={habit.reminderStart ?? ""}
              onBlur={(e) => updateHabit(habit.id, { reminderStart: e.target.value || undefined })} aria-label="Reminder window start" />
            <input className="field" type="time" style={{ width: 110 }} defaultValue={habit.reminderEnd ?? ""}
              onBlur={(e) => updateHabit(habit.id, { reminderEnd: e.target.value || undefined })} aria-label="Reminder window end" />
          </span>
        </label>
      </div>

      {scheduled && (
        <div className="row gap6 wrap" style={{ marginTop: 12 }}>
          {WEEKDAYS.map((label, d) => (
            <button key={d} type="button" className={`filter-pill ${sched.has(d) ? "on" : ""}`} onClick={() => toggleDay(d)}>{label}</button>
          ))}
        </div>
      )}

      <div className="row gap12 wrap" style={{ marginTop: 12, alignItems: "center" }}>
        <label className="row gap6" style={{ alignItems: "center" }}>
          <input type="checkbox" checked={habit.quietMode === true} onChange={(e) => updateHabit(habit.id, { quietMode: e.target.checked })} />
          <span>Quiet mode (no reminders)</span>
        </label>
        <label className="row gap6" style={{ alignItems: "center" }}>
          <input type="checkbox" checked={habit.examMode === true} onChange={(e) => updateHabit(habit.id, { examMode: e.target.checked })} />
          <span>Examination-period mode</span>
        </label>
        <GButton size="sm" onClick={onClose}>Done</GButton>
      </div>
      <div className="sub" style={{ marginTop: 8 }}>
        Reminders use a time window, not a fixed alarm, and never fire after you've completed the habit. Scheduling lives here; in-app reminder delivery is on the roadmap.
      </div>
    </div>
  );
}
