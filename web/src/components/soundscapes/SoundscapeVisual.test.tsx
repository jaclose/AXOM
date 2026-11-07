// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draw: vi.fn(() => false),
  fallback: vi.fn(),
}));
vi.mock("../../lib/motion", () => ({ useReducedMotion: () => true }));
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
});

describe("Soundscapes immersive rendering continuity", () => {
  it("does not reset scene animation time when entering or leaving fullscreen", () => {
    let clock = 100_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1440, height: 900, x: 0, y: 0, left: 0, top: 0, right: 1440, bottom: 900,
      toJSON: () => null,
    });

    const view = render(<SoundscapeVisual visual="flow" animate={false} />);
    expect(mocks.fallback).toHaveBeenCalled();
    const first = mocks.fallback.mock.lastCall?.[0]?.t as number;

    clock += 15_000;
    view.rerender(<SoundscapeVisual visual="flow" animate={false} immersive />);
    const fullscreenTime = mocks.fallback.mock.lastCall?.[0]?.t as number;

    clock += 8_000;
    view.rerender(<SoundscapeVisual visual="flow" animate={false} immersive={false} />);
    const restoredTime = mocks.fallback.mock.lastCall?.[0]?.t as number;

    expect(fullscreenTime - first).toBeCloseTo(15, 1);
    expect(restoredTime - fullscreenTime).toBeCloseTo(8, 1);
  });
});
