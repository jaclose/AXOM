// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDailyLoopReminderLedger } from "../../lib/dailyLoopReminders";
import { useStore } from "../../lib/store";
import { REMINDER_TOAST_DURATION_MS, useToasts } from "../../lib/toast";
import { Toaster } from "./Toaster";
import {
  DAILY_LOOP_REMINDER_OPEN_EVENT,
  DailyLoopReminderWatcher,
} from "./DailyLoopReminderWatcher";

function localTime(hour: number, minute = 0, day = 13): Date {
  return new Date(2026, 6, day, hour, minute, 0, 0);
}

function memoryLedger() {
  const values = new Map<string, string>();
  return createDailyLoopReminderLedger(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  }));
}

function renderWatcher(clock: () => Date) {
  return render(<>
    <DailyLoopReminderWatcher ledger={memoryLedger()} clock={clock} pollIntervalMs={0} />
    <Toaster />
  </>);
}

beforeEach(() => {
  window.location.hash = "";
  useToasts.setState({ toasts: [] });
  useStore.setState((state) => ({
    activeDayKey: "2026-07-13",
    dayPlans: [],
    closeouts: [],
    profile: {
      ...state.profile,
      dailyLoopReminders: {
        checkInEnabled: true,
        checkInTime: "08:00",
        closeoutEnabled: true,
        closeoutTime: "20:30",
      },
    },
  }));
});

afterEach(() => {
  cleanup();
  useToasts.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe("DailyLoopReminderWatcher", () => {
  it("publishes one non-blocking morning signal and exposes an exact-day open event", async () => {
    const now = localTime(9);
    const opened = vi.fn();
    window.addEventListener(DAILY_LOOP_REMINDER_OPEN_EVENT, opened);
    renderWatcher(() => now);

    expect(await screen.findByText("Set today’s direction")).toBeTruthy();
    expect(screen.getByText(/less than a minute.*optional/i)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useToasts.getState().toasts.map((toast) => toast.duration)).toEqual([REMINDER_TOAST_DURATION_MS]);

    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    expect(window.location.hash).toBe("#dashboard");
    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ kind: "check-in", dayKey: "2026-07-13" });
    window.removeEventListener(DAILY_LOOP_REMINDER_OPEN_EVENT, opened);
  });

  it("snoozes without repeating early, then reconciles after browser wake", async () => {
    let now = localTime(9);
    renderWatcher(() => now);
    fireEvent.click(await screen.findByRole("button", { name: "Snooze 30 min" }));
    expect(screen.queryByText("Set today’s direction")).toBeNull();

    now = localTime(9, 29);
    fireEvent(window, new Event("pageshow"));
    expect(screen.queryByText("Set today’s direction")).toBeNull();

    now = localTime(9, 30);
    fireEvent.focus(window);
    expect(await screen.findByText("Set today’s direction")).toBeTruthy();
  });

  it("uses the 20:30 local closeout boundary and suppresses a completed day", async () => {
    let now = localTime(20, 29);
    const first = renderWatcher(() => now);
    expect(screen.queryByText("Wrap up today")).toBeNull();

    now = localTime(20, 30);
    fireEvent(window, new Event("pageshow"));
    expect(await screen.findByText("Wrap up today")).toBeTruthy();
    first.unmount();
    useToasts.setState({ toasts: [] });

    useStore.setState({
      closeouts: [{
        id: "closed", dayKey: "2026-07-13", completedSummary: "Finished the plan",
        tomorrowMode: "auto", createdAt: now.toISOString(), updatedAt: now.toISOString(),
      }],
    });
    renderWatcher(() => now);
    await waitFor(() => expect(screen.queryByText("Wrap up today")).toBeNull());
  });

  it("keeps a reminder pending during quiet hours and publishes it once after quiet hours end", async () => {
    let now = localTime(9);
    const ledger = memoryLedger();
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        dailyLoopReminders: {
          ...state.profile.dailyLoopReminders,
          quietHoursEnabled: true,
          quietHoursStart: "08:30",
          quietHoursEnd: "10:00",
        },
      },
    }));
    render(<>
      <DailyLoopReminderWatcher ledger={ledger} clock={() => now} pollIntervalMs={0} />
      <Toaster />
    </>);

    await waitFor(() => expect(screen.queryByText("Set today’s direction")).toBeNull());
    expect(ledger.read("2026-07-13").checkIn.disposition).toBe("pending");

    now = localTime(10);
    fireEvent(window, new Event("pageshow"));
    expect(await screen.findByText("Set today’s direction")).toBeTruthy();
    expect(ledger.read("2026-07-13").checkIn.disposition).toBe("shown");

    fireEvent.focus(window);
    expect(screen.getAllByText("Set today’s direction")).toHaveLength(1);
  });

  it("never uses a stale active-day cursor or yesterday's check-in as today's completion", async () => {
    useStore.setState({
      activeDayKey: "2026-07-12",
      dayPlans: [{
        dayKey: "2026-07-12", intention: "Yesterday", wins: [], createdAt: "2026-07-12T08:00:00.000Z",
      }],
    });
    renderWatcher(() => localTime(9));
    expect(await screen.findByText("Set today’s direction")).toBeTruthy();
  });

  it("honors disabled reminders and keeps one signal through StrictMode replay", async () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        dailyLoopReminders: {
          checkInEnabled: false,
          checkInTime: "08:00",
          closeoutEnabled: false,
          closeoutTime: "20:30",
        },
      },
    }));
    const disabled = renderWatcher(() => localTime(21));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    disabled.unmount();

    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        dailyLoopReminders: { ...state.profile.dailyLoopReminders, checkInEnabled: true },
      },
    }));
    render(<StrictMode>
      <DailyLoopReminderWatcher ledger={memoryLedger()} clock={() => localTime(9)} pollIntervalMs={0} />
      <Toaster />
    </StrictMode>);
    expect(await screen.findAllByText("Set today’s direction")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
