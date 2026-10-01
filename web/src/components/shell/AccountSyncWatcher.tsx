import { useEffect } from "react";
import { deviceLabel, platformName, protectionView, useAccount } from "../../lib/account/accountStore";
import { useCompactAvatar } from "../../lib/avatarImage";
import { SyncCoordinator } from "../../lib/sync/syncCoordinator";
import { SupabaseSyncTransport } from "../../lib/sync/supabaseTransport";
import { SYNC_METADATA_KEY, deviceId, read } from "../../lib/sync/syncMetadata";
import { restingStatus } from "../../lib/sync/syncPolicy";
import { useStore } from "../../lib/store";

/** Debounce for background protection after the last change. */
const SYNC_DELAY_MS = 8000;

/**
 * App-root owner of background protection. Before this existed, uploads only
 * ran while Settings → Account was open; now a linked, signed-in workspace is
 * protected on every page, resumes after reloads, and retries when the
 * network returns. How often it may upload, and when it stops repeating a
 * failed upload, is decided in lib/sync/syncPolicy.ts. Renders nothing.
 */
export function AccountSyncWatcher() {
  const phase = useAccount((state) => state.phase);
  const link = useAccount((state) => state.link);
  const userId = useAccount((state) => state.user?.id);
  // Lives here because this is the always-mounted owner of what gets uploaded;
  // it also keeps local saves and backup files small without an account.
  useCompactAvatar();

  useEffect(() => {
    useAccount.getState().init();
  }, []);

  useEffect(() => {
    if (phase !== "signed-in" || link !== "linked" || !userId) return;
    const meta = read();
    const transport = new SupabaseSyncTransport();
    const coordinator = new SyncCoordinator(transport, () => useStore.getState(), SYNC_DELAY_MS, restingStatus(meta));
    useAccount.getState().attachCoordinator(coordinator);
    const offStatus = coordinator.subscribe((status) => useAccount.setState(protectionView(status)));
    let previous = useStore.getState();
    const offStore = useStore.subscribe((state) => {
      if (state === previous) return;
      previous = state;
      coordinator.queue();
    });
    const onOnline = () => coordinator.reconnect();
    window.addEventListener("online", onOnline);
    // Another tab uploaded, failed or started waiting: follow the shared state.
    const onStorage = (event: StorageEvent) => {
      if (event.key === SYNC_METADATA_KEY) coordinator.adopt();
    };
    window.addEventListener("storage", onStorage);
    coordinator.resume();
    void transport.touchDevice({ deviceId: deviceId(), label: deviceLabel(), platform: platformName(), revision: meta.baseRevision }).catch(() => undefined);
    return () => {
      offStatus();
      offStore();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
      coordinator.dispose();
      useAccount.getState().attachCoordinator(null);
    };
  }, [link, phase, userId]);

  return null;
}
