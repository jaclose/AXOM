import type { SoundscapePreset } from "./presets";

export type OutputMode = "headphones" | "speakers";

/** Speakers can't reproduce very low carriers; monaural beats stay audible above this. */
const SPEAKER_MIN_CARRIER_HZ = 140;
const CROSSFADE_S = 1.6;
const NOISE_SECONDS = 12;

interface Layer {
  bus: GainNode;
  stop: () => void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
}

export function soundscapesSupported(): boolean {
  return Boolean(audioContextCtor());
}

/** Carrier pair for a binaural (headphones) or monaural (speakers) beat. */
export function carrierPair(preset: Pick<SoundscapePreset, "carrierHz" | "beatHz">, output: OutputMode): [number, number] | null {
  if (!preset.carrierHz || !preset.beatHz) return null;
  const base = output === "speakers" ? Math.max(preset.carrierHz, SPEAKER_MIN_CARRIER_HZ) : preset.carrierHz;
  return [base, base + preset.beatHz];
}

/** Perceptual volume (0–100) → linear gain, capped well below full scale. */
export function volumeToGain(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / 100;
  return 0.55 * v * v;
}

/**
 * Stereo noise buffers. Brown: leaky-integrated white noise. Pink: Paul
 * Kellet's economy filter. Channels are independent so the bed feels wide.
 */
export function fillNoise(kind: "brown" | "pink" | "white", channel: Float32Array, random: () => number = Math.random): void {
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < channel.length; i += 1) {
    const white = random() * 2 - 1;
    if (kind === "white") channel[i] = white * 0.5;
    else if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02;
      channel[i] = last * 3.5;
    } else {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      channel[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  // Fade the loop seam over 40 ms so the buffer repeats without a click.
  const fade = Math.min(channel.length >> 1, 1764);
  for (let i = 0; i < fade; i += 1) {
    const t = i / fade;
    channel[i] = channel[i] * t + channel[channel.length - fade + i] * (1 - t);
  }
}

/**
 * The live audio graph. One engine per app: layers crossfade on a shared
 * master → analyser → output. Output goes through a media element when the
 * browser allows it, so macOS Now Playing and media keys work and playback
 * survives background tabs.
 */
export class SoundscapeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private element: HTMLAudioElement | null = null;
  private layer: Layer | null = null;
  private noise = new Map<string, AudioBuffer>();

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  private async context(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error("This browser can’t synthesize audio.");
    const ctx = new Ctor({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.86;
    master.connect(analyser);
    let routed = false;
    if (typeof ctx.createMediaStreamDestination === "function" && typeof Audio !== "undefined") {
      try {
        const stream = ctx.createMediaStreamDestination();
        analyser.connect(stream);
        const element = new Audio();
        element.srcObject = stream.stream;
        await element.play();
        this.element = element;
        routed = true;
      } catch {
        routed = false;
      }
    }
    if (!routed) analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.analyser = analyser;
    return ctx;
  }

  private noiseBuffer(ctx: AudioContext, kind: "brown" | "pink" | "white"): AudioBuffer {
    const cached = this.noise.get(kind);
    if (cached) return cached;
    const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) fillNoise(kind, buffer.getChannelData(channel));
    this.noise.set(kind, buffer);
    return buffer;
  }

  /** Start (or crossfade to) a preset. Must follow a user gesture the first time. */
  async play(preset: SoundscapePreset, options: { volume: number; output: OutputMode }): Promise<void> {
    const ctx = await this.context();
    await this.element?.play().catch(() => undefined);
    const now = ctx.currentTime;
    const previous = this.layer;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + CROSSFADE_S);
    bus.connect(this.master!);
    const stops = this.build(ctx, bus, preset, options.output);
    this.layer = { bus, stop: () => stops.forEach((stop) => stop()) };
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setTargetAtTime(volumeToGain(options.volume), now, 0.35);
    if (previous) this.retire(previous, now);
  }

  private retire(layer: Layer, at: number, seconds = CROSSFADE_S): void {
    layer.bus.gain.cancelScheduledValues(at);
    layer.bus.gain.setValueAtTime(layer.bus.gain.value, at);
    layer.bus.gain.linearRampToValueAtTime(0, at + seconds);
    window.setTimeout(() => {
      layer.stop();
      layer.bus.disconnect();
    }, seconds * 1000 + 120);
  }

  private build(ctx: AudioContext, bus: GainNode, preset: SoundscapePreset, output: OutputMode): Array<() => void> {
    const stops: Array<() => void> = [];
    const oscillator = (frequency: number, type: OscillatorType = "sine") => {
      const node = ctx.createOscillator();
      node.type = type;
      node.frequency.value = frequency;
      node.start();
      stops.push(() => { try { node.stop(); } catch { /* already stopped */ } node.disconnect(); });
      return node;
    };

    const pair = carrierPair(preset, output);
    if (pair) {
      const tone = ctx.createGain();
      tone.gain.value = 0.34;
      tone.connect(bus);
      const [left, right] = pair.map((frequency) => oscillator(frequency));
      if (output === "headphones") {
        const merger = ctx.createChannelMerger(2);
        left.connect(merger, 0, 0);
        right.connect(merger, 0, 1);
        merger.connect(tone);
      } else {
        // Both tones in both ears: the beat is audible on any speaker.
        left.connect(tone);
        right.connect(tone);
      }
    }

    if (preset.pad && preset.carrierHz) {
      // A slow, filtered drone a fifth apart, breathing over ~20 seconds.
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 650;
      filter.Q.value = 0.6;
      const pad = ctx.createGain();
      pad.gain.value = 0.07;
      filter.connect(pad).connect(bus);
      const root = preset.carrierHz / 2;
      [root, root * 1.5 + 0.3, root * 2 + 0.6].forEach((frequency, index) => {
        const voice = oscillator(frequency, "triangle");
        const pan = ctx.createStereoPanner();
        pan.pan.value = [-0.45, 0, 0.45][index];
        voice.connect(pan).connect(filter);
      });
      const lfo = oscillator(0.05);
      const depth = ctx.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(filter.frequency);
    }

    const bed = (kind: "brown" | "pink", level: number, shape?: (node: AudioNode) => AudioNode) => {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx, kind);
      source.loop = true;
      source.loopStart = Math.random() * (NOISE_SECONDS - 1);
      const gain = ctx.createGain();
      gain.gain.value = level;
      (shape ? shape(source) : source).connect(gain).connect(bus);
      source.start(0, source.loopStart);
      stops.push(() => { try { source.stop(); } catch { /* stopped */ } source.disconnect(); });
      return gain;
    };

    if (preset.noise) bed(preset.noise, preset.noise === "brown" ? 0.62 : 0.45);

    if (preset.rain) {
      const band = (source: AudioNode) => {
        const high = ctx.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 450;
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 6500;
        source.connect(high).connect(low);
        return low;
      };
      const hiss = bed("pink", 0.5, band);
      bed("brown", 0.16);
      // Gusts: slow random swells so the rain never sounds like a loop.
      const gust = window.setInterval(() => {
        hiss.gain.setTargetAtTime(0.38 + Math.random() * 0.3, ctx.currentTime, 0.9);
      }, 1400);
      // Droplets: short filtered clicks, panned randomly.
      const drop = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
      fillNoise("white", drop.getChannelData(0));
      const droplets = window.setInterval(() => {
        const count = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i += 1) {
          const at = ctx.currentTime + Math.random() * 0.25;
          const source = ctx.createBufferSource();
          source.buffer = drop;
          const tone = ctx.createBiquadFilter();
          tone.type = "bandpass";
          tone.frequency.value = 1800 + Math.random() * 3200;
          tone.Q.value = 6;
          const pan = ctx.createStereoPanner();
          pan.pan.value = Math.random() * 1.6 - 0.8;
          const env = ctx.createGain();
          env.gain.setValueAtTime(0, at);
          env.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.07, at + 0.002);
          env.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
          source.connect(tone).connect(env).connect(pan).connect(bus);
          source.start(at);
          source.onended = () => source.disconnect();
        }
      }, 250);
      stops.push(() => { window.clearInterval(gust); window.clearInterval(droplets); });
    }
    return stops;
  }

  setVolume(volume: number): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(volumeToGain(volume), this.ctx.currentTime, 0.12);
  }

  async pause(): Promise<void> {
    this.element?.pause();
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
    await this.element?.play().catch(() => undefined);
  }

  /** Fade out, then release the sources. A long fade suits the sleep timer. */
  stop(fadeSeconds = 1.2): Promise<void> {
    const ctx = this.ctx;
    const layer = this.layer;
    this.layer = null;
    if (!ctx || !layer) return Promise.resolve();
    this.retire(layer, ctx.currentTime, fadeSeconds);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (!this.layer) {
          this.element?.pause();
          void ctx.suspend().catch(() => undefined);
        }
        resolve();
      }, fadeSeconds * 1000 + 160);
    });
  }
}
