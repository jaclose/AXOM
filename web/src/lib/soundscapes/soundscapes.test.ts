// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LISTENING_REGIMEN, SOUNDSCAPES, SOUNDSCAPE_ORDER, isSoundscapeId, versionOf } from "./presets";
import { carrierPair, fillNoise, volumeToGain } from "./engine";
import { LISTENING_LOG_KEY, MIN_COMPARISON_SAMPLE, appendListeningInterval, compareListeningConditions, readListeningLog } from "./listeningLog";

describe("soundscape presets", () => {
  it("match the carriers measured from the learner's own recordings", () => {
    expect(carrierPair(SOUNDSCAPES["beta-20"], "headphones")).toEqual([100, 120]);
    expect(carrierPair(SOUNDSCAPES["alpha-10"], "headphones")).toEqual([55.5, 65.5]);
    expect(carrierPair(SOUNDSCAPES["delta-2"], "headphones")).toEqual([39, 41]);
    expect(carrierPair(SOUNDSCAPES["gamma-40"], "headphones")).toEqual([200, 240]);
  });

  it("keep the beat but lift inaudible carriers for speakers", () => {
    expect(carrierPair(SOUNDSCAPES["delta-2"], "speakers")).toEqual([140, 142]);
    expect(carrierPair(SOUNDSCAPES["gamma-40"], "speakers")).toEqual([200, 240]);
    expect(carrierPair(SOUNDSCAPES["brown-noise"], "speakers")).toBeNull();
  });

  it("carry an honest evidence note and never claim proof", () => {
    for (const id of SOUNDSCAPE_ORDER) {
      const preset = SOUNDSCAPES[id];
      expect(preset.evidenceNote.length).toBeGreaterThan(40);
      // Negations ("not guaranteed", "has not been shown") are the honest phrasing.
      expect(`${preset.evidenceNote} ${preset.howTo}`).not.toMatch(/\b(proven to|guarantees|boosts? (memory|retention))\b/i);
    }
    expect(SOUNDSCAPES["delta-2"].defaultStopMinutes).toBeGreaterThan(0);
    expect(SOUNDSCAPES["soft-rain"].defaultStopMinutes).toBeGreaterThan(0);
  });

  it("only reference real presets in the rotation, with silence for exam-style questions", () => {
    for (const step of LISTENING_REGIMEN) {
      if (step.presetId) expect(isSoundscapeId(step.presetId)).toBe(true);
      if (step.optional) expect(isSoundscapeId(step.optional)).toBe(true);
    }
    expect(LISTENING_REGIMEN.find((step) => step.activity === "Practice questions")?.presetId).toBeNull();
  });
});

describe("soundscape versions", () => {
  it("give every preset three distinct designed versions", () => {
    for (const id of SOUNDSCAPE_ORDER) {
      const designed = SOUNDSCAPES[id].versions.filter((version) => "recipe" in version);
      expect(designed).toHaveLength(3);
      expect(new Set(designed.map((version) => version.id)).size).toBe(3);
      for (const version of designed) expect(version.description.length).toBeGreaterThan(10);
    }
  });

  it("keep every tone layer on the preset's measured carrier and beat", () => {
    for (const id of SOUNDSCAPE_ORDER) {
      const preset = SOUNDSCAPES[id];
      for (const version of preset.versions) {
        if (!("recipe" in version)) continue;
        const tones = version.recipe.layers.filter((layer) => layer.kind === "tone");
        if (!preset.carrierHz) expect(tones).toEqual([]);
        for (const tone of tones) expect(tone).toMatchObject({ carrierHz: preset.carrierHz, beatHz: preset.beatHz });
        // Stacked layers stay well under full scale before the limiter.
        const total = version.recipe.layers.reduce((sum, layer) => sum + layer.level, 0);
        expect(total).toBeLessThanOrEqual(1.35);
      }
    }
  });

  it("falls back to the first version for unknown ids", () => {
    expect(versionOf(SOUNDSCAPES["gamma-40"], "nope").id).toBe("clean");
    expect(versionOf(SOUNDSCAPES["soft-rain"], "fireplace").label).toBe("Rain & fireplace");
  });
});

describe("synthesis helpers", () => {
  it("maps volume perceptually and never approaches full scale", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(50)).toBeLessThan(volumeToGain(51));
    expect(volumeToGain(100)).toBeLessThanOrEqual(0.6);
    expect(volumeToGain(400)).toBe(volumeToGain(100));
  });

  it.each(["brown", "pink"] as const)("fills bounded %s noise with a click-free loop seam", (kind) => {
    const channel = new Float32Array(44_100);
    fillNoise(kind, channel);
    const peak = channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThan(1);
    // The wrap (last → first sample) is no bigger than an ordinary step.
    let typical = 0;
    for (let i = 1; i < channel.length; i += 1) typical = Math.max(typical, Math.abs(channel[i] - channel[i - 1]));
    expect(Math.abs(channel[0] - channel[channel.length - 1])).toBeLessThanOrEqual(typical);
  });
});

describe("white noise (rain droplets)", () => {
  it("stays bounded", () => {
    const channel = new Float32Array(2048);
    fillNoise("white", channel);
    expect(channel.every((value) => Math.abs(value) <= 0.5)).toBe(true);
  });
});

describe("listening log and comparison", () => {
  beforeEach(() => localStorage.clear());

  it("ignores previews shorter than a minute", () => {
    appendListeningInterval({ presetId: "gamma-40", start: "2026-09-26T10:00:00Z", end: "2026-09-26T10:00:30Z" });
    appendListeningInterval({ presetId: "gamma-40", start: "2026-09-26T10:00:00Z", end: "2026-09-26T10:45:00Z" });
    expect(readListeningLog()).toHaveLength(1);
    localStorage.setItem(LISTENING_LOG_KEY, "not json");
    expect(readListeningLog()).toEqual([]);
  });

  it("splits accuracy and again-rate by what was playing, from the first logged play", () => {
    const log = [{ presetId: "gamma-40" as const, start: "2026-09-26T10:00:00Z", end: "2026-09-26T11:30:00Z" }];
    const at = (hour: number, minute: number) => `2026-09-26T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
    const attempts = [
      ...Array.from({ length: 25 }, (_, i) => ({ at: at(10, i), status: i < 20 ? "correct" : "incorrect" })),
      ...Array.from({ length: 22 }, (_, i) => ({ at: at(12, i), status: i < 11 ? "correct" : "guessed" })),
      { at: at(9, 0), status: "incorrect" }, // before the experiment: excluded
      { at: at(12, 30), status: "flagged" }, // not an answer: excluded
    ];
    const reviews = Array.from({ length: 5 }, (_, i) => ({ at: at(10, 50 + i), rating: i === 0 ? "again" : "good" }));
    const rows = compareListeningConditions({ log, attempts, reviews });
    const gamma = rows.find((row) => row.condition === "gamma-40")!;
    const quiet = rows.find((row) => row.condition === "quiet")!;
    expect(rows[0].condition).toBe("quiet");
    expect(gamma.minutes).toBe(90);
    expect(gamma.questions).toEqual({ answered: 25, correct: 20, accuracy: 0.8 });
    expect(quiet.questions).toEqual({ answered: 22, correct: 11, accuracy: 0.5 });
    // Five reviews is below the comparison threshold: counted, but no rate.
    expect(gamma.cards).toEqual({ reviewed: 5, again: 1, againRate: null });
    expect(MIN_COMPARISON_SAMPLE).toBeGreaterThan(5);
  });

  it("returns nothing until a soundscape has been logged", () => {
    expect(compareListeningConditions({ log: [], attempts: [{ at: "2026-09-26T10:00:00Z", status: "correct" }], reviews: [] })).toEqual([]);
  });
});

describe("soundscape store", () => {
  const fake = {
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    setVolume: vi.fn(),
    analyserNode: null,
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    Object.values(fake).forEach((value) => typeof value === "function" && (value as ReturnType<typeof vi.fn>).mockClear());
    const { setSoundscapeEngineForTests, useSoundscape } = await import("./store");
    setSoundscapeEngineForTests(fake as never);
    useSoundscape.setState({ status: "idle", presetId: null, stopAt: undefined });
  });
  afterEach(() => vi.useRealTimers());

  it("plays, logs the listening interval on stop, and remembers the preset", async () => {
    const { useSoundscape } = await import("./store");
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    await useSoundscape.getState().play("beta-20");
    expect(useSoundscape.getState()).toMatchObject({ status: "playing", presetId: "beta-20", lastPresetId: "beta-20" });
    expect(fake.play).toHaveBeenCalledWith(SOUNDSCAPES["beta-20"], expect.objectContaining({ output: "headphones", versionId: "clean" }));
    vi.setSystemTime(new Date("2026-09-26T10:50:00Z"));
    await useSoundscape.getState().stop();
    expect(useSoundscape.getState().status).toBe("idle");
    expect(readListeningLog()).toEqual([{ presetId: "beta-20", start: "2026-09-26T10:00:00.000Z", end: "2026-09-26T10:50:00.000Z" }]);
    expect(JSON.parse(localStorage.getItem("axom.soundscapes.v1")!).lastPresetId).toBe("beta-20");
  });

  it("arms the sleep preset's stop timer and fades out when it ends", async () => {
    const { useSoundscape } = await import("./store");
    await useSoundscape.getState().play("delta-2");
    expect(useSoundscape.getState().stopAt).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fake.stop).toHaveBeenCalledWith(8);
    expect(useSoundscape.getState().status).toBe("idle");
  });

  it("pauses without logging paused time and resumes", async () => {
    const { useSoundscape } = await import("./store");
    await useSoundscape.getState().play("gamma-40");
    await useSoundscape.getState().toggle();
    expect(useSoundscape.getState().status).toBe("paused");
    expect(fake.pause).toHaveBeenCalled();
    await useSoundscape.getState().toggle();
    expect(useSoundscape.getState().status).toBe("playing");
    expect(fake.resume).toHaveBeenCalled();
  });

  it("reports an engine failure instead of pretending to play", async () => {
    const { useSoundscape } = await import("./store");
    fake.play.mockRejectedValueOnce(new Error("This browser can’t synthesize audio."));
    await useSoundscape.getState().play("gamma-40");
    expect(useSoundscape.getState()).toMatchObject({ status: "idle", error: "This browser can’t synthesize audio." });
  });
});
