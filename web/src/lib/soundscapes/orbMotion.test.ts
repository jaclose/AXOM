import { describe, expect, it } from "vitest";
import { CORONA_WAVES, MAX_SWELL, SILENT, coronaShape, follow, followTime, orbPose, readBands, spectrumSpoke, onsetStrength } from "./orbMotion";

describe("how the orb answers sound", () => {
  it("is still and unlit in silence", () => {
    const pose = orbPose(SILENT);
    expect(pose.swell).toBe(0);
    expect(pose.glow).toBe(0);
    expect(pose.ripple).toBeCloseTo(0.25);
  });

  it("swells with bass, never past its limit, and glows with loudness", () => {
    expect(orbPose({ ...SILENT, bass: 0.5 }).swell).toBeLessThan(orbPose({ ...SILENT, bass: 1 }).swell);
    expect(orbPose({ ...SILENT, bass: 4 }).swell).toBeCloseTo(MAX_SWELL);
    expect(orbPose({ ...SILENT, level: 0.25 }).glow).toBeGreaterThan(0.4);
    expect(orbPose({ ...SILENT, level: 9 }).glow).toBe(1);
  });

  it("reads bands from analyser bytes", () => {
    const binHz = 48_000 / 512;
    const frequency = new Uint8Array(256);
    frequency.fill(200, 1, 3); // energy under 250 Hz only
    const flat = new Uint8Array(256).fill(128);
    const bands = readBands(frequency, flat, binHz);
    expect(bands.bass).toBeGreaterThan(0.6);
    expect(bands.mid).toBe(0);
    expect(bands.high).toBe(0);
    expect(bands.level).toBe(0);

    const loud = new Uint8Array(256).map((_, index) => (index % 2 ? 228 : 28));
    expect(readBands(new Uint8Array(256), loud, binHz).level).toBe(1);
  });

  it("follows up quickly and down slowly", () => {
    expect(follow(0, 1, 0.5, 0.1)).toBe(0.5);
    expect(follow(1, 0, 0.5, 0.1)).toBeCloseTo(0.9);
  });

  it("smooths consistently across frame rates", () => {
    let thirty = 0;
    let sixty = 0;
    for (let i = 0; i < 30; i++) thirty = followTime(thirty, 1, 1 / 30, 0.2, 0.5);
    for (let i = 0; i < 60; i++) sixty = followTime(sixty, 1, 1 / 60, 0.2, 0.5);
    expect(thirty).toBeCloseTo(sixty, 6);
  });

  it("shapes the corona from smooth waves: wide ones for bass, fine ones for highs, never more than its limit", () => {
    expect(coronaShape(SILENT)).toEqual([0, 0, 0, 0, 0]);
    const low = coronaShape({ ...SILENT, bass: 1 });
    const bright = coronaShape({ ...SILENT, high: 1 });
    expect(low[0]).toBeGreaterThan(low[2]);
    expect(bright[4]).toBeGreaterThan(bright[0]);
    expect(coronaShape({ bass: 9, mid: 9, high: 9, level: 9 }).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(1);
    expect(coronaShape(SILENT)).toHaveLength(CORONA_WAVES.length);
  });
});

describe("resonant orb spectral geometry", () => {
  it("maps actual FFT energy into bounded, mirrored radial spokes", () => {
    const bins = new Uint8Array(256);
    bins.fill(220, 2, 12);
    const responses = Array.from({ length: 96 }, (_, index) => spectrumSpoke(bins, index, 96));
    expect(responses.some((value) => value > 0.25)).toBe(true);
    expect(responses.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(spectrumSpoke(bins, 12, 96)).toBeCloseTo(spectrumSpoke(bins, 84, 96));
    expect(spectrumSpoke(new Uint8Array(256), 12, 96)).toBe(0);
  });

  it("detects isolated musical onsets but not static volume or silence", () => {
    expect(onsetStrength(0.9, 0.25)).toBeGreaterThan(onsetStrength(0.55, 0.5));
    expect(onsetStrength(0.4, 0.4)).toBe(0);
    expect(onsetStrength(0.1, 0.7)).toBe(0);
    expect(onsetStrength(9, -9)).toBe(1);
    expect(onsetStrength(Number.NaN, 0)).toBe(0);
  });
});
