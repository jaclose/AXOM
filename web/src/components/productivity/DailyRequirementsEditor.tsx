import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, Check, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { localDateKey } from "../../lib/dailyRollover";
import { evaluateDailySuccess, makeDailyRequirement } from "../../lib/dailySuccess";
import { useStore } from "../../lib/store";
import type { DailySuccessRequirement, DailySuccessSchedule, DailySuccessSource, HabitType } from "../../lib/types";
import { dismissAnnouncement, isAnnouncementDismissed, readDismissedAnnouncements } from "../../lib/announcements";
import { pushToast } from "../../lib/toast";
import { GButton, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

const STANDARD: Array<{
  kind: Exclude<QuickGoalKind, "custom" | "weekly-range" | "daily-slots">;
  label: string;
  target: number;
  unit: string;
}> = [
  { kind: "study-minutes", label: "Study minutes", target: 60, unit: "minutes" },
  { kind: "cards-reviewed", label: "Cards reviewed", target: 30, unit: "cards" },
  { kind: "practice-questions", label: "Practice questions", target: 30, unit: "questions" },
  { kind: "journal-closeout", label: "Daily closeout", target: 1, unit: "closeout" },
];

type QuickGoalKind = "study-minutes" | "cards-reviewed" | "practice-questions" | "journal-closeout" | "custom" | "weekly-range" | "daily-slots";
const QUICK_GOAL_LABELS: Record<Exclude<QuickGoalKind, "custom" | "weekly-range" | "daily-slots">, string> = {
  "study-minutes": "Study time",
  "cards-reviewed": "Cards reviewed",
  "practice-questions": "Practice questions",
  "journal-closeout": "Daily closeout",
};

export function DailyRequirementsEditor({ onFillActivity }: { onFillActivity?: (label: string, unit: string) => void } = {}) {
  const store = useStore();
  const [customName, setCustomName] = useState("");
  const [customTarget, setCustomTarget] = useState("1");
  const [customUnit, setCustomUnit] = useState("times");
  const [customSchedule, setCustomSchedule] = useState<DailySuccessSchedule>({ kind: "daily" });
  const [customCompletion, setCustomCompletion] = useState<"manual" | "activity" | "habit">("manual");
  const [customAliases, setCustomAliases] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<QuickGoalKind>("custom");
  const [quickName, setQuickName] = useState("");
  const [quickAmount, setQuickAmount] = useState("1");
  const [quickUnit, setQuickUnit] = useState("times");
  const [quickRecording, setQuickRecording] = useState<"manual" | "activity">("manual");
  const [quickSchedule, setQuickSchedule] = useState<DailySuccessSchedule>({ kind: "daily" });
  const [quickError, setQuickError] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("1");
  const [editSchedule, setEditSchedule] = useState<DailySuccessSchedule>({ kind: "daily" });
  const [editError, setEditError] = useState("");


  const config = store.profile.dailySuccess;
  const today = store.activeDayKey || localDateKey();
  const shown = useMemo(() => config?.requirements ?? legacyPreview(store.profile.dailyMinuteTarget, store.profile.dailyCardTarget, today), [config, store.profile.dailyCardTarget, store.profile.dailyMinuteTarget, today]);
  const todayResult = useMemo(() => evaluateDailySuccess(store, today, today), [store, today]);
  const resultById = new Map(todayResult.requirements.map((result) => [result.requirement.id, result]));
  const activeKinds = new Set(shown.map((requirement) => requirement.source.kind));

  function save(requirements: DailySuccessRequirement[]) {
    store.updateProfile({
      dailySuccess: {
        version: 1,
        configuredAt: config?.configuredAt ?? today,
        requirements,
      },
    });
  }

  function update(id: string, patch: Partial<DailySuccessRequirement>) {
    const changesScoringSemantics = Object.hasOwn(patch, "target")
      || Object.hasOwn(patch, "schedule")
      || Object.hasOwn(patch, "source")
      || Object.hasOwn(patch, "aliases")
      || Object.hasOwn(patch, "weight");
    save(shown.map((requirement) => requirement.id === id
      ? {
          ...requirement,
          ...patch,
          ...(changesScoringSemantics ? { trackingStartsAt: today } : {}),
          updatedAt: new Date().toISOString(),
        }
      : requirement));
  }

  function remove(id: string) {
    save(shown.filter((requirement) => requirement.id !== id));
  }

  function updateAliases(requirement: DailySuccessRequirement, raw: string) {
    const aliases = parseAliases(raw);
    const source = requirement.source.kind === "manual" && aliases?.length
      ? { kind: "activity-alias" as const }
      : requirement.source.kind === "activity-alias" && !aliases?.length
        ? { kind: "manual" as const }
        : requirement.source;
    update(requirement.id, { aliases, source });
  }

  function openQuickGoal() {
    const available = STANDARD.find((template) => !activeKinds.has(template.kind));
    setQuickKind(available ? available.kind : "custom");
    setQuickAmount(String(available?.target ?? 1));
    setQuickName("");
    setQuickUnit("times");
    setQuickRecording("manual");
    setQuickSchedule({ kind: "daily" });
    setQuickError("");
    setQuickOpen(true);
  }

  function chooseQuickKind(kind: QuickGoalKind) {
    setQuickKind(kind);
    const template = STANDARD.find((item) => item.kind === kind);
    setQuickAmount(String(template?.target ?? 1));
    if (kind === "weekly-range") {
      setQuickName("Gym");
      setQuickUnit("times");
      setQuickRecording("activity");
      setQuickSchedule({ kind: "weekly-range", minimum: 4, preferred: 5, weekStartsOn: 1 });
    } else if (kind === "daily-slots") {
      setQuickName("Prayer");
      setQuickUnit("prayers");
      setQuickRecording("manual");
      setQuickSchedule({ kind: "daily-slots", slots: ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] });
    } else {
      setQuickSchedule({ kind: "daily" });
    }
    setQuickError("");
  }

  function addQuickGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(quickAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      setQuickError("Enter a positive whole-number goal.");
      return;
    }
    if (quickKind !== "custom" && quickKind !== "weekly-range" && quickKind !== "daily-slots") {
      const template = STANDARD.find((item) => item.kind === quickKind);
      if (!template || activeKinds.has(template.kind)) {
        setQuickError("This goal already exists. Edit it below or choose another type.");
        return;
      }
      save([...shown, makeDailyRequirement({
        id: `daily-${template.kind}`,
        label: template.label,
        source: { kind: template.kind } as DailySuccessSource,
        target: amount,
        unit: template.unit,
        schedule: quickSchedule,
        trackingStartsAt: today,
      }, today)]);
    } else {
      const name = quickName.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!name) {
        setQuickError("Name the goal before saving.");
        return;
      }
      const unit = quickUnit.trim() || "times";
      save([...shown, makeDailyRequirement({
        id: `daily-quick-${crypto.randomUUID()}`,
        label: name,
        source: { kind: quickKind === "daily-slots" ? "manual" : quickRecording === "activity" ? "activity-alias" : "manual" },
        aliases: quickKind !== "daily-slots" && quickRecording === "activity" ? [name] : undefined,
        target: quickKind === "daily-slots" ? quickSchedule.kind === "daily-slots" ? quickSchedule.slots.length : amount : amount,
        unit,
        schedule: quickSchedule,
        trackingStartsAt: today,
      }, today)]);
    }
    setQuickOpen(false);
    setQuickError("");
  }

  function toggleNamedOccurrence(requirement: DailySuccessRequirement, slot: string) {
    if (requirement.schedule.kind !== "daily-slots" || !requirement.schedule.slots.includes(slot)) return;
    const id = `occurrence:${requirement.id}:${today}:${slot}`;
    const prior = requirement.manualContributions?.find((item) => item.id === id);
    const timestamp = new Date().toISOString();
    const newValue = prior?.value === 1 ? 0 : 1;
    update(requirement.id, {
      manualContributions: [
        ...(requirement.manualContributions ?? []).filter((item) => item.id !== id),
        { id, requirementId: requirement.id, dayKey: today, slotId: slot,
          value: newValue, unit: requirement.unit, mode: "add",
          createdAt: prior?.createdAt ?? timestamp, updatedAt: timestamp },
      ],
    });
  }

  function beginQuickEdit(requirement: DailySuccessRequirement) {
    setEditingGoalId(requirement.id);
    setEditAmount(String(requirement.target));
    setEditSchedule(requirement.schedule);
    setEditError("");
  }

  function saveQuickEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requirement = shown.find((item) => item.id === editingGoalId);
    if (!requirement) return;
    const amount = Number(editAmount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      setEditError("Enter a positive whole-number goal.");
      return;
    }
    const patch: Partial<DailySuccessRequirement> = {};
    if (amount !== requirement.target) patch.target = amount;
    if (JSON.stringify(editSchedule) !== JSON.stringify(requirement.schedule)) patch.schedule = editSchedule;
    if (Object.keys(patch).length) update(requirement.id, patch);
    setEditingGoalId(null);
    setEditError("");
  }

  function addStandard(template: typeof STANDARD[number]) {
    const source = { kind: template.kind } as DailySuccessSource;
    save([...shown, makeDailyRequirement({
      id: `daily-${template.kind}`,
      label: template.label,
      source,
      target: template.target,
      unit: template.unit,
      trackingStartsAt: today,
    }, today)]);
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    const target = Math.max(1, Number(customTarget) || 1);
    const habitType: HabitType = customSchedule.kind === "times-per-week"
      ? "weekly"
      : customSchedule.kind === "weekdays"
        ? "scheduled"
        : target > 1
          ? "count"
          : "binary";
    const habitId = customCompletion === "habit" ? store.addHabit({
      name, type: habitType, target,
      unit: customUnit.trim() || "times",
      weeklyTarget: customSchedule.kind === "times-per-week" ? customSchedule.times : undefined,
      schedule: customSchedule.kind === "weekdays" ? customSchedule.weekdays : undefined,
      trackingStartsAt: today,
    }) : undefined;
    const id = habitId ? `daily-habit-${habitId}` : `daily-manual-${crypto.randomUUID()}`;
    const aliases = customCompletion === "activity"
      ? parseAliases(`${name},${customAliases}`)
      : undefined;
    const requirement = makeDailyRequirement({
      id,
      label: name,
      source: habitId
        ? { kind: "habit", habitId }
        : customCompletion === "activity"
          ? { kind: "activity-alias" }
          : { kind: "manual" },
      aliases,
      target,
      unit: customUnit.trim() || "times",
      schedule: customSchedule,
      trackingStartsAt: today,
    }, today);
    save([...shown, requirement]);
    setCustomName("");
    setCustomTarget("1");
    setCustomAliases("");
    if (customCompletion === "manual" && store.profile.experimentalFlags?.habits !== true) {
      offerHabitTracking(requirement);
    }
  }

  function setManualValue(requirement: DailySuccessRequirement, value: number) {
    const timestamp = new Date().toISOString();
    const contribution = {
      id: crypto.randomUUID(),
      requirementId: requirement.id,
      dayKey: today,
      value: Math.max(0, Number(value) || 0),
      unit: requirement.unit,
      mode: "override" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    update(requirement.id, {
      manualContributions: [
        ...(requirement.manualContributions ?? []).filter((item) => !(item.dayKey === today && item.mode === "override")),
        contribution,
      ],
    });
  }

  function correctActivityMatch(sourceRecordId: string, fromRequirementId: string, toRequirementId?: string) {
    const timestamp = new Date().toISOString();
    save(shown.map((requirement) => {
      if (requirement.id === fromRequirementId) {
        return {
          ...requirement,
          excludedSourceRecordIds: uniqueIds([...(requirement.excludedSourceRecordIds ?? []), sourceRecordId]),
          includedSourceRecordIds: removeId(requirement.includedSourceRecordIds, sourceRecordId),
          updatedAt: timestamp,
        };
      }
      if (toRequirementId && requirement.id === toRequirementId) {
        return {
          ...requirement,
          excludedSourceRecordIds: removeId(requirement.excludedSourceRecordIds, sourceRecordId),
          includedSourceRecordIds: uniqueIds([...(requirement.includedSourceRecordIds ?? []), sourceRecordId]),
          updatedAt: timestamp,
        };
      }
      return requirement;
    }));
  }

  function restoreActivityMatch(sourceRecordId: string, requirementId: string) {
    save(shown.map((requirement) => requirement.id === requirementId
      ? {
          ...requirement,
          excludedSourceRecordIds: removeId(requirement.excludedSourceRecordIds, sourceRecordId),
          updatedAt: new Date().toISOString(),
        }
      : requirement));
  }

  function offerHabitTracking(requirement: DailySuccessRequirement) {
    const announcementId = habitPromptId(requirement.id);
    if (isAnnouncementDismissed(announcementId, readDismissedAnnouncements())) return;
    window.setTimeout(() => pushToast({
      title: "Track this as a recurring habit?",
      body: `${requirement.label} can stay a manual target, or Habit Tracker can hold its recurring check-ins.`,
      tone: "info",
      duration: 12_000,
      dedupe: announcementId,
      actions: [
        { label: "Enable Habit Tracker", onAction: () => enableHabitForTarget(requirement.id, announcementId) },
        { label: "Not now", onAction: () => { dismissAnnouncement(announcementId); } },
        { label: "Keep as manual target", onAction: () => { dismissAnnouncement(announcementId); } },
      ],
    }), 450);
  }

  function enableHabitForTarget(requirementId: string, announcementId: string) {
    const current = useStore.getState();
    const currentConfig = current.profile.dailySuccess;
    const requirement = currentConfig?.requirements.find((item) => item.id === requirementId);
    if (!currentConfig || !requirement || requirement.source.kind !== "manual") return;
    const habitType: HabitType = requirement.schedule.kind === "times-per-week"
      ? "weekly"
      : requirement.schedule.kind === "weekdays"
        ? "scheduled"
        : requirement.target > 1 ? "count" : "binary";
    const habitId = current.addHabit({
      name: requirement.label,
      type: habitType,
      target: requirement.target,
      unit: requirement.unit,
      weeklyTarget: requirement.schedule.kind === "times-per-week" ? requirement.schedule.times : undefined,
      schedule: requirement.schedule.kind === "weekdays" ? requirement.schedule.weekdays : undefined,
      trackingStartsAt: requirement.trackingStartsAt,
    });
    const refreshed = useStore.getState();
    refreshed.updateProfile({
      experimentalFlags: { ...refreshed.profile.experimentalFlags, habits: true },
      dailySuccess: {
        ...currentConfig,
        requirements: currentConfig.requirements.map((item) => item.id === requirementId
          ? { ...item, source: { kind: "habit" as const, habitId }, updatedAt: new Date().toISOString() }
          : item),
      },
    });
    dismissAnnouncement(announcementId);
    location.hash = "habits";
  }

  return (
    <>
      <section className="quick-goals" aria-label="Your daily goals">
        <header className="quick-goals-head">
          <div>
            <h4>Your goals</h4>
            <p>Choose what counts. Progress uses your recorded activity or check-offs, not a guessed score.</p>
          </div>
          <GButton size="sm" onClick={() => quickOpen ? setQuickOpen(false) : openQuickGoal()}
            aria-expanded={quickOpen} aria-controls="quick-goal-form">
            <Plus size={ICON_SIZE.body} /> {quickOpen ? "Close goal form" : "Add a goal"}
          </GButton>
        </header>
        {shown.filter((requirement) => requirement.enabled).length > 0 ? (
          <div className="quick-goals-list">
            {shown.filter((requirement) => requirement.enabled).slice(-4).reverse().map((requirement) => {
              const progress = resultById.get(requirement.id);
              const current = progress?.current ?? 0;
              const manual = requirement.source.kind === "manual" && !requirement.aliases?.length;
              const checked = progress?.status === "met";
              const weekly = requirement.schedule.kind === "weekly-range";
              const named = requirement.schedule.kind === "daily-slots";
              const weeklyCheck = requirement.manualContributions?.find((item) =>
                item.dayKey === today && item.mode === "override");
              const weeklyDoneToday = (weeklyCheck?.value ?? 0) >= requirement.target;
              const completedSlots = new Set((requirement.manualContributions ?? [])
                .filter((item) => item.dayKey === today && item.slotId && item.value > 0)
                .map((item) => item.slotId));
              return <div className="quick-goal-entry" key={requirement.id}><div className="quick-goal-row">
                <div className="quick-goal-copy">
                  <b>{requirement.label}</b>
                  <span>{weekly
                    ? progress?.calculation ?? "Weekly goal"
                    : named ? `${completedSlots.size} / ${requirement.schedule.kind === "daily-slots" ? requirement.schedule.slots.length : 0} reported`
                    : progress?.eligible
                      ? `${formatGoalNumber(current)} / ${formatGoalNumber(progress.target)} ${requirement.unit}`
                      : `Not scheduled today · ${scheduleDescription(requirement.schedule)}`}</span>
                  <div className="quick-goal-track"
                    role="progressbar" aria-label={`${requirement.label} progress`}
                    aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={Math.round((progress?.ratio ?? 0) * 100)}>
                    <i style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} />
                  </div>
                </div>
                {manual && weekly && (
                  <GButton size="sm" type="button"
                    onClick={() => setManualValue(requirement, weeklyDoneToday ? 0 : requirement.target)}>
                    {weeklyDoneToday ? "Undo today" : "Mark today"} {requirement.label}
                  </GButton>
                )}
                {manual && !weekly && !named && progress?.eligible && (
                  requirement.target <= 1
                    ? <GButton size="sm" onClick={() => setManualValue(requirement, checked ? 0 : requirement.target)}>
                        {checked ? "Undo" : "Complete"} {requirement.label}
                      </GButton>
                    : <div className="quick-goal-adjust">
                        <button type="button" aria-label={`Decrease ${requirement.label}`} disabled={current <= 0}
                          onClick={() => setManualValue(requirement, Math.max(0, current - 1))}>−</button>
                        <button type="button" aria-label={`Increase ${requirement.label}`}
                          onClick={() => setManualValue(requirement, current + 1)}>+</button>
                      </div>
                )}
                {requirement.source.kind === "activity-alias" && onFillActivity && (
                  <GButton size="sm" type="button" aria-label={`Use ${requirement.label} in self-report`}
                    onClick={() => onFillActivity(requirement.aliases?.[0] ?? requirement.label, requirement.unit)}>
                    Use in log
                  </GButton>
                )}
                {!manual && requirement.source.kind !== "activity-alias" && (
                  <small className="quick-goal-origin">{completionSourceDescription(requirement)}</small>
                )}
                <button type="button" className="quick-goal-edit-trigger" aria-label={`Edit ${requirement.label} goal`}
                  aria-expanded={editingGoalId === requirement.id}
                  onClick={() => editingGoalId === requirement.id ? setEditingGoalId(null) : beginQuickEdit(requirement)}>Edit</button>
              </div>
              {named && requirement.schedule.kind === "daily-slots" && (
                <div className="quick-goal-slots" role="group" aria-label={`${requirement.label} named occurrences`}>
                  {requirement.schedule.slots.map((slot) => <button key={slot} type="button"
                    aria-pressed={completedSlots.has(slot)}
                    onClick={() => toggleNamedOccurrence(requirement, slot)}>{slot}</button>)}
                </div>
              )}
              {editingGoalId === requirement.id && (
                <form className="quick-goal-edit-form" onSubmit={saveQuickEdit} aria-label={`Edit ${requirement.label}`}>
                  <label><span>Amount</span><input className="field" type="number" min="1" step="1"
                    aria-label="Change goal amount" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} /></label>
                  <label><span>Schedule</span><select className="field" aria-label="Change goal schedule"
                    value={editSchedule.kind} onChange={(event) => setEditSchedule(scheduleFromKind(event.target.value))}>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Monday to Friday</option>
                    <option value="times-per-week">Times per week</option>
                  </select></label>
                  {editSchedule.kind === "times-per-week" && (
                    <label><span>Days per week</span><input className="field" type="number" min="1" max="7"
                      aria-label="Change days per week" value={editSchedule.times}
                      onChange={(event) => setEditSchedule({
                        kind: "times-per-week", times: Math.max(1, Math.min(7, Math.round(Number(event.target.value) || 1))), weekStartsOn: 1,
                      })} /></label>
                  )}
                  <p className="quick-goal-guide">Changes start today. Earlier activity and recorded goal results remain available.</p>
                  {editError && <p className="quick-goal-error" role="alert">{editError}</p>}
                  <div className="quick-goal-actions">
                    <GButton size="sm" variant="primary" type="submit">Update goal</GButton>
                    <GButton size="sm" type="button" onClick={() => setEditingGoalId(null)}>Cancel edit</GButton>
                  </div>
                </form>
              )}
              </div>;
            })}
            {shown.filter((requirement) => requirement.enabled).length > 4 && (
              <p className="quick-goal-overflow">Additional goals are available in Choose targets below.</p>
            )}
          </div>
        ) : <p className="quick-goals-empty">No goals selected. Add one to start, or just log your work.</p>}
        {quickOpen && (
          <form id="quick-goal-form" className="quick-goal-form" onSubmit={addQuickGoal}>
            <label>
              <span>Goal type</span>
              <select className="field" aria-label="Goal type" value={quickKind}
                onChange={(event) => chooseQuickKind(event.target.value as QuickGoalKind)}>
                {STANDARD.map((template) => (
                  <option key={template.kind} value={template.kind} disabled={activeKinds.has(template.kind)}>
                    {QUICK_GOAL_LABELS[template.kind]}
                    {activeKinds.has(template.kind) ? " (already set)" : ""}
                  </option>
                ))}
                <option value="weekly-range">Flexible weekly (gym 4–5 days)</option>
                <option value="daily-slots">Named daily occurrences (five prayers)</option>
                <option value="custom">Custom goal</option>
              </select>
            </label>
            {(quickKind === "custom" || quickKind === "weekly-range" || quickKind === "daily-slots") && (
              <label className="quick-goal-name"><span>Goal name</span>
                <input className="field" aria-label="Goal name" placeholder="e.g. Read anatomy, pray, practice piano"
                  maxLength={80} value={quickName} onChange={(event) => setQuickName(event.target.value)} />
              </label>
            )}
            {quickKind !== "daily-slots" && quickKind !== "weekly-range" && <label><span>Amount</span><input className="field" aria-label="Goal amount" type="number" min="1" step="1"
              value={quickAmount} onChange={(event) => setQuickAmount(event.target.value)} /></label>}
            {(quickKind === "custom" || quickKind === "weekly-range") && <>
              <label><span>Unit</span><select className="field" aria-label="Goal unit" value={quickUnit}
                onChange={(event) => setQuickUnit(event.target.value)}>
                <option value="times">Times</option>
                <option value="minutes">Minutes</option>
                <option value="pages">Pages</option>
                <option value="questions">Questions</option>
                <option value="cards">Cards</option>
              </select></label>
              {quickKind === "weekly-range" && quickSchedule.kind === "weekly-range" && <>
                <label><span>Minimum days per week</span><input className="field" aria-label="Minimum weekly days"
                  type="number" min="1" max="7" value={quickSchedule.minimum}
                  onChange={(e) => setQuickSchedule({ ...quickSchedule, minimum: Math.max(1, Math.min(7, Number(e.target.value)||1)) })} /></label>
                <label><span>Preferred days per week</span><input className="field" aria-label="Preferred weekly days"
                  type="number" min="1" max="7" value={quickSchedule.preferred}
                  onChange={(e) => setQuickSchedule({ ...quickSchedule, preferred: Math.max(1, Math.min(7, Number(e.target.value)||1)) })} /></label>
              </>}
              <label><span>How progress is recorded</span>
                <select className="field" aria-label="How progress is recorded" value={quickRecording}
                  onChange={(event) => setQuickRecording(event.target.value as "manual" | "activity")}>
                  <option value="manual">I check it off here</option>
                  <option value="activity">My self-reported activities</option>
                </select>
              </label>
            </>}
            {quickKind !== "weekly-range" && quickKind !== "daily-slots" && <label><span>Schedule</span><select className="field" aria-label="Goal schedule" value={quickSchedule.kind}
              onChange={(event) => setQuickSchedule(scheduleFromKind(event.target.value))}>
              <option value="daily">Every day</option>
              <option value="weekdays">Monday to Friday</option>
              <option value="times-per-week">Times per week</option>
            </select></label>}
            {quickSchedule.kind === "times-per-week" && (
              <label><span>Days per week</span><input className="field" type="number" min="1" max="7" step="1"
                value={quickSchedule.times} onChange={(event) => setQuickSchedule({
                  kind: "times-per-week", times: Math.max(1, Math.min(7, Math.round(Number(event.target.value) || 1))), weekStartsOn: 1,
                })} /></label>
            )}
            <p className="quick-goal-guide">{quickKind === "custom" && quickRecording === "activity"
              ? "Activities with this exact name will update the goal when you log them. Time or quantity follows the unit you chose."
              : "A new goal starts today. Earlier dates are not rescored."}</p>
            {quickError && <p className="quick-goal-error" role="alert">{quickError}</p>}
            <div className="quick-goal-actions">
              <GButton size="sm" variant="primary" type="submit"><Check size={ICON_SIZE.body} /> Save goal</GButton>
              <GButton size="sm" type="button" onClick={() => { setQuickOpen(false); setQuickError(""); }}>Cancel</GButton>
            </div>
          </form>
        )}
      </section>
      <details className="daily-requirements-editor" data-tour="requirements">
      <summary><SlidersHorizontal size={ICON_SIZE.body} aria-hidden="true" /> Choose targets <span>{shown.length}</span></summary>
      <div className="daily-requirements-body">
        <p>
          Only enabled, scheduled targets count. New targets start today—AXOM never creates past misses.
          {config ? "" : " Your current minute/card rules remain active until you change this list."}
        </p>
        <div className="daily-requirement-list">
          {shown.length === 0 && <div className="daily-requirement-empty">No target is enabled. Today stays neutral until you choose one.</div>}
          {shown.map((requirement) => {
            const result = resultById.get(requirement.id);
            const manual = requirement.source.kind === "manual" && !(requirement.aliases?.length);
            const linkedHabitId = requirement.source.kind === "habit" ? requirement.source.habitId : undefined;
            const linkedHabit = linkedHabitId
              ? store.habits.find((habit) => habit.id === linkedHabitId)
              : undefined;
            const complete = result?.status === "met";
            const matchedActivityRows = result?.contributions.filter((row) => row.sourceRecord === "study-log") ?? [];
            const excludedActivityRows = (requirement.excludedSourceRecordIds ?? [])
              .map((sourceRecordId) => store.logs.find((log) => log.id === sourceRecordId && log.dayKey === today))
              .filter((log): log is NonNullable<typeof log> => Boolean(log));
            return (
            <div className="daily-requirement-card" key={requirement.id}>
              <div className="daily-requirement-card-head">
                <label className="daily-requirement-toggle">
                  <input type="checkbox" checked={requirement.enabled} onChange={(event) => update(requirement.id, { enabled: event.target.checked, trackingStartsAt: today })} />
                  <span><b>{requirement.label}</b><small>{completionSourceDescription(requirement)}</small></span>
                </label>
                <div className="daily-requirement-progress">
                  <span>Today</span>
                  <b>{result?.calculation ?? "Not scheduled"}</b>
                  <Tag tone={complete ? "green" : result?.status === "in-progress" ? "cyan" : "neutral"}>{complete ? "Complete" : result?.status === "in-progress" ? "In progress" : "Pending"}</Tag>
                </div>
                {(manual || linkedHabit) && (
                  <div className="daily-requirement-check">
                    {requirement.target <= 1 ? (
                      <GButton size="sm" variant={complete ? "default" : "primary"} onClick={() => {
                        if (linkedHabit) {
                          if (complete) store.clearHabitCheck(linkedHabit.id, today);
                          else store.checkHabit(linkedHabit.id, today, "done", requirement.target);
                        } else setManualValue(requirement, complete ? 0 : requirement.target);
                      }}>
                        {complete ? <RotateCcw size={ICON_SIZE.body} /> : <Check size={ICON_SIZE.body} />} {complete ? "Undo" : "Mark complete"}
                      </GButton>
                    ) : (
                      <label><span>Today’s value</span><input className="field" type="number" min="0" defaultValue={result?.current || ""} onBlur={(event) => {
                        const value = Math.max(0, Number(event.target.value) || 0);
                        if (linkedHabit) {
                          if (!value) store.clearHabitCheck(linkedHabit.id, today);
                          else store.checkHabit(linkedHabit.id, today, value >= requirement.target ? "done" : "partial", value);
                        } else setManualValue(requirement, value);
                      }} /></label>
                    )}
                  </div>
                )}
              </div>
              {(matchedActivityRows.length > 0 || excludedActivityRows.length > 0) && (
                <details className="daily-requirement-matches">
                  <summary>Today’s matched activity <span>{matchedActivityRows.length} active</span></summary>
                  <div className="daily-requirement-match-list">
                    {matchedActivityRows.map((row) => {
                      const log = store.logs.find((candidate) => candidate.id === row.sourceRecordId);
                      return <div key={row.dedupeKey} className="daily-requirement-match-row">
                        <div><b>{log?.type || "Activity"}</b><span>{formatMatchValue(row.value, row.unit)} · {matchLabel(row.matchedBy)}</span></div>
                        <button type="button" className="ghost-btn" onClick={() => correctActivityMatch(row.sourceRecordId, requirement.id)}>Undo match</button>
                        {shown.length > 1 && <select className="field" aria-label={`Reassign ${log?.type || "activity"} from ${requirement.label}`} defaultValue="" onChange={(event) => {
                          if (!event.target.value) return;
                          correctActivityMatch(row.sourceRecordId, requirement.id, event.target.value);
                        }}>
                          <option value="">Reassign…</option>
                          {shown.filter((candidate) => candidate.id !== requirement.id && candidate.enabled).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                        </select>}
                      </div>;
                    })}
                    {excludedActivityRows.map((log) => <div key={log.id} className="daily-requirement-match-row muted">
                      <div><b>{log.type}</b><span>Match removed for today · source activity preserved</span></div>
                      <button type="button" className="ghost-btn" onClick={() => restoreActivityMatch(log.id, requirement.id)}>Restore match</button>
                    </div>)}
                  </div>
                  <p>Corrections affect only this target. The original activity and history stay intact.</p>
                </details>
              )}
              <details className="daily-requirement-settings">
                <summary>Target settings <span>{scheduleDescription(requirement.schedule)} · weight {requirement.weight ?? 1}</span></summary>
              <div className="daily-requirement-row">
              <label><span>Target</span><input className="field" aria-label="Target" type="number" min="1" value={requirement.target} onChange={(event) => update(requirement.id, { target: Math.max(1, Number(event.target.value) || 1) })} /></label>
              <label><span>Schedule</span><select className="field" aria-label="Schedule" value={requirement.schedule.kind} onChange={(event) => update(requirement.id, { schedule: scheduleFromKind(event.target.value) })}>
                <option value="daily">Daily</option>
                <option value="weekdays">Selected weekdays</option>
                <option value="times-per-week">Times per week</option>
              </select></label>
              <label><span>Weight toward today</span><input className="field" aria-label={`Weight for ${requirement.label}`} type="number" min="0.1" max="5" step="0.1" value={requirement.weight ?? 1} onChange={(event) => update(requirement.id, { weight: Math.max(.1, Math.min(5, Number(event.target.value) || 1)) })} /></label>
              <label className="daily-requirement-aliases"><span>Activity aliases</span><input className="field" aria-label={`Activity aliases for ${requirement.label}`} placeholder="gym, workout, lifting" defaultValue={(requirement.aliases ?? []).join(", ")} onBlur={(event) => updateAliases(requirement, event.target.value)} /></label>
              {requirement.schedule.kind === "weekdays" && (
                <WeekdayPicker value={requirement.schedule.weekdays} onChange={(weekdays) => update(requirement.id, { schedule: { kind: "weekdays", weekdays } })} />
              )}
              {requirement.schedule.kind === "times-per-week" && (
                <label><span>Times</span><input className="field" type="number" min="1" max="7" value={requirement.schedule.times} onChange={(event) => update(requirement.id, { schedule: { kind: "times-per-week", times: Math.max(1, Math.min(7, Number(event.target.value) || 1)), weekStartsOn: 1 } })} /></label>
              )}
              <button type="button" className="daily-requirement-remove" aria-label={`Remove ${requirement.label} target`} onClick={() => remove(requirement.id)}><Trash2 size={ICON_SIZE.body} /></button>
              </div>
              <div className="daily-requirement-meta">
                <span><b>Completion source:</b> {completionSourceDescription(requirement)}</span>
                <span><b>Schedule:</b> {scheduleDescription(requirement.schedule)}</span>
                <span><b>Tracking since:</b> {requirement.trackingStartsAt}</span>
                {requirement.aliases?.length ? <span><b>Matches:</b> {requirement.aliases.join(", ")}</span> : null}
              </div>
              </details>
            </div>
          );})}
        </div>

        <div className="daily-requirement-add">
          <span>Add a standard signal</span>
          <div className="row wrap gap6">
            {STANDARD.filter((template) => !activeKinds.has(template.kind)).map((template) => (
              <GButton size="sm" key={template.kind} onClick={() => addStandard(template)}><Plus size={ICON_SIZE.body} /> {template.label}</GButton>
            ))}
          </div>
        </div>

        <details className="daily-custom-requirement">
          <summary><CalendarDays size={ICON_SIZE.body} /> Add a custom recurring requirement</summary>
          <div className="daily-custom-grid">
            <label><span>Name</span><input className="field" placeholder="Gym, reading, prayer, steps…" value={customName} onChange={(event) => setCustomName(event.target.value)} /></label>
            <label><span>Target</span><input className="field" type="number" min="1" value={customTarget} onChange={(event) => setCustomTarget(event.target.value)} /></label>
            <label><span>Unit</span><input className="field" placeholder="times" value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} /></label>
            <label><span>Completion source</span><select className="field" aria-label="Completion source" value={customCompletion} onChange={(event) => setCustomCompletion(event.target.value as typeof customCompletion)}>
              <option value="manual">Manual check-off</option>
              <option value="activity">Matching activity log</option>
              <option value="habit">Linked Habit Tracker</option>
            </select></label>
            <label><span>Schedule</span><select className="field" value={customSchedule.kind} onChange={(event) => setCustomSchedule(scheduleFromKind(event.target.value))}>
              <option value="daily">Daily</option>
              <option value="weekdays">Monday–Friday</option>
              <option value="times-per-week">Times per week</option>
            </select></label>
            {customCompletion === "activity" && <label className="daily-custom-alias"><span>Activity aliases</span><input className="field" placeholder="gym, workout, lifting" value={customAliases} onChange={(event) => setCustomAliases(event.target.value)} /></label>}
            {customSchedule.kind === "times-per-week" && <label><span>Times</span><input className="field" type="number" min="1" max="7" value={customSchedule.times} onChange={(event) => setCustomSchedule({ ...customSchedule, times: Math.max(1, Math.min(7, Number(event.target.value) || 1)) })} /></label>}
            <GButton variant="primary" onClick={addCustom}><Plus size={ICON_SIZE.body} /> Add target</GButton>
          </div>
        </details>
      </div>
      </details>
    </>
  );
}

function formatGoalNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function legacyPreview(minutes: number, cards: number, today: string): DailySuccessRequirement[] {
  return [
    makeDailyRequirement({ id: "legacy-study-minutes", label: "Study minutes", source: { kind: "study-minutes" }, target: Math.max(1, minutes || 240), unit: "minutes", trackingStartsAt: today }, today),
    makeDailyRequirement({ id: "legacy-cards-reviewed", label: "Cards reviewed", source: { kind: "cards-reviewed" }, target: Math.max(1, cards || 120), unit: "cards", trackingStartsAt: today }, today),
  ];
}

function scheduleFromKind(kind: string): DailySuccessSchedule {
  if (kind === "weekdays") return { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] };
  if (kind === "times-per-week") return { kind: "times-per-week", times: 3, weekStartsOn: 1 };
  return { kind: "daily" };
}

function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  const labels = [
    ["S", "Sunday"], ["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"],
    ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"],
  ] as const;
  return <fieldset className="daily-weekdays"><legend>Eligible days</legend>{labels.map(([short, label], day) => {
    const checked = value.includes(day);
    const lastSelected = checked && value.length === 1;
    return <label key={day}><input type="checkbox" aria-label={label} checked={checked} disabled={lastSelected} onChange={(event) => {
      const next = event.target.checked ? [...new Set([...value, day])].sort() : value.filter((item) => item !== day);
      if (next.length) onChange(next);
    }} /><span>{short}</span></label>;
  })}</fieldset>;
}

function completionSourceDescription(requirement: DailySuccessRequirement): string {
  if (requirement.aliases?.length) return "Automatic from matching activity labels";
  if (requirement.source.kind === "study-minutes") return "Automatic from Pomodoro or study time";
  if (requirement.source.kind === "cards-reviewed") return "Automatic from card activity";
  if (requirement.source.kind === "practice-questions") return "Automatic from Question Bank or question logs";
  if (requirement.source.kind === "journal-closeout") return "Automatic from Journal closeout";
  if (requirement.source.kind === "habit") return "Linked to Habit Tracker";
  if (requirement.source.kind === "productivity-tracker") return "Automatic from linked activity category";
  if (requirement.source.kind === "activity-alias") return "Automatic from matching activity labels";
  return requirement.target > 1 ? "Manual quantity" : "Manual check-off";
}

function scheduleDescription(schedule: DailySuccessSchedule): string {
  if (schedule.kind === "daily-slots") return `${schedule.slots.length} named occurrences daily`;
  if (schedule.kind === "weekly-range") return `${schedule.minimum}–${schedule.preferred} days per week`;
  if (schedule.kind === "daily") return "Every day";
  if (schedule.kind === "weekdays") return schedule.weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ");
  return `${schedule.times} times per week`;
}

function parseAliases(value: string): string[] | undefined {
  const seen = new Set<string>();
  const aliases = value.split(",").map((item) => item.trim().replace(/\s+/g, " ")).filter((item) => {
    const key = item.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
  return aliases.length ? aliases : undefined;
}

function habitPromptId(requirementId: string): string {
  return `daily-target-habit-v1:${requirementId.replace(/[^a-z0-9._:-]/gi, "-").slice(0, 72)}`;
}

function uniqueIds(ids: string[]): string[] | undefined {
  const next = [...new Set(ids.filter(Boolean))].slice(-200);
  return next.length ? next : undefined;
}

function removeId(ids: string[] | undefined, id: string): string[] | undefined {
  const next = (ids ?? []).filter((candidate) => candidate !== id);
  return next.length ? next : undefined;
}

function formatMatchValue(value: number, unit: string): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${formatted} ${unit}`;
}

function matchLabel(matchedBy: string): string {
  if (matchedBy === "reassigned") return "reassigned by you";
  if (matchedBy === "alias") return "matched an alias";
  if (matchedBy === "linked") return "linked source";
  return "automatic source";
}
