// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../soundscapes/SoundscapeVisual", () => ({ SoundscapeVisual: ({ label }: { label?: string }) => <div data-testid="visual">{label}</div> }));

const { FocusDock } = await import("./FocusDock");
const { usePomodoro } = await import("../../lib/pomodoro");
const { useSoundscape, setSoundscapeEngineForTests } = await import("../../lib/soundscapes/store");
const { applyUserSounds } = await import("../../lib/soundscapes/presets");
const { useSessionUi } = await import("../../lib/sessionUi");
const { useStore } = await import("../../lib/store");
const { makeSeed } = await import("../../lib/seed");

const engine = { play: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), setVolume: vi.fn(), analyserNode: null };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState(makeSeed());
  setSoundscapeEngineForTests(engine as never);
  useSoundscape.setState({ status: "idle", presetId: null, loadedVersionId: null, versions: {}, lastPresetId: "axom-1", stopAt: undefined });
  usePomodoro.getState().pause();
  usePomodoro.setState({
    presetId: "25-5", phase: "focus", secondsLeft: 25 * 60, running: false,
    focusRunStarted: false, autoLog: true, sessionsToday: 0, loggedMinutesToday: 0,
    anchorDay: useStore.getState().activeDayKey, activeSavedPresetId: undefined,
    targetKind: "free", targetId: undefined, targetLabel: undefined, intention: "",
  });
  useSessionUi.setState({ focusMode: false, capturing: false });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("(min-width: 561px)"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  applyUserSounds([]);
  usePomodoro.getState().pause();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("focus dock", () => {
  it("keeps both pills and starts the configured timer from idle", () => {
    const { container } = render(<FocusDock />);
    expect(screen.getByRole("region", { name: "Focus dock" })).toBeTruthy();
    expect(container.querySelectorAll(".focus-dock-content .dock-capsule")).toHaveLength(2);
    expect(container.querySelectorAll(".focus-dock-goo button")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    expect(usePomodoro.getState().running).toBe(true);
  });

  it("starts a break with the selected duration", () => {
    render(<FocusDock />);
    fireEvent.click(screen.getByRole("button", { name: "Timer options" }));
    fireEvent.change(screen.getByLabelText("Timer duration"), { target: { value: "50-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Start break" }));
    expect(usePomodoro.getState()).toMatchObject({ phase: "break", secondsLeft: 600, running: true });
  });

  it("keeps both pills while the Pomodoro is running or paused", () => {
    act(() => usePomodoro.getState().start());
    render(<FocusDock />);
    const dock = screen.getByRole("region", { name: "Focus dock" });
    expect(dock.classList.contains("split")).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Focus running/);
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    expect(usePomodoro.getState().running).toBe(false);
    expect(screen.getByRole("button", { name: "Resume timer" })).toBeTruthy();
  });

  it("resumes a paused sprint without resetting its duration or logging it twice", () => {
    act(() => {
      usePomodoro.getState().start();
      vi.advanceTimersByTime(90_000);
      usePomodoro.getState().pause();
    });
    const secondsLeft = usePomodoro.getState().secondsLeft;
    const logsBefore = useStore.getState().logs;
    const { container } = render(<FocusDock />);
    fireEvent.click(screen.getByRole("button", { name: "Resume timer" }));
    expect(usePomodoro.getState()).toMatchObject({ running: true, secondsLeft, focusRunStarted: true });
    expect(useStore.getState().logs).toEqual(logsBefore);
    fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
    fireEvent.mouseEnter(container.querySelector(".dock-timer")!);
    fireEvent.click(screen.getByRole("button", { name: "Reset timer" }));
    expect(useStore.getState().logs).toHaveLength(logsBefore.length + 1);
    expect(useStore.getState().logs[0]).toMatchObject({ type: "Pomodoro", minutes: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Reset timer" }));
    expect(useStore.getState().logs).toHaveLength(logsBefore.length + 1);
    expect(container.querySelectorAll(".focus-dock-content .dock-capsule")).toHaveLength(2);
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
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.getAttribute("aria-hidden")).toBe("true");
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
    expect(screen.getByRole("button", { name: "Play sound" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Focus dock" }).querySelectorAll(".focus-dock-content .dock-capsule")).toHaveLength(2);
  });

  it("requires explicit activation on narrow or touch layouts while preserving keyboard access", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { container } = render(<FocusDock />);
    const trigger = screen.getByRole("button", { name: /soundscape.*show visual and controls/ });
    fireEvent.mouseEnter(container.querySelector(".dock-sound-wrap")!);
    fireEvent.mouseEnter(container.querySelector(".dock-timer")!);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset timer" })).toBeNull();

    fireEvent.click(trigger);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.focus(trigger);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("labels the loaded recording until a paused replacement has actually started", async () => {
    applyUserSounds([
      { id: "first", name: "First recording", url: "blob:first", presetId: "yours" },
      { id: "second", name: "Second recording", url: "blob:second", presetId: "yours" },
    ]);
    await act(() => useSoundscape.getState().play("yours", { version: "user-first" }));
    const { container } = render(<FocusDock />);
    await act(() => useSoundscape.getState().pause());
    act(() => useSoundscape.getState().setVersion("yours", "user-second"));
    expect(container.querySelector(".dock-sound-name b")?.textContent).toBe("First recording");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play sound" })); });
    expect(container.querySelector(".dock-sound-name b")?.textContent).toBe("Second recording");
  });

  it("lets keyboard users tab forward into sound controls and escape back to the trigger", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<FocusDock />);
    const trigger = screen.getByRole("button", { name: /soundscape.*show visual and controls/ });
    act(() => trigger.focus());
    const panel = await screen.findByRole("dialog");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play sound" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stop sound" }));
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(panel.isConnected).toBe(false));
  });

  it("keeps sound controls open when the pointer leaves a keyboard-focused panel", async () => {
    const { container } = render(<FocusDock />);
    act(() => screen.getByRole("button", { name: /soundscape.*show visual and controls/ }).focus());
    await act(() => vi.advanceTimersByTimeAsync(0));
    const panel = screen.getByRole("dialog");
    const volume = within(panel).getByRole("slider", { name: "Volume" });
    act(() => volume.focus());
    fireEvent.mouseLeave(container.querySelector(".dock-sound-wrap")!);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("dialog")).toBe(panel);
    expect(document.activeElement).toBe(volume);
  });

  it("keeps extra controls open while the pointer crosses the gap", () => {
    act(() => usePomodoro.getState().start());
    const { container } = render(<FocusDock />);
    const capsule = container.querySelector(".focus-dock-content .dock-timer")!;
    fireEvent.mouseEnter(capsule);
    expect(screen.getByRole("button", { name: "Skip to next phase" })).toBeTruthy();
    fireEvent.mouseLeave(capsule);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseEnter(capsule);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("button", { name: "Skip to next phase" })).toBeTruthy();
    fireEvent.mouseLeave(capsule);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("button", { name: "Skip to next phase" })).toBeNull();
  });

  it("does not permit changing duration while the timer is running", () => {
    act(() => usePomodoro.getState().start());
    render(<FocusDock />);
    fireEvent.click(screen.getByRole("button", { name: "Timer options" }));
    expect((screen.getByLabelText("Timer duration") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Start break" }) as HTMLButtonElement).disabled).toBe(true);
    expect(usePomodoro.getState().running).toBe(true);
  });

  it("does not advertise timer options for a standalone session", () => {
    act(() => useStore.getState().startSession({ title: "Renal transport", link: { kind: "free", label: "Free study" }, source: "manual" }));
    render(<FocusDock />);
    expect(screen.queryByRole("button", { name: "Timer options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pause session" })).toBeTruthy();
  });

  it("returns keyboard focus to the session control when closing quick logs", () => {
    act(() => useStore.getState().startSession({ title: "Renal transport", link: { kind: "free", label: "Free study" }, source: "manual" }));
    render(<FocusDock />);
    const trigger = screen.getByRole("button", { name: "Pause session" });
    act(() => trigger.focus());
    fireEvent.click(screen.getByRole("button", { name: "Log a quick note" }));
    const log = within(screen.getByRole("menu", { name: "Quick log" })).getAllByRole("menuitem")[0];
    act(() => log.focus());
    fireEvent.keyDown(log, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("menu", { name: "Quick log" })).toBeNull();
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
