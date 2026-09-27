// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../soundscapes/SoundscapeVisual", () => ({ SoundscapeVisual: ({ label }: { label?: string }) => <div data-testid="visual">{label}</div> }));

const { FocusDock } = await import("./FocusDock");
const { usePomodoro } = await import("../../lib/pomodoro");
const { useSoundscape, setSoundscapeEngineForTests } = await import("../../lib/soundscapes/store");
const { useSessionUi } = await import("../../lib/sessionUi");
const { useStore } = await import("../../lib/store");
const { makeSeed } = await import("../../lib/seed");

const engine = { play: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), setVolume: vi.fn(), analyserNode: null };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState(makeSeed());
  setSoundscapeEngineForTests(engine as never);
  useSoundscape.setState({ status: "idle", presetId: null, stopAt: undefined });
  usePomodoro.getState().reset();
  useSessionUi.setState({ focusMode: false, capturing: false });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  usePomodoro.getState().pause();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("focus dock", () => {
  it("stays out of the way when nothing is running", () => {
    render(<FocusDock />);
    expect(screen.queryByRole("region", { name: "Focus dock" })).toBeNull();
  });

  it("shows a running Pomodoro as a single pill with working controls", () => {
    act(() => usePomodoro.getState().start());
    render(<FocusDock />);
    const dock = screen.getByRole("region", { name: "Focus dock" });
    expect(dock.classList.contains("split")).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/Focus running/);
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    expect(usePomodoro.getState().running).toBe(false);
    expect(screen.getByRole("button", { name: "Resume timer" })).toBeTruthy();
  });

  it("splits into a timer and a sound capsule, and genies the visual on hover", async () => {
    act(() => usePomodoro.getState().start());
    await act(() => useSoundscape.getState().play("gamma-40"));
    render(<FocusDock />);
    expect(screen.getByRole("region", { name: "Focus dock" }).classList.contains("split")).toBe(true);
    const name = screen.getByRole("button", { name: /40 Hz Gamma soundscape/ });
    fireEvent.mouseEnter(name.closest(".dock-sound-wrap")!);
    expect(screen.queryByRole("dialog", { name: "40 Hz Gamma soundscape" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    const panel = screen.getByRole("dialog", { name: "40 Hz Gamma soundscape" });
    expect(panel.textContent).toMatch(/Tentative evidence/);
    fireEvent.keyDown(panel, { key: "Escape" });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.queryByRole("dialog", { name: "40 Hz Gamma soundscape" })).toBeNull();
  });

  it("opens the genie from the keyboard and stops the sound from the pill", async () => {
    await act(() => useSoundscape.getState().play("soft-rain"));
    render(<FocusDock />);
    fireEvent.focus(screen.getByRole("button", { name: /Soft rain soundscape/ }));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("dialog", { name: "Soft rain soundscape" })).toBeTruthy();
    // Rain arms its sleep-friendly stop timer by default.
    expect(screen.getAllByText(/Stops in 20 min/).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop sound" })); });
    expect(useSoundscape.getState().status).toBe("idle");
  });

  it("finishes a live study session through the capture", () => {
    act(() => {
      useStore.getState().startSession({ title: "Renal transport", link: { kind: "free", label: "Free study" }, source: "manual" });
    });
    const { container } = render(<FocusDock />);
    expect(screen.getByRole("status").textContent).toMatch(/Session running/);
    fireEvent.mouseEnter(container.querySelector(".focus-dock-content .dock-timer")!);
    fireEvent.click(screen.getByRole("button", { name: "Finish session" }));
    expect(useSessionUi.getState().capturing).toBe(true);
  });
});
