import { useState } from "react";
import { ArrowUpRight, CalendarCheck2, CheckCheck, Clock3, ListChecks } from "lucide-react";
import { useStore } from "../lib/store";
import { ProductivityPage } from "./ProductivityPage";
import { TasksPage } from "./TasksPage";
import { HabitTrackerPage } from "./HabitTrackerPage";
import "../styles/workspace-hubs.css";

export type DailyWorkspaceTab = "focus" | "tasks" | "habits";

const DAILY_VIEWS = [
  { id: "focus", label: "Focus", hint: "Log, plan and time", icon: Clock3 },
  { id: "tasks", label: "Tasks", hint: "Decide what is next", icon: ListChecks },
  { id: "habits", label: "Habits", hint: "Track the commitments", icon: CalendarCheck2 },
] as const;

/** A single day surface with the same saved activities, tasks and habit identities. */
export function DailyWorkspacePage({ initialTab = "focus" }: { initialTab?: DailyWorkspaceTab }) {
  const [tab, setTab] = useState<DailyWorkspaceTab>(initialTab);
  const state = useStore();
  const openTasks = state.tasks.filter((task) => !task.done && !task.archived);
  const overdue = openTasks.filter((task) => Boolean(task.due) && task.due!.slice(0, 10) < state.activeDayKey);
  const activeHabits = state.habits.filter((habit) => !habit.archived);
  const habitsEnabled = state.profile.experimentalFlags?.habits === true;

  return <section className="axom-workspace" aria-labelledby="daily-workspace-title">
    <header className="axom-workspace-hero">
      <div>
        <span className="axom-workspace-eyebrow">AXOM / DAILY SYSTEM</span>
        <h1 id="daily-workspace-title">Give the day a direction.</h1>
        <p>Focus, actions and routines in one place. A recorded hour is effort; a completed task is an action. Neither implies mastery.</p>
      </div>
      <span className="axom-workspace-hero-symbol" aria-hidden="true"><CheckCheck size={42} strokeWidth={1.1} /></span>
    </header>

    <div className="axom-workspace-indicators" aria-label="Current daily records">
      <div><span>DAY</span><strong className="axom-workspace-date">{state.activeDayKey}</strong><small>Selected working date</small></div>
      <div><span>OPEN TASKS</span><strong>{openTasks.length}</strong><small>{overdue.length ? `${overdue.length} overdue to review` : "No overdue tasks"}</small></div>
      <div><span>ACTIVE HABITS</span><strong>{habitsEnabled ? activeHabits.length : "Off"}</strong><small>{habitsEnabled ? "Your saved routines" : "Optional, enable here"}</small></div>
      <a className="axom-workspace-evidence" href="#reports">View learning reports <ArrowUpRight size={15} aria-hidden="true" /></a>
    </div>

    <nav className="axom-workspace-nav" aria-label="Daily workspace views">
      {DAILY_VIEWS.map(({ id, label, hint, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={tab === id} aria-controls="daily-workspace-content" onClick={() => setTab(id)}>
          <Icon size={18} aria-hidden="true" />
          <span><b>{label}</b><small>{hint}</small></span>
        </button>
      ))}
    </nav>

    <div id="daily-workspace-content" className="axom-workspace-content" aria-label={DAILY_VIEWS.find((view) => view.id === tab)?.label}>
      {tab === "focus" ? <ProductivityPage /> : tab === "tasks" ? <TasksPage /> : <HabitTrackerPage />}
    </div>
  </section>;
}
