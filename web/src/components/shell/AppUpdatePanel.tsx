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
  if (window.confirm(prompt)) void appUpdates.apply();
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
    preparing: "Saving your workspace and verifying a recovery snapshot…",
    installing: "Installing the update. Keep AXOM open until it restarts.",
    restarting: "Update ready. Restarting AXOM…",
    disabled: state.error ?? "Updates are unavailable for this build.",
    error: state.error ?? "The update could not finish. Try again later.",
  };
  const apply = requestApplyUpdate;
  return (
    <div className="backup-actions-panel" aria-busy={busy}>
      <div className="sync-title">App updates</div>
      <p className="sub">{state.desktop ? "Desktop app" : "Web app"} · v{APP_RELEASE_VERSION}</p>
      <p role={state.phase === "error" ? "alert" : "status"}>{status[state.phase]}</p>
      {state.restartPending && state.phase === "error" && <p className="sub">The update is already prepared. Retry the restart below; it will save your current workspace again without reinstalling.</p>}
      {state.lastChecked && <p className="sub">Last checked: {new Date(state.lastChecked).toLocaleString()}</p>}
      {state.phase === "downloading" && <div>
        <progress aria-label="Update download" value={state.totalBytes ? state.downloadedBytes : undefined} max={state.totalBytes ?? 1} style={{ width: "100%" }} />
        <p className="sub">{(state.downloadedBytes / 1_048_576).toFixed(1)} MB{state.totalBytes ? ` of ${(state.totalBytes / 1_048_576).toFixed(1)} MB` : " received"}</p>
      </div>}
      {state.notes && <details><summary>What’s new</summary><p style={{ whiteSpace: "pre-wrap" }}>{state.notes}</p></details>}
      <div className="row wrap gap8">
        <GButton size="sm" disabled={busy || appUpdates.hasDownloaded() || state.restartPending} onClick={() => { void appUpdates.check(true); }}><RefreshCw size={16} /> Check for updates</GButton>
        {state.desktop && state.version && !appUpdates.hasDownloaded() && <GButton size="sm" variant="primary" disabled={busy} onClick={() => { void appUpdates.download(); }}><Download size={16} /> Download update</GButton>}
        {canApply && <GButton size="sm" variant="primary" disabled={busy} onClick={apply}><ShieldCheck size={16} /> {state.desktop ? (state.restartPending ? "Save and restart" : "Install and restart") : "Save and refresh"}</GButton>}
        {state.version && !busy && <GButton size="sm" onClick={() => appUpdates.defer()}>Remind me next time</GButton>}
      </div>
      {state.deferred && <p className="sub">Reminder deferred for this app session. You can still update here.</p>}
      {state.desktop && (
        <label className="row gap8 sub">
          <input type="checkbox" checked={autoDownload} onChange={(event) => writeUpdatePreferences({ autoDownload: event.target.checked })} />
          Download updates in the background (installing always waits for you)
        </label>
      )}
      <p className="sub">Your local workspace stays on this device. Before applying an update, AXOM verifies a workspace snapshot. Portable backups in Settings also include question-image attachments.</p>
      <Suspense fallback={<p className="sub">Loading release notes…</p>}><ReleaseNotesHistory /></Suspense>
    </div>
  );
}
