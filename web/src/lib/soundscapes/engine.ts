import { versionOf, type SoundscapePreset, type SoundscapeVersion } from "./presets";
import { LayerKit, carrierPairFor, fillNoise, impulseResponse } from "./synth";

export type OutputMode = "headphones" | "speakers";
export { fillNoise };

const CROSSFADE_S = 1.8;
/** Seconds for the very first fade-in from silence (never a sudden start). */
const FIRST_FADE_TAU_S = 1.4;
/** Largest loudness trim any version may apply (dB). */
export const MAX_TRIM_DB = 8;

/** Hearing-comfort settings shared by every soundscape (see context()). */
export const COMFORT = {
  subsonicHz: 32,
  shelfHz: 5200,
  shelfDb: -5,
  topHz: 10_500,
  /** Pre-volume: bursts above this are squeezed (the beds sit ~6 dB below). */
  tamerThresholdDb: -9,
  /** Post-volume sample ceiling. */
  ceilingDb: -9,
  inputTrim: 0.57,
} as const;

/**
 * A 12-second mono WAV of dither-level noise (±1 LSB, about -90 dBFS: far
 * below hearing). Chrome only lists "persistent" media players in Now Playing
 * and the media keys; the Web Audio stream alone counts as a one-shot call.
 */
function createSessionAnchor(): HTMLAudioElement | null {
  if (typeof Audio === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    const rate = 8000;
    const samples = rate * 12;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.round(Math.random() * 2 - 1), true);
    const element = new Audio(URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })));
    element.loop = true;
    element.preload = "auto";
    return element;
  } catch {
    return null;
  }
}

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
 * The live audio graph. One engine per app: versions crossfade into a shared
 * hearing-comfort chain → volume → peak ceiling → analyser → speakers. A
 * near-silent anchor file makes AXOM a "persistent" media player, so macOS
 * Now Playing, Control Center and the media keys see it.
 */
export class SoundscapeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Entry of the hearing-comfort chain every version feeds. */
  private input: GainNode | null = null;
  /** Near-silent looping file: gives the browser a real media player so macOS Now Playing and media keys see AXOM. */
  private anchor: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
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
    // Hearing comfort, before the volume so it works at every level:
    //   subsonic high-pass (no ear pressure) → soft high shelf and gentle
    //   top roll-off (no hiss fatigue) → transient tamer (no sudden chirps or
    //   clicks more than a few dB above the bed).
    const input = ctx.createGain();
    // The tamer adds automatic make-up gain (Chrome ≈ +4.9 dB at these
    // settings); take it back so a volume setting sounds as loud as before.
    input.gain.value = COMFORT.inputTrim;
    const subsonic = ctx.createBiquadFilter();
    subsonic.type = "highpass";
    subsonic.frequency.value = COMFORT.subsonicHz;
    subsonic.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = COMFORT.shelfHz;
    shelf.gain.value = COMFORT.shelfDb;
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = COMFORT.topHz;
    top.Q.value = 0.5;
    const tamer = ctx.createDynamicsCompressor();
    tamer.threshold.value = COMFORT.tamerThresholdDb;
    tamer.knee.value = 6;
    tamer.ratio.value = 10;
    tamer.attack.value = 0.003;
    tamer.release.value = 0.25;
    const master = ctx.createGain();
    master.gain.value = 0;
    input.connect(subsonic).connect(shelf).connect(top).connect(tamer).connect(master);
    // Final peak guard after the volume: nothing leaves AXOM above this ceiling.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = COMFORT.ceilingDb;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.3;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.86;
    master.connect(limiter).connect(analyser);
    // Straight to the speakers. (A MediaStream <audio> route used to sit here;
    // Chrome counts stream playback as a one-shot "call", and any one-shot
    // player makes the whole tab uncontrollable, which hid AXOM from macOS
    // Now Playing and the media keys. AudioContext output alone keeps the
    // tab audible, so background tabs aren't throttled.)
    analyser.connect(ctx.destination);
    this.anchor = createSessionAnchor();
    this.input = input;
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
    const version = versionOf(preset, options.versionId);
    const now = ctx.currentTime;
    const previous = this.layer;
    const bus = ctx.createGain();
    const trim = "recipe" in version ? 10 ** (Math.min(MAX_TRIM_DB, version.recipe.trimDb ?? 0) / 20) : 1;
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(trim, now + CROSSFADE_S);
    bus.connect(this.input!);
    const stops = this.build(ctx, bus, version, options.output);
    this.layer = { bus, stop: () => stops.forEach((stop) => stop()) };
    // From silence, fade in slowly; between versions the crossfade already does the work.
    const fromSilence = !previous || this.master!.gain.value < 0.002;
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setTargetAtTime(volumeToGain(options.volume), now, fromSilence ? FIRST_FADE_TAU_S : 0.35);
    void this.anchor?.play().catch(() => undefined);
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
    // Shipped files are relative to the app; your own files arrive as blob: URLs.
    const url = /^(blob:|https?:|data:)/.test(version.src) ? version.src : `${import.meta.env.BASE_URL}${version.src}`;
    const element = new Audio(url);
    element.loop = true;
    if (!url.startsWith("blob:")) element.crossOrigin = "anonymous";
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
    this.anchor?.pause();
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
    await this.anchor?.play().catch(() => undefined);
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
          this.anchor?.pause();
          void ctx.suspend().catch(() => undefined);
        }
        resolve();
      }, fadeSeconds * 1000 + 160);
    });
  }
}
