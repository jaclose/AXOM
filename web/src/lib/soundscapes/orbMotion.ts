// ===========================================================================
// How the stage orb answers the sound. Pure numbers, no drawing: the analyser's
// spectrum is reduced to three bands and a level, and `orbPose` turns those
// into how far the ring swells, how brightly the orb glows and how much its
// outline ripples. Everything here is a matter of taste and safe to tune.
//
// Safety (WCAG 2.3.1): brightness follows the slow `glow` envelope only, so it
// cannot flash; the fast response is geometry (a thin ring moving a few
// percent), which is not a luminance change.
// ===========================================================================

export interface OrbBands {
  /** 0..1 energy below about 250 Hz. */
  bass: number;
  /** 0..1 energy from about 250 Hz to 2 kHz. */
  mid: number;
  /** 0..1 energy above about 2 kHz. */
  high: number;
  /** 0..1 overall loudness. */
  level: number;
}

export interface OrbPose {
  /** Extra radius as a fraction of the ring's radius. */
  swell: number;
  /** 0..1 how lit the orb is. */
  glow: number;
  /** 0..1 how strongly the spectrum shapes the outline. */
  ripple: number;
}

export const SILENT: OrbBands = { bass: 0, mid: 0, high: 0, level: 0 };

/** Largest swell, as a fraction of the radius. */
export const MAX_SWELL = 0.06;

export function orbPose(bands: OrbBands): OrbPose {
  return {
    // Bass moves the whole ring; the curve keeps quiet passages nearly still.
    swell: MAX_SWELL * Math.min(1, bands.bass) ** 1.35,
    // Loudness lights it, a little ahead of linear so soft sounds still show.
    glow: Math.min(1, Math.sqrt(Math.max(0, bands.level)) * 0.95),
    // Mids and highs draw the outline; pure low tones leave it calm.
    ripple: Math.min(1, 0.25 + bands.mid * 0.7 + bands.high * 0.9),
  };
}

/** Mean of `data[from..to)` on a 0..1 scale. */
function mean(data: ArrayLike<number>, from: number, to: number): number {
  const end = Math.min(data.length, Math.max(from + 1, to));
  let sum = 0;
  for (let index = from; index < end; index += 1) sum += data[index];
  return sum / ((end - from) * 255);
}

/**
 * Bands from an AnalyserNode's byte data. `binHz` is sampleRate / fftSize.
 * Bin 0 (DC) is skipped. Gains lift each band into a useful 0..1 range for
 * music and for the quiet, narrow spectra of synthesized tones alike.
 */
export function readBands(frequency: ArrayLike<number>, waveform: ArrayLike<number>, binHz: number): OrbBands {
  const bin = (hz: number) => Math.max(1, Math.round(hz / binHz));
  let sum = 0;
  for (let index = 0; index < waveform.length; index += 1) sum += ((waveform[index] - 128) / 128) ** 2;
  const rms = waveform.length ? Math.sqrt(sum / waveform.length) : 0;
  return {
    bass: Math.min(1, mean(frequency, 1, bin(250) + 1) * 1.25),
    mid: Math.min(1, mean(frequency, bin(250) + 1, bin(2000) + 1) * 1.6),
    high: Math.min(1, mean(frequency, bin(2000) + 1, bin(8000) + 1) * 2.2),
    level: Math.min(1, rms * 3.2),
  };
}

/** One step of an envelope follower: quick to rise, slow to fall. */
export function follow(current: number, target: number, attack: number, release: number): number {
  return current + (target - current) * (target > current ? attack : release);
}

/**
 * The corona is a circle bent by a few slow waves. These are how many waves
 * of each kind fit around it; `coronaShape` says how strong each one is.
 */
export const CORONA_WAVES = [2, 3, 4, 5, 7] as const;

/**
 * Strength of each corona wave (0..1, summing to at most 1). Low sound makes
 * the wide, slow waves; mids and highs add the finer ones. Because the shape
 * is a sum of smooth waves it can never kink, whatever the sound does.
 */
export function coronaShape(bands: OrbBands): number[] {
  const bass = Math.min(1, bands.bass);
  const mid = Math.min(1, bands.mid);
  const high = Math.min(1, bands.high);
  return [
    bass * 0.34,
    (bass * 0.4 + mid * 0.6) * 0.26,
    mid * 0.2,
    (mid * 0.5 + high * 0.5) * 0.12,
    high * 0.08,
  ];
}
