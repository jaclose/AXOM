import { versionOf, type SoundscapePreset, type SoundscapeVersion } from "./presets";
import { LayerKit, carrierPairFor, fillNoise, impulseResponse } from "./synth";

export type OutputMode = "headphones" | "speakers";
export { fillNoise };

const CROSSFADE_S = 1.8;

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
  return carrierPairFor(preset.carrierHz, preset.beatHz, output);
}

/** Perceptual volume (0–100) → linear gain, capped well below full scale. */
export function volumeToGain(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / 100;
  return 0.6 * v * v;
}

/**
 * The live audio graph. One engine per app: versions crossfade on a shared
 * master → gentle limiter → analyser → output. Output goes through a media
 * element when the browser allows it, so macOS Now Playing and media keys
 * work and playback survives background tabs.
 */
export class SoundscapeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private element: HTMLAudioElement | null = null;
  private layer: Layer | null = null;
  private kit: LayerKit | null = null;
  private rooms = new Map<number, AudioBuffer>();

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /** Create/resume the audio context inside a user gesture so later (hover) previews can start. */
  async unlock(): Promise<boolean> {
    const ctx = await this.context();
    return ctx.state === "running";
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
    // Soft-knee limiting keeps stacked layers from clipping without pumping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.02;
    limiter.release.value = 0.4;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.86;
    master.connect(limiter).connect(analyser);
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
    this.kit = new LayerKit(ctx);
    return ctx;
  }

  private room(ctx: AudioContext, seconds: number): AudioBuffer {
    const key = Math.round(seconds * 10);
    let buffer = this.rooms.get(key);
    if (!buffer) {
      buffer = impulseResponse(ctx, seconds);
      this.rooms.set(key, buffer);
    }
    return buffer;
  }

  /** Start (or crossfade to) a preset version. Must follow a user gesture the first time. */
  async play(preset: SoundscapePreset, options: { volume: number; output: OutputMode; versionId?: string }): Promise<void> {
    const ctx = await this.context();
    await this.element?.play().catch(() => undefined);
    const version = versionOf(preset, options.versionId);
    const now = ctx.currentTime;
    const previous = this.layer;
    const bus = ctx.createGain();
    const trim = "recipe" in version ? 10 ** ((version.recipe.trimDb ?? 0) / 20) : 1;
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(trim, now + CROSSFADE_S);
    bus.connect(this.master!);
    const stops = this.build(ctx, bus, version, options.output);
    this.layer = { bus, stop: () => stops.forEach((stop) => stop()) };
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setTargetAtTime(volumeToGain(options.volume), now, 0.35);
    if (previous) this.retire(previous, now);
  }

  private build(ctx: AudioContext, bus: GainNode, version: SoundscapeVersion, output: OutputMode): Array<() => void> {
    if ("src" in version) return this.recording(ctx, bus, version);
    const stops: Array<() => void> = [];
    let wet: GainNode | null = null;
    if (version.recipe.reverb) {
      const convolver = ctx.createConvolver();
      convolver.buffer = this.room(ctx, version.recipe.reverb.seconds);
      wet = ctx.createGain();
      wet.gain.value = 1;
      const wetLevel = ctx.createGain();
      wetLevel.gain.value = version.recipe.reverb.mix;
      wet.connect(convolver).connect(wetLevel).connect(bus);
      // Everything also sends a little to the room, so the mix feels placed.
      const dry = ctx.createGain();
      dry.connect(bus);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      dry.connect(send).connect(wet);
      stops.push(() => { convolver.disconnect(); wetLevel.disconnect(); send.disconnect(); dry.disconnect(); wet?.disconnect(); });
      stops.push(...this.kit!.build(version.recipe, dry, wet, output));
      return stops;
    }
    stops.push(...this.kit!.build(version.recipe, bus, null, output));
    return stops;
  }

  /** An imported recording: a pre-looped file streamed through the graph. */
  private recording(ctx: AudioContext, bus: GainNode, version: Extract<SoundscapeVersion, { src: string }>): Array<() => void> {
    const element = new Audio(`${import.meta.env.BASE_URL}${version.src}`);
    element.loop = true;
    element.crossOrigin = "anonymous";
    const source = ctx.createMediaElementSource(element);
    const level = ctx.createGain();
    level.gain.value = version.gain ?? 0.8;
    source.connect(level).connect(bus);
    void element.play().catch(() => undefined);
    return [() => { element.pause(); element.removeAttribute("src"); element.load(); source.disconnect(); level.disconnect(); }];
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
