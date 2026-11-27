import { useEffect } from "react";
import { exportStateWithAttachments } from "../../lib/backup";
import { useStore } from "../../lib/store";
import { pushToast, useToasts } from "../../lib/toast";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, subscribeQuestionAttachmentScope, type QuestionAttachmentScope } from "../../lib/questionAttachmentScope";
import { VAULT_WRITE_FAILURE_EVENT, readVaultWriteFailure } from "../../lib/vaultActivity";
import { takeRefreshAfterBackupNotice } from "../../lib/refreshRecovery";

const FAILURE_BODY = "Your latest changes are still open here but are not stored yet. Export a backup and keep this tab open.";
const PENDING_BODY = "Preparing a backup. Keep this tab open until the download is ready.";

/** Keep the storage warning visible even when a backup is attempted: a download
 * is not confirmation that the workspace was saved or can be restored. */
export function VaultSaveWatcher() {
  useEffect(() => {
    let active = true;
    let warningId: string | undefined;
    let pendingScope: QuestionAttachmentScope | null = null;

    function clearWarning() {
      if (warningId) useToasts.getState().dismiss(warningId);
      warningId = undefined;
    }

    function updateWarning(body: string, pending: boolean) {
      const id = warningId;
      if (!id) return;
      useToasts.setState(state => ({
        toasts: state.toasts.map(toast => toast.id === id
          ? { ...toast, body, actions: toast.actions?.map(action => ({ ...action, disabled: pending })) }
          : toast),
      }));
    }

    async function exportBackup(scope: QuestionAttachmentScope, id: string | undefined) {
      if (!active || !isQuestionAttachmentScopeCurrent(scope) || pendingScope === scope
        || !id || warningId !== id || !useToasts.getState().toasts.some(toast => toast.id === id)) return;
      pendingScope = scope;
      updateWarning(PENDING_BODY, true);
      try {
        const result = await exportStateWithAttachments(useStore.getState(), "complete");
        if (!active || !isQuestionAttachmentScopeCurrent(scope)) return;
        const incomplete = result.missingBlobKeys.length || result.missingOriginalIds.length || result.deferredSourceCount !== 0;
        updateWarning(incomplete
          ? "Backup download requested, but some files or account content are missing. Keep this tab open and retry."
          : "Backup download requested. Check that the file arrived and keep this tab open. Changes made since export began may not be included; device storage is still unconfirmed.", false);
      } catch {
        if (active && isQuestionAttachmentScopeCurrent(scope)) {
          updateWarning("The backup could not be prepared. Keep this tab open and retry.", false);
        }
      } finally {
        if (pendingScope === scope) pendingScope = null;
      }
    }

    function warn() {
      const scope = getQuestionAttachmentScope();
      const pending = pendingScope === scope;
      if (warningId && useToasts.getState().toasts.some(toast => toast.id === warningId)) {
        if (!pending) updateWarning(FAILURE_BODY, false);
        return;
      }
      pushToast({
        title: "AXOM could not save on this device",
        body: pending ? PENDING_BODY : FAILURE_BODY,
        tone: "warn",
        duration: 0,
        dedupe: "vault-write-failure",
        actions: [{
          label: "Export backup",
          keepOpen: true,
          disabled: pending,
          onAction: () => { void exportBackup(scope, id); },
        }],
      });
      const id = useToasts.getState().toasts.find(toast => toast.dedupe === "vault-write-failure")?.id;
      warningId = id;
    }
    // An old account's warning and action must not carry into the new scope.
    const unsubscribe = subscribeQuestionAttachmentScope(() => {
      pendingScope = null;
      clearWarning();
    });
    if (readVaultWriteFailure()) warn();
    // Say what just happened after "Refresh now" from a backup (RefreshAfterBackup).
    const refreshedAfter = takeRefreshAfterBackupNotice();
    if (refreshedAfter) {
      const at = new Date(refreshedAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      pushToast({
        title: "AXOM refreshed after your backup",
        body: `If anything looks older than before, merge the backup from ${at} in Settings › Emergency recovery.`,
        tone: "info",
        duration: 0,
        dedupe: "refresh-after-backup",
      });
    }
    window.addEventListener(VAULT_WRITE_FAILURE_EVENT, warn);
    return () => {
      active = false;
      unsubscribe();
      clearWarning();
      window.removeEventListener(VAULT_WRITE_FAILURE_EVENT, warn);
    };
  }, []);
  return null;
}
