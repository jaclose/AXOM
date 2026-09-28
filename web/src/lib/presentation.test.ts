// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TIMING,
  coverForIntro,
  markAppReady,
  onAppReady,
  resetPresentationForTests,
  revealApp,
  usePageEntrance,
  whenAppReady,
} from "./presentation";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  resetPresentationForTests();
});

afterEach(() => {
  resetPresentationForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.motion;
});

describe("presentation", () => {
  it("reveals the interface, then removes the attribute so nothing stays animated", async () => {
    markAppReady();
    revealApp("intro");
    expect(document.documentElement.dataset.reveal).toBe("intro");
    await vi.advanceTimersByTimeAsync(PRESENTATION_TIMING.settleMs);
    expect(document.documentElement.dataset.reveal).toBeUndefined();
  });

  it("keeps a plain open's reveal until real content has rendered", async () => {
    revealApp("open");
    await vi.advanceTimersByTimeAsync(PRESENTATION_TIMING.settleMs * 2);
    expect(document.documentElement.dataset.reveal).toBe("open");
    markAppReady();
    await vi.advanceTimersByTimeAsync(PRESENTATION_TIMING.settleMs);
    expect(document.documentElement.dataset.reveal).toBeUndefined();
  });

  it("does nothing under reduced motion (the OS setting or AXOM's own)", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    revealApp("open");
    expect(document.documentElement.dataset.reveal).toBeUndefined();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
    document.documentElement.dataset.motion = "reduce";
    revealApp("intro");
    expect(document.documentElement.dataset.reveal).toBeUndefined();
  });

  it("never lets a wait on readiness hang", async () => {
    const waited = vi.fn();
    void whenAppReady(500).then(waited);
    await vi.advanceTimersByTimeAsync(500);
    expect(waited).toHaveBeenCalledOnce();
    const ready = vi.fn();
    const stop = onAppReady(ready);
    stop();
    markAppReady();
    expect(ready).not.toHaveBeenCalled();
    onAppReady(ready);
    expect(ready).toHaveBeenCalledOnce();
  });

  it("gives each tab its entrance once, and not while the first screen is still resolving", () => {
    const { result, rerender } = renderHook(({ route }) => usePageEntrance(route), { initialProps: { route: "reports" } });
    expect(result.current).toBe(true);
    rerender({ route: "reports" });
    expect(result.current).toBe(true); // fixed for the whole visit
    rerender({ route: "journal" });
    expect(result.current).toBe(true);
    rerender({ route: "reports" });
    expect(result.current).toBe(false);

    resetPresentationForTests();
    coverForIntro();
    const covered = renderHook(() => usePageEntrance("dashboard"));
    expect(covered.result.current).toBe(false);
  });
});
