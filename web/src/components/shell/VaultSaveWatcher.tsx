import { useEffect } from "react";
import { exportStateWithAttachments } from "../../lib/backup";
import { useStore } from "../../lib/store";
import { pushToast } from "../../lib/toast";
import { VAULT_WRITE_FAILURE_EVENT, readVaultWriteFailure } from "../../lib/vaultActivity";

/**
 * Says so when a save reaches no storage on this device. Ordinary saves are
 * best-effort, so before this the workspace could stop saving with no sign
 * beyond a "Saved at" time in Settings that had stopped moving. The notice
 * stays until it is dismissed, and offers the one action that keeps the work:
 * a backup file made from what is open now. Renders nothing.
 */
export function VaultSaveWatcher() {
  useEffect(() => {
    function warn() {
      pushToast({
        title: "AXOM could not save on this device",
        body: "Your latest changes are still open here but are not stored yet. Export a backup now so nothing is lost.",
        tone: "warn",
        duration: 0,
        dedupe: "vault-write-failure",
        actions: [{
          label: "Export backup",
          onAction: () => { void exportStateWithAttachments(useStore.getState()); },
        }],
      });
    }
    // A save can fail before this mounts (the first write after opening).
    if (readVaultWriteFailure()) warn();
    window.addEventListener(VAULT_WRITE_FAILURE_EVENT, warn);
    return () => window.removeEventListener(VAULT_WRITE_FAILURE_EVENT, warn);
  }, []);
  return null;
}
