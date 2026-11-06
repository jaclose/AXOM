import { useSyncExternalStore } from "react";
import { readLastVaultWrite, readVaultWriteFailure, VAULT_WRITE_EVENT, VAULT_WRITE_FAILURE_EVENT } from "../../lib/vaultActivity";

function subscribe(callback: () => void) {
  window.addEventListener(VAULT_WRITE_EVENT, callback);
  window.addEventListener(VAULT_WRITE_FAILURE_EVENT, callback);
  return () => { window.removeEventListener(VAULT_WRITE_EVENT, callback); window.removeEventListener(VAULT_WRITE_FAILURE_EVENT, callback); };
}
function snapshot() { return readVaultWriteFailure() ? "failed" : readLastVaultWrite()?.at ?? "pending"; }
export function useProductivitySaveStatus() { return useSyncExternalStore(subscribe, snapshot, () => "pending"); }
export function ProductivitySaveStatus({ status }: { status: string }) {
  return <p className="productivity-save" role="status">{status === "failed" ? "Save failed. Check Settings." : status === "pending" ? "Waiting for a local save" : `Saved on this device at ${new Date(status).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}</p>;
}
