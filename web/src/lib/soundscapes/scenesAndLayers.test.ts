// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENES, sceneById, sceneUrl } from "./scenes";
import { AMBIENT_ORDER, FREQUENCY_ORDER, SOUNDSCAPES, lookFor } from "./presets";
import { LayerKit, type SynthLayer } from "./synth";
import { useSoundscape } from "./store";

describe("scenes", () => {
  it("ships only licensed scenes, each with a poster and a genre", () => {
    expect(SCENES.length).toBe(28);
    expect(SCENES.map((scene) => scene.id)).toEqual(expect.arrayContaining(["earth", "open-sea", "neon-corridor", "emerald-dust", "skeleton"]));
    for (const scene of SCENES) {
      expect(scene.src).toMatch(/^scenes\/[a-z-]+\.mp4$/);
      expect(scene.poster).toMatch(/^scenes\/[a-z-]+\.jpg$/);
      expect(scene.credit).toBe("Pixabay");
      expect(["nature", "future", "space", "waves", "fun"]).toContain(scene.genre);
    }
    expect(sceneById("earth")?.label).toBe("Earth turning");
    expect(sceneUrl("scenes/earth.mp4")).toMatch(/\/scenes\/earth\.mp4$/);
  });

  it("points every preset and version scene at a real scene", () => {
    for (const preset of Object.values(SOUNDSCAPES)) {
      if (preset.scene) expect(sceneById(preset.scene), preset.id).toBeTruthy();
      for (const version of preset.versions) if (version.scene) expect(sceneById(version.scene), `${preset.id}/${version.id}`).toBeTruthy();
    }
  });

  it("lets a version choose its own scene or generative look", () => {
    expect(lookFor(SOUNDSCAPES["beta-20"], "lofi").scene).toBe("retro-tv");
    expect(lookFor(SOUNDSCAPES["beta-20"]).scene).toBe("heartbeat");
    // Rainfall designs its own generative layers, so it opts out of the default scene.
    expect(lookFor(SOUNDSCAPES["gamma-40"], "rainfall")).toMatchObject({ scene: undefined, visual: "lattice", overlay: "rain" });
  });

  it("gives every frequency a significance card and every ambient sound three versions", () => {
    for (const id of FREQUENCY_ORDER) expect(SOUNDSCAPES[id].significance?.headline, id).toBeTruthy();
    for (const id of AMBIENT_ORDER) {
      expect(SOUNDSCAPES[id].family).toBe("ambient");
      expect(SOUNDSCAPES[id].versions).toHaveLength(3);
    }
  });
});

describe("scene choice", () => {
  beforeEach(() => localStorage.clear());
  it("persists a scene per preset and clears it with auto", () => {
    useSoundscape.getState().setScene("alpha-10", "kelp-forest");
    expect(useSoundscape.getState().scenes["alpha-10"]).toBe("kelp-forest");
    expect(JSON.parse(localStorage.getItem("axom.soundscapes.v1")!).scenes).toEqual({ "alpha-10": "kelp-forest" });
    useSoundscape.getState().setScene("alpha-10", "auto");
    expect(useSoundscape.getState().scenes["alpha-10"]).toBeUndefined();
  });
});

// A tiny stand-in for Web Audio: enough surface for every layer builder.
function fakeContext() {
  const created: string[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = (kind: string) => {
    created.push(kind);
    const n: Record<string, unknown> = {
      gain: param(), frequency: param(), detune: param(), Q: param(), pan: param(), type: "sine",
      connect: vi.fn((target: unknown) => target), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, loop: false, onended: null,
    };
    return n;
  };
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createOscillator: () => node("osc"),
    createBufferSource: () => node("source"),
    createStereoPanner: () => node("pan"),
    createChannelMerger: () => node("merger"),
    createBuffer: (channels: number, length: number) => ({ getChannelData: () => new Float32Array(length), numberOfChannels: channels, length }),
  };
  return { ctx: ctx as unknown as AudioContext, created };
}

describe("new ambient layers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each<SynthLayer>([
    { kind: "fan", level: 0.5, speed: "high" },
    { kind: "cabin", level: 0.5 },
    { kind: "chatter", level: 0.5, voices: 5 },
    { kind: "birds", level: 0.5, density: "dawn" },
    { kind: "noise", color: "white", level: 0.3, highpassHz: 60, lowpassHz: 6500 },
  ])("builds, schedules events and stops cleanly: %o", (layer) => {
    const { ctx, created } = fakeContext();
    const kit = new LayerKit(ctx);
    const dry = { connect: vi.fn() } as unknown as AudioNode;
    const stops = kit.build({ layers: [layer] }, dry, dry, "headphones");
    expect(stops.length).toBeGreaterThan(0);
    const before = created.length;
    vi.advanceTimersByTime(20_000);
    if (layer.kind === "chatter" || layer.kind === "birds") expect(created.length).toBeGreaterThan(before);
    for (const stop of stops) stop();
    const afterStop = created.length;
    vi.advanceTimersByTime(20_000);
    expect(created.length).toBe(afterStop); // no timers left running
  });
});
