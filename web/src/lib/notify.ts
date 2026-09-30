// OS chrome belongs to the OS. AXOM supplies concise copy, permission-aware
// delivery, event identity and an allowlisted destination where clicks exist.
export type NotifyPermission = "granted" | "denied" | "default" | "unavailable";
export type NotificationRoute = "productivity" | "questions" | "step" | "soundscapes" | "dashboard";
export interface NotifyOptions {
  tag?: string;
  silent?: boolean;
  route?: NotificationRoute;
  action?: "rest";
  /** Stable event identity survives route remounts and reloads on this device. */
  dedupeKey?: string;
  sound?: "Ping" | "Blow" | "Glass";
}
const HISTORY_KEY = "axom.notifications.sent.v1";
const inFlight = new Set<string>();
const ROUTES = new Set<NotificationRoute>(["productivity", "questions", "step", "soundscapes", "dashboard"]);

function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
async function desktopPlugin() { return import("@tauri-apps/plugin-notification"); }

export function notificationDestination(value: unknown): Pick<NotifyOptions, "route" | "action"> {
  if (!value || typeof value !== "object") return {};
  const data = value as Record<string, unknown>;
  return { route: ROUTES.has(data.route as NotificationRoute) ? data.route as NotificationRoute : undefined, action: data.action === "rest" ? "rest" : undefined };
}
export function openNotificationDestination(value: unknown): void {
  const destination = notificationDestination(value);
  if (destination.route) location.hash = destination.route;
  window.dispatchEvent(new CustomEvent("axom:notification-open", { detail: destination }));
}
function readHistory(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}");
    return raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([, at]) => typeof at === "number" && Date.now() - at < 86_400_000)) : {};
  } catch { return {}; }
}

export async function notificationPermission(): Promise<NotifyPermission> {
  try {
    if (isDesktop()) return (await (await desktopPlugin()).isPermissionGranted()) ? "granted" : "default";
    if (typeof Notification === "undefined") return "unavailable";
    return Notification.permission;
  } catch { return "unavailable"; }
}

/** Call only from an explicit notification enable button. */
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
  } catch { return "unavailable"; }
}

export async function notify(title: string, body?: string, options: NotifyOptions = {}): Promise<boolean> {
  const key = options.dedupeKey ?? `${options.tag ?? "notice"}:${title}:${body ?? ""}`;
  const history = readHistory();
  const recent = history[key];
  if (inFlight.has(key) || (recent !== undefined && Date.now() - recent < (options.dedupeKey ? 86_400_000 : 30_000))) return false;
  inFlight.add(key);
  try {
    if (isDesktop()) {
      const plugin = await desktopPlugin();
      if (!(await plugin.isPermissionGranted())) return false;
      // Desktop Tauri 2.5 does not emit action events or deliver extra payload.
      // Do not claim arbitrary desktop notification deep links are supported.
      plugin.sendNotification({ title, body, sound: options.silent ? undefined : options.sound });
    } else {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      const data = notificationDestination(options);
      const notificationOptions: NotificationOptions = { body, tag: options.tag, silent: options.silent, icon: `${import.meta.env.BASE_URL}icon-192.png`, data };
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
      if (registration?.active && typeof registration.showNotification === "function") {
        await registration.showNotification(title, notificationOptions);
      } else {
        const shown = new Notification(title, notificationOptions);
        shown.onclick = () => { window.focus(); openNotificationDestination(data); shown.close(); };
      }
    }
    history[key] = Date.now();
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(Object.entries(history).sort((a, b) => b[1] - a[1]).slice(0, 200)))); } catch { /* delivery remains available without storage */ }
    return true;
  } catch { return false; }
  finally { inFlight.delete(key); }
}
