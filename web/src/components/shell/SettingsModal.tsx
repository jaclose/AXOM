import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useNotificationPermission } from "../../lib/useNotificationPermission";
import {
  Bell, Clock3, Database, Download, FileJson, Palette, RotateCcw, ShieldCheck,
  Sparkles, Trash2, Upload, UserCircle2, Check, MessageCircle, Settings2,
  Paintbrush, BookOpen, LayoutGrid, GraduationCap, Globe2,
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
import { EDUCATION_TRACKS, resolveTrack } from "../../lib/tracks";
import { prettyDate } from "../../lib/scoring";
import type { DashboardWidgetId, EducationTrackId, ExperienceFocusId } from "../../lib/types";
import { HardDrive } from "lucide-react";
import { AxomWordmark } from "../ui/BrandMark";
import { SCHEMA_VERSION, APP_BUILD_LABEL } from "../../lib/seed";
import { lastBackupAt } from "../../lib/backup";
import { listLocalBackups } from "../../lib/localBackup";
import { restoreLocalWorkspaceBackup } from "../../lib/storageRecovery";
import { runStorageMigrations } from "../../lib/storageMigrations";
import { requestOnboardingRerun } from "../../lib/uiStore";
import { canonicalTimeZone, normalizeClockPreferences, normalizeTimeZonePreference, systemTimeZone } from "../../lib/clock";
import { normalizeDailyLoopReminderPreferences } from "../../lib/dailyLoopReminders";
import { AccountSyncPanel } from "./AccountSyncPanel";
import { AppearanceStudio } from "./AppearanceStudio";
import {
  BackupStatusCard,
  FocusCheckInSettings,
  LastSavedLine,
  ProfileSection,
  RestoreHistoryCard,
} from "./SettingsSections";
import { recordRestoreEvent } from "../../lib/restoreHistory";
import { DEFAULT_STUDY_WORKFLOW, normalizeStudyWorkflow, toggleStudyMethod, type StudyMethodId } from "../../lib/studyPreferences";
import { StudyMethodFollowUps } from "./StudyMethodFollowUps";
import { StudyTextSuggestions } from "./StudyTextSuggestions";
import {
  CURRENT_DASHBOARD_WIDGET_IDS,
  adaptLegacyDashboardLayout,
  applyDashboardLayoutPreset,
  dashboardWidgetCatalogItem,
  normalizeDashboardLayoutPreferences,
} from "../../lib/dashboardWidgets";

type SettingsSection = "profile" | "account" | "appearance" | "personalization" | "data" | "backup" | "advanced";
export type PersonalizationSubsection = "study" | "rhythm" | "dashboard" | "program";
/** Legacy names remain accepted so existing deep links keep opening safely. */
export type SettingsTab = SettingsSection | PersonalizationSubsection | "general" | "ai";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof UserCircle2 }> = [
  { id: "profile", label: "Profile", icon: UserCircle2 },
  { id: "account", label: "Account", icon: ShieldCheck },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "personalization", label: "Personalization", icon: Palette },
  { id: "data", label: "Data", icon: Database },
  { id: "backup", label: "Emergency recovery", icon: FileJson },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

const PERSONALIZATION_SUBSECTIONS: Array<{ id: PersonalizationSubsection; label: string; detail: string; icon: typeof UserCircle2 }> = [
  { id: "study", label: "Study style", detail: "Methods, passes, and review timing", icon: BookOpen },
  { id: "rhythm", label: "Daily rhythm", detail: "Reminders, lock-in check-ins, clock", icon: Clock3 },
  { id: "dashboard", label: "Dashboard", detail: "Which widgets appear", icon: LayoutGrid },
  { id: "program", label: "Program & lanes", detail: "Track, focus lanes, early features", icon: GraduationCap },
];

function normalizeSettingsTab(tab: SettingsTab): SettingsSection {
  if (tab === "general") return "profile";
  if (tab === "ai") return "advanced";
  if (tab === "study" || tab === "rhythm" || tab === "dashboard" || tab === "program") return "personalization";
  return tab;
}

function initialSubsection(tab: SettingsTab): PersonalizationSubsection {
  return tab === "rhythm" || tab === "dashboard" || tab === "program" ? tab : "study";
}

export function SettingsModal({ onClose, initialTab = "general" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const store = useStore();
  const { profile } = store;
  const fileRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>("");
  const [tab, setTab] = useState<SettingsSection>(() => normalizeSettingsTab(initialTab));
  const [personalTab, setPersonalTab] = useState<PersonalizationSubsection>(() => initialSubsection(initialTab));
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
    account: { title: "Account & protection", body: "Optional sign-in, automatic protected versions, and safe restore controls." },
    appearance: { title: "Appearance", body: "Make AXOM yours: light or dark, an accent palette (or your own color), and motion." },
    data: {
      title: "Data on this device",
      body: "See where your workspace lives, whether storage is healthy, and what AXOM has saved.",
    },
    backup: {
      title: "Emergency recovery",
      body: "Export a portable copy, restore safely, and review automatic local recovery snapshots.",
    },
    personalization: {
      title: "Personalization",
      body: "How you study, your daily rhythm, what the dashboard shows, and your program.",
    },
    advanced: {
      title: "Advanced",
      body: "Technical versions, diagnostics, optional provider tools, and destructive reset controls.",
    },
  };
  const localBackups = listLocalBackups();
  const exportedAt = lastBackupAt();

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
          recordRestoreEvent({ kind: "portable-restore", detail: file.name });
          setMsg(`Restored from ${file.name}. Your data is back.`);
          finishAttachments(next.questions);
        } else {
          const merged = mergeStates(store, next);
          if (!confirm("Merge this backup into the current data? Records are combined by id (newer wins); your profile and current day stay as they are. Nothing is deleted.")) {
            setMsg("Merge cancelled. No data changed.");
            return;
          }
          store.replaceAll(merged);
          recordRestoreEvent({ kind: "portable-merge", detail: file.name });
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
          <ProfileSection
            onChangeAvatar={() => avatarRef.current?.click()}
            onRemoveAvatar={() => store.updateProfile({ avatarDataUrl: undefined })}
            onViewPromise={() => setViewingPromise(true)}
            onSignPromise={() => setResigning(true)}
            onOpenProgram={() => { setPersonalTab("program"); setTab("personalization"); }}
            onOpenAccount={() => setTab("account")}
            onClose={onClose}
          />
          <input ref={avatarRef} type="file" accept="image/*" hidden
            onChange={(e) => e.target.files?.[0] && setAvatar(e.target.files[0])} />
        </section>
      )}

      {tab === "data" && (
        <section role="tabpanel" id={`${tabsId}-panel-data`} aria-labelledby={`${tabsId}-tab-data`} className="backup-center">
          <div className="backup-actions-panel premium-panel">
            <div>
              <div className="sync-title">Local-first workspace</div>
              <div className="sub">
                Your AXOM workspace is stored on this device and changes save locally as you work.
                When you deliberately link an account, acknowledged protected versions are also retained remotely.
              </div>
              <div style={{ marginTop: 8 }}><LastSavedLine /></div>
            </div>
            <Tag tone="green"><ShieldCheck size={ICON_SIZE.microInline} /> On this device</Tag>
          </div>
          <DataHealthPanel />
        </section>
      )}
      {tab === "account" && <section role="tabpanel" id={`${tabsId}-panel-account`} aria-labelledby={`${tabsId}-tab-account`}><AccountSyncPanel /></section>}

      {tab === "appearance" && (
        <section role="tabpanel" id={`${tabsId}-panel-appearance`} aria-labelledby={`${tabsId}-tab-appearance`} className="backup-center">
          <AppearanceStudio />
          <DevicePreferencePanel />
        </section>
      )}

      {tab === "backup" && (
        <section role="tabpanel" id={`${tabsId}-panel-backup`} aria-labelledby={`${tabsId}-tab-backup`} className="backup-center">
          <div className="sub" style={{ marginBottom: 4 }}>
            Signed-in accounts can retain protected server versions. Manual JSON backup remains an emergency portable safety valve.
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
              recordRestoreEvent({ kind: "snapshot-restore", detail: "Automatic local snapshot" });
              setMsg("Safety snapshot restored. Retry startup to finish recovery.");
              return true;
            }}
            onResolved={() => setMsg("Storage update completed successfully.")}
          />

          <div className="backup-actions-panel">
            <div>
              <div className="sync-title">Portable emergency copy</div>
              <div className="sub">Automatic local saving is primary. Export a portable copy you control, or restore or merge a saved AXOM JSON file when recovery is needed.</div>
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

          <BackupStatusCard
            snapshotCount={localBackups.length}
            latestSnapshotAt={localBackups[0]?.savedAt}
            lastExportedAt={exportedAt ?? undefined}
          />
          <RestoreHistoryCard />

          {msg && <div className="backup-status" role="status">{msg}</div>}
        </section>
      )}

      {tab === "personalization" && (
        <section role="tabpanel" id={`${tabsId}-panel-personalization`} aria-labelledby={`${tabsId}-tab-personalization`} className="backup-center">
          <nav className="settings-subnav" aria-label="Personalization sections">
            {PERSONALIZATION_SUBSECTIONS.map(({ id, label, detail, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={personalTab === id ? "on" : ""}
                aria-current={personalTab === id ? "true" : undefined}
                onClick={() => setPersonalTab(id)}
              >
                <Icon size={ICON_SIZE.body} aria-hidden="true" />
                <span><b>{label}</b><small>{detail}</small></span>
              </button>
            ))}
          </nav>
          {personalTab === "study" && <StudyWorkflowSettings />}
          {personalTab === "rhythm" && <DailyUtilitiesSettings />}
          {personalTab === "dashboard" && <DashboardVisibilitySettings />}
          {personalTab === "program" && <PersonalizationPanel />}
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
                  recordRestoreEvent({ kind: "reset", detail: "Starter data" });
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

const STUDY_METHOD_OPTIONS: Array<{ id: StudyMethodId; label: string }> = [
  { id: "lecture-passes", label: "Lecture passes" }, { id: "practice-questions", label: "Practice questions" },
  { id: "anki", label: "Anki" }, { id: "quizlet", label: "Quizlet" }, { id: "noji", label: "Noji" },
  { id: "remnote", label: "RemNote" }, { id: "notes", label: "Notes / concept notes" },
  { id: "teach-aloud", label: "Teaching aloud / Feynman" }, { id: "recall", label: "Recall sessions" },
  { id: "external-resource", label: "External resources" }, { id: "custom", label: "Other" },
];

function StudyWorkflowSettings() {
  const store = useStore();
  const workflow = normalizeStudyWorkflow(store.profile.studyWorkflow ?? DEFAULT_STUDY_WORKFLOW);
  const enabled = new Set((workflow.methods ?? []).filter((method) => method.enabled).map((method) => method.id));
  function toggle(id: StudyMethodId) {
    store.updateProfile({ studyWorkflow: toggleStudyMethod(workflow, id) });
  }
  function save(patch: Partial<typeof workflow>) {
    store.updateProfile({ studyWorkflow: { ...workflow, configured: true, ...patch } });
  }
  function setKindPasses(kind: "Lecture" | "DLA" | "PQ", lecturePasses: number) {
    save({ itemKindDefaults: { ...workflow.itemKindDefaults, [kind]: { ...workflow.itemKindDefaults?.[kind], lecturePasses } } });
  }
  return (
    <div className="settings-stack">
      <section className="settings-card" aria-labelledby="study-methods-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><BookOpen size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="study-methods-title">How you study</h4>
            <p>Pick every method you actually use. AXOM uses this to shape recommendations and follow-ups — it never forces a method (not even Anki).</p>
          </div>
        </div>
        <div className="settings-chip-row" aria-label="Study methods">
          {STUDY_METHOD_OPTIONS.map((option) => (
            <button key={option.id} type="button" className={`filter-pill ${enabled.has(option.id) ? "on" : ""}`} aria-pressed={enabled.has(option.id)} onClick={() => toggle(option.id)}>
              {enabled.has(option.id) && <Check size={ICON_SIZE.microInline} aria-hidden="true" />} {option.label}
            </button>
          ))}
        </div>
        <StudyMethodFollowUps workflow={workflow} onChange={(studyWorkflow) => store.updateProfile({ studyWorkflow })} />
      </section>

      <section className="settings-card" aria-labelledby="study-passes-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><RotateCcw size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="study-passes-title">Passes &amp; review timing</h4>
            <p>
              How many times you usually go through material, and when AXOM should bring it back. Course Tracker items without their own
              setting use these — a course or single item can always override them.
            </p>
          </div>
        </div>
        <div className="settings-target-grid">
          <label className="stack gap6">
            <span className="field-label">Usual lecture passes</span>
            <input className="field" type="number" min={1} max={6} value={workflow.lecturePasses ?? 2} onChange={(event) => save({ lecturePasses: Number(event.target.value) })} />
          </label>
          <label className="stack gap6">
            <span className="field-label">Review again after (days)</span>
            <input className="field" type="number" min={1} max={14} value={workflow.reviewAfterDays ?? 3} onChange={(event) => save({ reviewAfterDays: Number(event.target.value) })} />
          </label>
        </div>
        <div className="settings-kind-defaults">
          <span className="field-label">Passes by item type</span>
          <p className="sub">Example: set PQ to 6 if you usually do six rounds of practice questions. Leave a type alone to use your usual passes.</p>
          <div className="settings-kind-grid">
            {(["Lecture", "DLA", "PQ"] as const).map((kind) => (
              <label className="settings-kind" key={kind}>
                <b>{kind}</b>
                <input
                  className="field"
                  aria-label={`${kind} default passes`}
                  type="number"
                  min={1}
                  max={6}
                  value={workflow.itemKindDefaults?.[kind]?.lecturePasses ?? workflow.lecturePasses ?? 2}
                  onChange={(event) => setKindPasses(kind, Number(event.target.value))}
                />
                <small>{workflow.itemKindDefaults?.[kind]?.lecturePasses ? "Custom" : "Uses usual"}</small>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="study-words-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Sparkles size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="study-words-title">In your own words</h4>
            <p>Anything the options above miss. AXOM keeps this text exactly as written. Suggestions below come from fixed word rules (not AI), are shown for you to confirm, and are never applied automatically.</p>
          </div>
        </div>
        <label className="stack gap6">
          <span className="field-label">Other — tell AXOM how you study</span>
          <textarea className="field" rows={3} value={workflow.customContext ?? ""} placeholder="e.g. First pass on lecture day, Anki that night, a week later I redo the PQs." onChange={(event) => save({ customContext: event.target.value })} />
        </label>
        <StudyTextSuggestions workflow={workflow} onApply={(studyWorkflow) => store.updateProfile({ studyWorkflow })} />
      </section>
    </div>
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
    <div className="settings-stack">
      <FocusCheckInSettings />

      <section className="settings-card" aria-labelledby="rhythm-reminders-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Bell size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="rhythm-reminders-title">Daily rhythm reminders</h4>
            <p>Optional in-app prompts use this device's local time. Each enabled prompt appears at most once per day unless you choose Snooze.</p>
          </div>
        </div>
        <div className="settings-reminder-list">
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
              <div className="sub">No prompts or check-ins in this window. A pending prompt can resume later the same day, but never carries into a new day.</div>
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
        </div>
      </section>

      <section className="settings-card" aria-labelledby="rhythm-clock-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Clock3 size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="rhythm-clock-title">Clock</h4>
            <p>The time in the top bar, with an optional analog clock when you click it. Only preferences are saved — never the time itself.</p>
          </div>
          <label className="settings-switch">
            <input type="checkbox" checked={clock.enabled} onChange={(event) => updateClock({ enabled: event.target.checked })} />
            <span>Show clock</span>
          </label>
        </div>
        <div className={`settings-compact-grid ${clock.enabled ? "" : "muted"}`} aria-label="Clock display preferences">
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
      </section>

      <section className="settings-card" aria-labelledby="rhythm-timezone-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Globe2 size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="rhythm-timezone-title">Timezone</h4>
            <p>Shared by the clock, reminders, and Daily Word. Daily Word locks the timezone when a puzzle starts.</p>
          </div>
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
        </fieldset>
      </section>

      {puzzleCount > 0 && (
        <div className="settings-utility-row danger-zone">
          <div><div className="sync-title">Daily Word history</div><div className="sub">{puzzleCount} local puzzle record{puzzleCount === 1 ? "" : "s"}. This reset does not affect courses, tasks, or other AXOM data.</div></div>
          <GButton size="sm" variant="danger" onClick={() => {
            if (confirm("Reset Daily Word history and statistics on this device? No other AXOM data will change.")) resetDailyWordPuzzles();
          }}><Trash2 size={ICON_SIZE.body} /> Reset Daily Word</GButton>
        </div>
      )}
    </div>
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
    <section className="settings-card" aria-labelledby="dashboard-widgets-title">
      <div className="settings-card-head">
        <span className="settings-card-icon"><LayoutGrid size={ICON_SIZE.body} aria-hidden="true" /></span>
        <div>
          <h4 id="dashboard-widgets-title">Dashboard widgets</h4>
          <p>Choose what appears on the dashboard. This changes presentation only — hiding a widget never deletes data. Use “Edit dashboard” for sizes and order.</p>
        </div>
      </div>
      <div className="settings-widget-grid">
        {CURRENT_DASHBOARD_WIDGET_IDS.filter((id) => id !== "welcome").map((id) => (
          <label className="early-feature-row" key={id}>
            <input type="checkbox" checked={!hidden.has(id)} onChange={(event) => setVisible(id, event.target.checked)} />
            <span>{dashboardWidgetCatalogItem(id).label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function DevicePreferencePanel() {
  const [permission, requestPermission] = useNotificationPermission();
  async function requestNotifications() {
    await requestPermission();
  }
  const label = permission === "granted" ? "On" : permission === "denied" ? "Blocked in browser settings" : permission === "unavailable" ? "Not supported here" : "Not enabled yet";
  return (
    <section className="settings-card" aria-labelledby="device-notifications-title">
      <div className="settings-card-head">
        <span className="settings-card-icon"><Bell size={ICON_SIZE.body} aria-hidden="true" /></span>
        <div>
          <h4 id="device-notifications-title">System notifications</h4>
          <p>Lets focus timers and lock-in check-ins reach you while AXOM is in the background. Status on this device: <b>{label}</b>.</p>
        </div>
        {permission === "default" && <GButton size="sm" onClick={requestNotifications}>Enable notifications</GButton>}
      </div>
    </section>
  );
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
    <div className="settings-stack">
      <section className="settings-card" aria-labelledby="program-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><GraduationCap size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="program-title">Program: {track.label}</h4>
            <p>Your program controls starter courses, visible resources, and study lanes. Switching never deletes existing data.</p>
          </div>
          <GButton size="sm" onClick={requestOnboardingRerun}>
            <Sparkles size={ICON_SIZE.body} /> Run setup again
          </GButton>
        </div>
        <div className="track-settings-grid">
          {EDUCATION_TRACKS.map((t) => {
            const current = t.id === track.id;
            return (
              <button key={t.id} type="button" className={`track-setting-card ${current ? "on" : ""}`}
                aria-pressed={current}
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
        <div className="settings-inline-row">
          <div>
            <div className="sync-title">Starter structure</div>
            <div className="sub">{track.progress.summary}</div>
          </div>
          <GButton size="sm" onClick={loadStarter}><Sparkles size={ICON_SIZE.body} /> Load {track.short} structure</GButton>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="lanes-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Check size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="lanes-title">Focus lanes</h4>
            <p>
              Current primary: <b>{activeFocus?.label ?? "Custom"}</b>. Check the lanes you follow; “Make primary” sets your main focus and
              default targets. The Course Tracker lets you narrow to one term, course, or section inside a lane.
            </p>
          </div>
        </div>
        <div className="focus-settings-grid">
          {laneOptions.map((option) => {
            const subscribed = subscriptions.includes(option.id);
            const primary = activeFocusId === option.id;
            return (
              <div key={option.id} className={`focus-setting-row ${primary ? "primary" : ""}`}>
                <button type="button" className={`focus-check ${subscribed ? "on" : ""}`} onClick={() => toggleFocus(option.id)} title="Toggle subscription" aria-pressed={subscribed} aria-label={`Follow ${option.label}`}>
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
      </section>

      <section className="settings-card" aria-labelledby="resources-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><HardDrive size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="resources-title">SGU shared drives</h4>
            <p>Show SGU-specific drives on the Resources page. Your personal drive and universal board packs always stay.</p>
          </div>
          <button type="button" className={`onboarding-switch ${showSgu ? "on" : ""}`}
            onClick={() => store.updateProfile({ showSguResources: !showSgu })}
            aria-label="Show SGU shared drives" aria-pressed={showSgu} title={showSgu ? "SGU drives shown" : "SGU drives hidden"}>
            <span />
          </button>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="labs-title">
        <div className="settings-card-head">
          <span className="settings-card-icon"><Sparkles size={ICON_SIZE.body} aria-hidden="true" /></span>
          <div>
            <h4 id="labs-title">Early features <Tag tone="orange">Labs</Tag></h4>
            <p>Opt into surfaces still under active development. They can change between releases — your data stays either way.</p>
          </div>
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
      </section>
    </div>
  );
}
