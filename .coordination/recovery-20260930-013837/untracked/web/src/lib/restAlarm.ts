import { invoke } from "@tauri-apps/api/core";
import { isMacDesktopShell } from "./desktopShell";
import { readRestAudio } from "./restAudioFile";
import type { RestPreferences } from "./restPreferences";

let context: AudioContext | null = null;
let alarmTimer: ReturnType<typeof setInterval> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let custom: HTMLAudioElement | null = null;
let customUrl: string | undefined;
let generation = 0;
const oscillators = new Set<OscillatorNode>();
const gains = new Set<GainNode>();
let systemName: string | undefined;
function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}
export function primeRestAlarm(): void {
  const ctx = audioContext();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}
export function alarmLevel(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / 40_000));
  return 0.035 + (0.26 - 0.035) * t * t;
}
function bell(ctx: AudioContext, frequency: number, at: number, level: number): void {
  const out = ctx.createGain();
  gains.add(out);
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
  out.connect(ctx.destination);
  let ended = 0;
  [[1, 1], [2.756, 0.32], [5.404, 0.1]].forEach(([ratio, amplitude]) => {
    const oscillator = ctx.createOscillator();
    oscillators.add(oscillator);
    oscillator.type = "sine";
    oscillator.frequency.value = frequency * ratio;
    const partial = ctx.createGain();
    partial.gain.value = amplitude;
    oscillator.connect(partial).connect(out);
    oscillator.start(at);
    oscillator.stop(at + 2.7);
    oscillator.onended = () => {
      oscillators.delete(oscillator);
      oscillator.disconnect(); partial.disconnect();
      if (++ended === 3) { out.disconnect(); gains.delete(out); }
    };
  });
}
export async function availableSystemRestSounds(): Promise<string[]> {
  if (!isMacDesktopShell()) return [];
  try { return await invoke<string[]>("rest_system_sounds"); } catch { return []; }
}
export function stopRestAlarm(): void {
  generation += 1;
  clearInterval(alarmTimer); alarmTimer = undefined;
  clearTimeout(previewTimer); previewTimer = undefined;
  for (const gain of gains) gain.disconnect();
  gains.clear();
  for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* already ended */ } oscillator.disconnect(); }
  oscillators.clear();
  custom?.pause(); custom = null;
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = undefined;
  if (systemName) void invoke("rest_system_sound", { name: systemName, volume: 0, stop: true }).catch(() => undefined);
  systemName = undefined;
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
}
export async function startRestAlarm(preferences: RestPreferences, options: { preview?: boolean; onError?: (message: string) => void } = {}): Promise<void> {
  stopRestAlarm();
  const ticket = generation;
  const started = Date.now();
  const volume = () => (preferences.volume / 100) * (preferences.fadeIn ? alarmLevel(Date.now() - started) / 0.26 : 1);
  const ctx = audioContext();
  if (ctx?.state === "suspended") await ctx.resume().catch(() => undefined);
  if (ticket !== generation) return;
  const synth = () => {
    if (!ctx || preferences.volume === 0) return;
    const notes = preferences.sound === "warm" ? [261.63, 329.63, 392] : preferences.sound === "pulse" ? [440, 440, 554.37] : [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
    notes.forEach((note, index) => bell(ctx, note, ctx.currentTime + .05 + index * .42, .26 * volume()));
  };
  let phrase = synth;
  if (preferences.sound.startsWith("system:") && isMacDesktopShell()) {
    systemName = preferences.sound.slice(7);
    const name = systemName;
    phrase = () => { void invoke("rest_system_sound", { name, volume: volume(), stop: false }).catch(() => { options.onError?.("System tone unavailable. Playing AXOM chime."); synth(); }); };
  } else if (preferences.sound === "custom") {
    try {
      const blob = await readRestAudio();
      if (ticket !== generation) return;
      if (!blob) throw new Error("missing audio");
      customUrl = URL.createObjectURL(blob);
      custom = new Audio(customUrl);
      custom.loop = true;
      custom.volume = volume();
      await custom.play();
      if (ticket !== generation) return;
      phrase = () => { if (custom) custom.volume = volume(); };
    } catch {
      options.onError?.("Your sound could not play. Using AXOM chime; choose another WAV, M4A, or MP3.");
    }
  }
  if (ticket !== generation) return;
  phrase();
  alarmTimer = setInterval(phrase, custom ? 250 : 5200);
  if (preferences.vibration && !options.preview && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([300, 200, 300]);
  if (options.preview) previewTimer = setTimeout(stopRestAlarm, 4500);
}
