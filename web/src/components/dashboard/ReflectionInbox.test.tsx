// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journalReminderLedger } from "../../lib/journalReminder";
import { useToasts } from "../../lib/toast";
import type { DayPlan } from "../../lib/types";
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
  vi.unstubAllGlobals();
});
describe("ReflectionInbox", () => {
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
});
