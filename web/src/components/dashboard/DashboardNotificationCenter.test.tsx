// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationsSettings } from "../../lib/communications/client";
import { DashboardNotificationCenter } from "./DashboardNotificationCenter";

const reload = vi.fn();
const localValues = new Map<string, string>();
const memoryLocalStorage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key: string) => localValues.get(key) ?? null,
  key: (index: number) => [...localValues.keys()][index] ?? null,
  removeItem: (key: string) => { localValues.delete(key); },
  setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
};
let userId = "account-a";
let remote: {
  data: CommunicationsSettings | null;
  loading: boolean;
  error: string;
  reload: typeof reload;
};

vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: userId ? { id: userId } : null }),
}));

vi.mock("../../lib/communications/client", async () => {
  const actual = await vi.importActual<typeof import("../../lib/communications/client")>("../../lib/communications/client");
  return { ...actual, useCommunications: () => remote };
});
function settings(history: CommunicationsSettings["history"]): CommunicationsSettings {
  return {
    preferences: [],
    identity: { accent: "#c8a96a", theme: "dark" },
    history,
    privacy: [],
    admin: false,
    deliveryMode: "live",
    deletionEnabled: false,
    hasProtectedCopy: true,
  };
}

beforeEach(() => {
  localValues.clear();
  vi.stubGlobal("localStorage", memoryLocalStorage);
  userId = "account-a";
  reload.mockReset();
  remote = {
    data: settings([
      { id: "delivered-1", type: "weekly_report", status: "delivered", created_at: "2026-10-15T10:00:00.000Z", sent_at: "2026-10-15T10:01:00.000Z" },
      { id: "failed-1", type: "security", status: "failed", created_at: "2026-10-15T09:00:00.000Z" },
      { id: "queued-1", type: "daily_learning", status: "queued", created_at: "2026-10-15T08:00:00.000Z" },
    ]),
    loading: false,
    error: "",
    reload,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardNotificationCenter", () => {
  it("shows only meaningful communication outcomes and persists read state per account", async () => {
    render(<DashboardNotificationCenter />);
    const trigger = screen.getByRole("button", { name: "Notifications, 1 item needs attention" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("Weekly Report")).toBeTruthy();
    expect(screen.getByText("Security notice")).toBeTruthy();
    expect(screen.queryByText("Daily learning")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    expect(new Set(JSON.parse(localStorage.getItem("axom.communicationReads.v1:account-a") ?? "[]") as string[])).toEqual(
      new Set(["delivered-1:delivered", "failed-1:failed"]),
    );
  });

  it("resurfaces a failed outcome after the successful outcome was read", () => {
    memoryLocalStorage.setItem("axom.communicationReads.v1:account-a", JSON.stringify(["delivered-1:delivered", "failed-1:delivered"]));
    render(<DashboardNotificationCenter />);

    expect(screen.getByRole("button", { name: "Notifications, 1 item needs attention" })).toBeTruthy();
  });

  it("keeps account failures actionable without turning the bell into a persistent banner", () => {
    remote = { data: null, loading: false, error: "Communications could not be reached.", reload };
    render(<DashboardNotificationCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("Inbox unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses a calm local-only state when no account is connected", () => {
    userId = "";
    remote = { data: null, loading: false, error: "Sign in to manage email delivery.", reload };
    render(<DashboardNotificationCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("Sign in for account notices")).toBeTruthy();
    expect(screen.getByText("Device reminders still work without an account.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("closes with Escape and returns focus to the bell", () => {
    render(<DashboardNotificationCenter />);
    const trigger = screen.getByRole("button", { name: "Notifications, 1 item needs attention" });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Notifications" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps routine history available without turning it into an attention badge", () => {
    remote = {
      data: settings(Array.from({ length: 11 }, (_, index) => ({
        id: `delivered-${index}`,
        type: "weekly_report",
        status: "delivered",
        created_at: `2026-10-15T${String(10 - Math.min(index, 9)).padStart(2, "0")}:00:00.000Z`,
      }))),
      loading: false,
      error: "",
      reload,
    };
    render(<DashboardNotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.queryByText("9+")).toBeNull();
    expect(screen.getAllByText("Weekly Report")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("axom.communicationReads.v1:account-a") ?? "[]")).toHaveLength(11);
  });

  it("closes on focus departure without stealing focus from the next control", async () => {
    render(<><DashboardNotificationCenter /><button type="button">Continue studying</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 item needs attention" }));
    const next = screen.getByRole("button", { name: "Continue studying" });
    next.focus();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(next);
  });

  it("returns focus to the bell after an outside blank-area dismissal", async () => {
    render(<DashboardNotificationCenter />);
    const trigger = screen.getByRole("button", { name: "Notifications, 1 item needs attention" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });
});
