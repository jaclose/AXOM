import { Compass, Menu, RotateCw } from "lucide-react";
import type { RefObject } from "react";
import { GButton } from "../ui/primitives";
import { useStore } from "../../lib/store";
import { useUi } from "../../lib/uiStore";
import { ClockControl } from "./ClockControl";
import { TopBarQuote } from "./TopBarQuote";
import { ICON_SIZE } from "../../lib/iconSize";

export function TopBar({
  title, subtitle, onMenu, menuButtonRef, drawerOpen, onRefresh, refreshing, route = "dashboard",
}: {
  route?: string;
  title: string;
  subtitle: string;
  onMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement>;
  drawerOpen: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const clockPreferences = useStore((state) => state.profile.clockPreferences);
  const timeZonePreference = useStore((state) => state.profile.timeZonePreference);
  const activeDayKey = useStore((state) => state.activeDayKey);
  return (
    <div className="topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="menu-btn"
        onClick={onMenu}
        aria-label="Open navigation menu"
        aria-controls="app-sidebar"
        aria-expanded={drawerOpen}
      >
        <Menu size={ICON_SIZE.control} />
      </button>
      <div className="topbar-heading">
        <div className="tb-title">{title}</div>
        <div className="tb-sub">{subtitle}</div>
      </div>
      <TopBarQuote dayKey={activeDayKey} route={route} />
      <div className="tb-actions">
        <ClockControl
          clockPreferences={clockPreferences}
          timeZonePreference={timeZonePreference}
          onOpenPreferences={() => useUi.getState().requestSettings("rhythm")}
        />
        <GButton
          className="topbar-guide"
          onClick={() => useUi.getState().openGuide()}
          aria-label="Open the AXOM Guide"
          aria-keyshortcuts="Control+/ Meta+/"
          title="Ask how to do anything (Ctrl or ⌘ + /)"
          data-guide="topbar-guide"
        >
          <Compass size={ICON_SIZE.body} aria-hidden="true" />
          <span>Guide</span>
        </GButton>
        <GButton className="topbar-refresh" onClick={onRefresh}>
          <RotateCw size={ICON_SIZE.body} className={refreshing ? "spin" : ""} />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </GButton>
      </div>
    </div>
  );
}
