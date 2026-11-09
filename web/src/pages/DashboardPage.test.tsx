// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
  STORED_DASHBOARD_WIDGET_IDS,
  makeSeed,
} from "../lib/seed";
import { useStore } from "../lib/store";
import { DashboardPage } from "./DashboardPage";

const backupMocks = vi.hoisted(() => ({ exportStateWithAttachments: vi.fn() }));
vi.mock("../lib/backup", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/backup")>(),
  exportStateWithAttachments: backupMocks.exportStateWithAttachments,
}));

const localValues = new Map<string, string>();
const memoryLocalStorage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key: string) => localValues.get(key) ?? null,
  key: (index: number) => [...localValues.keys()][index] ?? null,
  removeItem: (key: string) => { localValues.delete(key); },
  setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
};

beforeEach(() => {
  backupMocks.exportStateWithAttachments.mockReset();
  localValues.clear();
  vi.stubGlobal("localStorage", memoryLocalStorage);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const seed = makeSeed();
  seed.profile.hiddenDashboardWidgets = DEFAULT_DASHBOARD_WIDGETS.filter((id) => id !== "todayScore");
  seed.profile.dashboardWidgetOrder = [...DEFAULT_DASHBOARD_WIDGETS];
  seed.profile.dailySuccess = { version: 1, configuredAt: seed.activeDayKey, requirements: [] };
  useStore.setState(seed);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardPage declutter", () => {
  function showLocalDataWidget() {
    useStore.getState().updateProfile({
      hiddenDashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.filter((id) => id !== "localData"),
    });
  }

  function showWeeklyWidget() {
    useStore.getState().updateProfile({
      hiddenDashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.filter((id) => id !== "weekly"),
    });
  }

  it("keeps a new workspace's week neutral until study or a target is recorded", () => {
    showWeeklyWidget();
    const { container } = render(<DashboardPage />);
    const weekly = container.querySelector<HTMLElement>(".weekly-card")!;

    expect(within(weekly).getByText("No activity yet")).toBeTruthy();
    expect(within(weekly).getByText("No study logged yet")).toBeTruthy();
    expect(within(weekly).getByText("When you're ready, start with one short study block.")).toBeTruthy();
    expect(within(weekly).queryByText("Below target")).toBeNull();
    expect(within(weekly).queryByText(/oldest due task/)).toBeNull();
    expect([...weekly.querySelectorAll<HTMLElement>(".week-bar-fill")].every((bar) => bar.style.height === "0%"))
      .toBe(true);
  });

  it("keeps the scored weekly result and due-task guidance for recorded work", () => {
    showWeeklyWidget();
    const dayKey = useStore.getState().activeDayKey;
    useStore.setState((state) => ({
      logs: [{ id: "real-study", dayKey, ts: `${dayKey}T12:00:00.000Z`, type: "Study", minutes: 10, cards: 0,
        academic: true, productive: true }],
      tasks: [...state.tasks, { id: "real-due", title: "Review renal transport", due: dayKey,
        done: false, archived: false, created: `${dayKey}T08:00:00.000Z` }],
    }));
    const { container } = render(<DashboardPage />);
    const weekly = container.querySelector<HTMLElement>(".weekly-card")!;

    expect(within(weekly).getByText("Below target")).toBeTruthy();
    expect(within(weekly).getByText("Tomorrow: clear the oldest due task before adding volume.")).toBeTruthy();
    expect(within(weekly).queryByText("No activity yet")).toBeNull();
  });

  it("leaves the daily quote to the top bar instead of duplicating it on the dashboard", () => {
    const { container } = render(<DashboardPage />);
    expect(container.querySelector(".alpha-build-copy")).toBeTruthy();
    expect(container.querySelector(".dashboard-quote")).toBeNull();
    expect(screen.queryByRole("region", { name: "Daily quote" })).toBeNull();
    expect(screen.queryByText("Welcome, JD", { exact: true })).toBeNull();
  });

  it("removes AI Suggested Actions from defaults and catalogs without rewriting a legacy preference", () => {
    expect(DEFAULT_DASHBOARD_WIDGETS).not.toContain("aiActions");
    expect(DEFAULT_HIDDEN_DASHBOARD_WIDGETS).not.toContain("aiActions");
    expect(STORED_DASHBOARD_WIDGET_IDS).toContain("aiActions");
    useStore.getState().updateProfile({
      dashboardWidgetOrder: ["aiActions", ...DEFAULT_DASHBOARD_WIDGETS],
      hiddenDashboardWidgets: ["aiActions"],
    });
    render(<DashboardPage />);
    expect(screen.queryByText("AI Suggested Actions", { exact: true })).toBeNull();
    expect(screen.queryByText("AI actions", { exact: true })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    expect(screen.queryByText("AI actions", { exact: true })).toBeNull();
    expect(screen.queryByText(/Provider-backed action queue/)).toBeNull();
    expect(useStore.getState().profile.dashboardWidgetOrder?.[0]).toBe("aiActions");
    expect(useStore.getState().profile.hiddenDashboardWidgets).toEqual(["aiActions"]);
  });

  it("never infers JD and lets a nameless user add an explicit name", () => {
    useStore.getState().updateProfile({ name: "AXOM" });
    render(<DashboardPage />);

    expect(screen.getByText("Welcome", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Welcome, JD", { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add your name" }));
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Welcome, Ada", { exact: true })).toBeTruthy();
    expect(useStore.getState().profile.name).toBe("Ada");
  });

  it("preserves an explicitly stored user named JD", () => {
    useStore.getState().updateProfile({ name: "JD" });
    render(<DashboardPage />);

    expect(screen.getByText("Welcome, JD", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your name" })).toBeNull();
  });

  it("cancels name editing without creating a placeholder identity", () => {
    useStore.getState().updateProfile({ name: "" });
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add your name" }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Temporary" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useStore.getState().profile.name).toBe("");
    expect(screen.getByText("Welcome", { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add your name" })).toBeTruthy();
  });

  it("removes primary diagnostics and the duplicated five-card stat row", () => {
    const { container } = render(<DashboardPage />);
    expect(screen.getByText("Today's targets")).toBeTruthy();
    expect(screen.getByText("Decide what makes a day count")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Choose targets" }).getAttribute("href")).toBe("#productivity");
    expect(screen.queryByText(/Schema 32/)).toBeNull();
    expect(screen.queryByText(/Version v/)).toBeNull();
    expect(screen.queryByText(/active map nodes/)).toBeNull();
    expect(container.querySelector(".dashboard-stat-row")).toBeNull();
  });

  it("preserves returning-user widget order and hidden data on render", () => {
    const beforeOrder = [...(useStore.getState().profile.dashboardWidgetOrder ?? [])];
    const beforeHidden = [...(useStore.getState().profile.hiddenDashboardWidgets ?? [])];
    render(<DashboardPage />);
    expect(useStore.getState().profile.dashboardWidgetOrder).toEqual(beforeOrder);
    expect(useStore.getState().profile.hiddenDashboardWidgets).toEqual(beforeHidden);
    expect(useStore.getState().tracker.length).toBeGreaterThan(0);
  });

  it("exports a complete portable copy from the Dashboard backup action", async () => {
    showLocalDataWidget();
    backupMocks.exportStateWithAttachments.mockResolvedValueOnce({
      attachmentCount: 1, missingBlobKeys: [], originalCount: 0,
      missingOriginalIds: [], deferredSourceCount: 0,
    });
    const { container } = render(<DashboardPage />);
    const widget = within(container.querySelector<HTMLElement>(".local-data-card")!);

    fireEvent.click(widget.getByRole("button", { name: "Export backup" }));
    await waitFor(() => expect(backupMocks.exportStateWithAttachments).toHaveBeenCalledOnce());
    expect(backupMocks.exportStateWithAttachments.mock.calls[0][0]).toBe(useStore.getState());
    expect((await widget.findByRole("status")).textContent).toMatch(/complete backup downloaded/i);
  });

  it("reports an account-switch export failure without claiming a downloaded backup", async () => {
    showLocalDataWidget();
    backupMocks.exportStateWithAttachments.mockRejectedValueOnce(new Error("The signed-in account changed."));
    const { container } = render(<DashboardPage />);
    const widget = within(container.querySelector<HTMLElement>(".local-data-card")!);

    fireEvent.click(widget.getByRole("button", { name: "Export backup" }));
    expect((await widget.findByRole("alert")).textContent).toMatch(/backup was not downloaded.*account changed/i);
    expect((widget.getByRole("button", { name: "Export backup" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
