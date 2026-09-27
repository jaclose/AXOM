// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import App from "../../App";
import { useStore } from "../../lib/store";
import { STORAGE_KEYS } from "../../lib/brand";
import { PROMISE_PROMPT_VERSION } from "../../lib/promisePrompt";
import {
  DAILY_GAMES_FOLDER,
  getNavAnnouncementId,
  getNavModuleStatus,
  MODULE_STATUS_META,
} from "./nav";

const localValues = new Map<string, string>();
const memoryLocalStorage: Storage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => { localValues.delete(key); },
  setItem: (key, value) => { localValues.set(key, String(value)); },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryLocalStorage);
  localStorage.clear();
  window.location.hash = "#dashboard";
  useStore.setState((state) => ({
    profile: {
      ...state.profile,
      onboarded: true,
      tourDone: true,
      promisePromptStatus: {
        state: "skipped",
        updatedAt: "2026-07-13T00:00:00.000Z",
        promptVersion: PROMISE_PROMPT_VERSION,
      },
      hiddenNav: [],
      prepCollapsed: false,
      toolsCollapsed: false,
      dailyGamesCollapsed: false,
      experimentalFlags: { ...state.profile.experimentalFlags, habits: true, dailyGames: false },
    },
    dailyWordPuzzles: [],
  }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 880px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => { callback(0); return 1; },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mobile sidebar accessibility", () => {
  it("makes the offscreen drawer inert, then exposes and focuses it when opened", () => {
    const onClose = vi.fn();
    const props = {
      active: "dashboard",
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      onClose,
    };
    const { container, rerender } = render(<Sidebar {...props} collapsed={false} />);
    const sidebar = container.querySelector<HTMLElement>("#app-sidebar")!;

    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar.hasAttribute("inert")).toBe(true);

    rerender(<Sidebar {...props} collapsed />);
    expect(sidebar.hasAttribute("aria-hidden")).toBe(false);
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(sidebar);

    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("connects the menu trigger to the drawer and reports expanded state", () => {
    const menuButtonRef = createRef<HTMLButtonElement>();
    const onMenu = vi.fn();
    const { rerender } = render(
      <TopBar
        title="Dashboard"
        subtitle="Overview"
        onMenu={onMenu}
        menuButtonRef={menuButtonRef}
        drawerOpen={false}
        onRefresh={() => {}}
        refreshing={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menuButtonRef.current).toBe(trigger);
    fireEvent.click(trigger);
    expect(onMenu).toHaveBeenCalledOnce();

    rerender(
      <TopBar
        title="Dashboard"
        subtitle="Overview"
        onMenu={onMenu}
        menuButtonRef={menuButtonRef}
        drawerOpen
        onRefresh={() => {}}
        refreshing={false}
      />,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and restores focus to the menu trigger", () => {
    render(<App />);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Close navigation menu" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Close navigation menu" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("sidebar module status", () => {
  it("keeps status assignments and accessible presentation metadata centralized", () => {
    expect(getNavModuleStatus("questions")).toBe("new");
    expect(getNavModuleStatus("methods")).toBe("new");
    expect(getNavModuleStatus("daily-word")).toBe("new");
    expect(getNavModuleStatus("doctordle")).toBeUndefined();
    expect(getNavModuleStatus("daily-games")).toBe("new");
    expect(getNavModuleStatus("building")).toBe("new");
    expect(getNavModuleStatus("anki")).toBe("wip");
    expect(getNavModuleStatus("habits")).toBe("wip");
    expect(getNavModuleStatus("step")).toBe("wip");
    expect(getNavModuleStatus("premed")).toBe("wip");
    expect(getNavModuleStatus("integrations")).toBe("wip");
    expect(getNavModuleStatus("appchecker")).toBe("wip");
    expect(getNavModuleStatus("leaderboards")).toBe("wip");
    expect(getNavModuleStatus("dashboard")).toBeUndefined();
    expect(getNavAnnouncementId("questions")).toBe("question-bank-entry-v1");
    expect(getNavAnnouncementId("methods")).toBe("study-methods-library-v1");
    expect(getNavAnnouncementId("daily-word")).toBe("daily-word-launch-v1");
    expect(getNavAnnouncementId("doctordle")).toBeUndefined();
    expect(MODULE_STATUS_META["under-construction"]).toEqual({
      badgeLabel: "BUILDING",
      accessibleLabel: "Under construction",
    });
  });

  it("renders visible badges with full accessible status names", () => {
    render(
      <Sidebar
        active="dashboard"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        collapsed
        onClose={vi.fn()}
      />,
    );

    const newItem = screen.getByRole("button", { name: "Question Bank, New" });
    expect(newItem.querySelector(".nav-status")?.textContent).toBe("NEW");

    const wipItem = screen.getByRole("button", { name: "Anki Lab, Work in progress" });
    expect(wipItem.querySelector(".nav-status")?.textContent).toBe("WIP");

    const buildingItem = screen.getByRole("button", { name: "Application Checker, Work in progress" });
    const buildingBadge = buildingItem.querySelector<HTMLElement>(".nav-status");
    expect(buildingBadge?.textContent).toBe("WIP");
    expect(buildingBadge?.getAttribute("title")).toBe("Work in progress");
  });

  it("keeps status treatments visible for hidden modules in customize mode", () => {
    useStore.setState((state) => ({
      profile: { ...state.profile, hiddenNav: ["methods"] },
    }));
    render(
      <Sidebar
        active="dashboard"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        collapsed
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Study Methods, New" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    const hiddenModule = screen.getByRole("button", { name: "Study Methods, New" });
    expect(hiddenModule.classList.contains("off")).toBe(true);
    expect(hiddenModule.getAttribute("aria-pressed")).toBe("false");
    expect(hiddenModule.querySelector(".nav-status")?.textContent).toBe("NEW");
  });

  it("dismisses each NEW badge only after its meaningful active-route open and persists the stable id", () => {
    const props = {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      collapsed: true,
      onClose: vi.fn(),
    };
    const { rerender, unmount } = render(<Sidebar {...props} active="dashboard" />);
    const questions = screen.getByRole("button", { name: "Question Bank, New" });
    fireEvent.mouseEnter(questions);
    expect(localStorage.getItem(STORAGE_KEYS.dismissedAnnouncements)).toBeNull();

    rerender(<Sidebar {...props} active="questions" />);
    expect(screen.getByRole("button", { name: "Question Bank" }).querySelector(".nav-status")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.dismissedAnnouncements) ?? "[]")).toEqual([
      "question-bank-entry-v1",
    ]);
    expect(screen.getByRole("button", { name: "Study Methods, New" })).toBeTruthy();

    unmount();
    render(<Sidebar {...props} active="dashboard" />);
    expect(screen.getByRole("button", { name: "Question Bank" }).querySelector(".nav-status")).toBeNull();
    expect(screen.getByRole("button", { name: "Study Methods, New" })).toBeTruthy();
  });

  it("dismisses a persistent game route and never dismisses WIP or BUILDING", () => {
    const props = {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      collapsed: true,
      onClose: vi.fn(),
    };
    const { rerender } = render(<Sidebar {...props} active="daily-word" />);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.dismissedAnnouncements) ?? "[]")).toContain("daily-word-launch-v1");

    rerender(<Sidebar {...props} active="anki" />);
    expect(screen.getByRole("button", { name: "Anki Lab, Work in progress" })).toBeTruthy();
    rerender(<Sidebar {...props} active="appchecker" />);
    expect(screen.getByRole("button", { name: "Application Checker, Work in progress" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.dismissedAnnouncements) ?? "[]")).toEqual(["daily-word-launch-v1"]);
  });
});

describe("sidebar folder disclosure accessibility", () => {
  it("uses stable controls and keeps collapsed Academic Prep and Tools groups mounted", () => {
    render(
      <Sidebar
        active="dashboard"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        collapsed
        onClose={vi.fn()}
      />,
    );

    const prepToggle = screen.getByRole("button", { name: "Academic Prep" });
    const prepItems = document.getElementById("sidebar-academic-prep-items")!;
    expect(prepToggle.getAttribute("id")).toBe("sidebar-academic-prep-toggle");
    expect(prepToggle.getAttribute("aria-controls")).toBe(prepItems.id);
    expect(prepToggle.getAttribute("aria-expanded")).toBe("true");
    expect(prepItems.getAttribute("aria-labelledby")).toBe(prepToggle.id);
    expect(prepItems.hidden).toBe(false);

    fireEvent.click(prepToggle);
    expect(prepToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("sidebar-academic-prep-items")).toBe(prepItems);
    expect(prepItems.hidden).toBe(true);

    const toolsToggle = screen.getByRole("button", { name: "Tools" });
    const toolItems = document.getElementById("sidebar-tools-items")!;
    expect(toolsToggle.getAttribute("id")).toBe("sidebar-tools-toggle");
    expect(toolsToggle.getAttribute("aria-controls")).toBe(toolItems.id);
    expect(toolsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(toolItems.getAttribute("aria-labelledby")).toBe(toolsToggle.id);
    expect(toolItems.hidden).toBe(false);

    fireEvent.click(toolsToggle);
    expect(toolsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("sidebar-tools-items")).toBe(toolItems);
    expect(toolItems.hidden).toBe(true);
  });

  it("keeps Daily Games persistent and preserves local history", () => {
    useStore.setState({
      dailyWordPuzzles: [{
        puzzleId: "daily-word:general-1:2026-07-12",
        puzzleDate: "2026-07-12",
        timezone: "America/Grenada",
        wordListVersion: "general-1",
        guesses: ["APPLE"],
        completed: false,
        won: false,
        startedAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:01:00.000Z",
      }],
    });
    render(
      <Sidebar
        active="dashboard"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        collapsed
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: DAILY_GAMES_FOLDER.label })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Daily Games, New" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Daily Word, New" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Doctordle" })).toBeTruthy();
    expect(useStore.getState().dailyWordPuzzles).toHaveLength(1);
  });

  it("uses a stable Daily Games disclosure and removes collapsed children from keyboard navigation", () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        experimentalFlags: { ...state.profile.experimentalFlags, dailyGames: true },
      },
    }));
    render(
      <Sidebar
        active="daily-word"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        collapsed
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: DAILY_GAMES_FOLDER.label });
    const region = document.getElementById(DAILY_GAMES_FOLDER.regionId)!;
    const activeRoute = screen.getByRole("button", { name: "Daily Word" });
    expect(toggle.id).toBe(DAILY_GAMES_FOLDER.toggleId);
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.getAttribute("aria-labelledby")).toBe(toggle.id);
    expect(activeRoute.getAttribute("aria-current")).toBe("page");

    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole("button", { name: "Daily Word, New" })).toBeNull();
  });
});
