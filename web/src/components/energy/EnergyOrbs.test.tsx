// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { EnergyOrbs } from "./EnergyOrbs";

beforeEach(() => {
  localStorage.clear();
  useStore.setState(makeSeed());
  useStore.getState().updateProfile({ energyChecks: [] });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EnergyOrbs", () => {
  it("logs a check, answers from the orb row, and explains why only the first time", () => {
    vi.useFakeTimers();
    render(<EnergyOrbs />);
    expect(screen.getByRole("group", { name: "Energy right now" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log energy: Sharp" }));

    expect(useStore.getState().profile.energyChecks).toEqual([expect.objectContaining({ score: 92 })]);
    const bubble = screen.getByRole("status");
    expect(bubble.textContent).toContain("Energy logged. Check in again later.");
    expect(bubble.textContent).toContain("AXOM finds your best times of day");
    expect((screen.getByRole("button", { name: "Log energy: Low" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => { vi.runAllTimers(); });
    expect(screen.getByText(/at \d/).textContent).toContain("Energy sharp");
    fireEvent.click(screen.getByRole("button", { name: "Check in again" }));
    fireEvent.click(screen.getByRole("button", { name: "Log energy: Okay" }));
    expect(screen.getByRole("status").textContent).not.toContain("best times");
    expect(useStore.getState().profile.energyChecks).toHaveLength(2);
  });

  it("asks nothing more unless writing is on, then keeps the note with the check", () => {
    const { unmount } = render(<EnergyOrbs />);
    fireEvent.click(screen.getByRole("button", { name: "Log energy: Good" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    unmount();

    render(<EnergyOrbs writing />);
    fireEvent.click(screen.getByRole("button", { name: "Log energy: Sharp" }));
    const note = screen.getByLabelText(/feeling so good|working today|click/);
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    fireEvent.change(note, { target: { value: "Slept eight hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(useStore.getState().profile.energyChecks?.at(-1)).toMatchObject({ score: 92, note: "Slept eight hours" });
    expect(screen.getByText("Kept with this check-in.")).toBeTruthy();
  });
});
