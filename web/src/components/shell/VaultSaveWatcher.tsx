import { useEffect } from "react";
import { exportStateWithAttachments } from "../../lib/backup";
import { useStore } from "../../lib/store";
import { pushToast } from "../../lib/toast";
import { VAULT_WRITE_FAILURE_EVENT, readVaultWriteFailure } from "../../lib/vaultActivity";

/**
 * Says so when a save reaches no storage on this device. Ordinary saves are
 * best-effort, so before this the workspace could stop saving with no sign
 * beyond a "Saved at" time in Settings that had stopped moving. The notice
 * stays until it is dismissed and offers an export of the current workspace.
 * Form-local drafts and disputed storage versions are not included. Renders nothing.
 */
export function VaultSaveWatcher() {
  useEffect(() => {
    function warn() {
      pushToast({
        title: "AXOM could not save on this device",
        body: "AXOM could not confirm the latest save. Export the current workspace, and separately copy any open drafts. This backup may exclude disputed stored versions and unsaved form entries.",
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
