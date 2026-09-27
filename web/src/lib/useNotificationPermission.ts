import { useCallback, useEffect, useState } from "react";
import { notificationPermission, requestNotificationPermission, type NotifyPermission } from "./notify";

/** Current system-notification permission for this shell, plus a request action. */
export function useNotificationPermission(): [NotifyPermission, () => Promise<NotifyPermission>] {
  const [permission, setPermission] = useState<NotifyPermission>(() => (
    typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && typeof Notification !== "undefined"
      ? Notification.permission
      : typeof Notification === "undefined" && !(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) ? "unavailable" : "default"
  ));
  useEffect(() => {
    let active = true;
    void notificationPermission().then((value) => { if (active) setPermission(value); });
    return () => { active = false; };
  }, []);
  const request = useCallback(async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    return next;
  }, []);
  return [permission, request];
}
