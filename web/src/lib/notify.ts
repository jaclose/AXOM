// ===========================================================================
// System notifications for both shells. The desktop app's webview has no web
// Notification API, so Tauri's notification plugin carries lock-in check-ins,
// sprint completions and the rest alarm to macOS/Windows notification centres;
// browsers use the standard Notification API. Every call fails soft: a denied
// or unavailable permission never throws into the caller.
// ===========================================================================

export type NotifyPermission = "granted" | "denied" | "default" | "unavailable";

function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function desktopPlugin() {
  return import("@tauri-apps/plugin-notification");
}

export async function notificationPermission(): Promise<NotifyPermission> {
  try {
    if (isDesktop()) return (await (await desktopPlugin()).isPermissionGranted()) ? "granted" : "default";
    if (typeof Notification === "undefined") return "unavailable";
    return Notification.permission;
  } catch {
    return "unavailable";
  }
}

/** Ask once, from a user gesture. Returns the resulting permission. */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  try {
    if (isDesktop()) {
      const plugin = await desktopPlugin();
      if (await plugin.isPermissionGranted()) return "granted";
      const result = await plugin.requestPermission();
      return result === "granted" ? "granted" : result === "denied" ? "denied" : "default";
    }
    if (typeof Notification === "undefined") return "unavailable";
    return await Notification.requestPermission();
  } catch {
    return "unavailable";
  }
}

/** Show a system notification if permitted. Resolves true when one was shown. */
export async function notify(title: string, body?: string, options: { tag?: string; silent?: boolean } = {}): Promise<boolean> {
  try {
    if (isDesktop()) {
      const plugin = await desktopPlugin();
      if (!(await plugin.isPermissionGranted())) return false;
      plugin.sendNotification({ title, body });
      return true;
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const shown = new Notification(title, { body, tag: options.tag, silent: options.silent, icon: `${import.meta.env.BASE_URL}icon-192.png` });
    shown.onclick = () => { window.focus(); shown.close(); };
    return true;
  } catch {
    return false;
  }
}
