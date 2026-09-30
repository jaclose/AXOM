// ===========================================================================
// Your trackers — the variables you choose to follow (Exist/Bearable-style
// custom tracking, Streaks-style limits), logged in one tap. Each switch on
// a tracker changes what AXOM does with its entries, and says so.
// ===========================================================================
import { useMemo, useState, type ComponentType, type CSSProperties } from "react";
import {
  Activity, Archive, ArchiveRestore, Bike, BookOpen, Brain, Check, Code2, Coffee, Droplets, Dumbbell, Eye, EyeOff,
  FileText, FlaskConical, Footprints, GraduationCap, Heart, Languages, Moon, Music, PenLine, Plus, Salad, Settings2,
  Smartphone, Sparkles, Target, Timer, type LucideProps,
} from "lucide-react";
import { useStore } from "../../lib/store";
import type { ProductivityTracker, ProductivityUnitType } from "../../lib/types";
import {
  formatTrackerValue, quickIncrements, summarizeTracker, trackerGoal, trackerUnitLabel, type TrackerSummary,
} from "../../lib/trackerStats";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { DailyRequirementsEditor } from "./DailyRequirementsEditor";
import { evaluateDailySuccess, evaluateRequirement, makeDailyRequirement } from "../../lib/dailySuccess";
import { ICON_SIZE } from "../../lib/iconSize";
import { pushToast } from "../../lib/toast";

type IconComponent = ComponentType<LucideProps>;

export const TRACKER_ICONS: Record<string, IconComponent> = {
  Activity, BookOpen, Brain, Bike, Code2, Coffee, Droplets, Dumbbell, FileText, FlaskConical, Footprints,
  GraduationCap, Heart, Languages, Moon, Music, PenLine, Salad, Smartphone, Sparkles, Target, Timer,
};

const TRACKER_COLORS = ["var(--cyan)", "var(--teal)", "var(--green)", "var(--gold)", "var(--orange)", "var(--red)", "var(--purple)", "var(--blue)"];

const UNIT_OPTIONS: Array<[ProductivityUnitType, string]> = [
  ["minutes", "Minutes"],
  ["count", "Count"],
  ["yesno", "Yes / no"],
  ["distance", "Distance (km)"],
  ["custom", "Custom unit"],
];

export function TrackerIcon({ name, size = ICON_SIZE.body }: { name: string; size?: number }) {
  const Icon = TRACKER_ICONS[name] ?? Activity;
  return <Icon size={size} aria-hidden="true" />;
}

/** What each switch does — shown next to it, so nothing is a mystery flag. */
const FLAG_COPY: Array<{ key: keyof Pick<ProductivityTracker, "contributesToAcademicStudy" | "contributesToTotalProductiveTime" | "contributesToEnergy" | "contributesToReports" | "contributesToHabitTracking">; label: string; detail: string }> = [
  { key: "contributesToAcademicStudy", label: "Counts as study", detail: "Adds to study minutes, day grades and study targets. Changing it re-labels past entries too." },
  { key: "contributesToTotalProductiveTime", label: "Counts as productive time", detail: "Adds to total productive minutes on Productivity and in the journal." },
  { key: "contributesToEnergy", label: "Compare with my energy", detail: "Reports compares your energy on days with and without it once each side has 3+ days." },
  { key: "contributesToReports", label: "Show in Reports", detail: "Adds a weekly total, trend and goal progress to Reports → Trackers." },
  { key: "contributesToHabitTracking", label: "Track as a habit", detail: "Keeps a linked habit checked from your entries, with a streak (Habits is an Early Feature)." },
];

export function TrackerManager() {
  const state = useStore();
  const trackers = state.productivityTrackers;
  const [targetDetails, setTargetDetails] = useState(false);
  const targetResults = evaluateDailySuccess(state).requirements.filter((result) => result.requirement.enabled);
  if (!targetResults.some((result) => result.requirement.source.kind === "study-minutes")) {
    const study = trackers.find((tracker) => tracker.id === "tracker-study");
    if (study) targetResults.unshift(evaluateRequirement(makeDailyRequirement({ id: "system-study-preview", label: "Study", source: { kind: "study-minutes" }, target: study.dailyTarget ?? study.weeklyTarget ?? 240, unit: "minutes", schedule: study.dailyTarget ? { kind: "daily" } : { kind: "weekly-total", weekStartsOn: 1 }, trackingStartsAt: study.createdAt.slice(0, 10) }), state, state.activeDayKey, state.activeDayKey));
  }
  const logs = useStore((s) => s.logs);
  const today = useStore((s) => s.activeDayKey);
  const [editing, setEditing] = useState<ProductivityTracker | "new" | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const visible = trackers.filter((tracker) => tracker.visible && !tracker.archived);
  const hidden = trackers.filter((tracker) => !tracker.visible || tracker.archived);
  const summaries = useMemo(
    () => new Map(trackers.map((tracker) => [tracker.id, summarizeTracker(tracker, logs, today)])),
    [trackers, logs, today],
  );
  // Most-used first so the board reflects what you actually track.
  const ordered = [...visible].sort((a, b) => (summaries.get(b.id)!.activeDays30 - summaries.get(a.id)!.activeDays30) || a.name.localeCompare(b.name));

  return (
    <GlassCard pad className="tracker-board" data-module-tour="productivity-targets">
      <PanelHeader title="Targets" sub="One progress view of the work you intend to do." action={<GButton size="sm" onClick={() => setTargetDetails(true)}><Settings2 size={ICON_SIZE.body} /> Configure targets</GButton>} />
      <div className="target-progress-list">
        {targetResults.map((result) => {
          const requirement = result.requirement;
          const weekly = requirement.schedule.kind === "weekly-total" || requirement.schedule.kind === "times-per-week";
          const unit = requirement.schedule.kind === "times-per-week" ? "days" : requirement.unit;
          const value = (amount: number) => unit === "minutes" ? `${Math.floor(Math.round(amount) / 60)}h ${Math.round(amount) % 60}m` : `${Math.round(amount * 10) / 10}`;
          return <button type="button" key={requirement.id} className="target-progress-row" onClick={() => { if (requirement.id === "system-study-preview") setEditing(trackers.find((tracker) => tracker.id === "tracker-study")!); else setTargetDetails(true); }} aria-label={`Edit ${requirement.label} target`}>
            <span><b>{requirement.source.kind === "study-minutes" ? "Study" : requirement.label}</b><small>{!result.eligible ? "Day off" : weekly ? "This week" : "Today"}</small></span>
            <span className="target-progress-value">{value(result.current)} <small>/ {value(result.target)}{unit !== "minutes" ? ` ${unit}` : ""}</small></span>
            <span className="target-progress-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, result.ratio * 100)}%` }} /></span><strong>{Math.round(result.ratio * 100)}%</strong>
          </button>;
        })}
      </div>
      {targetDetails && <Modal title="Targets" onClose={() => setTargetDetails(false)}><DailyRequirementsEditor expanded /></Modal>}
      <details className="tracker-categories-disclosure"><summary>Activity categories <span>Manual entries and advanced settings</span></summary>
      <PanelHeader
        title="Your trackers"
        headingLevel={2}
        sub="The variables you follow. Log in one tap; goals, streaks, energy comparisons and reports follow from the same entries."
        action={<GButton size="sm" variant="primary" onClick={() => setEditing("new")}><Plus size={ICON_SIZE.body} /> New tracker</GButton>}
      />
      <div className="tracker-board-grid">
        {ordered.map((tracker) => (
          <TrackerCard key={tracker.id} tracker={tracker} summary={summaries.get(tracker.id)!} onEdit={() => setEditing(tracker)} />
        ))}
      </div>
      {hidden.length > 0 && (
        <div className="tracker-hidden">
          <GhostButton onClick={() => setShowHidden((value) => !value)} aria-expanded={showHidden}>
            {showHidden ? <EyeOff size={ICON_SIZE.body} /> : <Eye size={ICON_SIZE.body} />} {hidden.length} hidden or archived
          </GhostButton>
          {showHidden && (
            <ul>
              {hidden.map((tracker) => (
                <li key={tracker.id}>
                  <span className="tracker-dot" style={{ background: tracker.color }} />
                  <span>{tracker.name}</span>
                  <small>{tracker.archived ? "Archived" : "Hidden"}</small>
                  <GhostButton onClick={() => setEditing(tracker)}><Settings2 size={ICON_SIZE.microInline} /> Edit</GhostButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </details>
      {editing && <TrackerEditor tracker={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </GlassCard>
  );
}

function TrackerCard({ tracker, summary, onEdit }: { tracker: ProductivityTracker; summary: TrackerSummary; onEdit: () => void }) {
  const logProductivity = useStore((s) => s.logProductivity);
  const goal = trackerGoal(tracker);
  const weekly = !tracker.dailyTarget && Boolean(tracker.weeklyTarget);
  const target = weekly ? tracker.weeklyTarget : tracker.dailyTarget && tracker.dailyTarget > 0 ? tracker.dailyTarget : undefined;
  const current = weekly ? summary.week : summary.today;
  const ratio = target ? Math.min(1, current / target) : summary.today > 0 ? 1 : 0;
  const over = goal === "at-most" && target !== undefined && summary.today > target;
  const doneToday = tracker.unitType === "yesno" && summary.today > 0;
  const style = { "--tracker": tracker.color } as CSSProperties;

  function log(amount: number) {
    logProductivity(tracker.unitType === "minutes" ? { trackerId: tracker.id, minutes: amount } : { trackerId: tracker.id, quantity: amount });
    pushToast({ title: `${tracker.name}: +${formatTrackerValue(tracker, amount)}`, tone: "success", duration: 2400, dedupe: `tracker-${tracker.id}` });
  }

  return (
    <article className={`tracker-card ${over ? "over" : ""}`} style={style} aria-label={tracker.name}>
      <header>
        <span className="tracker-icon"><TrackerIcon name={tracker.icon} /></span>
        <div className="tracker-title">
          <b>{tracker.name}</b>
          <small>{tracker.category}{goal === "at-most" ? " · limit" : ""}</small>
        </div>
        <button type="button" className="tracker-edit" onClick={onEdit} aria-label={`Edit ${tracker.name}`}><Settings2 size={ICON_SIZE.body} /></button>
      </header>

      <div className="tracker-today">
        <span className="tracker-ring" style={{ "--p": ratio } as CSSProperties} aria-hidden="true" />
        <div>
          <b>{tracker.unitType === "yesno" ? (doneToday ? "Done today" : "Not yet today") : formatTrackerValue(tracker, current)}</b>
          <small>
            {target !== undefined && tracker.unitType !== "yesno"
              ? `${goal === "at-most" ? "limit" : "goal"} ${formatTrackerValue(tracker, target)} ${weekly ? "this week" : "a day"}`
              : summary.todayMet ? "Goal met" : "today"}
          </small>
        </div>
      </div>


      <footer>
        <span className="tracker-week">
          <b>{formatTrackerValue(tracker, summary.week)}</b> this week
          {summary.weeklyProgress !== null && <small> · {summary.weeklyProgress}% of weekly goal</small>}
        </span>
        <div className="tracker-quick" role="group" aria-label={`Log ${tracker.name}`}>
          {tracker.unitType === "yesno"
            ? <GButton size="sm" variant={doneToday ? "default" : "primary"} disabled={doneToday} onClick={() => log(1)}><Check size={ICON_SIZE.body} /> {doneToday ? "Logged" : "Done"}</GButton>
            : quickIncrements(tracker).map((amount) => (
              <GButton key={amount} size="sm" onClick={() => log(amount)} aria-label={`Log ${amount} ${trackerUnitLabel(tracker, amount)} of ${tracker.name}`}>
                +{amount}{tracker.unitType === "minutes" ? "m" : ""}
              </GButton>
            ))}
        </div>
      </footer>
    </article>
  );
}

type Draft = Omit<ProductivityTracker, "id" | "createdAt" | "updatedAt">;

function emptyDraft(): Draft {
  return {
    name: "",
    icon: "Activity",
    color: "var(--cyan)",
    unitType: "minutes",
    dailyTarget: 30,
    weeklyTarget: undefined,
    goal: "at-least",
    category: "Personal",
    contributesToAcademicStudy: false,
    contributesToTotalProductiveTime: true,
    contributesToEnergy: true,
    contributesToReports: true,
    contributesToHabitTracking: false,
    visible: true,
    archived: false,
  };
}

export function TrackerEditor({ tracker, onClose }: { tracker?: ProductivityTracker; onClose: () => void }) {
  const add = useStore((s) => s.addProductivityTracker);
  const update = useStore((s) => s.updateProductivityTracker);
  const allTrackers = useStore((s) => s.productivityTrackers);
  const categories = useMemo(() => [...new Set(allTrackers.map((item) => item.category))].sort(), [allTrackers]);
  const [draft, setDraft] = useState<Draft>(() => (tracker ? { ...tracker } : emptyDraft()));
  const patch = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));
  const protectedStudy = tracker?.id === "tracker-study";
  const unit = trackerUnitLabel(draft);
  const valid = draft.name.trim().length > 0;

  function save() {
    if (!valid) return;
    const clean: Draft = {
      ...draft,
      name: draft.name.trim(),
      category: draft.category.trim() || "Personal",
      customUnit: draft.unitType === "custom" ? draft.customUnit?.trim() || "units" : undefined,
      dailyTarget: draft.dailyTarget && draft.dailyTarget > 0 ? draft.dailyTarget : draft.goal === "at-most" ? 0 : undefined,
      weeklyTarget: draft.weeklyTarget && draft.weeklyTarget > 0 ? draft.weeklyTarget : undefined,
    };
    if (tracker) update(tracker.id, clean);
    else add(clean);
    pushToast({ title: tracker ? "Tracker updated" : "Tracker created", body: tracker ? undefined : "Log it from the tracker board or the activity field.", tone: "success" });
    onClose();
  }

  function toggleArchive() {
    if (!tracker) return;
    update(tracker.id, { archived: !tracker.archived });
    pushToast({ title: tracker.archived ? "Tracker restored" : "Tracker archived", body: tracker.archived ? undefined : "Its history stays in your log and reports.", tone: "info" });
    onClose();
  }

  return (
    <Modal
      title={tracker ? `Edit ${tracker.name}` : "New tracker"}
      className="tracker-editor-modal"
      onClose={onClose}
      footer={(
        <>
          {tracker && !protectedStudy && (
            <GhostButton onClick={toggleArchive}>
              {tracker.archived ? <ArchiveRestore size={ICON_SIZE.body} /> : <Archive size={ICON_SIZE.body} />} {tracker.archived ? "Restore" : "Archive"}
            </GhostButton>
          )}
          <GButton onClick={onClose}>Cancel</GButton>
          <GButton variant="primary" onClick={save} disabled={!valid}>{tracker ? "Save" : "Create tracker"}</GButton>
        </>
      )}
    >
      <div className="tracker-editor">
        {protectedStudy && <p className="tracker-editor-note">Study is a system target. Focus time contributes automatically. Change the amount or icon here; choose weekdays or a weekly total in Targets.</p>}
        <label className="tracker-field wide">
          <span>Name</span>
          <input className="field" value={draft.name} disabled={protectedStudy} autoFocus maxLength={40} placeholder="Exercise, Reading, Social media…" onChange={(event) => patch({ name: event.target.value })} />
        </label>

        <fieldset className="tracker-field wide">
          <legend>Icon and color</legend>
          <div className="tracker-icon-grid" role="radiogroup" aria-label="Icon">
            {Object.keys(TRACKER_ICONS).map((name) => (
              <button key={name} type="button" role="radio" aria-checked={draft.icon === name} aria-label={name}
                className={draft.icon === name ? "on" : ""} onClick={() => patch({ icon: name })} style={{ "--tracker": draft.color } as CSSProperties}>
                <TrackerIcon name={name} />
              </button>
            ))}
          </div>
          <div className="tracker-color-row" role="radiogroup" aria-label="Color">
            {TRACKER_COLORS.map((color) => (
              <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={color.replace(/var\(--|\)/g, "")}
                className={draft.color === color ? "on" : ""} style={{ background: color }} onClick={() => patch({ color })} />
            ))}
          </div>
        </fieldset>

        <fieldset className="tracker-field wide">
          <legend>Goal</legend>
          <div className="tracker-segment" role="radiogroup" aria-label="Goal direction">
            <button type="button" role="radio" aria-checked={draft.goal !== "at-most"} className={draft.goal !== "at-most" ? "on" : ""} onClick={() => patch({ goal: "at-least" })}>
              Build it up <small>at least a daily amount</small>
            </button>
            <button type="button" role="radio" disabled={protectedStudy} aria-checked={draft.goal === "at-most"} className={draft.goal === "at-most" ? "on" : ""}
              onClick={() => patch({ goal: "at-most", contributesToAcademicStudy: false, contributesToTotalProductiveTime: false })}>
              Keep it under <small>a daily limit</small>
            </button>
          </div>
        </fieldset>

        <label className="tracker-field">
          <span>Measured in</span>
          <select className="field" disabled={protectedStudy} value={draft.unitType} onChange={(event) => patch({ unitType: event.target.value as ProductivityUnitType })}>
            {UNIT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {draft.unitType === "custom" ? (
          <label className="tracker-field">
            <span>Unit name</span>
            <input className="field" value={draft.customUnit ?? ""} maxLength={16} placeholder="pages, glasses…" onChange={(event) => patch({ customUnit: event.target.value })} />
          </label>
        ) : (
          <label className="tracker-field">
            <span>Category</span>
            <input className="field" list="tracker-categories" value={draft.category} maxLength={24} onChange={(event) => patch({ category: event.target.value })} />
            <datalist id="tracker-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
          </label>
        )}
        {draft.unitType !== "yesno" && (
          <label className="tracker-field">
            <span>{draft.goal === "at-most" ? "Daily limit" : "Daily goal"} ({unit})</span>
            <input className="field" type="number" min={0} value={draft.dailyTarget ?? ""} placeholder="optional" onChange={(event) => patch({ dailyTarget: event.target.value === "" ? undefined : Number(event.target.value) })} />
          </label>
        )}
        {draft.goal !== "at-most" && (
          <label className="tracker-field">
            <span>Weekly goal ({draft.unitType === "yesno" ? "days" : unit})</span>
            <input className="field" type="number" min={0} value={draft.weeklyTarget ?? ""} placeholder="optional" onChange={(event) => patch({ weeklyTarget: event.target.value === "" ? undefined : Number(event.target.value) })} />
          </label>
        )}

        <fieldset className="tracker-field wide tracker-flags">
          <legend>What it counts toward</legend>
          {FLAG_COPY.map((flag) => (
            <label key={flag.key} className="tracker-flag">
              <input type="checkbox" disabled={protectedStudy && (flag.key === "contributesToAcademicStudy" || flag.key === "contributesToTotalProductiveTime")} checked={Boolean(draft[flag.key])} onChange={(event) => patch({ [flag.key]: event.target.checked })} />
              <span><b>{flag.label}</b><small>{flag.detail}</small></span>
            </label>
          ))}
          <label className="tracker-flag">
            <input type="checkbox" checked={draft.visible} onChange={(event) => patch({ visible: event.target.checked })} />
            <span><b>Show on the tracker board</b><small>Hidden trackers keep their history and still appear in the activity field.</small></span>
          </label>
        </fieldset>
        {tracker && <p className="tracker-editor-note"><Tag tone="neutral">{tracker.id.startsWith("tracker-") ? "Built-in" : "Yours"}</Tag> Entries are matched by this tracker, so renaming keeps its history.</p>}
      </div>
    </Modal>
  );
}
