import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, CheckCheck, CircleAlert, LoaderCircle, Mail, RefreshCw, X } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useCommunications, type CommunicationsSettings } from "../../lib/communications/client";
import { CATEGORIES, TEMPLATE_CATEGORY } from "../../lib/communications/model";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, GhostButton } from "../ui/primitives";
import "../../styles/dashboard-inbox.css";

type CommunicationRecord = CommunicationsSettings["history"][number];
const READ_KEY = "axom.communicationReads.v1";
const VISIBLE_STATUSES = new Set(["sent", "delivered", "failed", "bounced", "complained", "suppressed"]);

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

function readToken(item: CommunicationRecord): string {
  const outcome = ["failed", "bounced", "complained", "suppressed"].includes(item.status)
    ? item.status
    : "delivered";
  return `${item.id}:${outcome}`;
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
  const remote = useCommunications();
  const [open, setOpen] = useState(false);
  const [mobilePanelTop, setMobilePanelTop] = useState(0);
  const [read, setRead] = useState<Set<string>>(() => userId ? readIds(userId) : new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const outcomes = useMemo(
    () => (remote.data?.history ?? []).filter((item) => VISIBLE_STATUSES.has(item.status)),
    [remote.data?.history],
  );
  const history = outcomes.slice(0, 8);
  const unread = outcomes.filter((item) => !read.has(readToken(item))).length;

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
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
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

  return (
    <div className="dashboard-notifications" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ghost-btn icon-only dashboard-notifications__trigger"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={ICON_SIZE.emphasis} aria-hidden="true" />
        {unread > 0 && <span className="dashboard-notifications__badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
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
              {unread > 0 && <GhostButton onClick={() => markRead(outcomes)}><CheckCheck size={ICON_SIZE.body} aria-hidden="true" /> Mark recent read</GhostButton>}
              <GhostButton className="dashboard-notifications__close" aria-label="Close notifications" onClick={() => { setOpen(false); buttonRef.current?.focus(); }}>
                <X size={ICON_SIZE.body} aria-hidden="true" />
              </GhostButton>
            </div>
          </header>
          <div className="dashboard-notifications__body" aria-live="polite">
            {remote.loading && (
              <div className="dashboard-notifications__state" role="status"><LoaderCircle className="is-spinning" size={ICON_SIZE.display} aria-hidden="true" /><b>Checking your inbox</b><span>This will only take a moment.</span></div>
            )}
            {!remote.loading && !userId && (
              <div className="dashboard-notifications__state"><Bell size={ICON_SIZE.display} aria-hidden="true" /><b>Sign in for account notices</b><span>Device reminders still work without an account.</span></div>
            )}
            {!remote.loading && userId && remote.error && (
              <div className="dashboard-notifications__state"><CircleAlert size={ICON_SIZE.display} aria-hidden="true" /><b>Inbox unavailable</b><span>{remote.error}</span><GButton size="sm" onClick={() => void remote.reload()}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Try again</GButton></div>
            )}
            {!remote.loading && userId && !remote.error && !history.length && (
              <div className="dashboard-notifications__state"><Bell size={ICON_SIZE.display} aria-hidden="true" /><b>Nothing needs your attention</b><span>Important account and learning communications will appear here.</span></div>
            )}
            {!remote.loading && userId && !remote.error && history.length > 0 && (
              <ul className="dashboard-notifications__list">
                {history.map((item) => {
                  const unreadItem = !read.has(readToken(item));
                  const needsAttention = !["sent", "delivered"].includes(item.status);
                  return (
                    <li key={item.id} className={unreadItem ? "is-unread" : ""}>
                      <a href="#communications" onClick={() => markRead([item])}>
                        <span className={needsAttention ? "is-attention" : ""} aria-hidden="true">{needsAttention ? <CircleAlert size={ICON_SIZE.body} /> : <Mail size={ICON_SIZE.body} />}</span>
                        <span><b>{communicationTitle(item.type)}</b><small>{statusLabel(item.status)} · {relativeTime(item.sent_at ?? item.created_at)}</small>{unreadItem && <span className="sr-only"> Unread.</span>}</span>
                        {unreadItem && <i aria-hidden="true" />}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <footer><a href="#communications" onClick={() => markRead(outcomes)}>Open communications <span aria-hidden="true">→</span></a></footer>
        </section>
      )}
    </div>
  );
}
