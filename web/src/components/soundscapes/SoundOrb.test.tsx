// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ analyser: vi.fn(), reduced: false }));
vi.mock("../../lib/motion", () => ({ useReducedMotion: () => mocks.reduced }));
vi.mock("../../lib/soundscapes/store", () => ({ soundscapeAnalyser: mocks.analyser }));
import { SoundOrb } from "./SoundOrb";

afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.analyser.mockReset(); mocks.reduced = false; });

describe("sound orb response", () => {
  it("reads the complete analyser buffers and stops requesting frames when paused", () => {
    const frequency = vi.fn(), waveform = vi.fn();
    mocks.analyser.mockReturnValue({ frequencyBinCount: 1024, fftSize: 2048, context: { sampleRate: 48000 }, getByteFrequencyData: frequency, getByteTimeDomainData: waveform });
    const context = { setTransform: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const view = render(<SoundOrb active reactive />);
    const orb = view.container.querySelector("canvas")!;
    expect(orb.dataset.response).toBe("audio");
    expect(frequency.mock.calls[0][0]).toHaveLength(1024);
    expect(waveform.mock.calls[0][0]).toHaveLength(2048);
    expect(request).toHaveBeenCalled();
    view.rerender(<SoundOrb active={false} reactive />);
    expect(orb.dataset.response).toBe("idle");
    expect(cancel).toHaveBeenCalledWith(42);
  });

  it("keeps reduced motion still without reading audio", () => {
    mocks.reduced = true;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn(), clearRect: vi.fn() } as never);
    const request = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<SoundOrb active reactive />);
    expect(container.querySelector("canvas")?.dataset.response).toBe("still");
    expect(mocks.analyser).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
