// Pomodoro focus timer UI. One component, two densities: a full panel for the
// Productivity page and a compact widget for the Dashboard. Both are driven by
// the shared usePomodoro store, so the clock stays in sync wherever it's shown.
import { useEffect, useMemo, useState } from "react";
import { RestButton } from "../rest/RestOverlay";
import { Pause, Play, RotateCcw, Save, SkipForward, Timer, Coffee, Flame, Trash2 } from "lucide-react";
import { GlassCard, GButton, PanelHeader } from "../ui/primitives";
import { useStore } from "../../lib/store";
import { usePomodoro, POMODORO_PRESETS, PRIMARY_POMODORO_PRESET_IDS, clampPomodoroCustomDurations, effectivePreset, formatClock, getBreakDurationMinutes } from "../../lib/pomodoro";
import { effectivePomodoroPreferences } from "../../lib/pomodoroPreferences";
import { isMacDesktopShell } from "../../lib/desktopShell";
import { isMenuBarTimerEnabled } from "../../lib/menuBarTimer";
import type { PomodoroSavedPreset } from "../../lib/types";
import { ICON_SIZE } from "../../lib/iconSize";

export function Pomodoro({ compact = false }: { compact?: boolean }) {
  const pomo = usePomodoro();
  const [intentionDraft, setIntentionDraft] = useState(pomo.intention);
  const [customDraft, setCustomDraft] = useState({
    focus: pomo.customFocus,
    break: pomo.customBreak,
    longBreak: pomo.customLongBreak,
    cyclesBeforeLongBreak: pomo.customCycles,
  });
  const [presetName, setPresetName] = useState("");
  const [confirmExtraPreset, setConfirmExtraPreset] = useState(false);
  const tracker = useStore((s) => s.tracker);
  const blueprintInstalls = useStore((s) => s.blueprintInstalls);
  const pomodoroPreferences = useStore((s) => s.profile.pomodoroPreferences);
  const updateProfile = useStore((s) => s.updateProfile);
  const preferences = effectivePomodoroPreferences(pomodoroPreferences);
  const preset = effectivePreset(pomo);
  const breakSeconds = getBreakDurationMinutes({
    sessionsToday: pomo.sessionsToday,
    cyclesBeforeLongBreak: preset.cyclesBeforeLongBreak,
    shortBreak: preset.break,
    longBreak: preset.longBreak,
  }) * 60;
  const total = pomo.phase === "focus" ? preset.focus * 60 : breakSeconds;
  const elapsed = total - pomo.secondsLeft;
  const pct = total ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
  const isFocus = pomo.phase === "focus";
  // Only the macOS desktop app has a menu bar to draw in; browsers never see this control.
  const showMenuBarToggle = !compact && isMacDesktopShell();

  const radius = compact ? 46 : 58;
  const dim = (radius + 7) * 2;
  const circumference = 2 * Math.PI * radius;
  const accent = isFocus ? "var(--cyan)" : "var(--green)";
  const targets = useMemo(() => {
    const trackerTargets = tracker
      .filter((item) => item.passes < 4 || item.ankiPasses < 3)
      .slice(0, 18)
      .map((item) => ({ value: `tracker:${item.id}`, label: `${item.label} · ${item.path}`, kind: "tracker" as const, id: item.id }));
    const blueprintTargets = blueprintInstalls
      .flatMap((install) => install.nodes
        .filter((node) => node.status !== "done" && node.status !== "mastered")
        .slice(0, 10)
        .map((node) => ({ value: `blueprint:${node.id}`, label: `${node.objective} · ${install.title}`, kind: "blueprint" as const, id: node.id })))
      .slice(0, 18);
    return [{ value: "free", label: "No target selected", kind: "free" as const }, ...trackerTargets, ...blueprintTargets];
  }, [tracker, blueprintInstalls]);
  const selectedTarget = pomo.targetKind === "free" ? "free" : `${pomo.targetKind}:${pomo.targetId ?? ""}`;
  const primaryPresets = PRIMARY_POMODORO_PRESET_IDS.map((id) => POMODORO_PRESETS.find((item) => item.id === id)!).filter(Boolean);
  const classicPreset = POMODORO_PRESETS.find((item) => item.id === "25-5")!;
  const sortedSavedPresets = [...preferences.savedPresets]
    .sort((a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt) || a.label.localeCompare(b.label));
  const quickSavedPresets = sortedSavedPresets.slice(0, 3);
  const librarySavedPresets = sortedSavedPresets.slice(3);

  // The clock lifecycle is owned at the app root (PomodoroFx), so a running
  // sprint keeps time regardless of whether this page is mounted.
  useEffect(() => { setIntentionDraft(pomo.intention); }, [pomo.intention]);

  function chooseTarget(value: string) {
    const target = targets.find((item) => item.value === value);
    if (!target || target.kind === "free") {
      pomo.setTarget({ kind: "free" });
    } else {
      pomo.setTarget({ kind: target.kind, id: target.id, label: target.label });
    }
  }

  function choosePreset(id: string) {
    pomo.setPreset(id);
    if (id === "custom") {
      setCustomDraft({ focus: pomo.customFocus, break: pomo.customBreak, longBreak: pomo.customLongBreak, cyclesBeforeLongBreak: pomo.customCycles });
    }
  }

  function runDraft(savedPresetId?: string) {
    pomo.runCustom({ ...customDraft, intention: intentionDraft }, savedPresetId);
  }

  function saveDraft(force = false) {
    if (preferences.savedPresets.length >= 3 && !force) {
      setConfirmExtraPreset(true);
      return;
    }
    const timestamp = new Date().toISOString();
    const durations = clampPomodoroCustomDurations(customDraft);
    const saved: PomodoroSavedPreset = {
      id: crypto.randomUUID(),
      label: presetName.trim().slice(0, 60) || `${durations.focus} / ${durations.break}`,
      ...durations,
      intention: intentionDraft.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      useCount: 0,
    };
    updateProfile({ pomodoroPreferences: { ...preferences, savedPresets: [...preferences.savedPresets, saved] } });
    setCustomDraft(durations);
    setPresetName("");
    setConfirmExtraPreset(false);
  }

  function applySavedPreset(saved: PomodoroSavedPreset) {
    setCustomDraft({ focus: saved.focus, break: saved.break, longBreak: saved.longBreak, cyclesBeforeLongBreak: saved.cyclesBeforeLongBreak });
    setIntentionDraft(saved.intention ?? "");
    pomo.runCustom(saved, saved.id);
  }

  function deleteSaved(id: string) {
    updateProfile({ pomodoroPreferences: { ...preferences, savedPresets: preferences.savedPresets.filter((item) => item.id !== id) } });
  }

  function updateAutoStart(patch: Partial<Pick<typeof preferences, "autoStartBreak" | "autoStartFocus">>) {
    updateProfile({ pomodoroPreferences: { ...preferences, ...patch } });
  }

  function updateShowInMenuBar(showInMenuBar: boolean) {
    updateProfile({ pomodoroPreferences: { ...preferences, showInMenuBar } });
  }

  return (
    <GlassCard pad className={`pomodoro ${compact ? "compact" : ""} ${pomo.running ? "running" : ""} phase-${pomo.phase}`} data-tour="pomodoro">
      <PanelHeader
        title="Pomodoro"
        sub={compact ? (pomo.targetLabel ?? "Focus sprints that auto-log minutes") : "Focus sprints that auto-log their minutes to today when finished"}
        action={
          <span className={`pomo-phase-pill ${pomo.phase}`}>
            {isFocus ? <Flame size={ICON_SIZE.body} /> : <Coffee size={ICON_SIZE.body} />} {isFocus ? "Focus" : "Break"}
          </span>
        }
      />

      <div className="pomo-body">
        <div className="pomo-dial" style={{ width: dim, height: dim }}>
          <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
            <circle cx={dim / 2} cy={dim / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
            <circle
              cx={dim / 2} cy={dim / 2} r={radius} fill="none" stroke={accent} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <div className="pomo-clock">
            <span className="pomo-time">{formatClock(pomo.secondsLeft)}</span>
            <span className="pomo-sub">{isFocus ? "until break" : "until focus"}</span>
          </div>
        </div>

        <div className="pomo-controls">
          <div className="pomo-presets">
            {(compact ? primaryPresets.filter((option) => option.id !== "custom") : primaryPresets).map((option) => (
              <button
                key={option.id}
                type="button"
                className={`pomo-preset ${pomo.presetId === option.id ? "on" : ""}`}
                onClick={() => choosePreset(option.id)}
                disabled={pomo.running}
                title={`${option.focus} min focus · ${option.break} min break`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {!compact && (
            <details className="pomo-secondary-presets">
              <summary>Classic and saved presets</summary>
              <div className="pomo-saved-row">
                <button type="button" className={`pomo-preset ${pomo.presetId === classicPreset.id ? "on" : ""}`} onClick={() => choosePreset(classicPreset.id)} disabled={pomo.running}>
                  {classicPreset.label}
                </button>
                {quickSavedPresets.map((saved) => (
                  <div className="pomo-saved-preset" key={saved.id}>
                    <button type="button" onClick={() => applySavedPreset(saved)} disabled={pomo.running} title={`${saved.focus} min focus · ${saved.break} min break`}>
                      <b>{saved.label}</b><small>{saved.focus} / {saved.break}{saved.useCount ? ` · ${saved.useCount} uses` : ""}</small>
                    </button>
                    <button type="button" aria-label={`Delete ${saved.label} preset`} onClick={() => deleteSaved(saved.id)}><Trash2 size={ICON_SIZE.microInline} /></button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {!compact && librarySavedPresets.length > 0 && (
            <details className="pomo-secondary-presets">
              <summary>More saved presets ({librarySavedPresets.length})</summary>
              <div className="pomo-saved-row">
                {librarySavedPresets.map((saved) => (
                  <div className="pomo-saved-preset" key={saved.id}>
                    <button type="button" onClick={() => applySavedPreset(saved)} disabled={pomo.running} title={`${saved.focus} min focus · ${saved.break} min break`}>
                      <b>{saved.label}</b><small>{saved.focus} / {saved.break}{saved.useCount ? ` · ${saved.useCount} uses` : ""}</small>
                    </button>
                    <button type="button" aria-label={`Delete ${saved.label} preset`} onClick={() => deleteSaved(saved.id)}><Trash2 size={ICON_SIZE.microInline} /></button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {!compact && pomo.presetId === "custom" && (
            <div className="pomo-custom-box">
              <div className="pomo-custom-head">
                <span><b>Custom focus</b><small>Edit locally, then run once or save it.</small></span>
                <input className="field" aria-label="Custom preset name" placeholder="Preset name (optional)" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
              </div>
              <div className="pomo-custom-grid">
                <label className="stack gap6">
                  <span className="field-label">Focus</span>
                  <input className="field" type="number" min={1} max={180} value={customDraft.focus} disabled={pomo.running}
                    onChange={(e) => setCustomDraft((draft) => ({ ...draft, focus: Number(e.target.value) }))} aria-label="Custom focus minutes" />
                </label>
                <label className="stack gap6">
                  <span className="field-label">Short break</span>
                  <input className="field" type="number" min={1} max={90} value={customDraft.break} disabled={pomo.running}
                    onChange={(e) => setCustomDraft((draft) => ({ ...draft, break: Number(e.target.value) }))} aria-label="Custom short break minutes" />
                </label>
                <label className="stack gap6">
                  <span className="field-label">Long break</span>
                  <input className="field" type="number" min={1} max={120} value={customDraft.longBreak} disabled={pomo.running}
                    onChange={(e) => setCustomDraft((draft) => ({ ...draft, longBreak: Number(e.target.value) }))} aria-label="Custom long break minutes" />
                </label>
                <label className="stack gap6">
                  <span className="field-label">Cycles → long</span>
                  <input className="field" type="number" min={1} max={12} value={customDraft.cyclesBeforeLongBreak} disabled={pomo.running}
                    onChange={(e) => setCustomDraft((draft) => ({ ...draft, cyclesBeforeLongBreak: Number(e.target.value) }))} aria-label="Cycles before long break" />
                </label>
              </div>
              <div className="pomo-custom-options">
                <label><input type="checkbox" checked={preferences.autoStartBreak} onChange={(event) => updateAutoStart({ autoStartBreak: event.target.checked })} /> Auto-start break</label>
                <label><input type="checkbox" checked={preferences.autoStartFocus} onChange={(event) => updateAutoStart({ autoStartFocus: event.target.checked })} /> Auto-start focus</label>
              </div>
              {confirmExtraPreset && (
                <div className="pomo-soft-limit" role="status">
                  <span>AXOM usually keeps three quick presets to reduce clutter. You can continue and keep more.</span>
                  <GButton size="sm" onClick={() => saveDraft(true)}>Continue and save</GButton>
                </div>
              )}
              <div className="row wrap gap8 pomo-custom-actions">
                <GButton onClick={() => runDraft()}>Run once</GButton>
                <GButton variant="primary" onClick={() => saveDraft()}><Save size={ICON_SIZE.body} /> Save preset</GButton>
              </div>
            </div>
          )}

          {!compact && (
            <div className="pomo-target-box">
              <label className="stack gap6">
                <span className="field-label">Sprint target</span>
                <select className="field" value={selectedTarget} onChange={(event) => chooseTarget(event.target.value)} disabled={pomo.running}>
                  {targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                </select>
              </label>
              <label className="stack gap6">
                <span className="field-label">Intention</span>
                <input className="field" value={intentionDraft} onChange={(event) => {
                  setIntentionDraft(event.target.value);
                  pomo.setIntention(event.target.value);
                }}
                  placeholder="e.g. finish cardio questions without checking notes" />
              </label>
            </div>
          )}

          <div className="pomo-actions">
            <GButton variant="primary" onClick={pomo.toggle}>
              {pomo.running ? <><Pause size={ICON_SIZE.body} /> Pause</> : <><Play size={ICON_SIZE.body} /> Start</>}
            </GButton>
            <GButton size="sm" onClick={pomo.skip} title="Skip to the next phase and log elapsed focus minutes">
              <SkipForward size={ICON_SIZE.body} /> Skip
            </GButton>
            <GButton size="sm" onClick={pomo.reset} title="Reset and log elapsed focus minutes">
              <RotateCcw size={ICON_SIZE.body} /> Reset
            </GButton>
          </div>

          <RestButton compact={compact} />
          <div className="pomo-meta">
            <span className="pomo-stat"><Timer size={ICON_SIZE.body} /> {pomo.sessionsToday} sprint{pomo.sessionsToday === 1 ? "" : "s"} today</span>
            <span className="pomo-stat"><Flame size={ICON_SIZE.body} /> {pomo.loggedMinutesToday}m logged</span>
            <label className="pomo-toggle" title="Add finished focus minutes to today's study log">
              <input type="checkbox" checked={pomo.autoLog} onChange={(event) => pomo.setAutoLog(event.target.checked)} />
              <span>Auto-log</span>
            </label>
            {showMenuBarToggle && (
              <label className="pomo-toggle" title="Show the clock at the top of the screen. Closing the window during a sprint keeps it running there.">
                <input type="checkbox" checked={isMenuBarTimerEnabled(preferences)} onChange={(event) => updateShowInMenuBar(event.target.checked)} />
                <span>Show timer in the Mac menu bar</span>
              </label>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
