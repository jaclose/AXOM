import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Archive, Camera, CheckCircle2, Clock3, Cloud, Download, GraduationCap, History, Lock, Play, RotateCcw,
  ScrollText, ShieldCheck, Target,
} from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import { GButton, Tag } from "../ui/primitives";
import { academicStagesForTrack, resolveTrack } from "../../lib/tracks";
import { focusOption } from "../../lib/experience";
import { isoDate, prettyDate } from "../../lib/scoring";
import type { AcademicStageId } from "../../lib/types";
import { useAccount } from "../../lib/account/accountStore";
import {
  FOCUS_CHECKIN_INTERVALS,
  focusCheckInLedger,
  lockedInRate,
  normalizeFocusCheckInPreferences,
  type FocusCheckInTone,
} from "../../lib/focusCheckIn";
import { FOCUS_CHECKIN_TEST_EVENT } from "./FocusCheckIn";
import { RESTORE_EVENT_LABELS, RESTORE_HISTORY_EVENT, readRestoreHistory } from "../../lib/restoreHistory";
import { VAULT_WRITE_EVENT, readLastVaultWrite } from "../../lib/vaultActivity";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function ProfileSection({
  onChangeAvatar,
  onRemoveAvatar,
  onViewPromise,
  onSignPromise,
  onOpenProgram,
  onOpenAccount,
  onClose,
}: {
  onChangeAvatar: () => void;
  onRemoveAvatar: () => void;
  onViewPromise: () => void;
  onSignPromise: () => void;
  onOpenProgram: () => void;
  onOpenAccount: () => void;
  onClose: () => void;
}) {
  const profile = useStore((state) => state.profile);
  const updateProfile = useStore((state) => state.updateProfile);
  const accountPhase = useAccount((state) => state.phase);
  const accountUser = useAccount((state) => state.user);
  const track = resolveTrack(profile.educationTrack);
  const stageGroup = academicStagesForTrack(track.id);
  const focus = focusOption(profile.activeFocusId);
  const promise = profile.promise;
  const stage = profile.academicStageId ?? stageGroup.defaultStageId;
  const initial = (profile.name || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="profile-section">
      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          <button type="button" className="profile-avatar" onClick={onChangeAvatar} aria-label="Change profile photo">
            {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : <span>{initial}</span>}
            <i aria-hidden="true"><Camera size={ICON_SIZE.body} /></i>
          </button>
          {profile.avatarDataUrl && (
            <button type="button" className="profile-avatar-remove" onClick={onRemoveAvatar}>Remove photo</button>
          )}
        </div>
        <div className="profile-hero-fields">
          <label className="profile-name-field">
            <span>Display name</span>
            <input
              className="field"
              value={profile.name}
              maxLength={120}
              placeholder="How AXOM greets you"
              onChange={(event) => updateProfile({ name: event.target.value })}
            />
          </label>
          <label className="profile-goal-field">
            <span>Your goal or motto</span>
            <input
              className="field"
              value={profile.tagline}
              maxLength={160}
              placeholder="e.g. Match into EM. One honest block at a time."
              onChange={(event) => updateProfile({ tagline: event.target.value })}
            />
          </label>
          <div className="profile-account-line">
            <Cloud size={ICON_SIZE.microInline} aria-hidden="true" />
            {accountUser
              ? <span>Signed in as <b>{accountUser.email}</b></span>
              : <span>Local profile on this device</span>}
            <button type="button" className="account-link" onClick={onOpenAccount}>
              {accountUser ? "Manage account" : accountPhase === "unconfigured" ? "About accounts" : "Sign in"}
            </button>
          </div>
        </div>
      </div>

      <div className="profile-card">
        <div className="profile-card-head">
          <GraduationCap size={ICON_SIZE.body} aria-hidden="true" />
          <h4>Where you are</h4>
        </div>
        <div className="profile-facts">
          <div className="profile-fact">
            <span>Program</span>
            <b>{track.label}</b>
            <button type="button" className="account-link" onClick={onOpenProgram}>Change</button>
          </div>
          <label className="profile-fact">
            <span>Current stage</span>
            <select
              className="field"
              value={stage}
              onChange={(event) => updateProfile({
                academicStageId: event.target.value as AcademicStageId,
                customAcademicStage: event.target.value === "other" ? profile.customAcademicStage : undefined,
              })}
            >
              {stageGroup.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <div className="profile-fact">
            <span>Primary focus</span>
            <b>{focus?.label ?? "Not chosen yet"}</b>
            <button type="button" className="account-link" onClick={onOpenProgram}>{focus ? "Change" : "Choose"}</button>
          </div>
        </div>
        {stage === "other" && (
          <label className="profile-inline-field">
            <span>Describe your stage (optional)</span>
            <input className="field" value={profile.customAcademicStage ?? ""} maxLength={120} onChange={(event) => updateProfile({ customAcademicStage: event.target.value })} />
          </label>
        )}
      </div>

      <div className="profile-card profile-promise">
        <div className="profile-card-head">
          <ScrollText size={ICON_SIZE.body} aria-hidden="true" />
          <h4>Your promise</h4>
          {promise?.signedName && <Tag tone="green"><CheckCircle2 size={ICON_SIZE.microInline} /> Signed</Tag>}
        </div>
        <p>{promise?.signedName
          ? `Signed by ${promise.signedName} on ${prettyDate(promise.signedAt)}. A private commitment — not a contract.`
          : "A short, private promise to yourself. Optional, and you can re-sign any time."}</p>
        <div className="profile-actions">
          {promise?.signedName && <GButton size="sm" onClick={onViewPromise}><ScrollText size={ICON_SIZE.body} /> View promise</GButton>}
          <GButton size="sm" onClick={onSignPromise}><ScrollText size={ICON_SIZE.body} /> {promise?.signedName ? "Re-sign" : "Sign your promise"}</GButton>
        </div>
      </div>

      <details className="profile-card profile-legacy">
        <summary><Target size={ICON_SIZE.body} aria-hidden="true" /> Older daily targets &amp; journal time</summary>
        <p>
          These card/minute targets are only used until you set up Daily requirements on the Productivity page.
          The journal follow-up time controls when AXOM nudges you to write.
        </p>
        <div className="settings-target-grid">
          <label className="stack gap6"><span className="field-label">Legacy card target</span>
            <input className="field" type="number" min={0} value={String(profile.dailyCardTarget ?? 120)} onChange={(e) => updateProfile({ dailyCardTarget: Number(e.target.value) || 0 })} />
          </label>
          <label className="stack gap6"><span className="field-label">Legacy minute target</span>
            <input className="field" type="number" min={0} value={String(profile.dailyMinuteTarget ?? 240)} onChange={(e) => updateProfile({ dailyMinuteTarget: Number(e.target.value) || 0 })} />
          </label>
          <label className="stack gap6"><span className="field-label">Journal follow-up time</span>
            <input className="field" type="time" value={profile.journalReviewTime ?? "20:00"} onChange={(e) => updateProfile({ journalReviewTime: e.target.value || "20:00" })} />
          </label>
        </div>
        <a className="gbtn sm" href="#productivity" onClick={onClose}>Set up Daily requirements</a>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emergency recovery: status strip + restore history
// ---------------------------------------------------------------------------

function subscribeVault(listener: () => void) {
  window.addEventListener(VAULT_WRITE_EVENT, listener);
  return () => window.removeEventListener(VAULT_WRITE_EVENT, listener);
}
function vaultSnapshot() {
  const record = readLastVaultWrite();
  return record ? `${record.at}|${record.target}` : "";
}

/** "Saved on this device at 8:42:13 PM" — the exact latest local write. */
export function useLastVaultWrite() {
  const raw = useSyncExternalStore(subscribeVault, vaultSnapshot, () => "");
  if (!raw) return null;
  const [at, target] = raw.split("|");
  return { at, target };
}

export function LastSavedLine() {
  const write = useLastVaultWrite();
  return (
    <span className="last-saved-line" role="status">
      <ShieldCheck size={ICON_SIZE.microInline} aria-hidden="true" />
      {write
        ? <>Saved on this device at <b>{new Date(write.at).toLocaleTimeString()}</b>{write.target === "local-fallback" ? " (browser storage fallback)" : ""}</>
        : <>Autosave is on — the next change will be saved immediately</>}
    </span>
  );
}

export function BackupStatusCard({ snapshotCount, latestSnapshotAt, lastExportedAt }: {
  snapshotCount: number;
  latestSnapshotAt?: string;
  lastExportedAt?: string;
}) {
  const write = useLastVaultWrite();
  const exportAgeDays = lastExportedAt ? Math.floor((Date.now() - Date.parse(lastExportedAt)) / 86_400_000) : null;
  const items = [
    {
      icon: ShieldCheck,
      label: "Live workspace",
      value: write ? `Saved ${new Date(write.at).toLocaleTimeString()}` : "Autosave on",
      tone: "good",
    },
    {
      icon: Archive,
      label: "Automatic snapshots",
      value: snapshotCount ? `${snapshotCount} · latest ${formatDay(latestSnapshotAt)}` : "None yet",
      tone: snapshotCount ? "good" : "neutral",
    },
    {
      icon: Download,
      label: "Last portable export",
      value: lastExportedAt ? `${formatDay(lastExportedAt)}${exportAgeDays !== null && exportAgeDays > 14 ? " · consider a fresh one" : ""}` : "Never — export one to keep a copy",
      tone: !lastExportedAt || (exportAgeDays !== null && exportAgeDays > 14) ? "warn" : "good",
    },
  ] as const;
  return (
    <section className="backup-status-card" aria-label="Backup status">
      <h4>Backup status</h4>
      <div className="backup-status-strip">
        {items.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className={`backup-status-item ${tone}`}>
            <Icon size={ICON_SIZE.body} aria-hidden="true" />
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <p>
        The live workspace saves to this browser’s local vault as you work. Automatic snapshots are safety copies taken before
        storage updates. A portable export is the copy you keep somewhere else. Imports are checked before anything is replaced.
      </p>
    </section>
  );
}

export function RestoreHistoryCard() {
  const [events, setEvents] = useState(readRestoreHistory);
  useEffect(() => {
    const sync = () => setEvents(readRestoreHistory());
    window.addEventListener(RESTORE_HISTORY_EVENT, sync);
    return () => window.removeEventListener(RESTORE_HISTORY_EVENT, sync);
  }, []);
  return (
    <section className="restore-history-card" aria-label="Restore history">
      <div className="restore-history-head">
        <History size={ICON_SIZE.body} aria-hidden="true" />
        <h4>Restore history</h4>
        <small>This device · last {Math.min(events.length, 50) || 0}</small>
      </div>
      {events.length === 0 ? (
        <p className="restore-history-empty">No restores, merges, or resets on this device yet.</p>
      ) : (
        <ol className="restore-history-list">
          {events.slice(0, 8).map((event) => (
            <li key={event.id}>
              <RotateCcw size={ICON_SIZE.microInline} aria-hidden="true" />
              <div>
                <b>{RESTORE_EVENT_LABELS[event.kind]}</b>
                <small>{new Date(event.at).toLocaleString()}{event.detail ? ` · ${event.detail}` : ""}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatDay(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Lock-in check-ins (Personalization → Daily rhythm)
// ---------------------------------------------------------------------------

const TONES: Array<{ id: FocusCheckInTone; label: string; sample: string }> = [
  { id: "gentle", label: "Gentle", sample: "Just checking in — how’s the focus?" },
  { id: "coach", label: "Coach", sample: "Quick check. Still on the work?" },
  { id: "intense", label: "Intense", sample: "Eyes up. Are you actually working?" },
];

export function FocusCheckInSettings() {
  const raw = useStore((state) => state.profile.focusCheckIn);
  const updateProfile = useStore((state) => state.updateProfile);
  const preferences = normalizeFocusCheckInPreferences(raw);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unavailable" : Notification.permission);
  const ledger = focusCheckInLedger.read(isoDate(new Date()));
  const rate = lockedInRate(ledger);

  function update(patch: Partial<typeof preferences>) {
    updateProfile({ focusCheckIn: normalizeFocusCheckInPreferences({ ...preferences, ...patch }) });
  }

  async function enableNotifications(checked: boolean) {
    if (checked && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
    update({ systemNotifications: checked });
  }

  return (
    <section className="settings-card lockin-settings" aria-labelledby="lockin-settings-title">
      <div className="settings-card-head">
        <span className="settings-card-icon"><Lock size={ICON_SIZE.body} aria-hidden="true" /></span>
        <div>
          <h4 id="lockin-settings-title">“Are you locked in?” check-ins</h4>
          <p>A quick pop-up on your current screen at the interval you choose. Answer in one tap; AXOM replies with a nudge — or how much is left.</p>
        </div>
        <label className="settings-switch">
          <input type="checkbox" checked={preferences.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          <span>Enable lock-in check-ins</span>
        </label>
      </div>

      <div className={`lockin-body ${preferences.enabled ? "" : "muted"}`}>
        <div className="lockin-row">
          <span className="field-label">Every</span>
          <div className="lockin-intervals" role="group" aria-label="Check-in interval">
            {FOCUS_CHECKIN_INTERVALS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`filter-pill ${preferences.intervalMinutes === minutes ? "on" : ""}`}
                aria-pressed={preferences.intervalMinutes === minutes}
                onClick={() => update({ intervalMinutes: minutes })}
              >
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
              </button>
            ))}
          </div>
        </div>
        <div className="lockin-row">
          <span className="field-label">When</span>
          <div className="lockin-choice" role="radiogroup" aria-label="When to check in">
            <label className={preferences.scope === "focus" ? "on" : ""}>
              <input type="radio" name="lockin-scope" checked={preferences.scope === "focus"} onChange={() => update({ scope: "focus" })} />
              <span><b>During focus sprints</b><small>Only while a Pomodoro focus block or study session is running</small></span>
            </label>
            <label className={preferences.scope === "anytime" ? "on" : ""}>
              <input type="radio" name="lockin-scope" checked={preferences.scope === "anytime"} onChange={() => update({ scope: "anytime" })} />
              <span><b>Whenever AXOM is open</b><small>Useful when you study outside the timer</small></span>
            </label>
          </div>
        </div>
        <div className="lockin-row">
          <span className="field-label">Voice</span>
          <div className="lockin-choice three" role="radiogroup" aria-label="Check-in voice">
            {TONES.map((tone) => (
              <label key={tone.id} className={preferences.tone === tone.id ? "on" : ""}>
                <input type="radio" name="lockin-tone" checked={preferences.tone === tone.id} onChange={() => update({ tone: tone.id })} />
                <span><b>{tone.label}</b><small>“{tone.sample}”</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="lockin-toggles">
          <label className="settings-switch">
            <input type="checkbox" checked={preferences.varyTiming} onChange={(event) => update({ varyTiming: event.target.checked })} />
            <span>Vary the timing (±30%) so you can’t anticipate it</span>
          </label>
          <label className="settings-switch">
            <input type="checkbox" checked={preferences.respectQuietHours} onChange={(event) => update({ respectQuietHours: event.target.checked })} />
            <span>Stay quiet during quiet hours</span>
          </label>
          <label className="settings-switch">
            <input type="checkbox" checked={preferences.systemNotifications} disabled={permission === "denied" || permission === "unavailable"} onChange={(event) => void enableNotifications(event.target.checked)} />
            <span>Also notify when AXOM is in the background{permission === "denied" ? " (blocked in browser settings)" : ""}</span>
          </label>
        </div>
        <div className="lockin-foot">
          <GButton size="sm" onClick={() => window.dispatchEvent(new CustomEvent(FOCUS_CHECKIN_TEST_EVENT))}>
            <Play size={ICON_SIZE.body} aria-hidden="true" /> Preview a check-in
          </GButton>
          <span>
            <Clock3 size={ICON_SIZE.microInline} aria-hidden="true" />
            Today: {ledger.prompts} check-in{ledger.prompts === 1 ? "" : "s"}
            {rate !== null ? ` · ${rate}% locked in` : ""}
            {ledger.breaks ? ` · ${ledger.breaks} break${ledger.breaks === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
