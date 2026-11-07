// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draw: vi.fn(() => false),
  fallback: vi.fn(),
  reduced: false,
}));
vi.mock("../../lib/motion", () => ({ useReducedMotion: () => mocks.reduced }));
vi.mock("../../lib/soundscapes/store", () => ({ soundscapeAnalyser: () => null }));
vi.mock("./shaders", () => ({
  shaderRenderer: { draw: mocks.draw },
  rgbChannels: () => [0.5, 0.5, 0.5],
}));
vi.mock("./visuals", () => ({
  VISUAL_RENDERERS: { flow: mocks.fallback },
}));
import { SoundscapeVisual } from "./SoundscapeVisual";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.draw.mockClear();
  mocks.fallback.mockClear();
  mocks.reduced = false;
});

describe("Soundscapes immersive rendering continuity", () => {
  it("continues a playing scene through fullscreen transitions without restarting it", () => {
    let clock = 100_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1440, height: 900, x: 0, y: 0, left: 0, top: 0, right: 1440, bottom: 900,
      toJSON: () => null,
    });

    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const view = render(<SoundscapeVisual visual="flow" animate />);
    expect(mocks.fallback).toHaveBeenCalled();
    const first = mocks.fallback.mock.lastCall?.[0]?.t as number;

    clock += 15_000;
    view.rerender(<SoundscapeVisual visual="flow" animate immersive />);
    const fullscreenTime = mocks.fallback.mock.lastCall?.[0]?.t as number;

    clock += 8_000;
    view.rerender(<SoundscapeVisual visual="flow" animate immersive={false} />);
    const restoredTime = mocks.fallback.mock.lastCall?.[0]?.t as number;

    expect(fullscreenTime - first).toBeCloseTo(15, 1);
    expect(restoredTime - fullscreenTime).toBeCloseTo(8, 1);
  });
  it("freezes a reduced-motion scene and a paused scene across fullscreen transitions", () => {
    let clock = 50_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1280, height: 720, x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      toJSON: () => null,
    });
    const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(17);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    mocks.reduced = true;
    const still = render(<SoundscapeVisual visual="flow" animate />);
    const start = mocks.fallback.mock.lastCall?.[0]?.t as number;
    clock += 13_000;
    still.rerender(<SoundscapeVisual visual="flow" animate immersive />);
    const reducedTime = mocks.fallback.mock.lastCall?.[0]?.t as number;
    expect(reducedTime).toBeCloseTo(start, 6);
    expect(request).not.toHaveBeenCalled();
    still.unmount();

    mocks.reduced = false;
    clock += 1_000;
    const paused = render(<SoundscapeVisual visual="flow" animate={false} />);
    const before = mocks.fallback.mock.lastCall?.[0]?.t as number;
    clock += 15_000;
    paused.rerender(<SoundscapeVisual visual="flow" animate={false} immersive />);
    const after = mocks.fallback.mock.lastCall?.[0]?.t as number;
    expect(after).toBeCloseTo(before, 6);
    paused.unmount();
  });

});
