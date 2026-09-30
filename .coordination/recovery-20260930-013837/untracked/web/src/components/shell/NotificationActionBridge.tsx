import { useEffect } from "react";
import { notificationDestination, openNotificationDestination } from "../../lib/notify";
import { useRest } from "../../lib/rest";

/** Browser and service-worker click handoff. Native Tauri desktop has no onAction event. */
export function NotificationActionBridge() {
  useEffect(() => {
    const open = (event: Event) => {
      const destination = notificationDestination((event as CustomEvent<unknown>).detail);
      if (destination.action === "rest" && useRest.getState().status !== "idle") useRest.getState().setOverlayOpen(true);
    };
    const message = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("type" in event.data) || event.data.type !== "AXOM_NOTIFICATION_OPEN") return;
      openNotificationDestination(event.data);
    };
    window.addEventListener("axom:notification-open", open);
    navigator.serviceWorker?.addEventListener("message", message);
    const url = new URL(location.href);
    if (url.searchParams.get("axomRest") === "1") {
      url.searchParams.delete("axomRest");
      history.replaceState(history.state, "", url);
      openNotificationDestination({ route: "productivity", action: "rest" });
    }
    return () => {
      window.removeEventListener("axom:notification-open", open);
      navigator.serviceWorker?.removeEventListener("message", message);
    };
  }, []);
  return null;
}
