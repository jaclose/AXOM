// Timer cues (JD, 2026-09-30; the Ideas 3 "Raycast" note): a small tone when a
// timer starts, an elegant soft chime and a fading green glow around the
// screen's edges when it ends. The sounds are synthesized (no audio files, no
// licensing) on one shared AudioContext. It is created inside the gesture that
// starts a timer, so the finish can sound later without another click. A device
// preference, like the opening film.

export interface TimerCuePreferences {
  /** A tone on start and a chime on finish. */
  sound: boolean;
  /** The green glow around the screen's edges when a timer ends. */
  glow: boolean;
}

export const DEFAULT_TIMER_CUES: TimerCuePreferences = { sound: true, glow: true };
export const TIMER_CUES_KEY = "axom.timerCues.v1";
export const TIMER_CUES_EVENT = "axom:timer-cue-preferences";
export const TIMER_GLOW_EVENT = "axom:timer-glow";

export type TimerKind = "focus" | "break";

export function readTimerCues(): TimerCuePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMER_CUES_KEY) ?? "null") as Partial<TimerCuePreferences> | null;
    return {
      sound: typeof raw?.sound === "boolean" ? raw.sound : DEFAULT_TIMER_CUES.sound,
      glow: typeof raw?.glow === "boolean" ? raw.glow : DEFAULT_TIMER_CUES.glow,
    };
  } catch {
    return DEFAULT_TIMER_CUES;
  }
}

export function writeTimerCues(patch: Partial<TimerCuePreferences>): TimerCuePreferences {
  const next = { ...readTimerCues(), ...patch };
  try { localStorage.setItem(TIMER_CUES_KEY, JSON.stringify(next)); } catch { /* device preference only */ }
  try { window.dispatchEvent(new CustomEvent(TIMER_CUES_EVENT, { detail: next })); } catch { /* non-DOM */ }
  return next;
}

// --- Sound -------------------------------------------------------------------

interface CueEngine { ctx: AudioContext; bus: GainNode }
let shared: CueEngine | null = null;

/** One context for every cue: a soft low-pass and a short, damped echo give the tones room without a reverb file. */
function engine(): CueEngine | null {
  if (typeof window === "undefined") return null;
  try {
    if (!shared) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const bus = ctx.createGain();
      bus.gain.value = 0.9;
      const soften = ctx.createBiquadFilter();
      soften.type = "lowpass";
      soften.frequency.value = 4200;
      const echo = ctx.createDelay(1);
      echo.delayTime.value = 0.19;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2400;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.26;
      const tail = ctx.createGain();
      tail.gain.value = 0.3;
      bus.connect(soften).connect(ctx.destination);
      soften.connect(echo).connect(damp).connect(feedback).connect(echo);
      damp.connect(tail).connect(ctx.destination);
      shared = { ctx, bus };
    }
    if (shared.ctx.state === "suspended") void shared.ctx.resume().catch(() => undefined);
    return shared;
  } catch {
    return null;
  }
}

/** A bell-like note: a sine with two quiet overtones, a quick attack and a long exponential decay. */
function note({ ctx, bus }: CueEngine, frequency: number, at: number, peak: number, decay: number) {
  const start = ctx.currentTime + at;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + decay);
  envelope.connect(bus);
  for (const [ratio, level] of [[1, 1], [2, 0.18], [3.01, 0.05]] as const) {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency * ratio;
    const partial = ctx.createGain();
    partial.gain.value = level;
    oscillator.connect(partial).connect(envelope);
    oscillator.start(start);
    oscillator.stop(start + decay + 0.05);
  }
}

/** Starting: a quiet rising fifth (D5 to A5), under half a second. */
export function playTimerStartCue({ force = false } = {}): void {
  if (!force && !readTimerCues().sound) return;
  const cue = engine();
  if (!cue) return;
  note(cue, 587.33, 0, 0.05, 0.35);
  note(cue, 880, 0.085, 0.045, 0.5);
}

/** Finishing: a soft arpeggio that rings out. Up (C5 E5 G5 C6) when focus ends, down (G5 E5 C5) when a break ends. */
export function playTimerEndCue(kind: TimerKind = "focus", { force = false } = {}): void {
  if (!force && !readTimerCues().sound) return;
  const cue = engine();
  if (!cue) return;
  const notes = kind === "focus" ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
  notes.forEach((frequency, index) => note(cue, frequency, index * 0.11, 0.06 - index * 0.006, 2.4 - index * 0.2));
}

// --- Glow --------------------------------------------------------------------

/** Lights the screen's edges (TimerEdgeGlow renders it). */
export function flashTimerGlow({ force = false } = {}): void {
  if (!force && !readTimerCues().glow) return;
  try { window.dispatchEvent(new CustomEvent(TIMER_GLOW_EVENT)); } catch { /* non-DOM */ }
}

/** A timer ran to its end on its own: chime and glow. */
export function timerFinished(kind: TimerKind): void {
  playTimerEndCue(kind);
  flashTimerGlow();
}
