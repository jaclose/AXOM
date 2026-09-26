// ===========================================================================
// Update detection (directive §6). Polls the deployed version manifest and
// shows a calm notice: local progress is never touched, reload is never forced,
// and the notice stays quiet while a study session is running. "Later" defers
// that version until the next app load.
// ===========================================================================
import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "../../lib/store";
import { findLiveSession } from "../../lib/sessions";
import { BRAND } from "../../lib/brand";
import { pushToast } from "../../lib/toast";
import { appUpdates, isDesktopApp, UPDATE_CHECK_INTERVAL } from "../../lib/appUpdates";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { Modal } from "../ui/Modal";

export function UpdateAvailableWatcher() {
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot);
  const sessions = useStore((store) => store.sessions);
  useEffect(() => {
    const check = () => { if (document.visibilityState !== "hidden") void appUpdates.check(); };
    const online = () => { appUpdates.retryConnection(); check(); };
    const manual = () => { setOpen(true); void appUpdates.check(true); };
    const chunkError = () => {
      pushToast({
        title: "This screen could not finish loading",
        body: "A newer deployment or a lost connection may be responsible. Finish unsaved edits, then review updates. Refreshing is always your choice.",
        tone: "warn", duration: 0, dedupe: "chunk-load-error",
        actionLabel: "Review updates", onAction: manual,
      });
    };
    check();
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL);
    window.addEventListener("online", online);
    window.addEventListener("axom:web-update-ready", check);
    window.addEventListener("axom:chunk-load-error", chunkError);
    window.addEventListener("axom:check-for-updates", manual);
    document.addEventListener("visibilitychange", check);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isDesktopApp()) {
      void import("@tauri-apps/api/event").then(({ listen }) => listen("axom:check-for-updates", manual)).then((stop) => {
        if (disposed) stop(); else unlisten = stop;
      }).catch(() => { /* Settings remains available if native menus fail. */ });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("axom:web-update-ready", check);
      window.removeEventListener("axom:chunk-load-error", chunkError);
      window.removeEventListener("axom:check-for-updates", manual);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    if (state.phase !== "available" || state.deferred || findLiveSession(sessions ?? [])) return;
    pushToast({
      title: `Update available — v${state.version}`,
      body: "Review what’s new and choose when to update. Your app will not restart automatically.",
      tone: "info", actionLabel: "Review update", duration: 0,
      dedupe: `app-update-${state.buildId ?? state.version}`,
      onAction: () => setOpen(true),
    });
    appUpdates.defer();
  }, [state, sessions]);
  const applying = ["preparing", "installing", "restarting"].includes(state.phase);
  return open ? <Modal title="AXOM updates" onClose={() => { if (!applying) setOpen(false); }}><AppUpdatePanel /></Modal> : null;
}

/** Exposed for the About page: what channel/product this build is. */
export const UPDATE_CHANNEL = BRAND.channel;
