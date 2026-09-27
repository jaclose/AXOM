// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushToast, REMINDER_TOAST_DURATION_MS, useToasts } from "../../lib/toast";
import { Toaster } from "./Toaster";

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  for (const toast of useToasts.getState().toasts) useToasts.getState().dismiss(toast.id);
  vi.useRealTimers();
});

function showReminder() {
  act(() => pushToast({
    title: "Wrap up today",
    body: "Review what changed. This is optional.",
    duration: REMINDER_TOAST_DURATION_MS,
    actions: [{ label: "Open closeout" }, { label: "Skip today" }],
  }));
}

describe("Toaster", () => {
  it("dismisses an optional reminder on its own after the reminder duration", () => {
    render(<Toaster />);
    showReminder();
    expect(screen.getByRole("status").textContent).toContain("Wrap up today");
    act(() => { vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS); });
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("keeps a reminder while the pointer is over it", () => {
    render(<Toaster />);
    showReminder();
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => { vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS * 3); });
    expect(screen.getByText("Wrap up today")).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => { vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS); });
    expect(screen.queryByText("Wrap up today")).toBeNull();
  });

  it("keeps a reminder while keyboard focus is inside it, including moves between its controls", () => {
    render(<Toaster />);
    showReminder();
    const open = screen.getByRole("button", { name: /Open closeout/ });
    const skip = screen.getByRole("button", { name: /Skip today/ });
    act(() => open.focus());
    act(() => skip.focus());
    act(() => { vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS * 3); });
    expect(screen.getByText("Wrap up today")).toBeTruthy();
    act(() => skip.blur());
    act(() => { vi.advanceTimersByTime(REMINDER_TOAST_DURATION_MS); });
    expect(screen.queryByText("Wrap up today")).toBeNull();
  });

  it("keeps an explicit, named dismiss control", () => {
    render(<Toaster />);
    showReminder();
    const dismiss = screen.getByRole("button", { name: "Dismiss Wrap up today" });
    expect(dismiss.getAttribute("type")).toBe("button");
    expect(dismiss.classList.contains("toast-close")).toBe(true);
    fireEvent.click(dismiss);
    expect(screen.queryByText("Wrap up today")).toBeNull();
  });
});
