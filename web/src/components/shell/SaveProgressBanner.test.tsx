// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { SaveProgressBanner } from "./SaveProgressBanner";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({ ...makeSeed(), logs: [] });
  useAccount.setState({ phase: "signed-out", user: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const logSomething = () => act(() => { useStore.setState({ logs: [{ id: "l1", dayKey: "2026-09-30", ts: "2026-09-30T12:00:00Z", type: "Pomodoro", minutes: 25, cards: 0 }] as never }); });

describe("SaveProgressBanner", () => {
  it("slides in after the first saved work, then opens account sign-up and steps aside", () => {
    const create = vi.fn();
    render(<SaveProgressBanner suspended={false} onCreateAccount={create} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Save your progress")).toBeNull();

    logSomething();
    act(() => { vi.advanceTimersByTime(2300); });
    expect(screen.getByRole("region", { name: "Save your progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make an account" }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.queryByText("Save your progress")).toBeNull();
  });

  it("waits while something else is on screen, never shows when signed in, and Not now closes it", () => {
    const { rerender } = render(<SaveProgressBanner suspended onCreateAccount={vi.fn()} />);
    logSomething();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Save your progress")).toBeNull();

    act(() => { useAccount.setState({ phase: "signed-in" }); });
    rerender(<SaveProgressBanner suspended={false} onCreateAccount={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Save your progress")).toBeNull();

    act(() => { useAccount.setState({ phase: "signed-out" }); });
    act(() => { vi.advanceTimersByTime(2300); });
    fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
    expect(screen.queryByText("Save your progress")).toBeNull();
    expect(JSON.parse(localStorage.getItem("axom.saveProgress.v1")!).state).toBe("snoozed");
  });
});
