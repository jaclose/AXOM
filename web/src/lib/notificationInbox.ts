/** Device-only receipts for AXOM's own learning prompts. No journal text is stored. */
export type LocalNoticeKind = "check-in" | "closeout" | "journal-feedback" | "study-reminder" | "rest-reminder";
export interface LocalNotice {
  id: string;
  kind: LocalNoticeKind;
  createdAt: string;
}

const KEY = "axom.notificationInbox.v1";
const EVENT = "axom:notification-inbox-changed";
const kinds = new Set<LocalNoticeKind>(["check-in", "closeout", "journal-feedback", "study-reminder", "rest-reminder"]);

export function localNoticeCopy(kind: LocalNoticeKind): { title: string; body: string; href: string } {
  if (kind === "check-in") return {
    title: "Give today a direction",
    body: "Choose one intention. You can change it as the day unfolds.",
    href: "#dashboard",
  };
  if (kind === "closeout") return {
    title: "A page before the day ends",
    body: "Keep what mattered, note what changed, and leave a first step for tomorrow.",
    href: "#journal",
  };
  if (kind === "rest-reminder") return {
    title: "Rest is over",
    body: "Return when you are ready. Your study timer is waiting.",
    href: "#productivity",
  };
  if (kind === "study-reminder") return {
    title: "Study reminder",
    body: "A cue from your AXOM study session.",
    href: "#productivity",
  };
  return {
    title: "How does the journal feel?",
    body: "Rate the experience and tell us what to keep, improve, or add. Your writing stays private.",
    href: "#journal?feedback=1",
  };
}

export function readLocalNotices(): LocalNotice[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is LocalNotice => item !== null && typeof item === "object"
      && typeof item.id === "string" && item.id.length <= 100
      && kinds.has(item.kind) && typeof item.createdAt === "string"
      && Number.isFinite(Date.parse(item.createdAt)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  } catch { return []; }
}

export function recordLocalNotice(id: string, kind: LocalNoticeKind, at = new Date()): void {
  if (!id || id.length > 100 || !kinds.has(kind) || !Number.isFinite(at.getTime())) return;
  const existing = readLocalNotices();
  if (existing.some((item) => item.id === id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([{ id, kind, createdAt: at.toISOString() }, ...existing].slice(0, 40)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* The reminder itself still works when device storage is unavailable. */ }
}

export function subscribeLocalNotices(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
