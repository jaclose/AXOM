import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Bell, Clock3, Database, Download, FileJson, Gamepad2, ImagePlus, Palette, RotateCcw, ShieldCheck,
  Sparkles, Trash2, Upload, UserCircle2, Check, ScrollText, MessageCircle, Settings2,
} from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { Modal, Field } from "../ui/Modal";
import { GButton, Tag } from "../ui/primitives";
import { useStore } from "../../lib/store";
import { exportStateWithAttachments, mergeStates, parseImport } from "../../lib/backup";
import {
  extractQuestionAttachmentPayloads,
  restoreQuestionAttachmentPayloads,
  runQuestionAttachmentMaintenance,
} from "../../lib/questionAttachments";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { DataHealthPanel } from "./DataHealthPanel";
import { RecoveryStatusCard } from "./RecoveryStatusCard";
import { PromiseCutscene } from "./PromiseCutscene";
import { FOCUS_OPTIONS, focusOption, normalizedFocusIds } from "../../lib/experience";
import { academicStagesForTrack, EDUCATION_TRACKS, resolveTrack } from "../../lib/tracks";
import { prettyDate } from "../../lib/scoring";
import type { AcademicStageId, DashboardWidgetId, EducationTrackId, ExperienceFocusId } from "../../lib/types";
import { HardDrive } from "lucide-react";
import { ThemeToggle } from "../ui/ThemeToggle";
import { AxomWordmark } from "../ui/BrandMark";
import { SCHEMA_VERSION, APP_BUILD_LABEL } from "../../lib/seed";
import { lastBackupAt } from "../../lib/backup";
import { listLocalBackups } from "../../lib/localBackup";
import { restoreLocalWorkspaceBackup } from "../../lib/storageRecovery";
import { runStorageMigrations } from "../../lib/storageMigrations";
import { requestOnboardingRerun } from "../../lib/uiStore";
import { canonicalTimeZone, normalizeClockPreferences, normalizeTimeZonePreference, systemTimeZone } from "../../lib/clock";
import { normalizeDailyLoopReminderPreferences } from "../../lib/dailyLoopReminders";
import {
  CURRENT_DASHBOARD_WIDGET_IDS,
  adaptLegacyDashboardLayout,
  applyDashboardLayoutPreset,
  dashboardWidgetCatalogItem,
  normalizeDashboardLayoutPreferences,
} from "../../lib/dashboardWidgets";

type SettingsSection = "profile" | "data" | "backup" | "personalization" | "advanced";
/** Legacy names remain accepted so existing deep links keep opening safely. */
export type SettingsTab = SettingsSection | "general" | "ai" | "account";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof UserCircle2 }> = [
  { id: "profile", label: "Profile", icon: UserCircle2 },
  { id: "data", label: "Data", icon: Database },
  { id: "backup", label: "Backup", icon: FileJson },
  { id: "personalization", label: "Personalization", icon: Palette },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

function normalizeSettingsTab(tab: SettingsTab): SettingsSection {
  if (tab === "general") return "profile";
  if (tab === "ai" || tab === "account") return "advanced";
  return tab;
}

export function SettingsModal({ onClose, initialTab = "general" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const store = useStore();
  const { profile } = store;
  const fileRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>("");
  const [tab, setTab] = useState<SettingsSection>(() => normalizeSettingsTab(initialTab));
  const tabsId = useId();
  const tabRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});
  const [resigning, setResigning] = useState(false);
  const [viewingPromise, setViewingPromise] = useState(false);
  const promise = profile.promise;
  const tabIntro: Record<SettingsSection, { title: string; body: string }> = {
    profile: {
      title: "Profile",
      body: "Your identity, academic path, current focus, and good-enough daily targets.",
    },
    data: {
      title: "Data on this device",
      body: "See where your workspace lives, whether storage is healthy, and what AXOM has saved.",
    },
    backup: {
      title: "Backup & recovery",
      body: "Export a portable copy, restore safely, and review automatic local recovery snapshots.",
    },
    personalization: {
      title: "Personalization",
      body: "Choose theme, dashboard visibility, study lanes, and device-level preferences.",
    },
    advanced: {
      title: "Advanced",
      body: "Technical versions, diagnostics, optional provider tools, and destructive reset controls.",
    },
  };
  const localBackups = listLocalBackups();
  const exportedAt = lastBackupAt();
  const track = resolveTrack(profile.educationTrack);
  const stageGroup = academicStagesForTrack(track.id);
  const focus = focusOption(profile.activeFocusId);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, section: SettingsSection) {
    const index = SETTINGS_SECTIONS.findIndex((item) => item.id === section);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % SETTINGS_SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SETTINGS_SECTIONS.length - 1;
    else return;
    event.preventDefault();
    const nextSection = SETTINGS_SECTIONS[next].id;
    setTab(nextSection);
    tabRefs.current[nextSection]?.focus();
  }

  function doImport(file: File, mode: "replace" | "merge") {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rawText = String(reader.result);
        const next = parseImport(rawText);
        // Q2b-2: image bytes ride inside the exported file only; extract them
        // here and restore into the blob store after the state lands.
        let attachmentPayloads: ReturnType<typeof extractQuestionAttachmentPayloads> = [];
        try {
          attachmentPayloads = extractQuestionAttachmentPayloads(JSON.parse(rawText));
        } catch {
          attachmentPayloads = [];
        }
        const finishAttachments = (questions: typeof next.questions) => {
          void restoreQuestionAttachmentPayloads(attachmentPayloads, questions ?? [])
            .then(async ({ restored }) => {
              await runQuestionAttachmentMaintenance(questions ?? []).catch(() => undefined);
              if (restored) setMsg((current) => `${current} Restored ${restored} image attachment${restored === 1 ? "" : "s"}.`);
            })
            .catch(() => setMsg((current) => `${current} Some image attachments could not be restored.`));
        };
        if (mode === "replace") {
          if (!confirm("Restore this backup? It REPLACES the current data on this device. Download a backup first if you want to keep both.")) {
            setMsg("Restore cancelled. No data changed.");
            return;
          }
          store.replaceAll(next);
          setMsg(`Restored from ${file.name}. Your data is back.`);
          finishAttachments(next.questions);
        } else {
          const merged = mergeStates(store, next);
          if (!confirm("Merge this backup into the current data? Records are combined by id (newer wins); your profile and current day stay as they are. Nothing is deleted.")) {
            setMsg("Merge cancelled. No data changed.");
            return;
          }
          store.replaceAll(merged);
          setMsg(`Merged ${file.name} into this device's data.`);
          finishAttachments(merged.questions);
        }
      } catch (e) {
        setMsg((e as Error).message);
      }
      if (fileRef.current) fileRef.current.value = "";
      if (mergeRef.current) mergeRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function exportBackup() {
    void exportStateWithAttachments(store).then(({ attachmentCount, missingBlobKeys }) => {
      const missing = missingBlobKeys.length
        ? ` ${missingBlobKeys.length} image attachment${missingBlobKeys.length === 1 ? "" : "s"} could not be read and were exported as metadata only.`
        : "";
      const included = attachmentCount ? ` Includes ${attachmentCount} image attachment${attachmentCount === 1 ? "" : "s"}.` : "";
      setMsg(`Downloaded your backup file.${included}${missing}`);
    });
  }

  function setAvatar(file: File) {
    const reader = new FileReader();
    reader.onload = () => store.updateProfile({ avatarDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <Modal
      title="Your AXOM Setup"
      onClose={onClose}
      footer={<GButton variant="primary" onClick={onClose}>Done</GButton>}
    >
      <div className="filter-bar settings-tabs" style={{ marginBottom: 4 }} role="tablist" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              ref={(node) => { tabRefs.current[id] = node; }}
              id={`${tabsId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={active ? `${tabsId}-panel-${id}` : undefined}
              tabIndex={active ? 0 : -1}
              className={`filter-pill ${active ? "on" : ""}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, id)}
            >
              <Icon size={ICON_SIZE.body} style={{ marginRight: 6, verticalAlign: -2 }} /> {label}
            </button>
          );
        })}
      </div>

      <div className="settings-intro">
        <b>{tabIntro[tab].title}</b>
        <span>{tabIntro[tab].body}</span>
      </div>

      {tab === "profile" && (
        <section role="tabpanel" id={`${tabsId}-panel-profile`} aria-labelledby={`${tabsId}-tab-profile`}>
          <div className="settings-profile-card">
            <span className="avatar" style={{ width: 44, height: 44 }}>
              {profile.avatarDataUrl
                ? <img src={profile.avatarDataUrl} alt="" />
                : <span className="avatar-mono">{(profile.name || "A").slice(0, 1)}</span>}
            </span>
            <div className="grow">
              <div className="sync-title">{profile.name || "AXOM"}</div>
              <div className="sub">Stored in this device’s AXOM workspace</div>
            </div>
            <div className="row wrap gap8">
              <GButton size="sm" onClick={() => avatarRef.current?.click()}>
                <ImagePlus size={ICON_SIZE.body} /> Change avatar
              </GButton>
            </div>
            <input ref={avatarRef} type="file" accept="image/*" hidden
              onChange={(e) => e.target.files?.[0] && setAvatar(e.target.files[0])} />
          </div>

          <Field label="Display name" value={profile.name}
            onChange={(e) => store.updateProfile({ name: e.target.value })} />
          <div className="settings-target-grid">
            <Field label="Academic path" value={track.label} readOnly />
            <label className="stack gap6"><span className="field-label">Current stage</span><select className="field" value={profile.academicStageId ?? stageGroup.defaultStageId} onChange={(event) => store.updateProfile({ academicStageId: event.target.value as AcademicStageId, customAcademicStage: event.target.value === "other" ? profile.customAcademicStage : undefined })}>
              {stageGroup.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select></label>
            <Field label="Current focus" value={focus?.label ?? "Choose in Personalization"} readOnly />
          </div>
          {(profile.academicStageId ?? stageGroup.defaultStageId) === "other" && <Field label="Custom stage (optional)" value={profile.customAcademicStage ?? ""} onChange={(event) => store.updateProfile({ customAcademicStage: event.target.value })} />}
          <Field label="Optional goal" value={profile.tagline}
            onChange={(e) => store.updateProfile({ tagline: e.target.value })} />

          <details className="settings-profile-disclosure">
            <summary>Legacy targets and reminder time</summary>
            <p className="sub">These minute/card targets are used only while an existing workspace has not configured Daily requirements. Cards are optional in the new model.</p>
            <div className="settings-target-grid">
              <Field label="Legacy card target" type="number" value={String(profile.dailyCardTarget ?? 120)}
                onChange={(e) => store.updateProfile({ dailyCardTarget: Number(e.target.value) || 0 })} />
              <Field label="Legacy minute target" type="number" value={String(profile.dailyMinuteTarget ?? 240)}
                onChange={(e) => store.updateProfile({ dailyMinuteTarget: Number(e.target.value) || 0 })} />
              <Field label="Journal follow-up time" type="time" value={profile.journalReviewTime ?? "20:00"}
                onChange={(e) => store.updateProfile({ journalReviewTime: e.target.value || "20:00" })} />
            </div>
            <a className="gbtn sm" href="#productivity" onClick={onClose}>Configure daily requirements</a>
          </details>

          <div className="backup-actions-panel promise-settings-card" style={{ marginTop: 14 }}>
            <div>
              <div className="sync-title"><ScrollText size={ICON_SIZE.body} style={{ verticalAlign: -2, marginRight: 6 }} /> Your promise</div>
              <div className="sub">{promise?.signedName
                ? `Signed by ${promise.signedName} on ${prettyDate(promise.signedAt)}.`
                : "You haven't signed your promise yet."}</div>
            </div>
            <div className="row wrap gap8">
              {promise?.signedName && <GButton size="sm" onClick={() => setViewingPromise(true)}><ScrollText size={ICON_SIZE.body} /> View signed promise</GButton>}
              <GButton size="sm" onClick={() => setResigning(true)}>
                <ScrollText size={ICON_SIZE.body} /> {promise?.signedName ? "Re-sign promise" : "Sign your promise"}
              </GButton>
            </div>
          </div>
        </section>
      )}

      {tab === "data" && (
        <section role="tabpanel" id={`${tabsId}-panel-data`} aria-labelledby={`${tabsId}-tab-data`} className="backup-center">
          <div className="backup-actions-panel premium-panel">
            <div>
              <div className="sync-title">Local-first workspace</div>
              <div className="sub">
                Your AXOM workspace is stored on this device. It is not automatically synced to an account or uploaded to the cloud.
                Changes save locally as you work.
              </div>
            </div>
            <Tag tone="green"><ShieldCheck size={ICON_SIZE.microInline} /> On this device</Tag>
          </div>
          <DataHealthPanel />
        </section>
      )}

      {tab === "backup" && (
        <section role="tabpanel" id={`${tabsId}-panel-backup`} aria-labelledby={`${tabsId}-tab-backup`} className="backup-center">
          <div className="sub" style={{ marginBottom: 4 }}>
            Automatic local recovery snapshots help protect updates and migrations. Export a backup to keep a portable copy.
          </div>

          <RecoveryStatusCard
            onExport={exportBackup}
            onChoosePortableRestore={() => fileRef.current?.click()}
            onRetry={() => runStorageMigrations()}
            onRestoreAutomatic={async (key) => {
              if (!confirm("Restore this verified automatic snapshot? This replaces the current device workspace with the snapshot. Export the current workspace first if you made changes after the snapshot; the snapshot itself is retained.")) {
                throw new Error("Restore cancelled. No data changed.");
              }
              await restoreLocalWorkspaceBackup(key);
              setMsg("Safety snapshot restored. Retry startup to finish recovery.");
              return true;
            }}
            onResolved={() => setMsg("Storage update completed successfully.")}
          />

          <div className="backup-actions-panel">
            <div>
              <div className="sync-title">Portable backup file</div>
              <div className="sub">Export a copy you control, or choose a saved AXOM JSON file to restore or merge.</div>
            </div>
            <div className="row wrap gap8">
              <GButton size="sm" variant="primary" onClick={exportBackup}>
                <Download size={ICON_SIZE.body} /> Export backup
              </GButton>
              <GButton size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={ICON_SIZE.body} /> Import / restore
              </GButton>
              <GButton size="sm" onClick={() => mergeRef.current?.click()}>
                <Upload size={ICON_SIZE.body} /> Merge backup
              </GButton>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden
                onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0], "replace")} />
              <input ref={mergeRef} type="file" accept="application/json,.json" hidden
                onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0], "merge")} />
            </div>
            <div className="backup-note">
              <ShieldCheck size={ICON_SIZE.body} />
              <span>Replace asks for confirmation. Merge combines records by ID; newer records win and nothing is deleted.</span>
            </div>
          </div>

          <div className="backup-actions-panel">
            <div className="sync-title">Backup status</div>
            <div className="data-health-grid">
              <div className="data-health-cell"><b>{localBackups.length}</b><span className="sub">Automatic snapshots</span></div>
              <div className="data-health-cell"><b>{localBackups[0] ? formatSettingsDate(localBackups[0].savedAt) : "None yet"}</b><span className="sub">Latest local snapshot</span></div>
              <div className="data-health-cell"><b>{exportedAt ? formatSettingsDate(exportedAt) : "None yet"}</b><span className="sub">Last exported</span></div>
              <div className="data-health-cell"><b>Checked on import</b><span className="sub">Portable-file verification</span></div>
            </div>
            <details>
              <summary>How backups work</summary>
              <div className="sub" style={{ marginTop: 8 }}>
                The live workspace stays in this browser’s local vault. Automatic snapshots are local safety copies made before storage migrations.
                An exported JSON file is the portable copy you can keep elsewhere. AXOM currently does not retain a separate restore-history log.
              </div>
            </details>
          </div>

          {msg && <div className="backup-status" role="status">{msg}</div>}
        </section>
      )}

      {tab === "personalization" && (
        <section role="tabpanel" id={`${tabsId}-panel-personalization`} aria-labelledby={`${tabsId}-tab-personalization`} className="backup-center">
          <div className="backup-actions-panel">
            <div><div className="sync-title">Theme</div><div className="sub">Light, dark, or the current device setting.</div></div>
            <ThemeToggle />
          </div>
          <DailyUtilitiesSettings />
          <DashboardVisibilitySettings />
          <DevicePreferencePanel />
          <PersonalizationPanel />
        </section>
      )}

      {tab === "advanced" && (
        <section role="tabpanel" id={`${tabsId}-panel-advanced`} aria-labelledby={`${tabsId}-tab-advanced`} className="backup-center">
          <AppUpdatePanel />
          <div className="backup-actions-panel">
            <div className="sync-title">Technical details</div>
            <div className="settings-target-grid">
              <Field label="Schema version" value={`v${store.schemaVersion ?? SCHEMA_VERSION}`} readOnly />
              <Field label="Build version" value={APP_BUILD_LABEL} readOnly />
              <Field label="Local workspace ID" value={profile.userId} readOnly />
            </div>
          </div>

          <details className="backup-actions-panel">
            <summary>AI and provider settings (optional)</summary>
            <div className="sub" style={{ margin: "8px 0 12px" }}>Providers are optional. AXOM’s local calculations, backup, onboarding, and core study tools do not require AI.</div>
            <AiSettingsPanel />
          </details>

          <div className="backup-actions-panel">
            <div>
              <div className="sync-title">Community and beta feedback</div>
              <div className="sub">Ask questions or report a rough edge. This does not sync or upload your workspace.</div>
            </div>
            <a className="gbtn sm primary" href="https://discord.gg/sTNuHa6qR" target="_blank" rel="noreferrer noopener">
              <MessageCircle size={ICON_SIZE.body} /> AXOM Discord Channel
            </a>
          </div>

          <div className="backup-actions-panel danger-zone">
            <div>
              <div className="sync-title">Danger zone</div>
              <div className="sub">Reset is separated here because it replaces the current local workspace with starter data.</div>
            </div>
            <GButton size="sm" variant="danger"
              onClick={() => {
                if (confirm("Reset everything to the starter data? This wipes your current local data.")) {
                  store.resetToSeed();
                  setMsg("Reset to starter data.");
                }
              }}>
              <RotateCcw size={ICON_SIZE.body} /> Reset to starter data
            </GButton>
          </div>
          {msg && <div className="backup-status" role="status">{msg}</div>}
        </section>
      )}

      {resigning && <PromiseCutscene onDone={() => setResigning(false)} />}
      {viewingPromise && promise && <PromiseSheet onClose={() => setViewingPromise(false)} />}
    </Modal>
  );
}

function DailyUtilitiesSettings() {
  const profile = useStore((state) => state.profile);
  const updateProfile = useStore((state) => state.updateProfile);
  const resetDailyWordPuzzles = useStore((state) => state.resetDailyWordPuzzles);
  const puzzleCount = useStore((state) => state.dailyWordPuzzles.length);
  const clock = normalizeClockPreferences(profile.clockPreferences);
  const timeZone = normalizeTimeZonePreference(profile.timeZonePreference);
  const reminders = normalizeDailyLoopReminderPreferences(profile.dailyLoopReminders);
  const [customTimeZone, setCustomTimeZone] = useState(timeZone.customTimezone ?? systemTimeZone());
  const [timeZoneError, setTimeZoneError] = useState("");
  const timeZoneErrorId = useId();

  useEffect(() => {
    if (timeZone.mode === "custom" && timeZone.customTimezone) setCustomTimeZone(timeZone.customTimezone);
  }, [timeZone.customTimezone, timeZone.mode]);

  function updateClock(patch: Partial<typeof clock>) {
    updateProfile({ clockPreferences: { ...clock, ...patch } });
  }

  function updateReminders(patch: Partial<typeof reminders>) {
    updateProfile({
      dailyLoopReminders: normalizeDailyLoopReminderPreferences({ ...reminders, ...patch }),
    });
  }

  function useSystemTimeZone() {
    setTimeZoneError("");
    updateProfile({ timeZonePreference: { mode: "system" } });
  }

  function saveCustomTimeZone() {
    const canonical = canonicalTimeZone(customTimeZone);
    if (!canonical) {
      setTimeZoneError("Enter a valid IANA timezone, such as America/Grenada or America/New_York.");
      return;
    }
    setTimeZoneError("");
    setCustomTimeZone(canonical);
    updateProfile({ timeZonePreference: { mode: "custom", customTimezone: canonical } });
  }

  return (
    <details className="backup-actions-panel" open>
      <summary>Daily utilities</summary>
      <div className="stack" style={{ gap: 12, marginTop: 10 }}>
        <div className="settings-utility-row">
          <div>
            <div className="sync-title"><Gamepad2 size={ICON_SIZE.body} /> Daily Games</div>
            <div className="sub">Optional Daily Word and Doctordle WIP folder. Disabling it hides navigation and preserves history.</div>
          </div>
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={profile.experimentalFlags?.dailyGames === true}
              onChange={(event) => updateProfile({
                experimentalFlags: { ...(profile.experimentalFlags ?? {}), dailyGames: event.target.checked },
              })}
            />
            <span>Enable Daily Games</span>
          </label>
        </div>

        <div className="settings-utility-row">
          <div>
            <div className="sync-title"><Clock3 size={ICON_SIZE.body} /> Clock</div>
            <div className="sub">Compact TopBar time with an optional analog popover. Only preferences persist; current time never does.</div>
          </div>
          <label className="settings-inline-toggle">
            <input type="checkbox" checked={clock.enabled} onChange={(event) => updateClock({ enabled: event.target.checked })} />
            <span>Show clock</span>
          </label>
        </div>

        <fieldset className="settings-timezone-fieldset settings-reminder-fieldset">
          <legend>Daily rhythm reminders</legend>
          <div className="sub">
            Optional in-app prompts use this device's local time. Each enabled prompt appears at most once per day unless you choose Snooze.
          </div>
          <div className="settings-reminder-row">
            <div>
              <div className="sync-title">Daily Check-In</div>
              <div className="sub">A calm morning prompt to choose what matters today.</div>
            </div>
            <label className="settings-inline-toggle">
              <input
                type="checkbox"
                checked={reminders.checkInEnabled}
                onChange={(event) => updateReminders({ checkInEnabled: event.target.checked })}
              />
              <span>Enable Daily Check-In</span>
            </label>
            <label className="settings-reminder-time">
              <span className="field-label">Daily Check-In time</span>
              <input
                className="field"
                type="time"
                value={reminders.checkInTime}
                disabled={!reminders.checkInEnabled}
                onChange={(event) => updateReminders({ checkInTime: event.target.value })}
              />
            </label>
          </div>
          <div className="settings-reminder-row">
            <div>
              <div className="sync-title">Evening closeout</div>
              <div className="sub">A gentle prompt to notice a win, close open loops, and set up tomorrow.</div>
            </div>
            <label className="settings-inline-toggle">
              <input
                type="checkbox"
                checked={reminders.closeoutEnabled}
                onChange={(event) => updateReminders({ closeoutEnabled: event.target.checked })}
              />
              <span>Enable evening closeout</span>
            </label>
            <label className="settings-reminder-time">
              <span className="field-label">Evening closeout time</span>
              <input
                className="field"
                type="time"
                value={reminders.closeoutTime}
                disabled={!reminders.closeoutEnabled}
                onChange={(event) => updateReminders({ closeoutTime: event.target.value })}
              />
            </label>
          </div>
          <div className="settings-reminder-row settings-reminder-quiet-hours">
            <div>
              <div className="sync-title">Quiet hours</div>
              <div className="sub">Pause prompts in this device-local window. A pending prompt can resume later the same day, but never carries into a new day.</div>
            </div>
            <label className="settings-inline-toggle">
              <input
                type="checkbox"
                checked={reminders.quietHoursEnabled}
                onChange={(event) => updateReminders({ quietHoursEnabled: event.target.checked })}
              />
              <span>Enable quiet hours</span>
            </label>
            <div className="settings-reminder-time-range">
              <label className="settings-reminder-time">
                <span className="field-label">Quiet hours start</span>
                <input
                  className="field"
                  type="time"
                  value={reminders.quietHoursStart}
                  disabled={!reminders.quietHoursEnabled}
                  onChange={(event) => updateReminders({ quietHoursStart: event.target.value })}
                />
              </label>
              <label className="settings-reminder-time">
                <span className="field-label">Quiet hours end</span>
                <input
                  className="field"
                  type="time"
                  value={reminders.quietHoursEnd}
                  disabled={!reminders.quietHoursEnabled}
                  onChange={(event) => updateReminders({ quietHoursEnd: event.target.value })}
                />
              </label>
            </div>
          </div>
        </fieldset>

        <div className="settings-compact-grid" aria-label="Clock display preferences">
          <label><input type="checkbox" checked={clock.showDigital} onChange={(event) => updateClock({ showDigital: event.target.checked })} /> Digital time</label>
          <label><input type="checkbox" checked={clock.showAnalog} onChange={(event) => updateClock({ showAnalog: event.target.checked })} /> Analog popover</label>
          <label><input type="checkbox" checked={clock.showDigitalSeconds} onChange={(event) => updateClock({ showDigitalSeconds: event.target.checked })} /> Digital seconds</label>
          <label><input type="checkbox" checked={clock.showAnalogSeconds} onChange={(event) => updateClock({ showAnalogSeconds: event.target.checked })} /> Analog second hand</label>
          <label><input type="checkbox" checked={clock.showDate} onChange={(event) => updateClock({ showDate: event.target.checked })} /> Date</label>
          <label><input type="checkbox" checked={clock.showTimezoneLabel} onChange={(event) => updateClock({ showTimezoneLabel: event.target.checked })} /> Timezone label</label>
          <label className="stack gap6">
            <span className="field-label">Hour cycle</span>
            <select className="field" value={clock.hourCycle} onChange={(event) => updateClock({ hourCycle: event.target.value === "24" ? "24" : "12" })}>
              <option value="12">12-hour</option>
              <option value="24">24-hour</option>
            </select>
          </label>
        </div>

        <fieldset className="settings-timezone-fieldset">
          <legend>Shared timezone</legend>
          <div className="row wrap gap8">
            <label><input type="radio" name="settings-timezone-mode" checked={timeZone.mode === "system"} onChange={useSystemTimeZone} /> System timezone</label>
            <label><input type="radio" name="settings-timezone-mode" checked={timeZone.mode === "custom"} onChange={saveCustomTimeZone} /> Custom IANA timezone</label>
          </div>
          <div className="settings-timezone-input">
            <label className="stack gap6 grow">
              <span className="field-label">Custom timezone</span>
              <input
                className="field"
                value={customTimeZone}
                aria-invalid={Boolean(timeZoneError)}
                aria-describedby={timeZoneError ? timeZoneErrorId : undefined}
                onChange={(event) => setCustomTimeZone(event.target.value)}
                onBlur={() => { if (timeZone.mode === "custom") saveCustomTimeZone(); }}
              />
            </label>
            <GButton size="sm" onClick={saveCustomTimeZone}>Apply timezone</GButton>
          </div>
          {timeZoneError && <div className="field-error" id={timeZoneErrorId} role="alert">{timeZoneError}</div>}
          <div className="sub">Daily Word locks this timezone when a puzzle starts. Changing it never replaces an active puzzle.</div>
        </fieldset>

        {puzzleCount > 0 && (
          <div className="settings-utility-row danger-zone">
            <div><div className="sync-title">Daily Word history</div><div className="sub">{puzzleCount} local puzzle record{puzzleCount === 1 ? "" : "s"}. This reset does not affect courses, tasks, or other AXOM data.</div></div>
            <GButton size="sm" variant="danger" onClick={() => {
              if (confirm("Reset Daily Word history and statistics on this device? No other AXOM data will change.")) resetDailyWordPuzzles();
            }}><Trash2 size={ICON_SIZE.body} /> Reset Daily Word</GButton>
          </div>
        )}
      </div>
    </details>
  );
}

function DashboardVisibilitySettings() {
  const profile = useStore((state) => state.profile);
  const updateProfile = useStore((state) => state.updateProfile);
  const layout = normalizeDashboardLayoutPreferences(profile.dashboardLayout, {
    order: profile.dashboardWidgetOrder,
    hiddenWidgetIds: profile.hiddenDashboardWidgets,
  }) ?? applyDashboardLayoutPreset(adaptLegacyDashboardLayout(), "focused", "1970-01-01T00:00:00.000Z");
  const hidden = new Set(layout.hiddenWidgetIds);
  function setVisible(id: DashboardWidgetId, visible: boolean) {
    const next = new Set(hidden);
    if (visible) next.delete(id);
    else next.add(id);
    updateProfile({
      dashboardLayout: {
        ...layout,
        preset: "custom",
        order: layout.order.includes(id) ? layout.order : [...layout.order, id],
        hiddenWidgetIds: [...next],
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return (
    <details className="backup-actions-panel">
      <summary>Dashboard widgets</summary>
      <div className="sub" style={{ margin: "8px 0" }}>Choose what appears on the dashboard. This changes presentation only.</div>
      <div className="settings-widget-grid">
        {CURRENT_DASHBOARD_WIDGET_IDS.filter((id) => id !== "welcome" && id !== "commandBrief").map((id) => (
          <label className="early-feature-row" key={id}>
            <input type="checkbox" checked={!hidden.has(id)} onChange={(event) => setVisible(id, event.target.checked)} />
            <span>{dashboardWidgetCatalogItem(id).label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function DevicePreferencePanel() {
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unavailable" : Notification.permission);
  const reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function requestNotifications() {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }
  return (
    <div className="backup-actions-panel">
      <div>
        <div className="sync-title"><Bell size={ICON_SIZE.body} style={{ verticalAlign: -2, marginRight: 6 }} /> Device preferences</div>
        <div className="sub">Reduced motion: <b>{reducedMotion ? "On" : "Off"}</b> (follows this device). Focus-timer notifications: <b>{permission}</b>.</div>
      </div>
      {permission === "default" && <GButton size="sm" onClick={requestNotifications}>Enable focus-timer notifications</GButton>}
    </div>
  );
}

function formatSettingsDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString([], { dateStyle: "medium" });
}

const PROMISE_LINES = [
  "This is only a tool.",
  "It will not save you.",
  "It will not study for you.",
  "It will not become disciplined on your behalf.",
  "But if you return to it honestly,",
  "if you record the work,",
  "if you confront the missed days,",
  "if you build again after falling behind,",
  "then this becomes more than software.",
  "It becomes a witness.",
];

// Read-only view of the already-signed promise, in the contract styling.
function PromiseSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useStore();
  const p = profile.promise;
  return (
    <div className="promise-scrim" onMouseDown={onClose}>
      <div className="promise-orbs"><i /><i /><i /></div>
      <div className="promise-paper open" onMouseDown={(e) => e.stopPropagation()}>
        <header className="promise-contract-header">
          <AxomWordmark size="lg" />
          <span>Saved personal promise</span>
          <h2>A promise to yourself</h2>
          <p>A voluntary commitment, stored in your local AXOM profile. It is not a legal contract.</p>
        </header>
        <div className="promise-lines">
          {PROMISE_LINES.map((line, i) => (
            <p key={line} className={`promise-line in ${i === PROMISE_LINES.length - 1 ? "accent" : ""}`}>{line}</p>
          ))}
        </div>
        <div className="promise-signed-row">
          <div><span>Signed</span><b className="promise-sig">{p?.signedName}</b></div>
          <div className="right"><span>Date</span><b>{p?.signedAt ? prettyDate(p.signedAt) : "—"}</b></div>
        </div>
        <div className="sub" style={{ marginTop: 8, color: "#8a7f63" }}>Promise text {p?.promiseTextVersion ?? "v1"}</div>
        <button type="button" className="promise-btn" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function PersonalizationPanel() {
  const store = useStore();
  const profile = store.profile;
  const subscriptions = normalizedFocusIds(profile.focusSubscriptions);
  const activeFocusId = profile.activeFocusId && subscriptions.includes(profile.activeFocusId)
    ? profile.activeFocusId
    : subscriptions[0];
  const activeFocus = focusOption(activeFocusId);
  const track = resolveTrack(profile.educationTrack);
  const showSgu = profile.showSguResources ?? track.showsSguResources;
  // Lanes relevant to the current program, then anything else the user still
  // subscribes to (so switching programs never silently hides their picks).
  const laneOptions = FOCUS_OPTIONS.filter(
    (o) => track.focusIds.includes(o.id) || subscriptions.includes(o.id),
  );

  function chooseTrack(id: EducationTrackId) {
    if (id === profile.educationTrack) return;
    store.applyEducationTrack(id); // prefs only — never wipes existing data
  }

  function loadStarter() {
    if (!confirm(
      `Load the ${track.label} starter structure? This replaces the example term/course shells with ${track.short}'s, and keeps everything you've added. Export a backup first if unsure.`,
    )) return;
    store.applyEducationTrack(track.id, { seedStructure: true });
  }

  function toggleFocus(id: ExperienceFocusId) {
    const set = new Set(subscriptions);
    if (set.has(id) && id !== activeFocusId) set.delete(id);
    else set.add(id);
    store.updateProfile({ focusSubscriptions: [...set] });
  }

  function makePrimary(id: ExperienceFocusId) {
    const option = focusOption(id);
    const next = [...new Set([id, ...subscriptions])];
    store.updateProfile({
      activeFocusId: id,
      focusSubscriptions: next,
      phase: option?.phase,
      tagline: option?.tagline ?? profile.tagline,
      dailyCardTarget: option?.cardTarget ?? profile.dailyCardTarget,
      dailyMinuteTarget: option?.minuteTarget ?? profile.dailyMinuteTarget,
    });
  }

  return (
    <div className="backup-center">
      <div className="backup-actions-panel premium-panel">
        <div>
          <div className="sync-title">Program: {track.label}</div>
          <div className="sub">
            Current focus: <b>{activeFocus?.label ?? "Custom"}</b>. Your program controls starter courses,
            visible resources, and study lanes. Switching it never deletes existing data.
          </div>
        </div>
        <GButton size="sm" variant="primary" onClick={requestOnboardingRerun}>
          <Sparkles size={ICON_SIZE.body} /> Run setup again
        </GButton>
      </div>

      <div className="backup-actions-panel premium-panel">
        <div>
          <div className="sync-title">Early Features <Tag tone="orange">Labs</Tag></div>
          <div className="sub">
            Opt into experimental surfaces still under active development. They can change, move, or be removed
            between releases — your data stays local either way.
          </div>
          <label className="early-feature-row">
            <input
              type="checkbox"
              checked={profile.experimentalFlags?.habits === true}
              onChange={(e) => store.updateProfile({
                experimentalFlags: { ...(profile.experimentalFlags ?? {}), habits: e.target.checked },
              })}
            />
            <span><b>Habit Tracker</b> — calm, recovery-friendly habit tracking. Adds a “Habit Tracker” entry under Tools.</span>
          </label>
        </div>
      </div>

      <div className="track-settings-grid">
        {EDUCATION_TRACKS.map((t) => {
          const current = t.id === track.id;
          return (
            <button key={t.id} type="button" className={`track-setting-card ${current ? "on" : ""}`}
              onClick={() => chooseTrack(t.id)}>
              <div className="spread">
                <b>{t.short}</b>
                {current ? <Tag tone="cyan">Current</Tag> : t.status === "planned" ? <Tag tone="orange">Lighter</Tag> : null}
              </div>
              <small>{t.program}</small>
            </button>
          );
        })}
      </div>

      <div className="backup-actions-panel">
        <div>
          <div className="sync-title"><HardDrive size={ICON_SIZE.body} style={{ verticalAlign: -2, marginRight: 6 }} /> SGU shared drives</div>
          <div className="sub">Show SGU-specific drives on the Resources page. Your personal drive and universal board packs always stay.</div>
        </div>
        <button type="button" className={`onboarding-switch ${showSgu ? "on" : ""}`}
          onClick={() => store.updateProfile({ showSguResources: !showSgu })}
          aria-label="Show SGU shared drives" title={showSgu ? "SGU drives shown" : "SGU drives hidden"}>
          <span />
        </button>
      </div>

      <div className="backup-actions-panel">
        <div>
          <div className="sync-title">Starter structure</div>
          <div className="sub">{track.progress.summary}</div>
        </div>
        <GButton size="sm" onClick={loadStarter}><Sparkles size={ICON_SIZE.body} /> Load {track.short} structure</GButton>
      </div>

      <div className="focus-settings-grid">
        {laneOptions.map((option) => {
          const subscribed = subscriptions.includes(option.id);
          const primary = activeFocusId === option.id;
          return (
            <div key={option.id} className={`focus-setting-row ${primary ? "primary" : ""}`}>
              <button type="button" className={`focus-check ${subscribed ? "on" : ""}`} onClick={() => toggleFocus(option.id)} title="Toggle subscription">
                {subscribed && <Check size={ICON_SIZE.microInline} />}
              </button>
              <div className="grow">
                <b>{option.label}</b>
                <span>{option.blurb}</span>
              </div>
              <Tag tone={option.group === "SGU Terms" ? "cyan" : option.group === "Boards" ? "purple" : "green"}>{option.group}</Tag>
              <GButton size="sm" onClick={() => makePrimary(option.id)} disabled={primary}>
                {primary ? "Primary" : "Make primary"}
              </GButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
