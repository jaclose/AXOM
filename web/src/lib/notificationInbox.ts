/** Device-only receipts for AXOM's own learning prompts. No journal text is stored. */
export type LocalNoticeKind = "check-in" | "closeout" | "journal-catch-up" | "journal-feedback" | "study-reminder" | "rest-reminder" | "productivity-freeze" | "daily-word-freeze" | "doctordle-freeze";
export interface LocalNotice {
  id: string;
  kind: LocalNoticeKind;
  createdAt: string;
}

const KEY = "axom.notificationInbox.v1";
const EVENT = "axom:notification-inbox-changed";
const kinds = new Set<LocalNoticeKind>(["check-in", "closeout", "journal-catch-up", "journal-feedback", "study-reminder", "rest-reminder", "productivity-freeze", "daily-word-freeze", "doctordle-freeze"]);

export function localNoticeCopy(kind: LocalNoticeKind, noticeId?: string): { title: string; body: string; href: string } {
  const frozenDate = noticeId?.match(/^streak:(?:productivity-freeze|daily-word-freeze):(\d{4}-\d{2}-\d{2})$/)?.[1];
  const frozenCase = noticeId?.match(/^streak:doctordle-freeze:(\d+)$/)?.[1];
  if (kind === "productivity-freeze") return {
    title: "Your study streak was protected",
    body: `${frozenDate ? `A freeze covered ${frozenDate}.` : "One missed day was covered."} Return to your goals today when you can.`,
    href: "#productivity",
  };
  if (kind === "daily-word-freeze") return {
    title: "Your Daily Word streak was protected",
    body: `${frozenDate ? `A freeze covered ${frozenDate}.` : "One missed word was covered."} Today's puzzle is ready when you are.`,
    href: "#daily-word",
  };
  if (kind === "doctordle-freeze") return {
    title: "Your Doctordle check-in streak was protected",
    body: `${frozenCase ? `A freeze covered case #${frozenCase}.` : "One missed check-in was covered."} AXOM only counts the result you report.`,
    href: "#doctordle",
  };
  if (kind === "check-in") return {
    title: "Give today a direction",
    body: "Choose one intention. You can change it as the day unfolds.",
    href: "#dashboard",
  };
  if (kind === "closeout") return {
    title: "Before the day closes",
    body: "Keep one thing, release one thing, or simply close the page.",
    href: "#journal",
  };
  if (kind === "journal-catch-up") return {
    title: "Yesterday is still open",
    body: "Return to the page whenever you want. A day can be written after it ends.",
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

/** IDs carry a date only; no journal writing or study detail is kept in notices. */
export function localNoticeJournalDay(notice: LocalNotice): string | null {
  if (notice.kind === "journal-catch-up") return /^journal-catch-up:(\d{4}-\d{2}-\d{2})$/.exec(notice.id)?.[1] ?? null;
  if (notice.kind === "closeout") return /^daily-loop:(\d{4}-\d{2}-\d{2}):closeout$/.exec(notice.id)?.[1] ?? null;
  return null;
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
