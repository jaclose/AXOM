// ===========================================================================
// Soundscape layer library (Web Audio). Each builder wires one layer into a
// destination and returns a stop function. Layers are designed to sit under
// study: slow movement, no sharp transients, nothing that repeats audibly.
// ===========================================================================
import type { OutputMode } from "./engine";

export type PadStyle = "warm" | "glass" | "choir";
export type RainIntensity = "light" | "steady" | "heavy";

export interface ToneLayer { kind: "tone"; carrierHz: number; beatHz: number; level: number }
export interface PadLayer { kind: "pad"; style: PadStyle; rootHz: number; level: number }
export interface NoiseLayer { kind: "noise"; color: "brown" | "pink"; level: number; lowpassHz?: number }
export interface OceanLayer { kind: "ocean"; level: number }
export interface RainLayer { kind: "rain"; intensity: RainIntensity; level: number; thunder?: boolean; window?: boolean }
export interface WindLayer { kind: "wind"; level: number }
export interface FireLayer { kind: "fire"; level: number }
export interface ChimesLayer { kind: "chimes"; level: number }
export interface VinylLayer { kind: "vinyl"; level: number }

export type SynthLayer = ToneLayer | PadLayer | NoiseLayer | OceanLayer | RainLayer | WindLayer | FireLayer | ChimesLayer | VinylLayer;

export interface SynthRecipe {
  layers: SynthLayer[];
  /** Loudness trim so every version sits at the same perceived level (K-weighted, measured in Chrome). */
  trimDb?: number;
  /** Room size of the shared reverb (seconds) and how much of the mix it gets. */
  reverb?: { seconds: number; mix: number };
}

/** Speakers can't reproduce very low carriers; monaural beats stay audible above this. */
const SPEAKER_MIN_CARRIER_HZ = 140;
const NOISE_SECONDS = 12;

export function carrierPairFor(carrierHz: number, beatHz: number, output: OutputMode): [number, number] {
  const base = output === "speakers" ? Math.max(carrierHz, SPEAKER_MIN_CARRIER_HZ) : carrierHz;
  return [base, base + beatHz];
}

/**
 * Seamless stereo noise. Brown: leaky-integrated white noise. Pink: Paul
 * Kellet's economy filter. Generated past the end, then the natural
 * continuation is faded into the head, so sample 0 follows sample N-1.
 */
export function fillNoise(kind: "brown" | "pink" | "white", channel: Float32Array, random: () => number = Math.random): void {
  const fade = Math.min(channel.length >> 1, 1764);
  const total = channel.length + fade;
  const samples = new Float32Array(total);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < total; i += 1) {
    const white = random() * 2 - 1;
    if (kind === "white") samples[i] = white * 0.5;
    else if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02;
      samples[i] = last * 3.5;
    } else {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      samples[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  for (let i = 0; i < channel.length; i += 1) channel[i] = samples[i];
  for (let i = 0; i < fade; i += 1) {
    const t = i / fade;
    channel[i] = samples[i] * t + samples[channel.length + i] * (1 - t);
  }
}

/** A diffuse stereo room: decaying noise, slightly different per ear. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay = 2.6, random: () => number = Math.random): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // Soft pre-delay onset avoids a smeared attack on bells and droplets.
      const onset = Math.min(1, i / (ctx.sampleRate * 0.012));
      data[i] = (random() * 2 - 1) * Math.pow(1 - t, decay) * onset;
    }
  }
  return buffer;
}

export class LayerKit {
  private noise = new Map<string, AudioBuffer>();
  constructor(readonly ctx: AudioContext) {}

  noiseBuffer(kind: "brown" | "pink" | "white"): AudioBuffer {
    const cached = this.noise.get(kind);
    if (cached) return cached;
    const buffer = this.ctx.createBuffer(2, Math.floor(this.ctx.sampleRate * NOISE_SECONDS), this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) fillNoise(kind, buffer.getChannelData(channel));
    this.noise.set(kind, buffer);
    return buffer;
  }

  /** Build every layer of a recipe into `dry` (and `wet` for reverb sends). */
  build(recipe: SynthRecipe, dry: AudioNode, wet: AudioNode | null, output: OutputMode): Array<() => void> {
    const stops: Array<() => void> = [];
    for (const layer of recipe.layers) stops.push(...this.layer(layer, dry, wet ?? dry, output));
    return stops;
  }

  private layer(layer: SynthLayer, dry: AudioNode, wet: AudioNode, output: OutputMode): Array<() => void> {
    switch (layer.kind) {
      case "tone": return this.tone(layer, dry, output);
      case "pad": return this.pad(layer, dry, wet);
      case "noise": return this.bed(layer, dry);
      case "ocean": return this.ocean(layer, dry, wet);
      case "rain": return this.rain(layer, dry, wet);
      case "wind": return this.wind(layer, dry);
      case "fire": return this.fire(layer, dry, wet);
      case "chimes": return this.chimes(layer, wet);
      case "vinyl": return this.vinyl(layer, dry);
    }
  }

  private osc(frequency: number, type: OscillatorType, stops: Array<() => void>, detune = 0): OscillatorNode {
    const node = this.ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    node.start();
    stops.push(() => { try { node.stop(); } catch { /* stopped */ } node.disconnect(); });
    return node;
  }

  private loop(kind: "brown" | "pink" | "white", stops: Array<() => void>): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer(kind);
    source.loop = true;
    const offset = Math.random() * (NOISE_SECONDS - 1);
    source.start(0, offset);
    stops.push(() => { try { source.stop(); } catch { /* stopped */ } source.disconnect(); });
    return source;
  }

  private gain(value: number): GainNode {
    const node = this.ctx.createGain();
    node.gain.value = value;
    return node;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  /** Slow LFO driving an AudioParam around its current value. */
  private lfo(rate: number, depth: number, param: AudioParam, stops: Array<() => void>): void {
    const osc = this.osc(rate, "sine", stops);
    const amount = this.gain(depth);
    osc.connect(amount).connect(param);
  }

  private every(minMs: number, maxMs: number, run: () => void, stops: Array<() => void>): void {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => { run(); schedule(); }, minMs + Math.random() * (maxMs - minMs));
    };
    schedule();
    stops.push(() => clearTimeout(timer));
  }

  private tone(layer: ToneLayer, dry: AudioNode, output: OutputMode) {
    const stops: Array<() => void> = [];
    const [left, right] = carrierPairFor(layer.carrierHz, layer.beatHz, output);
    const level = this.gain(layer.level);
    level.connect(dry);
    const l = this.osc(left, "sine", stops);
    const r = this.osc(right, "sine", stops);
    if (output === "headphones") {
      const merger = this.ctx.createChannelMerger(2);
      l.connect(merger, 0, 0);
      r.connect(merger, 0, 1);
      merger.connect(level);
    } else {
      l.connect(level);
      r.connect(level);
    }
    return stops;
  }

  /** Detuned analog-style chord pad drifting through a slow progression. */
  private pad(layer: PadLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const out = this.gain(layer.level);
    const lowpass = this.filter("lowpass", layer.style === "glass" ? 2600 : layer.style === "choir" ? 1400 : 900, 0.5);
    lowpass.connect(out);
    out.connect(dry);
    const send = this.gain(0.9);
    out.connect(send).connect(wet);
    this.lfo(0.031, layer.style === "glass" ? 700 : 260, lowpass.frequency, stops);

    // Voicings (semitones above the root): i – VI – III – VII in a minor key,
    // voiced low and open so the pad never competes with reading.
    const progression = [[0, 7, 12, 15], [-4, 3, 8, 12], [3, 7, 10, 15], [-2, 5, 10, 14]];
    const type: OscillatorType = layer.style === "glass" ? "triangle" : "sawtooth";
    const voices = progression[0].map((interval, index) => {
      const frequency = layer.rootHz * 2 ** (interval / 12);
      const pair = [-7, 7].map((cents) => this.osc(frequency, type, stops, cents));
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = [-0.55, -0.2, 0.2, 0.55][index];
      const voiceGain = this.gain(layer.style === "choir" ? 0.16 : 0.2);
      if (layer.style === "choir") {
        // Rough "ah" formants give a distant-choir colour.
        [720, 1180, 2500].forEach((formant, i) => {
          const band = this.filter("bandpass", formant, 6);
          const level = this.gain([1, 0.6, 0.25][i]);
          pair.forEach((osc) => osc.connect(band));
          band.connect(level).connect(voiceGain);
        });
      } else {
        pair.forEach((osc) => osc.connect(voiceGain));
      }
      voiceGain.connect(pan).connect(lowpass);
      return { pair, index };
    });
    let step = 0;
    this.every(15_000, 19_000, () => {
      step = (step + 1) % progression.length;
      const at = this.ctx.currentTime;
      voices.forEach(({ pair, index }) => {
        const target = layer.rootHz * 2 ** (progression[step][index] / 12);
        pair.forEach((osc) => osc.frequency.setTargetAtTime(target, at, 2.2));
      });
    }, stops);
    return stops;
  }

  private bed(layer: NoiseLayer, dry: AudioNode) {
    const stops: Array<() => void> = [];
    const source = this.loop(layer.color, stops);
    const level = this.gain(layer.level);
    if (layer.lowpassHz) source.connect(this.filter("lowpass", layer.lowpassHz, 0.4)).connect(level);
    else source.connect(level);
    level.connect(dry);
    return stops;
  }

  /** Surf: pink noise whose level and brightness swell every ~9 seconds. */
  private ocean(layer: OceanLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const source = this.loop("pink", stops);
    const lowpass = this.filter("lowpass", 900, 0.3);
    const swell = this.gain(layer.level * 0.55);
    source.connect(lowpass).connect(swell);
    swell.connect(dry);
    swell.connect(this.gain(0.4)).connect(wet);
    this.lfo(0.105, layer.level * 0.45, swell.gain, stops);
    this.lfo(0.105, 650, lowpass.frequency, stops);
    // A second, slower set of waves so no two swells feel identical.
    this.lfo(0.037, layer.level * 0.18, swell.gain, stops);
    const under = this.loop("brown", stops);
    under.connect(this.gain(layer.level * 0.35)).connect(dry);
    return stops;
  }

  private rain(layer: RainLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const density = layer.intensity === "light" ? 0.45 : layer.intensity === "heavy" ? 1.6 : 1;
    // Hiss: the wash of distant drops.
    const hissSource = this.loop("pink", stops);
    const high = this.filter("highpass", layer.window ? 900 : 500, 0.5);
    const low = this.filter("lowpass", layer.window ? 5200 : 7000, 0.5);
    const hiss = this.gain(layer.level * (0.35 + 0.25 * density));
    hissSource.connect(high).connect(low).connect(hiss);
    hiss.connect(dry);
    this.lfo(0.07, layer.level * 0.08, hiss.gain, stops);
    // Body: low patter on surfaces.
    const body = this.loop("brown", stops);
    body.connect(this.filter("lowpass", 420, 0.5)).connect(this.gain(layer.level * 0.22 * density)).connect(dry);
    // Droplets: short resonant ticks, some on the "window" (a bright band).
    const drop = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.025), this.ctx.sampleRate);
    fillNoise("white", drop.getChannelData(0));
    const interval = setInterval(() => {
      const count = Math.round((1 + Math.random() * 4) * density);
      for (let i = 0; i < count; i += 1) {
        const at = this.ctx.currentTime + Math.random() * 0.2;
        const source = this.ctx.createBufferSource();
        source.buffer = drop;
        const tone = this.filter("bandpass", (layer.window ? 2400 : 1500) + Math.random() * 3600, 5 + Math.random() * 6);
        const env = this.ctx.createGain();
        const peak = layer.level * (0.05 + Math.random() * 0.09);
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(peak, at + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.03);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.8 - 0.9;
        source.connect(tone).connect(env).connect(pan);
        pan.connect(dry);
        pan.connect(wet);
        source.start(at);
        source.onended = () => { source.disconnect(); tone.disconnect(); env.disconnect(); pan.disconnect(); };
      }
    }, 200);
    stops.push(() => clearInterval(interval));
    if (layer.thunder) {
      this.every(40_000, 110_000, () => {
        const at = this.ctx.currentTime;
        const rumble = this.ctx.createBufferSource();
        rumble.buffer = this.noiseBuffer("brown");
        const lowpass = this.filter("lowpass", 90 + Math.random() * 60, 0.7);
        const env = this.ctx.createGain();
        const peak = layer.level * (0.45 + Math.random() * 0.3);
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(peak, at + 1.4 + Math.random());
        env.gain.exponentialRampToValueAtTime(0.0001, at + 7 + Math.random() * 3);
        rumble.connect(lowpass).connect(env);
        env.connect(dry);
        env.connect(wet);
        rumble.start(at, Math.random() * 5, 11);
        rumble.onended = () => { rumble.disconnect(); lowpass.disconnect(); env.disconnect(); };
      }, stops);
    }
    return stops;
  }

  /** Air moving past a window: band-passed noise whose pitch wanders. */
  private wind(layer: WindLayer, dry: AudioNode) {
    const stops: Array<() => void> = [];
    const source = this.loop("pink", stops);
    const band = this.filter("bandpass", 520, 1.1);
    const level = this.gain(layer.level * 0.8);
    source.connect(band).connect(level).connect(dry);
    this.lfo(0.043, 260, band.frequency, stops);
    this.lfo(0.061, layer.level * 0.35, level.gain, stops);
    return stops;
  }

  private fire(layer: FireLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const roar = this.loop("brown", stops);
    roar.connect(this.filter("lowpass", 320, 0.6)).connect(this.gain(layer.level * 0.45)).connect(dry);
    const click = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.008), this.ctx.sampleRate);
    fillNoise("white", click.getChannelData(0));
    this.every(60, 420, () => {
      const at = this.ctx.currentTime;
      const burst = Math.random() < 0.15 ? 3 + Math.floor(Math.random() * 4) : 1;
      for (let i = 0; i < burst; i += 1) {
        const source = this.ctx.createBufferSource();
        source.buffer = click;
        const tone = this.filter("highpass", 1400 + Math.random() * 2400, 0.8);
        const env = this.gain(layer.level * (0.08 + Math.random() * 0.22));
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.random() * 0.8 - 0.4;
        source.connect(tone).connect(env).connect(pan);
        pan.connect(dry);
        pan.connect(wet);
        source.start(at + i * (0.012 + Math.random() * 0.03));
        source.onended = () => { source.disconnect(); tone.disconnect(); env.disconnect(); pan.disconnect(); };
      }
    }, stops);
    return stops;
  }

  /** Sparse, soft glass bells from a pentatonic scale, mostly reverb. */
  private chimes(layer: ChimesLayer, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const scale = [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];
    this.every(3500, 11_000, () => {
      const at = this.ctx.currentTime;
      const notes = 1 + Math.floor(Math.random() * 3);
      for (let n = 0; n < notes; n += 1) {
        const frequency = scale[Math.floor(Math.random() * scale.length)];
        const start = at + n * (0.18 + Math.random() * 0.4);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(layer.level * (0.3 + Math.random() * 0.4), start + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, start + 3.2);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.4 - 0.7;
        env.connect(pan).connect(wet);
        [[1, 1], [2.76, 0.25], [5.4, 0.08]].forEach(([ratio, amp]) => {
          const osc = this.ctx.createOscillator();
          osc.frequency.value = frequency * ratio;
          const partial = this.gain(amp);
          osc.connect(partial).connect(env);
          osc.start(start);
          osc.stop(start + 3.3);
          osc.onended = () => { osc.disconnect(); partial.disconnect(); };
        });
      }
    }, stops);
    return stops;
  }

  /** Lo-fi warmth: a faint tape hiss with sparse dust crackles. */
  private vinyl(layer: VinylLayer, dry: AudioNode) {
    const stops: Array<() => void> = [];
    const hiss = this.loop("pink", stops);
    hiss.connect(this.filter("bandpass", 3200, 0.4)).connect(this.gain(layer.level * 0.12)).connect(dry);
    const click = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.004), this.ctx.sampleRate);
    fillNoise("white", click.getChannelData(0));
    this.every(90, 900, () => {
      const source = this.ctx.createBufferSource();
      source.buffer = click;
      const env = this.gain(layer.level * (0.05 + Math.random() * 0.2));
      source.connect(this.filter("highpass", 2000, 0.7)).connect(env).connect(dry);
      source.start();
      source.onended = () => { source.disconnect(); env.disconnect(); };
    }, stops);
    return stops;
  }
}
