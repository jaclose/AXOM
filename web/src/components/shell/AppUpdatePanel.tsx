import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { appUpdates, type UpdatePhase } from "../../lib/appUpdates";
import { APP_RELEASE_VERSION } from "../../lib/brand";
import { GButton } from "../ui/primitives";
import { useStore } from "../../lib/store";
import { findLiveSession } from "../../lib/sessions";
import { UPDATE_PREFS_EVENT, readUpdatePreferences, writeUpdatePreferences } from "../../lib/updatePreferences";
import { lazyWithFallback } from "../../lib/lazyWithFallback";

// Lives outside any route boundary: a missing chunk (tab open across a deploy)
// must degrade to a note, not crash the update panel that would fix it.
const ReleaseNotesHistory = lazyWithFallback(
  () => import("./ReleaseNotesHistory").then((module) => module.ReleaseNotesHistory),
  () => <p className="sub">Release notes for this version load after you refresh. Your workspace is not affected.</p>,
);

export const UPDATE_BUSY_PHASES: UpdatePhase[] = ["checking", "downloading", "preparing", "installing", "restarting"];

/** The one consent step before AXOM saves a checkpoint, installs, and restarts. */
export function requestApplyUpdate(): void {
  const state = appUpdates.getSnapshot();
  const live = findLiveSession(useStore.getState().sessions ?? []);
  const nextStep = state.desktop ? (state.restartPending ? "restart to finish the installed update" : "install the update and restart") : "refresh to the new web build";
  const prompt = `${live ? "You have an open study session. " : ""}Finish any unsaved edits first. AXOM will save a workspace recovery snapshot, then ${nextStep}. Continue?`;
  if (window.confirm(prompt)) void appUpdates.apply().then(() => {
    if (appUpdates.getSnapshot().phase === "error") window.dispatchEvent(new Event("axom:open-update-panel"));
  });
}

export function requestApplyUpdateWithVerifiedSave(): void {
  const prompt = "AXOM saved and verified your latest workspace, but could not create an extra recovery copy. Are you sure you want to refresh without that extra copy? AXOM will verify the saved workspace again before refreshing. You can export a backup first.";
  if (window.confirm(prompt)) void appUpdates.apply({ skipRecoverySnapshot: true });
}

/** User-authorized web-only escape hatch when the workspace save itself fails. */
export function requestApplyUpdateWithoutVerifiedSave(): void {
  const prompt = "AXOM could not verify that your latest workspace was saved. Refreshing now may lose recent changes. Export a backup first if possible. Are you sure you want to refresh anyway?";
  if (window.confirm(prompt)) void appUpdates.apply({ skipFailedCheckpoint: true }).then(() => {
    if (appUpdates.getSnapshot().phase === "error") window.dispatchEvent(new Event("axom:open-update-panel"));
  });
}

function useAutoDownload(): boolean {
  const [value, setValue] = useState(() => readUpdatePreferences().autoDownload);
  useEffect(() => {
    const sync = () => setValue(readUpdatePreferences().autoDownload);
    window.addEventListener(UPDATE_PREFS_EVENT, sync);
    return () => window.removeEventListener(UPDATE_PREFS_EVENT, sync);
  }, []);
  return value;
}

export function AppUpdatePanel() {
  const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot);
  const autoDownload = useAutoDownload();
  const busy = UPDATE_BUSY_PHASES.includes(state.phase);
  const canApply = Boolean(state.version) && (!state.desktop || appUpdates.hasDownloaded() || state.restartPending);
  const status: Record<UpdatePhase, string> = {
    idle: "Check when you’re ready. Background checks never install or restart the app.",
    checking: "Checking for updates…",
    current: "You’re running the latest available build.",
    available: `Version ${state.version} is available.`,
    downloading: "Downloading and verifying the update…",
    ready: "Download verified. Install when you’re ready to restart.",
    preparing: "Preparing the update…",
    installing: "Installing the update. Keep AXOM open until it restarts.",
    restarting: "Update ready. Restarting AXOM…",
    disabled: state.error ?? "Updates are unavailable for this build.",
    error: state.error ?? "The update could not finish. Try again later.",
  };
  const canContinueWithVerifiedSave = state.canContinueWithoutRecoverySnapshot && !state.desktop;
  const apply = canContinueWithVerifiedSave ? requestApplyUpdateWithVerifiedSave : requestApplyUpdate;
  const canRefreshWithoutVerifiedSave = state.canRefreshWithoutVerifiedSave && !state.desktop && state.phase === "error";
  return (
    <section className="settings-update-panel" aria-busy={busy} aria-labelledby="settings-update-title">
      <div className="settings-update-head">
        <div><span className="settings-eyebrow">Application</span><h5 id="settings-update-title">App updates</h5></div>
        <span className="settings-update-version">{state.desktop ? "Desktop" : "Web"} · v{APP_RELEASE_VERSION}</span>
      </div>
      <div className={`settings-update-state ${state.phase === "error" ? "error" : ""}`}>
        <p role={state.phase === "error" ? "alert" : "status"}>{status[state.phase]}</p>
        {state.lastChecked && <small>Last checked {new Date(state.lastChecked).toLocaleString()}</small>}
      </div>
      {state.restartPending && state.phase === "error" && <p className="sub">The update is already prepared. Retry the restart below; it will save your current workspace again without reinstalling.</p>}
      {canContinueWithVerifiedSave && <p className="sub">Your latest workspace was saved and verified. AXOM could not create the additional recovery copy. You can confirm a refresh with the verified save or retry creating the full backup.</p>}
      {canRefreshWithoutVerifiedSave && <p className="sub" id="update-unverified-save-warning">AXOM could not verify that your latest workspace was saved. Refreshing now may lose recent changes. Export a backup from Settings if possible, or choose Refresh anyway and confirm.</p>}
      {state.phase === "downloading" && <div>
        <progress aria-label="Update download" value={state.totalBytes ? state.downloadedBytes : undefined} max={state.totalBytes ?? 1} style={{ width: "100%" }} />
        <p className="sub">{(state.downloadedBytes / 1_048_576).toFixed(1)} MB{state.totalBytes ? ` of ${(state.totalBytes / 1_048_576).toFixed(1)} MB` : " received"}</p>
      </div>}
      {state.notes && <details><summary>What’s new</summary><p style={{ whiteSpace: "pre-wrap" }}>{state.notes}</p></details>}
      <div className="settings-update-actions">
        <GButton size="sm" disabled={busy || appUpdates.hasDownloaded() || state.restartPending} onClick={() => { void appUpdates.check(true); }}><RefreshCw size={16} /> Check for updates</GButton>
        {state.desktop && state.version && !appUpdates.hasDownloaded() && <GButton size="sm" variant="primary" disabled={busy} onClick={() => { void appUpdates.download(); }}><Download size={16} /> Download update</GButton>}
        {canApply && <GButton size="sm" variant="primary" disabled={busy} onClick={apply}><ShieldCheck size={16} /> {canContinueWithVerifiedSave ? "Confirm and refresh" : state.desktop ? (state.restartPending ? "Save and restart" : "Install and restart") : canRefreshWithoutVerifiedSave ? "Retry save and refresh" : "Save and refresh"}</GButton>}
        {canContinueWithVerifiedSave && <GButton size="sm" disabled={busy} onClick={requestApplyUpdate}><RefreshCw size={16} /> Retry full backup</GButton>}
        {canRefreshWithoutVerifiedSave && <GButton size="sm" disabled={busy} aria-describedby="update-unverified-save-warning" onClick={requestApplyUpdateWithoutVerifiedSave}><RefreshCw size={16} /> Refresh anyway</GButton>}
        {state.version && !busy && <GButton size="sm" onClick={() => appUpdates.defer()}>Remind me next time</GButton>}
      </div>
      {state.deferred && <p className="sub">Reminder deferred for this app session. You can still update here.</p>}
      {state.desktop && (
        <label className="row gap8 sub">
          <input type="checkbox" checked={autoDownload} onChange={(event) => writeUpdatePreferences({ autoDownload: event.target.checked })} />
          Download updates in the background (installing always waits for you)
        </label>
      )}
      <p className="settings-update-note">AXOM normally saves and verifies your workspace before updating. If only an extra recovery copy fails, a confirmed web refresh can use the verified save. After a primary-save failure, refreshing without verification requires separate confirmation and may lose recent changes.</p>
      <Suspense fallback={<p className="sub">Loading release notes…</p>}><ReleaseNotesHistory /></Suspense>
    </section>
  );
}
