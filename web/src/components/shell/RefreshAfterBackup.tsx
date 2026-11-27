import { useState, useSyncExternalStore } from "react";
import { Download, RefreshCw } from "lucide-react";
import { GButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { exportStateWithAttachments } from "../../lib/backup";
import { useStore } from "../../lib/store";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, subscribeQuestionAttachmentScope, type QuestionAttachmentScope } from "../../lib/questionAttachmentScope";
import { beginPortableBackupAttempt, lastPortableBackupAt, refreshAfterPortableBackup, subscribePortableBackup } from "../../lib/refreshRecovery";

function backupTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The way forward when AXOM cannot confirm a local save before refreshing:
 * download a complete backup of what is open, then refresh. "Refresh now"
 * re-checks that nothing changed since that download.
 */
export function RefreshAfterBackup({ intro = true }: { intro?: boolean } = {}) {
  const accountScope = useSyncExternalStore(subscribeQuestionAttachmentScope, getQuestionAttachmentScope, getQuestionAttachmentScope);
  return <ScopedRefreshAfterBackup key={accountScope.generation} intro={intro} accountScope={accountScope} />;
}

function ScopedRefreshAfterBackup({ intro, accountScope }: { intro: boolean; accountScope: QuestionAttachmentScope }) {
  const backupAt = useSyncExternalStore(subscribePortableBackup, lastPortableBackupAt, () => null);
  const [busy, setBusy] = useState<"backup" | "refresh" | null>(null);
  const [message, setMessage] = useState("");

  async function download() {
    if (!isQuestionAttachmentScopeCurrent(accountScope)) return;
    setBusy("backup");
    setMessage("");
    try {
      const state = useStore.getState();
      const finish = beginPortableBackupAttempt(state);
      const result = await exportStateWithAttachments(state, "complete");
      if (!isQuestionAttachmentScopeCurrent(accountScope)) return;
      const covered = finish(result);
      const incomplete = result.missingBlobKeys.length || result.missingOriginalIds.length || result.deferredSourceCount !== 0;
      setMessage(result.workspaceAdmissionFailed
        ? "Recovery copy requested, but AXOM cannot restore its workspace records as they are. Keep the copy and this tab open. Do not refresh."
        : incomplete
        ? "Backup downloaded, but it is incomplete. Some referenced files or account content could not be included. Keep this tab open and retry before refreshing."
        : covered
          ? "Backup downloaded. Keep the file until AXOM saves normally again."
          : "Backup downloaded, but it could not verify the current workspace. Keep the file and download a new backup before refreshing.");
    } catch (error) {
      if (isQuestionAttachmentScopeCurrent(accountScope)) setMessage(error instanceof Error ? error.message : "The backup could not be prepared. Nothing was changed.");
    } finally {
      if (isQuestionAttachmentScopeCurrent(accountScope)) setBusy(null);
    }
  }

  async function refresh() {
    if (!isQuestionAttachmentScopeCurrent(accountScope)) return;
    setBusy("refresh");
    setMessage("");
    try {
      await refreshAfterPortableBackup();
    } catch (error) {
      if (!isQuestionAttachmentScopeCurrent(accountScope)) return;
      setBusy(null);
      setMessage(error instanceof Error ? error.message : "The refresh could not start. Nothing was changed.");
    }
  }

  return (
    <div className="refresh-after-backup" role="group" aria-label="Refresh after a backup">
      {intro ? (
        <p className="sub">
          AXOM could not confirm a save on this device, so it will not refresh by itself. Download a backup of everything open now, then refresh.
          If anything looks older afterwards, open Settings › Emergency recovery and merge that backup.
        </p>
      ) : (
        <p className="sub">Safer: download a backup of everything open now, then refresh. If anything looks older afterwards, merge that backup in Settings › Emergency recovery.</p>
      )}
      <div className="route-error-actions">
        <GButton size="sm" disabled={busy !== null} onClick={() => { void download(); }}>
          <Download size={ICON_SIZE.body} /> {busy === "backup" ? "Preparing backup…" : backupAt ? "Download again" : "Download backup"}
        </GButton>
        <GButton size="sm" variant="primary" disabled={busy !== null || !backupAt} onClick={() => { void refresh(); }}>
          <RefreshCw size={ICON_SIZE.body} /> {busy === "refresh" ? "Refreshing…" : "Refresh now"}
        </GButton>
      </div>
      {backupAt && <p className="sub">Backup downloaded at {backupTime(backupAt)}.</p>}
      {message && <p role="status" className="sub">{message}</p>}
    </div>
  );
}
