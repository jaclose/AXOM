import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, BookText, CheckCheck, CircleAlert, LoaderCircle, Mail, MessageSquareText, RefreshCw, X } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useCommunications, type CommunicationsSettings } from "../../lib/communications/client";
import { CATEGORIES, TEMPLATE_CATEGORY } from "../../lib/communications/model";
import { ICON_SIZE } from "../../lib/iconSize";
import { normalizeJournalNotebookPreferences } from "../../lib/journalNotebook";
import { localNoticeCopy, localNoticeJournalDay, readLocalNotices, recordLocalNotice, subscribeLocalNotices, type LocalNotice } from "../../lib/notificationInbox";
import { gotoJournalDay } from "../../lib/uiStore";
import { useStore } from "../../lib/store";
import { GButton, GhostButton } from "../ui/primitives";
import "../../styles/dashboard-inbox.css";

type CommunicationRecord = CommunicationsSettings["history"][number];
const READ_KEY = "axom.communicationReads.v1";
const LOCAL_READ_KEY = "axom.notificationReads.v1";
const VISIBLE_STATUSES = new Set(["sent", "delivered", "failed", "bounced", "complained", "suppressed"]);
const ATTENTION_TYPES = new Set([
  "security",
  "export_ready",
  "deletion_requested",
  "deletion_scheduled",
  "deletion_completed",
]);

function storageKey(userId: string) {
  return `${READ_KEY}:${userId}`;
}
function readIds(userId: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-200) : []);
  } catch {
    return new Set();
  }
}

function writeIds(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...ids].slice(-200)));
  } catch {
    // Read markers are optional device courtesy state, never account data.
  }
}

function readLocalIds(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_READ_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-100) : []);
  } catch { return new Set(); }
}

function writeLocalIds(ids: Set<string>) {
  try { localStorage.setItem(LOCAL_READ_KEY, JSON.stringify([...ids].slice(-100))); }
  catch { /* Device-only read markers are optional. */ }
}

function readToken(item: CommunicationRecord): string {
  const outcome = ["failed", "bounced", "complained", "suppressed"].includes(item.status)
    ? item.status
    : "delivered";
  return `${item.id}:${outcome}`;
}

function needsAttention(item: CommunicationRecord): boolean {
  return !["sent", "delivered"].includes(item.status) || ATTENTION_TYPES.has(item.type);
}

function prioritizeHistory(outcomes: CommunicationRecord[], read: Set<string>): CommunicationRecord[] {
  const unreadAttention = outcomes.filter((item) => needsAttention(item) && !read.has(readToken(item)));
  const prioritizedIds = new Set(unreadAttention.map((item) => item.id));
  return [...unreadAttention, ...outcomes.filter((item) => !prioritizedIds.has(item.id))].slice(0, 8);
}

function communicationTitle(type: string): string {
  const category = TEMPLATE_CATEGORY[type as keyof typeof TEMPLATE_CATEGORY];
  if (category && Object.hasOwn(CATEGORIES, category)) return CATEGORIES[category as keyof typeof CATEGORIES].label;
  const labels: Record<string, string> = {
    welcome: "Welcome to AXOM",
    auth: "Account sign-in",
    security: "Security notice",
    export_requested: "Account export requested",
    export_ready: "Account export ready",
    deletion_requested: "Account deletion requested",
    deletion_scheduled: "Account deletion scheduled",
    deletion_cancelled: "Account deletion cancelled",
    deletion_completed: "Account deletion completed",
  };
  return labels[type] ?? "AXOM communication";
}

function statusLabel(status: string): string {
  if (status === "delivered") return "Delivered";
  if (status === "sent") return "Sent";
  if (status === "bounced") return "Delivery bounced";
  if (status === "complained") return "Marked as unwanted";
  if (status === "suppressed") return "Delivery paused";
  return "Delivery needs attention";
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function DashboardNotificationCenter() {
  const userId = useAccount((state) => state.user?.id ?? "");
  const journal = useStore((state) => state.journal);
  const notebook = useStore((state) => state.profile.journalNotebook);
  const updateProfile = useStore((state) => state.updateProfile);
  const remote = useCommunications();
  const [open, setOpen] = useState(false);
  const [mobilePanelTop, setMobilePanelTop] = useState(0);
  const [read, setRead] = useState<Set<string>>(() => userId ? readIds(userId) : new Set());
  const [localNotices, setLocalNotices] = useState<LocalNotice[]>(readLocalNotices);
  const [localRead, setLocalRead] = useState<Set<string>>(readLocalIds);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const outcomes = useMemo(
    () => (remote.data?.history ?? []).filter((item) => VISIBLE_STATUSES.has(item.status)),
    [remote.data?.history],
  );
  const history = prioritizeHistory(outcomes, read);
  const visibleLocalNotices = localNotices.filter((item) => item.kind !== "journal-catch-up" || !localRead.has(item.id));
  const unread = outcomes.filter((item) => !read.has(readToken(item))).length;
  const attentionUnread = outcomes.filter((item) => needsAttention(item) && !read.has(readToken(item))).length;
  const localUnread = localNotices.filter((item) => !localRead.has(item.id)).length;
  const badgeCount = attentionUnread + localUnread;

  useEffect(() => subscribeLocalNotices(() => {
    setLocalNotices(readLocalNotices());
    setLocalRead(readLocalIds());
  }), []);

  useEffect(() => {
    if (!journal.some((entry) => entry.notebookStatus === "complete")) return;
    const preferences = normalizeJournalNotebookPreferences(notebook);
    if (preferences.feedbackPrompted) return;
    recordLocalNotice("journal-feedback:first-page", "journal-feedback");
    updateProfile({ journalNotebook: { ...preferences, feedbackPrompted: true } });
  }, [journal, notebook, updateProfile]);

  useEffect(() => {
    setRead(userId ? readIds(userId) : new Set());
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const positionPanel = () => {
      const bottom = rootRef.current?.getBoundingClientRect().bottom ?? 0;
      setMobilePanelTop(Math.max(12, Math.min(bottom + 8, window.innerHeight - 280)));
    };
    positionPanel();
    panelRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      window.setTimeout(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body || !document.contains(focused)) buttonRef.current?.focus();
      }, 0);
    };
    const closeAfterFocusLeaves = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeAfterFocusLeaves);
    document.addEventListener("keydown", closeWithEscape);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeAfterFocusLeaves);
      document.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open]);

  function markRead(items: CommunicationRecord[]) {
    if (!userId) return;
    const next = new Set(read);
    [...items].reverse().forEach((item) => next.add(readToken(item)));
    writeIds(userId, next);
    setRead(next);
  }

  function markLocalRead(items: LocalNotice[]) {
    const next = new Set(localRead);
    items.forEach((item) => next.add(item.id));
    writeLocalIds(next);
    setLocalRead(next);
  }

  return (
    <div className="dashboard-notifications" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ghost-btn icon-only dashboard-notifications__trigger"
        aria-label={badgeCount ? `Notifications, ${badgeCount} ${badgeCount === 1 ? "item needs" : "items need"} attention` : "Notifications"}
        title="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => { setLocalNotices(readLocalNotices()); setOpen((value) => !value); }}
      >
        <Bell size={ICON_SIZE.emphasis} aria-hidden="true" />
        {badgeCount > 0 && <span className="dashboard-notifications__badge" aria-hidden="true">{badgeCount > 9 ? "9+" : badgeCount}</span>}
      </button>
      {open && (
        <section
          id={panelId}
          ref={panelRef}
          className="dashboard-notifications__panel"
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          style={{ "--dashboard-notifications-top": `${mobilePanelTop}px` } as CSSProperties}
        >
          <header>
            <div><span>Inbox</span><h2>Notifications</h2></div>
            <div className="dashboard-notifications__header-actions">
              {unread + localUnread > 0 && <GhostButton onClick={() => { markRead(outcomes); markLocalRead(localNotices); }}><CheckCheck size={ICON_SIZE.body} aria-hidden="true" /> Mark all read</GhostButton>}
              <GhostButton className="dashboard-notifications__close" aria-label="Close notifications" onClick={() => { setOpen(false); buttonRef.current?.focus(); }}>
                <X size={ICON_SIZE.body} aria-hidden="true" />
              </GhostButton>
            </div>
          </header>
          <div className="dashboard-notifications__body" aria-live="polite">
            {visibleLocalNotices.length > 0 && <div className="dashboard-notifications__group-label">On this device</div>}
            {visibleLocalNotices.length > 0 && <ul className="dashboard-notifications__list dashboard-notifications__list--local" aria-label="Learning and journal prompts">
              {visibleLocalNotices.map((item) => {
                const copy = localNoticeCopy(item.kind, item.id);
                const unreadItem = !localRead.has(item.id);
                const Icon = item.kind === "journal-feedback" ? MessageSquareText : BookText;
                return <li key={item.id} data-kind={item.kind} className={unreadItem ? "is-unread" : ""}>
                  <a href={copy.href} onClick={(event) => {
                    markLocalRead([item]);
                    const targetDay = localNoticeJournalDay(item);
                    if (targetDay) {
                      event.preventDefault();
                      gotoJournalDay(targetDay);
                      setOpen(false);
                    }
                  }}>
                    <span aria-hidden="true"><Icon size={ICON_SIZE.body} /></span>
                    <span><b>{copy.title}</b><small>{copy.body} · {relativeTime(item.createdAt)}</small>{unreadItem && <span className="sr-only"> Unread.</span>}</span>
                    {unreadItem && <i aria-hidden="true" />}
                  </a>
                  {item.kind === "journal-catch-up" && <button type="button" className="dashboard-notifications__dismiss" aria-label="Dismiss yesterday reminder" onClick={() => markLocalRead([item])}>Dismiss</button>}
                </li>;
              })}
            </ul>}
            {remote.loading && (
              <div className="dashboard-notifications__state" role="status"><LoaderCircle className="is-spinning" size={ICON_SIZE.display} aria-hidden="true" /><b>Checking your inbox</b><span>This will only take a moment.</span></div>
            )}
            {!remote.loading && !userId && (
              <div className="dashboard-notifications__state"><Bell size={ICON_SIZE.display} aria-hidden="true" /><b>Sign in for account notices</b><span>Your journal prompts stay on this device.</span></div>
            )}
            {!remote.loading && userId && remote.error && (
              <div className="dashboard-notifications__state"><CircleAlert size={ICON_SIZE.display} aria-hidden="true" /><b>Inbox unavailable</b><span>{remote.error}</span><GButton size="sm" onClick={() => void remote.reload()}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Try again</GButton></div>
            )}
            {!remote.loading && userId && !remote.error && !history.length && !visibleLocalNotices.length && (
              <div className="dashboard-notifications__state"><Bell size={ICON_SIZE.display} aria-hidden="true" /><b>Nothing needs your attention</b><span>Important account and learning communications will appear here.</span></div>
            )}
            {!remote.loading && userId && !remote.error && history.length > 0 && (
              <><div className="dashboard-notifications__group-label">Account email</div><ul className="dashboard-notifications__list">
                {history.map((item) => {
                  const unreadItem = !read.has(readToken(item));
                  const attentionItem = needsAttention(item);
                  return (
                    <li key={item.id} className={unreadItem ? "is-unread" : ""}>
                      <a href="#communications" onClick={() => markRead([item])}>
                        <span className={attentionItem ? "is-attention" : ""} aria-hidden="true">{attentionItem ? <CircleAlert size={ICON_SIZE.body} /> : <Mail size={ICON_SIZE.body} />}</span>
                        <span><b>{communicationTitle(item.type)}</b><small>{statusLabel(item.status)} · {relativeTime(item.sent_at ?? item.created_at)}</small>{unreadItem && <span className="sr-only"> Unread.</span>}</span>
                        {unreadItem && <i aria-hidden="true" />}
                      </a>
                    </li>
                  );
                })}
              </ul></>
            )}
          </div>
          <footer><a href="#communications" onClick={() => markRead(outcomes)}>Email preferences and history <span aria-hidden="true">→</span></a></footer>
        </section>
      )}
    </div>
  );
}
