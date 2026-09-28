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
export interface NoiseLayer { kind: "noise"; color: "brown" | "pink" | "white"; level: number; lowpassHz?: number; highpassHz?: number }
export interface OceanLayer { kind: "ocean"; level: number }
export interface RainLayer { kind: "rain"; intensity: RainIntensity; level: number; thunder?: boolean; window?: boolean }
export interface WindLayer { kind: "wind"; level: number }
export interface FireLayer { kind: "fire"; level: number }
export interface ChimesLayer { kind: "chimes"; level: number }
export interface VinylLayer { kind: "vinyl"; level: number }
/** A box fan: airy broadband wash, a low motor hum and a faint blade flutter. */
export interface FanLayer { kind: "fan"; level: number; speed?: "low" | "high" }
/** An airliner cabin at cruise: low engine drone, air-conditioning hiss, slow swells. */
export interface CabinLayer { kind: "cabin"; level: number }
/** A café murmur: several distant voices (formant-shaped noise) and the odd cup. */
export interface ChatterLayer { kind: "chatter"; level: number; voices?: number; cups?: boolean }
/** Forest birdsong over leaves: a few species calling from different distances. */
export interface BirdsLayer { kind: "birds"; level: number; density?: "sparse" | "dawn" }

export type SynthLayer = ToneLayer | PadLayer | NoiseLayer | OceanLayer | RainLayer | WindLayer | FireLayer | ChimesLayer | VinylLayer
  | FanLayer | CabinLayer | ChatterLayer | BirdsLayer;

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
/** Relative level of the second carrier through speakers (the beat's modulation depth). */
export const MONAURAL_BEAT_DEPTH = 0.5;

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
      case "fan": return this.fan(layer, dry);
      case "cabin": return this.cabin(layer, dry);
      case "chatter": return this.chatter(layer, dry, wet);
      case "birds": return this.birds(layer, dry, wet);
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
      // Two equal tones in the air beat at 100% depth, a buzz that tires the
      // ear within minutes (20–40 Hz is the "roughness" band). A quieter
      // second tone keeps the beat audible at about half the depth.
      l.connect(level);
      r.connect(this.gain(MONAURAL_BEAT_DEPTH)).connect(level);
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
    let chain: AudioNode = source;
    if (layer.highpassHz) chain = chain.connect(this.filter("highpass", layer.highpassHz, 0.5));
    if (layer.lowpassHz) chain = chain.connect(this.filter("lowpass", layer.lowpassHz, 0.4));
    chain.connect(level);
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
        const tone = this.filter("bandpass", 1200 + Math.random() * 1800, 0.9);
        const env = this.gain(layer.level * (0.06 + Math.random() * 0.14));
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
        env.gain.exponentialRampToValueAtTime(layer.level * (0.2 + Math.random() * 0.25), start + 0.03);
        env.gain.exponentialRampToValueAtTime(0.0001, start + 3.2);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.4 - 0.7;
        env.connect(pan).connect(wet);
        [[1, 1], [2.76, 0.18], [5.4, 0.04]].forEach(([ratio, amp]) => {
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
      const env = this.gain(layer.level * (0.03 + Math.random() * 0.1));
      source.connect(this.filter("bandpass", 2400, 0.8)).connect(env).connect(dry);
      source.start();
      source.onended = () => { source.disconnect(); env.disconnect(); };
    }, stops);
    return stops;
  }

  private fan(layer: FanLayer, dry: AudioNode) {
    const stops: Array<() => void> = [];
    const high = layer.speed === "high";
    // Air: pink noise shaped like a fan grille (a broad hump around 500–900 Hz).
    const air = this.loop("pink", stops);
    const body = this.filter("peaking", high ? 820 : 620, 0.8);
    body.gain.value = 6;
    const top = this.filter("lowpass", high ? 5200 : 3800, 0.5);
    const airLevel = this.gain(layer.level * 0.75);
    air.connect(body).connect(top).connect(airLevel).connect(dry);
    // Blade flutter: a slow, shallow sway (fast flutter reads as a buzz).
    this.lfo(high ? 9 : 6.5, layer.level * 0.025, airLevel.gain, stops);
    // Motor hum: a quiet mains-ish fundamental with a softer harmonic.
    const hum = this.gain(layer.level * 0.06);
    hum.connect(this.filter("lowpass", 400, 0.7)).connect(dry);
    [[high ? 118 : 104, 1], [high ? 236 : 208, 0.35]].forEach(([frequency, amp]) => this.osc(frequency, "sine", stops).connect(this.gain(amp)).connect(hum));
    this.lfo(0.05, layer.level * 0.015, hum.gain, stops);
    return stops;
  }

  private cabin(layer: CabinLayer, dry: AudioNode) {
    const stops: Array<() => void> = [];
    // The deep roar that fills an airliner at cruise.
    const roar = this.loop("brown", stops);
    const roarLevel = this.gain(layer.level * 0.95);
    roar.connect(this.filter("lowpass", 260, 0.6)).connect(roarLevel).connect(dry);
    this.lfo(0.021, layer.level * 0.12, roarLevel.gain, stops);
    // Air-conditioning: a soft, bright hiss from the vents.
    const vent = this.loop("pink", stops);
    vent.connect(this.filter("highpass", 1200, 0.5)).connect(this.filter("lowpass", 6500, 0.5)).connect(this.gain(layer.level * 0.12)).connect(dry);
    // Engine tones: close pairs that beat slowly, like two engines out of sync.
    const drone = this.gain(layer.level * 0.035);
    drone.connect(this.filter("lowpass", 700, 0.7)).connect(dry);
    [[86, 86.35], [129, 129.6], [172, 172.4]].forEach(([a, b], i) => {
      const amp = [1, 0.5, 0.25][i];
      this.osc(a, "sine", stops).connect(this.gain(amp)).connect(drone);
      this.osc(b, "sine", stops).connect(this.gain(amp * 0.8)).connect(drone);
    });
    return stops;
  }

  /** Distant café voices. Each "speaker" is noise through two moving vowel formants, gated in syllables and phrases. */
  private chatter(layer: ChatterLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    // Room tone under everything: it carries the loudness, so the voices can stay far away.
    const room = this.loop("pink", stops);
    room.connect(this.filter("lowpass", 1100, 0.5)).connect(this.gain(layer.level * 0.42)).connect(dry);
    const muffle = this.filter("lowpass", 2200, 0.6);
    const bus = this.gain(1);
    bus.connect(muffle);
    muffle.connect(this.gain(0.45)).connect(dry);
    muffle.connect(this.gain(0.9)).connect(wet);
    const vowels = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [440, 1020], [300, 870], [660, 1720]];
    const voices = Math.max(2, Math.min(9, layer.voices ?? 6));
    for (let v = 0; v < voices; v += 1) {
      const source = this.loop("pink", stops);
      const pitchShift = 0.82 + Math.random() * 0.4; // lower and higher voices
      // Broad formants: narrow ones whistle.
      const f1 = this.filter("bandpass", 500, 3.2);
      const f2 = this.filter("bandpass", 1500, 4);
      const gate = this.ctx.createGain();
      gate.gain.value = 0;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      const distance = this.gain(layer.level * (0.35 + Math.random() * 0.45) * Math.sqrt(6 / voices));
      source.connect(f1).connect(gate);
      source.connect(f2).connect(this.gain(0.45)).connect(gate);
      gate.connect(distance).connect(pan).connect(bus);
      // Speak in phrases of syllables, then pause, like real conversation.
      let talking = Math.random() < 0.5;
      this.every(170, 280, () => {
        const at = this.ctx.currentTime + 0.02;
        if (Math.random() < (talking ? 0.07 : 0.2)) talking = !talking;
        if (!talking) { gate.gain.setTargetAtTime(0, at, 0.08); return; }
        const [a, b] = vowels[Math.floor(Math.random() * vowels.length)];
        f1.frequency.setTargetAtTime(a * pitchShift, at, 0.04);
        f2.frequency.setTargetAtTime(b * pitchShift, at, 0.04);
        const peak = 0.45 + Math.random() * 0.35;
        gate.gain.cancelScheduledValues(at);
        gate.gain.setTargetAtTime(peak, at, 0.04);
        gate.gain.setTargetAtTime(0.12, at + 0.1 + Math.random() * 0.08, 0.06);
      }, stops);
    }
    if (layer.cups !== false) {
      // Now and then a cup meets a saucer somewhere across the room.
      this.every(5000, 14_000, () => {
        const at = this.ctx.currentTime;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(layer.level * (0.015 + Math.random() * 0.02), at + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.4 - 0.7;
        env.connect(pan);
        pan.connect(this.gain(0.4)).connect(dry);
        pan.connect(wet);
        const base = 1900 + Math.random() * 1100;
        [[1, 1], [1.51, 0.4], [2.37, 0.15]].forEach(([ratio, amp]) => {
          const osc = this.ctx.createOscillator();
          osc.frequency.value = base * ratio;
          const partial = this.gain(amp);
          osc.connect(partial).connect(env);
          osc.start(at);
          osc.stop(at + 0.5);
          osc.onended = () => { osc.disconnect(); partial.disconnect(); };
        });
      }, stops);
    }
    return stops;
  }

  /**
   * Birdsong over leaves. Calls sit in the 1.6–3.4 kHz range with soft
   * onsets (25–40 ms): real birds far away, not beeps in your ear. The leaf
   * bed carries the loudness so the calls stay a few dB above it.
   */
  private birds(layer: BirdsLayer, dry: AudioNode, wet: AudioNode) {
    const stops: Array<() => void> = [];
    const dawn = layer.density === "dawn";
    // Leaves: a soft rustle that breathes with the breeze.
    const leaves = this.loop("pink", stops);
    const leafLevel = this.gain(layer.level * 0.28);
    leaves.connect(this.filter("highpass", 500, 0.5)).connect(this.filter("lowpass", 3800, 0.5)).connect(leafLevel).connect(dry);
    this.lfo(0.07, layer.level * 0.09, leafLevel.gain, stops);
    // A far-off low wash (distant trees and air) so the forest has depth.
    const air = this.loop("brown", stops);
    air.connect(this.filter("lowpass", 380, 0.5)).connect(this.gain(layer.level * 0.22)).connect(dry);
    const envelope = (env: GainNode, at: number, peak: number, attack: number, end: number) => {
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(peak, at + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
    };
    const species: Array<(at: number, out: AudioNode, amp: number) => number> = [
      // A slow whistle that slides down (thrush-like).
      (at, out, amp) => {
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        const f = 1900 + Math.random() * 600;
        osc.frequency.setValueAtTime(f, at);
        osc.frequency.exponentialRampToValueAtTime(f * 0.78, at + 0.5);
        envelope(env, at, amp, 0.04, at + 0.55);
        osc.connect(env).connect(out);
        osc.start(at); osc.stop(at + 0.6);
        osc.onended = () => { osc.disconnect(); env.disconnect(); };
        return 0.6;
      },
      // A short phrase of soft up-chirps (sparrow-like).
      (at, out, amp) => {
        const notes = 2 + Math.floor(Math.random() * 3);
        const base = 2500 + Math.random() * 700;
        for (let n = 0; n < notes; n += 1) {
          const start = at + n * 0.14;
          const osc = this.ctx.createOscillator();
          const env = this.ctx.createGain();
          osc.frequency.setValueAtTime(base * 0.85, start);
          osc.frequency.exponentialRampToValueAtTime(base * (1.02 + n * 0.015), start + 0.07);
          envelope(env, start, amp * 0.7, 0.025, start + 0.11);
          osc.connect(env).connect(out);
          osc.start(start); osc.stop(start + 0.12);
          osc.onended = () => { osc.disconnect(); env.disconnect(); };
        }
        return notes * 0.14;
      },
      // A gentle warble (slow wobble; fast ones sound like an alarm).
      (at, out, amp) => {
        const osc = this.ctx.createOscillator();
        const wobble = this.ctx.createOscillator();
        const depth = this.gain(70 + Math.random() * 60);
        const env = this.ctx.createGain();
        const length = 0.45 + Math.random() * 0.4;
        osc.frequency.value = 2200 + Math.random() * 700;
        wobble.frequency.value = 9 + Math.random() * 5;
        wobble.connect(depth).connect(osc.frequency);
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(amp * 0.55, at + 0.08);
        env.gain.setValueAtTime(amp * 0.55, at + length - 0.12);
        env.gain.exponentialRampToValueAtTime(0.0001, at + length);
        osc.connect(env).connect(out);
        osc.start(at); wobble.start(at); osc.stop(at + length + 0.02); wobble.stop(at + length + 0.02);
        osc.onended = () => { osc.disconnect(); wobble.disconnect(); depth.disconnect(); env.disconnect(); };
        return length;
      },
      // Two-note "tee-oo" call (a chickadee-like pair).
      (at, out, amp) => {
        [[3100, 0], [2500, 0.3]].forEach(([f, offset]) => {
          const start = at + offset;
          const osc = this.ctx.createOscillator();
          const env = this.ctx.createGain();
          osc.frequency.setValueAtTime(f, start);
          osc.frequency.linearRampToValueAtTime(f * 0.95, start + 0.22);
          envelope(env, start, amp * 0.6, 0.035, start + 0.26);
          osc.connect(env).connect(out);
          osc.start(start); osc.stop(start + 0.28);
          osc.onended = () => { osc.disconnect(); env.disconnect(); };
        });
        return 0.6;
      },
    ];
    // Each bird lives somewhere in the forest (pan + distance) and repeats its own song.
    const birds = Array.from({ length: dawn ? 5 : 3 }, (_, i) => ({
      song: species[i % species.length],
      pan: Math.random() * 1.6 - 0.8,
      distance: 0.3 + Math.random() * 0.5,
    }));
    birds.forEach((bird) => {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = bird.pan;
      const far = this.filter("lowpass", 2600 + bird.distance * 3000, 0.5); // far birds lose their top
      const out = this.gain(1);
      out.connect(far).connect(pan);
      pan.connect(this.gain(0.45)).connect(dry);
      pan.connect(this.gain(0.8)).connect(wet);
      stops.push(() => { pan.disconnect(); far.disconnect(); out.disconnect(); });
      this.every(dawn ? 2600 : 4500, dawn ? 8000 : 15_000, () => {
        let at = this.ctx.currentTime + 0.05;
        const repeats = 1 + Math.floor(Math.random() * 2);
        for (let r = 0; r < repeats; r += 1) at += bird.song(at, out, layer.level * 0.07 * bird.distance) + 0.4 + Math.random() * 0.5;
      }, stops);
    });
    return stops;
  }
}
