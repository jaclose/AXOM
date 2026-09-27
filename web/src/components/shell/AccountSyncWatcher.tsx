import { useEffect } from "react";
import { deviceLabel, platformName, useAccount } from "../../lib/account/accountStore";
import { SyncCoordinator } from "../../lib/sync/syncCoordinator";
import { SupabaseSyncTransport } from "../../lib/sync/supabaseTransport";
import { deviceId, read } from "../../lib/sync/syncMetadata";
import { useStore } from "../../lib/store";

/** Debounce for background protection after the last change. */
const SYNC_DELAY_MS = 8000;

/**
 * App-root owner of background protection. Before this existed, uploads only
 * ran while Settings → Account was open; now a linked, signed-in workspace is
 * protected on every page, resumes after reloads, and retries when the
 * network returns. Renders nothing.
 */
export function AccountSyncWatcher() {
  const phase = useAccount((state) => state.phase);
  const link = useAccount((state) => state.link);
  const userId = useAccount((state) => state.user?.id);

  useEffect(() => {
    useAccount.getState().init();
  }, []);

  useEffect(() => {
    if (phase !== "signed-in" || link !== "linked" || !userId) return;
    const meta = read();
    const transport = new SupabaseSyncTransport();
    const initial = meta.conflictServerRevision !== undefined ? "conflict" : meta.pending ? "saved-locally" : meta.lastProtectedAt ? "protected" : "saved-locally";
    const coordinator = new SyncCoordinator(transport, () => useStore.getState(), SYNC_DELAY_MS, initial);
    useAccount.getState().attachCoordinator(coordinator);
    const offStatus = coordinator.subscribe((status) => {
      const current = read();
      useAccount.setState({
        protection: status,
        lastProtectedAt: current.lastProtectedAt,
        conflictServerRevision: current.conflictServerRevision,
      });
    });
    let previous = useStore.getState();
    const offStore = useStore.subscribe((state) => {
      if (state === previous) return;
      previous = state;
      coordinator.queue();
    });
    const onOnline = () => coordinator.reconnect();
    window.addEventListener("online", onOnline);
    if (meta.pending) coordinator.reconnect();
    void transport.touchDevice({ deviceId: deviceId(), label: deviceLabel(), platform: platformName(), revision: meta.baseRevision }).catch(() => undefined);
    return () => {
      offStatus();
      offStore();
      window.removeEventListener("online", onOnline);
      coordinator.dispose();
      useAccount.getState().attachCoordinator(null);
    };
  }, [link, phase, userId]);

  return null;
}
