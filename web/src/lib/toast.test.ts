// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushToast, REMINDER_TOAST_DURATION_MS, TOAST_RESUME_GRACE_MS, useToasts } from "./toast";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

function onlyToastId() {
  const [toast] = useToasts.getState().toasts;
  return toast.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  for (const toast of useToasts.getState().toasts) useToasts.getState().dismiss(toast.id);
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("toast auto-dismiss", () => {
  it("keeps the default six-second duration and sticky zero-duration notices", () => {
    pushToast({ title: "Saved" });
    pushToast({ title: "Local data needs attention", duration: 0 });
    vi.advanceTimersByTime(5_999);
    expect(useToasts.getState().toasts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(useToasts.getState().toasts.map(toast => toast.title)).toEqual(["Local data needs attention"]);
    vi.advanceTimersByTime(60 * 60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("gives optional reminders a finite duration so they never cover the page indefinitely", () => {
    expect(REMINDER_TOAST_DURATION_MS).toBeGreaterThanOrEqual(10_000);
    pushToast({ title: "Wrap up today", duration: REMINDER_TOAST_DURATION_MS });
    vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("pauses while hovered and resumes with the remaining time", () => {
    pushToast({ title: "Reminder", duration: 10_000 });
    const id = onlyToastId();
    vi.advanceTimersByTime(4_000);
    useToasts.getState().hold(id, "hover");
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
    useToasts.getState().release(id, "hover");
    vi.advanceTimersByTime(5_999);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("waits until every hold is released and leaves a short grace period", () => {
    pushToast({ title: "Reminder", duration: 3_000 });
    const id = onlyToastId();
    vi.advanceTimersByTime(2_900);
    useToasts.getState().hold(id, "hover");
    useToasts.getState().hold(id, "focus");
    useToasts.getState().release(id, "hover");
    vi.advanceTimersByTime(30_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
    useToasts.getState().release(id, "focus");
    vi.advanceTimersByTime(TOAST_RESUME_GRACE_MS - 1);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("does not count time while the page is hidden, including toasts raised in the background", () => {
    setVisibility("hidden");
    pushToast({ title: "Set today’s direction", duration: 5_000 });
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
    setVisibility("visible");
    vi.advanceTimersByTime(3_000);
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
    setVisibility("visible");
    vi.advanceTimersByTime(2_000);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("ignores holds for sticky or dismissed toasts and still de-duplicates", () => {
    pushToast({ title: "Update available", duration: 0, dedupe: "update" });
    pushToast({ title: "Update available", duration: 0, dedupe: "update" });
    const id = onlyToastId();
    expect(useToasts.getState().toasts).toHaveLength(1);
    useToasts.getState().hold(id, "hover");
    useToasts.getState().release(id, "hover");
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
    useToasts.getState().dismiss(id);
    expect(() => useToasts.getState().release(id, "hover")).not.toThrow();
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
