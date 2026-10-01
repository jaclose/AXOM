// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMER_CUES,
  flashTimerGlow,
  playLockInCue,
  playTimerEndCue,
  playTimerStartCue,
  readTimerCues,
  TIMER_CUES_KEY,
  TIMER_GLOW_EVENT,
  timerFinished,
  writeTimerCues,
} from "./timerCues";

/** A minimal Web Audio double that records every tone scheduled. */
function installAudio() {
  const tones: number[] = [];
  const node = () => ({ connect: vi.fn(function (this: unknown, next: unknown) { return next; }), gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } });
  class FakeContext {
    currentTime = 0;
    state = "running";
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    createGain() { return node(); }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 } }; }
    createDelay() { return { ...node(), delayTime: { value: 0 } }; }
    createOscillator() {
      const frequency = { value: 0 };
      return { ...node(), type: "", frequency, start: vi.fn(() => tones.push(frequency.value)), stop: vi.fn() };
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return tones;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("timer cues", () => {
  it("defaults to tones and glow on, and remembers a change on this device", () => {
    expect(readTimerCues()).toEqual(DEFAULT_TIMER_CUES);
    writeTimerCues({ glow: false });
    expect(JSON.parse(localStorage.getItem(TIMER_CUES_KEY)!)).toEqual({ sound: true, glow: false });
    localStorage.setItem(TIMER_CUES_KEY, "not json");
    expect(readTimerCues()).toEqual(DEFAULT_TIMER_CUES);
  });

  it("plays a short rising start tone and a longer finish arpeggio, and stays silent when turned off", () => {
    const tones = installAudio();
    playTimerStartCue();
    expect(tones.filter((hz) => hz < 1000)).toEqual([587.33, 880]);
    tones.length = 0;
    playTimerEndCue("focus");
    expect(tones.filter((_, index) => index % 3 === 0)).toEqual([523.25, 659.25, 783.99, 1046.5]);
    tones.length = 0;
    playTimerEndCue("break");
    expect(tones.filter((_, index) => index % 3 === 0)).toEqual([783.99, 659.25, 523.25]);
    // The Locked In check-in asks with three rising bells.
    tones.length = 0;
    playLockInCue();
    expect(tones.filter((_, index) => index % 3 === 0)).toEqual([783.99, 1046.5, 1318.51]);
    tones.length = 0;
    writeTimerCues({ sound: false });
    playLockInCue();
    playTimerStartCue();
    timerFinished("focus");
    expect(tones).toEqual([]);
    playTimerStartCue({ force: true });
    expect(tones.length).toBeGreaterThan(0);
  });

  it("lights the edges on a finish unless the glow is off (a preview always shows it)", () => {
    const glow = vi.fn();
    window.addEventListener(TIMER_GLOW_EVENT, glow);
    timerFinished("focus");
    expect(glow).toHaveBeenCalledTimes(1);
    writeTimerCues({ glow: false });
    timerFinished("break");
    expect(glow).toHaveBeenCalledTimes(1);
    flashTimerGlow({ force: true });
    expect(glow).toHaveBeenCalledTimes(2);
    window.removeEventListener(TIMER_GLOW_EVENT, glow);
  });

  it("never throws without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => { playTimerStartCue(); playTimerEndCue(); }).not.toThrow();
  });
});
