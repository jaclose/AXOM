// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundscapeEngine, recordingUrl } from "./engine";
import { SOUNDSCAPES } from "./presets";

function audioParam() {
  return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
}

function audioNode() {
  return { connect: vi.fn((next: unknown) => next), disconnect: vi.fn(), gain: audioParam(), frequency: audioParam(), Q: audioParam(), threshold: audioParam(), knee: audioParam(), ratio: audioParam(), attack: audioParam(), release: audioParam() };
}

class TestContext {
  static instances: TestContext[] = [];
  state = "running";
  currentTime = 0;
  destination = audioNode();
  createGain = audioNode;
  createBiquadFilter = audioNode;
  createDynamicsCompressor = audioNode;
  createAnalyser = () => ({ ...audioNode(), fftSize: 2048, smoothingTimeConstant: 0 });
  createMediaElementSource = audioNode;
  suspend = vi.fn(async () => { this.state = "suspended"; });
  resume = vi.fn(async () => { this.state = "running"; });
  constructor() { TestContext.instances.push(this); }
}

class TestAudio {
  static instances: TestAudio[] = [];
  static nextStart: (() => Promise<void>) | undefined;
  paused = true;
  currentTime = 0;
  loop = false;
  crossOrigin = "";
  readonly start = TestAudio.nextStart;
  play = vi.fn(() => {
    if (this.start) return this.start();
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
  constructor(public src: string) { TestAudio.nextStart = undefined; TestAudio.instances.push(this); }
}

const options = { volume: 35, output: "headphones" as const };

beforeEach(() => {
  vi.useFakeTimers();
  TestContext.instances = [];
  TestAudio.instances = [];
  TestAudio.nextStart = undefined;
  vi.stubGlobal("AudioContext", TestContext);
  vi.stubGlobal("Audio", TestAudio);
  // The optional Media Session anchor is unrelated to the actual recording.
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => { throw new Error("No session anchor"); });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recording lifecycle", () => {
  it("pauses the media clock and resumes the same recording position", async () => {
    const engine = new SoundscapeEngine();
    await engine.play(SOUNDSCAPES["axom-1"], options);
    const recording = TestAudio.instances[0];
    recording.currentTime = 92;
    await engine.pause();
    expect(recording.paused).toBe(true);
    expect(TestContext.instances[0].state).toBe("suspended");
    await engine.resume();
    expect(recording.paused).toBe(false);
    expect(recording.currentTime).toBe(92);
    expect(TestAudio.instances).toHaveLength(1);
    expect(TestContext.instances[0].state).toBe("running");
  });

  it("reports a failed recording start and releases its resources", async () => {
    TestAudio.nextStart = () => Promise.reject(new Error("Unsupported recording"));
    const engine = new SoundscapeEngine();
    await expect(engine.play(SOUNDSCAPES["axom-1"], options)).rejects.toThrow("Unsupported recording");
    expect(TestAudio.instances[0].load).toHaveBeenCalledOnce();
    expect(TestAudio.instances[0].src).toBe("");
    expect(TestContext.instances[0].state).toBe("suspended");
  });

  it("keeps the working recording when its replacement fails", async () => {
    const engine = new SoundscapeEngine();
    await engine.play(SOUNDSCAPES["axom-1"], options);
    const working = TestAudio.instances[0];
    TestAudio.nextStart = () => Promise.reject(new Error("Unavailable recording"));
    await expect(engine.play(SOUNDSCAPES.yours, options)).rejects.toThrow("Unavailable recording");
    expect(working.paused).toBe(false);
    expect(working.load).not.toHaveBeenCalled();
    expect(working.src).toBe("/soundscapes/axom-soundscape-1.m4a");
    expect(TestAudio.instances[1].src).toBe("");
  });

  it("cancels a loading recording when Stop is pressed", async () => {
    let rejectStart!: (error: Error) => void;
    TestAudio.nextStart = () => new Promise<void>((_resolve, reject) => { rejectStart = reject; });
    const engine = new SoundscapeEngine();
    const pending = engine.play(SOUNDSCAPES["axom-1"], options);
    await Promise.resolve();
    expect(TestAudio.instances).toHaveLength(1);
    await engine.stop();
    rejectStart(new Error("Playback was aborted"));
    await expect(pending).resolves.toBeUndefined();
    expect(TestAudio.instances[0].src).toBe("");
    expect(TestAudio.instances[0].load).toHaveBeenCalledOnce();
    expect(TestContext.instances[0].state).toBe("suspended");
  });

  it("pauses every recording during a crossfade", async () => {
    const engine = new SoundscapeEngine();
    await engine.play(SOUNDSCAPES["axom-1"], options);
    await engine.play(SOUNDSCAPES.yours, options);
    await engine.pause();
    expect(TestAudio.instances).toHaveLength(2);
    expect(TestAudio.instances.every((element) => element.paused)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    await engine.resume();
    expect(TestAudio.instances[0].src).toBe("");
    expect(TestAudio.instances[1].paused).toBe(false);
  });

  it("does not suspend a newer recording that is still buffering when an old stop finishes", async () => {
    const engine = new SoundscapeEngine();
    await engine.play(SOUNDSCAPES["axom-1"], options);
    const stopping = engine.stop();
    let finishStart!: () => void;
    TestAudio.nextStart = () => new Promise<void>((resolve) => { finishStart = resolve; });
    const starting = engine.play(SOUNDSCAPES.yours, options);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1500);
    await stopping;
    expect(TestContext.instances[0].state).toBe("running");
    finishStart();
    await starting;
    expect(TestContext.instances[0].state).toBe("running");
    expect(TestAudio.instances[1].src).not.toBe("");
  });
});

describe("recording URLs", () => {
  it("resolves relative assets once and preserves absolute URLs", () => {
    expect(recordingUrl("soundscapes/axom-soundscape-1.m4a", "/axom/")).toBe("/axom/soundscapes/axom-soundscape-1.m4a");
    expect(recordingUrl("/soundscapes/existing.m4a", "/axom/")).toBe("/soundscapes/existing.m4a");
    expect(recordingUrl("https://media.example.test/sound.m4a", "/axom/")).toBe("https://media.example.test/sound.m4a");
    expect(recordingUrl("blob:local-recording", "/axom/")).toBe("blob:local-recording");
  });
});
