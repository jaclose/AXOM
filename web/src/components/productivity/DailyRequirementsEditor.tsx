import { useMemo, useState } from "react";
import { CalendarDays, Check, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { localDateKey } from "../../lib/dailyRollover";
import { evaluateDailySuccess, makeDailyRequirement } from "../../lib/dailySuccess";
import { buildTargetContributionLedger } from "../../lib/targetContributions";
import { useStore } from "../../lib/store";
import type { DailySuccessRequirement, DailySuccessSchedule, DailySuccessSource, HabitType } from "../../lib/types";
import { dismissAnnouncement, isAnnouncementDismissed, readDismissedAnnouncements } from "../../lib/announcements";
import { pushToast } from "../../lib/toast";
import { GButton, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

const STANDARD: Array<{
  kind: DailySuccessSource["kind"];
  label: string;
  target: number;
  unit: string;
}> = [
  { kind: "study-minutes", label: "Study minutes", target: 60, unit: "minutes" },
  { kind: "cards-reviewed", label: "Cards reviewed", target: 30, unit: "cards" },
  { kind: "practice-questions", label: "Practice questions", target: 30, unit: "questions" },
  { kind: "journal-closeout", label: "Daily closeout", target: 1, unit: "closeout" },
];

export function DailyRequirementsEditor({ expanded = false }: { expanded?: boolean }) {
  const store = useStore();
  const [customName, setCustomName] = useState("");
  const [customTarget, setCustomTarget] = useState("1");
  const [customUnit, setCustomUnit] = useState("times");
  const [customSchedule, setCustomSchedule] = useState<DailySuccessSchedule>({ kind: "daily" });
  const [customCompletion, setCustomCompletion] = useState<"manual" | "activity" | "habit">("manual");
  const [customAliases, setCustomAliases] = useState("");
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

  function update(id: string, patch: Partial<DailySuccessRequirement>, displayUnitOnly = false) {
    const changesScoringSemantics = !displayUnitOnly && (Object.hasOwn(patch, "target")
      || Object.hasOwn(patch, "schedule")
      || Object.hasOwn(patch, "source")
      || Object.hasOwn(patch, "aliases")
      || Object.hasOwn(patch, "weight"));
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
    if (shown.find((item) => item.id === id)?.source.kind === "study-minutes") return;
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
    <details className="daily-requirements-editor" data-tour="requirements" open={expanded || undefined}>
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
            const weekly = requirement.schedule.kind === "weekly-total" || requirement.schedule.kind === "times-per-week";
            const todayValue = manual || linkedHabit ? buildTargetContributionLedger({ requirement, dayKey: today, logs: store.logs, productivityTrackers: store.productivityTrackers, habits: store.habits, habitEntries: store.habitEntries, closeouts: store.closeouts }).value : 0;
            const todayComplete = todayValue >= requirement.target;
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
                  <span>{weekly ? "This week" : "Today"}</span>
                  <b>{result?.calculation ?? "Not scheduled"}</b>
                  <Tag tone={complete ? "green" : result?.status === "in-progress" ? "cyan" : "neutral"}>{complete ? "Complete" : result?.status === "in-progress" ? "In progress" : "Pending"}</Tag>
                </div>
                {(manual || linkedHabit) && (
                  <div className="daily-requirement-check">
                    {requirement.target <= 1 ? (
                      <GButton size="sm" variant={todayComplete ? "default" : "primary"} onClick={() => {
                        if (linkedHabit) {
                          if (todayComplete) store.clearHabitCheck(linkedHabit.id, today);
                          else store.checkHabit(linkedHabit.id, today, "done", requirement.target);
                        } else setManualValue(requirement, todayComplete ? 0 : requirement.target);
                      }}>
                        {todayComplete ? <RotateCcw size={ICON_SIZE.body} /> : <Check size={ICON_SIZE.body} />} {todayComplete ? "Undo" : "Mark complete"}
                      </GButton>
                    ) : (
                      <label><span>Today’s value</span><input key={`${requirement.id}:${today}:${todayValue}`} className="field" type="number" min="0" step="any" defaultValue={todayValue || ""} onBlur={(event) => {
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
              <label><span>Target</span><input className="field" aria-label="Target" type="number" min="0.1" step="0.1" value={requirement.target} onChange={(event) => update(requirement.id, { target: Math.max(0.1, Number(event.target.value) || 1) })} /></label>
              {requirement.source.kind === "study-minutes" && <label><span>Unit</span><select className="field" aria-label="Study target unit" value={requirement.unit} onChange={(event) => update(requirement.id, { unit: event.target.value, target: event.target.value === "hours" ? requirement.target / 60 : requirement.target * 60 }, true)}><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>}
              <label><span>Schedule</span><select className="field" aria-label="Schedule" value={requirement.schedule.kind} onChange={(event) => update(requirement.id, { schedule: scheduleFromKind(event.target.value) })}>
                <option value="daily">Daily</option>
                <option value="weekdays">Selected weekdays</option>
                <option value="weekly-total">Weekly total</option>
                <option value="times-per-week">Days meeting target per week</option>
              </select></label>
              <label><span>Weight toward today</span><input className="field" aria-label={`Weight for ${requirement.label}`} type="number" min="0.1" max="5" step="0.1" value={requirement.weight ?? 1} onChange={(event) => update(requirement.id, { weight: Math.max(.1, Math.min(5, Number(event.target.value) || 1)) })} /></label>
              <label className="daily-requirement-aliases"><span>Activity aliases</span><input className="field" aria-label={`Activity aliases for ${requirement.label}`} placeholder="gym, workout, lifting" defaultValue={(requirement.aliases ?? []).join(", ")} onBlur={(event) => updateAliases(requirement, event.target.value)} /></label>
              {requirement.schedule.kind === "weekdays" && (
                <WeekdayPicker value={requirement.schedule.weekdays} onChange={(weekdays) => update(requirement.id, { schedule: { kind: "weekdays", weekdays } })} />
              )}
              {requirement.schedule.kind === "times-per-week" && (
                <label><span>Times</span><input className="field" type="number" min="1" max="7" value={requirement.schedule.times} onChange={(event) => update(requirement.id, { schedule: { kind: "times-per-week", times: Math.max(1, Math.min(7, Number(event.target.value) || 1)), weekStartsOn: 1 } })} /></label>
              )}
              {requirement.source.kind === "study-minutes" ? <Tag tone="neutral">System target</Tag> : <button type="button" className="daily-requirement-remove" aria-label={`Remove ${requirement.label} target`} onClick={() => remove(requirement.id)}><Trash2 size={ICON_SIZE.body} /></button>}
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
              <option value="weekly-total">Weekly total</option>
              <option value="times-per-week">Days meeting target per week</option>
            </select></label>
            {customCompletion === "activity" && <label className="daily-custom-alias"><span>Activity aliases</span><input className="field" placeholder="gym, workout, lifting" value={customAliases} onChange={(event) => setCustomAliases(event.target.value)} /></label>}
            {customSchedule.kind === "times-per-week" && <label><span>Times</span><input className="field" type="number" min="1" max="7" value={customSchedule.times} onChange={(event) => setCustomSchedule({ ...customSchedule, times: Math.max(1, Math.min(7, Number(event.target.value) || 1)) })} /></label>}
            <GButton variant="primary" onClick={addCustom}><Plus size={ICON_SIZE.body} /> Add target</GButton>
          </div>
        </details>
      </div>
    </details>
  );
}

function legacyPreview(minutes: number, cards: number, today: string): DailySuccessRequirement[] {
  return [
    makeDailyRequirement({ id: "legacy-study-minutes", label: "Study minutes", source: { kind: "study-minutes" }, target: Math.max(1, minutes || 240), unit: "minutes", trackingStartsAt: today }, today),
    makeDailyRequirement({ id: "legacy-cards-reviewed", label: "Cards reviewed", source: { kind: "cards-reviewed" }, target: Math.max(1, cards || 120), unit: "cards", trackingStartsAt: today }, today),
  ];
}

function scheduleFromKind(kind: string): DailySuccessSchedule {
  if (kind === "weekdays") return { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] };
  if (kind === "weekly-total") return { kind: "weekly-total", weekStartsOn: 1 };
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
  if (schedule.kind === "weekly-total") return "Total this week";
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
