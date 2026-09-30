// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cues from "../../lib/timerCues";
import { usePomodoro } from "../../lib/pomodoro";
import { TimerEdgeGlow } from "./TimerEdgeGlow";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  usePomodoro.setState({ running: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TimerEdgeGlow", () => {
  it("plays the start tone only when a timer actually starts", () => {
    const start = vi.spyOn(cues, "playTimerStartCue").mockImplementation(() => undefined);
    render(<TimerEdgeGlow />);
    act(() => usePomodoro.setState({ running: true }));
    act(() => usePomodoro.setState({ secondsLeft: 100 }));
    act(() => usePomodoro.setState({ running: false }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("blooms on a finish and clears itself", () => {
    const { container } = render(<TimerEdgeGlow />);
    expect(container.querySelector(".timer-edge-glow")).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(cues.TIMER_GLOW_EVENT)); });
    expect(container.querySelector(".timer-edge-glow")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2700); });
    expect(container.querySelector(".timer-edge-glow")).toBeNull();
  });
});
