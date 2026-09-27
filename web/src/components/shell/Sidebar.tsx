import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Settings, Cloud, SlidersHorizontal, Check, ChevronDown, ChevronRight, Wrench, GraduationCap, MessageCircle,
} from "lucide-react";
import {
  DAILY_GAMES_FOLDER,
  getNavAnnouncementId,
  getNavModuleStatus,
  MODULE_STATUS_META,
  navById,
  SIDEBAR_BOTTOM,
  SIDEBAR_LOCKED,
  SIDEBAR_LEARN,
  SIDEBAR_PREP,
  SIDEBAR_REVIEW,
  SIDEBAR_TODAY,
  SIDEBAR_TOOLS,
} from "./nav";
import { useStore } from "../../lib/store";
import { AxomBrandLockup } from "../ui/BrandMark";
import type { SettingsTab } from "./SettingsModal";
import { dismissAnnouncement, isAnnouncementDismissed, readDismissedAnnouncements } from "../../lib/announcements";
import { QuickThemeControl } from "./QuickThemeControl";
import { ICON_SIZE } from "../../lib/iconSize";
import { protectionLabel, useAccount } from "../../lib/account/accountStore";

const MOBILE_SIDEBAR_QUERY = "(max-width: 880px)";
const PREP_FOLDER_TOGGLE_ID = "sidebar-academic-prep-toggle";
const PREP_FOLDER_ITEMS_ID = "sidebar-academic-prep-items";
const TOOLS_FOLDER_TOGGLE_ID = "sidebar-tools-toggle";
const TOOLS_FOLDER_ITEMS_ID = "sidebar-tools-items";

function useMobileSidebar(): boolean {
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const update = (event: MediaQueryListEvent | MediaQueryList) => setMobile(event.matches);
    update(query);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return mobile;
}

export function Sidebar({
  active, onSelect, onOpenSettings, collapsed, onClose,
}: {
  active: string;
  onSelect: (id: string) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  collapsed: boolean;       // mobile drawer open/closed
  onClose: () => void;      // close drawer after pick on mobile
}) {
  const profile = useStore((s) => s.profile);
  const accountStatus = useAccount((state) => state.protection);
  const updateProfile = useStore((s) => s.updateProfile);
  const [manage, setManage] = useState(false);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState(readDismissedAnnouncements);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobile = useMobileSidebar();
  const hiddenOffscreen = mobile && !collapsed;

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (hiddenOffscreen) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
  }, [hiddenOffscreen]);

  useEffect(() => {
    if (!mobile || !collapsed) return;
    const frame = window.requestAnimationFrame(() => sidebarRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, mobile]);

  useEffect(() => {
    const announcementId = getNavAnnouncementId(active);
    if (!announcementId || isAnnouncementDismissed(announcementId, dismissedAnnouncements)) return;
    // The optional-route gate is an enablement explanation, not a meaningful
    // open of the game itself. Dismiss only once the module can render.
    setDismissedAnnouncements(dismissAnnouncement(announcementId));
  }, [active, dismissedAnnouncements]);

  const hidden = new Set(profile.hiddenNav ?? []);
  const toolsOpen = !profile.toolsCollapsed;
  const prepOpen = !profile.prepCollapsed;

  function toggleHidden(id: string) {
    if (SIDEBAR_LOCKED.has(id)) return;
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateProfile({ hiddenNav: [...next] });
  }

  function Item({ id }: { id: string }) {
    const item = navById(id);
    if (!item) return null;
    const I = item.icon;
    const isHidden = hidden.has(id);
    const assignedStatus = getNavModuleStatus(id);
    const announcementId = getNavAnnouncementId(id);
    const moduleStatus = assignedStatus === "new" && isAnnouncementDismissed(announcementId, dismissedAnnouncements)
      ? undefined
      : assignedStatus;
    const status = moduleStatus ? MODULE_STATUS_META[moduleStatus] : undefined;
    const accessibleLabel = status ? `${item.label}, ${status.accessibleLabel}` : item.label;
    const statusBadge = status && (
      <span
        className={`nav-status nav-status--${moduleStatus}`}
        aria-label={status.accessibleLabel}
        title={status.accessibleLabel}
      >
        {status.badgeLabel}
      </span>
    );
    if (manage) {
      const locked = SIDEBAR_LOCKED.has(id);
      return (
        <button type="button" className={`nav-item manage ${isHidden ? "off" : ""}`}
          aria-label={accessibleLabel} aria-pressed={!isHidden}
          onClick={() => toggleHidden(id)} disabled={locked} title={locked ? "Always shown" : isHidden ? "Show" : "Hide"}>
          <span className={`nav-check ${!isHidden ? "on" : ""}`}>{!isHidden && <Check size={ICON_SIZE.microInline} />}</span>
          <I size={ICON_SIZE.emphasis} /><span className="nav-item-label">{item.label}</span>{statusBadge}
        </button>
      );
    }
    if (isHidden) return null;
    return (
      <button type="button" className={`nav-item ${active === id ? "on" : ""}`}
        aria-label={accessibleLabel}
        aria-current={active === id ? "page" : undefined}
        onClick={() => { onSelect(id); onClose(); }}>
        <I size={ICON_SIZE.emphasis} /><span className="nav-item-label">{item.label}</span>{statusBadge}
      </button>
    );
  }

  // Experimental nav (e.g. Habit Tracker) only appears once opted in via
  // Settings → Early Features, even in manage mode.
  const habitsOn = profile.experimentalFlags?.habits === true;
  const navGate = (id: string) => id !== "habits" || habitsOn;
  const toolItems = (manage ? SIDEBAR_TOOLS : SIDEBAR_TOOLS.filter((id) => !hidden.has(id))).filter(navGate);
  const prepItems = (manage ? SIDEBAR_PREP : SIDEBAR_PREP.filter((id) => !hidden.has(id)));
  const dailyGamesOpen = !profile.dailyGamesCollapsed;
  const dailyGameItems = (manage
    ? DAILY_GAMES_FOLDER.routes
    : DAILY_GAMES_FOLDER.routes.filter((id) => !hidden.has(id))
  );
  const DailyGamesIcon = DAILY_GAMES_FOLDER.icon;
  const help = navById("help");
  const HelpIcon = help?.icon;
  const about = navById("about");
  const AboutIcon = about?.icon;

  return (
    <>
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`sidebar ${collapsed ? "open" : ""}`}
        aria-label="Primary navigation"
        aria-hidden={hiddenOffscreen || undefined}
        tabIndex={-1}
      >
        <button type="button" className="server-header" onClick={() => onOpenSettings("profile")} title="Profile & settings">
          <AxomBrandLockup
            className="server-brand"
            layout="horizontal"
            size="sm"
            subtitle={profile.versionLabel}
            markFramed
          />
          <ChevronDown size={ICON_SIZE.emphasis} className="server-caret" />
        </button>

        <div className="nav-manage-zone" data-tour="control-surface-menu">
          <button
            type="button"
            className={`nav-manage-btn ${manage ? "on" : ""}`}
            onClick={() => setManage((m) => !m)}
            aria-pressed={manage}
            title={manage ? "Done customizing" : "Subscribe or unsubscribe sections"}
          >
            {manage ? <Check size={ICON_SIZE.body} /> : <SlidersHorizontal size={ICON_SIZE.body} />}
            <span>{manage ? "Done" : "Customize"}</span>
          </button>
          <div className="nav-manage-hint">
            {manage ? "Tap sections to subscribe or hide them." : "Subscribe to sections you use; hide the rest."}
          </div>
        </div>

        <nav className="nav">
          <div className="nav-cat"><span>{manage ? "Customize sidebar" : "Today"}</span></div>
          {SIDEBAR_TODAY.map((id) => <Item key={id} id={id} />)}
          <div className="nav-cat"><span>Learn</span></div>
          {SIDEBAR_LEARN.map((id) => <Item key={id} id={id} />)}
          <div className="nav-cat"><span>Review &amp; reflect</span></div>
          {SIDEBAR_REVIEW.map((id) => <Item key={id} id={id} />)}

          {(prepItems.length > 0 || manage) && (
            <div className="nav-folder">
              <button
                id={PREP_FOLDER_TOGGLE_ID}
                type="button"
                className="nav-folder-head"
                aria-controls={PREP_FOLDER_ITEMS_ID}
                aria-expanded={prepOpen}
                onClick={() => updateProfile({ prepCollapsed: !profile.prepCollapsed })}>
                {prepOpen ? <ChevronDown size={ICON_SIZE.body} /> : <ChevronRight size={ICON_SIZE.body} />}
                <GraduationCap size={ICON_SIZE.body} /><span>Academic Prep</span>
                {!prepOpen && <span className="nav-folder-count">{prepItems.length}</span>}
              </button>
              <div
                id={PREP_FOLDER_ITEMS_ID}
                className="nav-folder-items"
                role="group"
                aria-labelledby={PREP_FOLDER_TOGGLE_ID}
                hidden={!prepOpen}
              >
                {prepItems.map((id) => <Item key={id} id={id} />)}
              </div>
            </div>
          )}

          {(toolItems.length > 0 || manage) && (
            <div className="nav-folder">
              <button
                id={TOOLS_FOLDER_TOGGLE_ID}
                type="button"
                className="nav-folder-head"
                aria-controls={TOOLS_FOLDER_ITEMS_ID}
                aria-expanded={toolsOpen}
                onClick={() => updateProfile({ toolsCollapsed: !profile.toolsCollapsed })}>
                {toolsOpen ? <ChevronDown size={ICON_SIZE.body} /> : <ChevronRight size={ICON_SIZE.body} />}
                <Wrench size={ICON_SIZE.body} /><span>Tools</span>
                {!toolsOpen && <span className="nav-folder-count">{toolItems.length}</span>}
              </button>
              <div
                id={TOOLS_FOLDER_ITEMS_ID}
                className="nav-folder-items"
                role="group"
                aria-labelledby={TOOLS_FOLDER_TOGGLE_ID}
                hidden={!toolsOpen}
              >
                {toolItems.map((id) => <Item key={id} id={id} />)}
              </div>
            </div>
          )}

          <div className="nav-folder">
              <button
                id={DAILY_GAMES_FOLDER.toggleId}
                type="button"
                className="nav-folder-head"
                aria-controls={DAILY_GAMES_FOLDER.regionId}
                aria-expanded={dailyGamesOpen}
                onClick={() => updateProfile({ dailyGamesCollapsed: !profile.dailyGamesCollapsed })}
              >
                {dailyGamesOpen ? <ChevronDown size={ICON_SIZE.body} /> : <ChevronRight size={ICON_SIZE.body} />}
                <DailyGamesIcon size={ICON_SIZE.body} /><span>{DAILY_GAMES_FOLDER.label}</span>
                {!dailyGamesOpen && <span className="nav-folder-count">{dailyGameItems.length}</span>}
              </button>
              <div
                id={DAILY_GAMES_FOLDER.regionId}
                className="nav-folder-items"
                role="group"
                aria-labelledby={DAILY_GAMES_FOLDER.toggleId}
                hidden={!dailyGamesOpen}
              >
                {dailyGameItems.map((id) => <Item key={id} id={id} />)}
              </div>
          </div>

          {SIDEBAR_BOTTOM.map((id) => <Item key={id} id={id} />)}
        </nav>

        <div className="sidebar-foot">
          {about && AboutIcon && (
            <button type="button" className={`nav-item footer-action ${active === "about" ? "on" : ""}`}
              onClick={() => { onSelect("about"); onClose(); }}>
              <AboutIcon size={ICON_SIZE.emphasis} /><span>About</span>
            </button>
          )}
          {help && HelpIcon && (
            <button type="button" className={`nav-item footer-action ${active === "help" ? "on" : ""}`}
              onClick={() => { onSelect("help"); onClose(); }}>
              <HelpIcon size={ICON_SIZE.emphasis} /><span>Help</span>
            </button>
          )}
          <a className="nav-item footer-action" href="https://discord.gg/sTNuHa6qR" target="_blank" rel="noreferrer noopener">
            <MessageCircle size={ICON_SIZE.emphasis} /><span>AXOM Discord Channel</span>
          </a>
          <div className="user-panel">
            <button type="button" className="user-id" onClick={() => onOpenSettings("profile")} title="Profile & settings">
              <span className="avatar sm">
                {profile.avatarDataUrl
                  ? <img src={profile.avatarDataUrl} alt="" />
                  : <span className="avatar-mono">{(profile.name || "A").slice(0, 1)}</span>}
                <span className="user-online" />
              </span>
              <span className="user-meta">
                <span className="user-name">{profile.name || "You"}</span>
                <span className="user-status">{manage ? "Tap sections to subscribe / hide" : profile.tagline}</span>
              </span>
            </button>
            <div className="user-actions">
              <QuickThemeControl />
              <button type="button" className="user-icon-btn account-status" data-status={accountStatus} onClick={() => onOpenSettings("account")} title="Account and protection" aria-label={`Account and protection: ${protectionLabel(accountStatus)}`} data-tour="data-safety-settings">
                <Cloud size={ICON_SIZE.emphasis} />
              </button>
              <button type="button" className="user-icon-btn" onClick={() => onOpenSettings("profile")} title="Settings">
                <Settings size={ICON_SIZE.emphasis} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      {collapsed && (
        <button
          type="button"
          className="drawer-scrim"
          onClick={onClose}
          aria-label="Close navigation menu"
        />
      )}
    </>
  );
}
