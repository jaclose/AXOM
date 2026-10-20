// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journalReminderLedger } from "../../lib/journalReminder";
import { dismissReflectionDays, reflectionDismissalKey } from "../../lib/reflectionDismissals";
import { useToasts } from "../../lib/toast";
import type { DayPlan } from "../../lib/types";
import { Toaster } from "../shell/Toaster";
import { ReflectionInbox } from "./ReflectionInbox";

const plans: DayPlan[] = [
  {
    dayKey: "2026-10-14",
    intention: "Finish the cardiology lectures",
    wins: [],
    createdAt: "2026-10-14T08:00:00.000Z",
  },
  {
    dayKey: "2026-10-10",
    intention: "Complete a question block",
    wins: [],
    createdAt: "2026-10-10T08:00:00.000Z",
  },
];

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
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  useToasts.setState({ toasts: [] });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("ReflectionInbox", () => {
  it("dismisses exact days across remount and day rollover while leaving new days eligible", () => {
    const originalPlans = structuredClone(plans);
    const first = render(
      <ReflectionInbox dayKeys={["2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss these days" }));
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();
    expect(plans).toEqual(originalPlans);
    expect(useToasts.getState().toasts.at(-1)?.title).toBe("Catch-up reminders dismissed");
    first.unmount();

    const { rerender } = render(
      <ReflectionInbox dayKeys={["2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-16" workspaceKey="profile-a" />,
    );
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();
    rerender(<ReflectionInbox dayKeys={["2026-10-15", "2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-16" workspaceKey="profile-a" />);
    expect(screen.getByRole("button", { name: /Continue Oct 15/ })).toBeTruthy();
    expect(screen.getByText(/One day is ready/)).toBeTruthy();
    rerender(<ReflectionInbox dayKeys={["2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-16" workspaceKey="profile-b" />);
    expect(screen.getByText(/2 days are ready/)).toBeTruthy();
  });

  it("offers Undo without completing or deleting any reflection", () => {
    render(<ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="undo-profile" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss these days" }));
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.actionLabel).toBe("Undo");
    act(() => toast.onAction?.());
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("retains the reminder and reports a failed preference write", () => {
    vi.spyOn(memoryLocalStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    render(<ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="full-profile" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss these days" }));
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ title: "Could not dismiss these days", tone: "warn" });
    expect(useToasts.getState().toasts.at(-1)?.body).toMatch(/could not confirm dismissal/);
  });

  it("keeps a working Undo retry after the original toast is dismissed on failure", () => {
    render(<>
      <ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="retry-undo" />
      <Toaster />
    </>);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss these days" }));
    vi.spyOn(memoryLocalStorage, "setItem").mockImplementationOnce(() => { throw new Error("blocked"); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();
    expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(["Could not undo dismissal"]);
    fireEvent.click(screen.getByRole("button", { name: "Retry Undo" }));
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("reconciles dismissals and restoration from another tab", () => {
    render(<ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="other-tab" />);
    const key = reflectionDismissalKey("other-tab", "2026-10-14");
    act(() => {
      localValues.set(key, "another-tab-token");
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();
    act(() => {
      localValues.delete(key);
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("never includes previously dismissed dates in Continue or the expanded list", () => {
    dismissReflectionDays("filtered-profile", ["2026-10-14"]);
    render(<ReflectionInbox dayKeys={["2026-10-14", "2026-10-13", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="filtered-profile" />);
    expect(screen.getByRole("button", { name: /Continue Oct 13/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View all 2" }));
    expect(screen.queryByRole("button", { name: /Oct 14/ })).toBeNull();
  });

  it("recommends one useful next action and keeps the rest behind disclosure", () => {
    const open = vi.fn();
    render(
      <ReflectionInbox
        dayKeys={["2026-10-14", "2026-10-10"]}
        dayPlans={plans}
        activeDayKey="2026-10-15"
        workspaceKey="profile-a"
        onOpenDay={open}
      />,
    );

    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
    expect(screen.getByText(/2 days are ready when you are/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Oct 10, 2026/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View all 2" }));
    fireEvent.click(screen.getByRole("button", { name: /Oct 10, 2026/ }));
    expect(open).toHaveBeenCalledWith("2026-10-10");
  });

  it("hides for the current day without changing Journal data and returns the next day", () => {
    const { rerender } = render(
      <ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not today" }));
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();

    rerender(<ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-16" workspaceKey="profile-a" />);
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("supports a four-hour reminder without deleting or completing a reflection", () => {
    const start = new Date("2026-10-15T12:00:00.000Z");
    const { unmount } = render(
      <ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" now={() => start} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();
    unmount();

    render(
      <ReflectionInbox
        dayKeys={["2026-10-14"]}
        dayPlans={plans}
        activeDayKey="2026-10-15"
        workspaceKey="profile-a"
        now={() => new Date(start.getTime() + 4 * 60 * 60_000 + 1)}
      />,
    );
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("returns automatically when a four-hour reminder expires on an open dashboard", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
    render(
      <ReflectionInbox
        dayKeys={["2026-10-14"]}
        dayPlans={plans}
        activeDayKey="2026-10-15"
        workspaceKey="profile-a"
        now={() => new Date(Date.now())}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();

    act(() => vi.advanceTimersByTime(4 * 60 * 60_000 + 20));
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("keeps a same-day dismissal when the eligible days change but not across workspaces", () => {
    const { rerender } = render(
      <ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not today" }));

    rerender(
      <ReflectionInbox dayKeys={["2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" />,
    );
    expect(screen.queryByRole("region", { name: "Reflection inbox" })).toBeNull();

    rerender(
      <ReflectionInbox dayKeys={["2026-10-14", "2026-10-10"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-b" />,
    );
    expect(screen.getByRole("region", { name: "Reflection inbox" })).toBeTruthy();
  });

  it("replaces the shell catch-up nudge instead of showing a duplicate", () => {
    useToasts.setState({
      toasts: [{
        id: "catch-up-toast",
        title: "Journal catch-up",
        tone: "warn",
        duration: 20_000,
        dedupe: "missed-standup:2026-10-15:2026-10-14",
      }],
    });

    render(
      <ReflectionInbox dayKeys={["2026-10-14"]} dayPlans={plans} activeDayKey="2026-10-15" workspaceKey="profile-a" />,
    );

    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(journalReminderLedger.nextTarget("2026-10-15", ["2026-10-14"])).toBeUndefined();
  });

  it("keeps the dashboard authoritative for every visible missed day", () => {
    render(
      <ReflectionInbox
        dayKeys={["2026-10-18", "2026-10-17"]}
        dayPlans={[]}
        activeDayKey="2026-10-20"
        workspaceKey="profile-a"
      />,
    );

    journalReminderLedger.skip("2026-10-20", "2026-10-18");
    expect(journalReminderLedger.nextTarget("2026-10-20", ["2026-10-18", "2026-10-17"]))
      .toBeUndefined();
  });
});
