// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DOCTORDLE_LOG, useDoctordle } from "../../lib/doctordle";
import { DoctordleCheckIn } from "./DoctordleCheckIn";
import { DoctordleReminder } from "./DoctordleReminder";

const NOON = Date.parse("2026-09-29T16:00:00Z"); // case #440

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  localStorage.clear();
  useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DoctordleCheckIn", () => {
  it("asks how it went once the learner is back, logs the answer, then gets out of the way", () => {
    useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG, opened: [440], lastOpenedAt: NOON - 30_000 } });
    render(<DoctordleCheckIn suspended={false} />);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByRole("dialog", { name: "Did you get today's Doctordle?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(useDoctordle.getState().log.results).toEqual({ 440: "solved" });
    expect(screen.getByText("Nice one.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays quiet while suspended, and Later snoozes it", () => {
    useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG, opened: [440], lastOpenedAt: NOON - 30_000 } });
    const view = render(<DoctordleCheckIn suspended />);
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<DoctordleCheckIn suspended={false} />);
    act(() => { vi.advanceTimersByTime(900); });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useDoctordle.getState().log.snoozedUntil).toBeGreaterThan(NOON);
  });
});

describe("DoctordleReminder", () => {
  const regular = { ...EMPTY_DOCTORDLE_LOG, opened: [436], results: { 438: "solved" as const } };

  it("says nothing to someone who never plays", () => {
    render(<DoctordleReminder />);
    expect(screen.queryByText("Did you do today's Doctordle?")).toBeNull();
  });

  it("walks Yes -> Got it and logs today's case", () => {
    useDoctordle.setState({ log: regular });
    render(<DoctordleReminder />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(useDoctordle.getState().log.results[440]).toBe("solved");
    expect(screen.getByText("Logged. Nice one.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByText(/Doctordle|Logged/)).toBeNull();
  });

  it("No offers the game, and opening it hands over to the return check-in", () => {
    useDoctordle.setState({ log: regular });
    render(<DoctordleReminder />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    const link = screen.getByRole("link", { name: /Open doctordle.org/ });
    expect(link.getAttribute("rel")).toContain("noopener");
    fireEvent.click(link);
    expect(useDoctordle.getState().log.opened).toContain(440);
    expect(screen.queryByText("It's a quick one")).toBeNull();
  });

  it("Don't show again turns reminders off", () => {
    useDoctordle.setState({ log: regular });
    render(<DoctordleReminder />);
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(useDoctordle.getState().log.remindersOff).toBe(true);
    expect(screen.queryByText("Did you do today's Doctordle?")).toBeNull();
  });
});
