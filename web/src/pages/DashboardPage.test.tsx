// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
  STORED_DASHBOARD_WIDGET_IDS,
  makeSeed,
} from "../lib/seed";
import { useStore } from "../lib/store";
import { DashboardPage } from "./DashboardPage";

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
});
