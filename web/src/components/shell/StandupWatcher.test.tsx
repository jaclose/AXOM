// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/brand";
import { useAccount } from "../../lib/account/accountStore";
import { dismissReflectionDays, reflectionDismissalKey } from "../../lib/reflectionDismissals";
import { deviceId } from "../../lib/sync/syncMetadata";
import { prettyDate } from "../../lib/scoring";
import { useStore } from "../../lib/store";
import { pushToast, REMINDER_TOAST_DURATION_MS, useToasts } from "../../lib/toast";
import { useUi } from "../../lib/uiStore";
import type { JournalEntry, StudyLog } from "../../lib/types";
import { StandupWatcher } from "./StandupWatcher";
import { Toaster } from "./Toaster";

/** A notice that is still active (dismissed ones evaporate for a moment). */
const activeToast = (text: string) => screen.queryByText(text)?.closest(".toast:not(.is-leaving)") ?? null;

function studyLog(day: string, id = day): StudyLog {
  return { id, dayKey: day, ts: `${day}T10:00:00`, type: "Study", minutes: 30, cards: 0 };
}

function setReminderState(today: string, missedDays: string[], journal: JournalEntry[] = []) {
  useStore.setState({
    activeDayKey: today,
    journal,
    logs: missedDays.map((day, index) => studyLog(day, `log-${index}`)),
    dayPlans: [],
  });
}

function renderWatcher() {
  return render(<><StandupWatcher /><Toaster /></>);
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  });
  window.location.hash = "";
  useToasts.setState({ toasts: [] });
  useUi.setState({ journalDay: null });
  useAccount.setState({ user: null });
});

afterEach(() => {
  cleanup();
  useToasts.setState({ toasts: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StandupWatcher", () => {
  it("suppresses dismissed dates after day rollover but offers a new missed date", async () => {
    const workspaceKey = `device:${deviceId()}:account:local`;
    dismissReflectionDays(workspaceKey, ["2026-10-17", "2026-10-18"]);
    setReminderState("2026-10-20", ["2026-10-17", "2026-10-18"]);
    const first = renderWatcher();
    expect(useToasts.getState().toasts).toHaveLength(0);
    first.unmount();
    setReminderState("2026-10-21", ["2026-10-17", "2026-10-18", "2026-10-20"]);
    renderWatcher();
    expect(await screen.findByText(`Journal catch-up for ${prettyDate("2026-10-20T12:00:00")}`)).toBeTruthy();
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("removes an already-visible toast when its day is dismissed on this device", async () => {
    setReminderState("2026-10-23", ["2026-10-22"]);
    renderWatcher();
    expect(await screen.findByRole("button", { name: "Complete catch-up" })).toBeTruthy();
    act(() => { dismissReflectionDays(`device:${deviceId()}:account:local`, ["2026-10-22"]); });
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("suppresses an in-flight toast when another tab saves the same exact-day preference", async () => {
    setReminderState("2026-10-25", ["2026-10-24"]);
    renderWatcher();
    expect(await screen.findByRole("button", { name: "Complete catch-up" })).toBeTruthy();
    const key = reflectionDismissalKey(`device:${deviceId()}:account:local`, "2026-10-24");
    act(() => {
      localStorage.setItem(key, "another-tab-token");
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("names the newest missed date and routes catch-up to that exact day without changing journal data", async () => {
    const existing: JournalEntry = {
      id: "existing",
      date: "2026-07-08T12:00:00",
      today: "Existing reflection",
      tomorrow: "",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    };
    setReminderState("2026-07-11", ["2026-07-09", "2026-07-10"], [existing]);
    renderWatcher();

    const label = prettyDate("2026-07-10T12:00:00");
    expect(await screen.findByText(`Journal catch-up for ${label}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`activity on ${label}`))).toBeTruthy();
    expect(screen.getByText(/it is optional/i)).toBeTruthy();
    expect(screen.getByRole("group", { name: `Journal catch-up for ${label} actions` })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Complete catch-up" }));
    expect(useUi.getState().journalDay).toBe("2026-07-10");
    expect(window.location.hash).toBe("#journal");
    expect(useStore.getState().journal).toEqual([existing]);
  });

  it("is an optional reminder that leaves on its own instead of covering the page until dismissed", async () => {
    setReminderState("2026-07-16", ["2026-07-15"]);
    renderWatcher();
    expect(await screen.findByRole("button", { name: /Dismiss Journal catch-up/ })).toBeTruthy();
    expect(useToasts.getState().toasts.map((toast) => toast.duration)).toEqual([REMINDER_TOAST_DURATION_MS]);
  });

  it("persists Skip for the current day and target", async () => {
    setReminderState("2026-07-12", ["2026-07-11"]);
    const first = renderWatcher();
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));

    const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.missedStandupReminder)!) as {
      day: string;
      skippedTargets: string[];
    };
    expect(metadata.day).toBe("2026-07-12");
    expect(metadata.skippedTargets).toContain("2026-07-11");

    first.unmount();
    useToasts.setState({ toasts: [] });
    renderWatcher();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("suppresses every remaining reminder after Do not remind me again today", async () => {
    setReminderState("2026-07-13", ["2026-07-12"]);
    renderWatcher();
    fireEvent.click(await screen.findByRole("button", { name: "Do not remind me again today" }));

    const metadata = JSON.parse(localStorage.getItem(STORAGE_KEYS.missedStandupReminder)!) as { muted: boolean };
    expect(metadata.muted).toBe(true);

    useStore.setState((state) => ({ logs: [...state.logs, studyLog("2026-07-11", "another-day")] }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("does not repeat within the session when localStorage throws", async () => {
    setReminderState("2026-07-14", ["2026-07-13"]);
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });

    const first = renderWatcher();
    const title = `Journal catch-up for ${prettyDate("2026-07-13T12:00:00")}`;
    expect(await screen.findByText(title)).toBeTruthy();
    first.unmount();
    useToasts.setState({ toasts: [] });

    renderWatcher();
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
  });

  it("keeps one exact-day reminder in flight during StrictMode effect replay", async () => {
    setReminderState("2026-07-15", ["2026-07-14", "2026-07-13"]);
    render(<StrictMode><StandupWatcher /><Toaster /></StrictMode>);

    expect(await screen.findByText(`Journal catch-up for ${prettyDate("2026-07-14T12:00:00")}`)).toBeTruthy();
    expect(screen.queryByText(`Journal catch-up for ${prettyDate("2026-07-13T12:00:00")}`)).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("Toaster action compatibility", () => {
  it("keeps the legacy single-action API working", () => {
    const onAction = vi.fn();
    pushToast({ title: "Legacy action", actionLabel: "Open", onAction, duration: 0 });
    render(<Toaster />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(activeToast("Legacy action")).toBeNull();
  });
});
