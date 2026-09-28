// ===========================================================================
// Soundscapes — synthesized study audio. Every tone is generated on device
// (Web Audio), so nothing is downloaded and loops never seam. Binaural
// carriers match the recordings the learner already used (measured with an
// FFT of each file's left/right channel).
//
// Honesty rule: the evidence note travels with every preset and is shown
// wherever the preset is offered. A frequency label is never presented as a
// proven memory or sleep treatment.
// ===========================================================================

// Shared recordings (committed) plus personal imports (gitignored
// soundscape-recordings.personal.json — your own files, never published).
const manifests = import.meta.glob<{ default: unknown }>("../../data/soundscape-recordings*.json", { eager: true });
// Tests see only the committed manifest, so they never depend on this machine's files.
const recordings = Object.entries(manifests)
  .filter(([path]) => !(import.meta.env.VITEST && path.includes(".personal.")))
  .flatMap(([, module]) => (Array.isArray(module.default) ? module.default : []));
import type { SynthRecipe } from "./synth";

export type SoundscapeVisual = "lattice" | "flow" | "breath" | "tide" | "grain" | "rain";

/** One way a preset can sound: a synthesized recipe or an imported recording. */
/** How a version looks: its own scene and/or a second scene blended on top. */
export interface SoundscapeLook {
  /** A video scene (lib/soundscapes/scenes) shown instead of the generative visual. */
  scene?: string;
  visual?: SoundscapeVisual;
  overlay?: SoundscapeVisual;
  /** 0–1 strength of the overlay (screen blend). */
  overlayMix?: number;
}

export type SoundscapeVersion =
  | ({ id: string; label: string; description: string; recipe: SynthRecipe; replacedByRecording?: boolean } & SoundscapeLook)
  | ({ id: string; label: string; description: string; src: string; gain?: number; source?: string; replacedByRecording?: boolean; userFile?: boolean } & SoundscapeLook);

/** What a brainwave band is associated with, told plainly (frequency cards). */
export interface Significance {
  symbol: string;
  range: string;
  state: string;
  headline: string;
  body: string;
  /** CSS color for the card's ring and waveform. */
  tint: string;
}
export type EvidenceLevel = "tentative" | "low" | "very-low" | "comfort";

export interface SoundscapePreset {
  id: SoundscapeId;
  name: string;
  /** Short label for the dock capsule. */
  short: string;
  band: "Gamma" | "Beta" | "Alpha" | "Delta" | "Noise" | "Nature" | "Ambience" | "Music" | "Yours";
  family: "frequency" | "ambient";
  /** Default video scene when a version doesn't choose one. */
  scene?: string;
  significance?: Significance;
  /** Binaural beat: left ear carrier, right ear carrier + beat. */
  carrierHz?: number;
  beatHz?: number;
  /** Three designed versions (plus any imported recordings); the first is the default. */
  versions: SoundscapeVersion[];
  bestFor: string[];
  howTo: string;
  evidence: EvidenceLevel;
  evidenceNote: string;
  /** Stop timer suggested when the preset starts (minutes). */
  defaultStopMinutes?: number;
  visual: SoundscapeVisual;
  /** Where the carrier numbers came from. */
  source?: string;
}

export type SoundscapeId = "gamma-40" | "beta-20" | "alpha-10" | "delta-2" | "brown-noise" | "soft-rain"
  | "white-noise" | "cafe" | "fan" | "airplane" | "forest" | "ocean"
  /** Files you added that don't lead a preset (versions come from userMedia). */
  | "yours"
  /** An unlockable track (see lib/unlocks). */
  | "again";

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  tentative: "Tentative evidence",
  low: "Low evidence",
  "very-low": "Very low evidence",
  comfort: "Comfort & masking",
};

export const SOUNDSCAPES: Record<SoundscapeId, SoundscapePreset> = {
  "gamma-40": {
    id: "gamma-40",
    name: "40 Hz Gamma",
    short: "40 Hz",
    band: "Gamma",
    family: "frequency",
    scene: "cockpit",
    significance: { symbol: "γ", range: "30–100 Hz", state: "Binding & attention", headline: "The binding rhythm", body: "Gamma bursts ride on focused attention, when the brain stitches details into one picture. MIT’s 40 Hz light-and-sound work made it famous (strong in mice, early in people). For study, treat it as a focus cue for new material.", tint: "#b48cff" },
    carrierHz: 200,
    beatHz: 40,
    versions: [
      { id: "clean", replacedByRecording: true, label: "Clean tone", description: "Just the 200 / 240 Hz pair in a small room.", recipe: { trimDb: -3.5, layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.2 }], reverb: { seconds: 1.2, mix: 0.15 } } },
      { id: "deep-focus", label: "Deep focus", description: "A slow analog chord pad over a low brown-noise floor.", recipe: { trimDb: -1.5, layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.15 }, { kind: "pad", style: "warm", rootHz: 110, level: 0.15 }, { kind: "noise", color: "brown", level: 0.16, lowpassHz: 500 }], reverb: { seconds: 3.5, mix: 0.35 } }, overlay: "breath", overlayMix: 0.35, scene: "chrome-rings" },
      { id: "rainfall", label: "Rainfall focus", description: "Steady rain with a faint glass pad.", recipe: { trimDb: -2.2, layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.14 }, { kind: "rain", intensity: "steady", level: 0.7 }, { kind: "pad", style: "glass", rootHz: 220, level: 0.05 }], reverb: { seconds: 2, mix: 0.25 } }, overlay: "rain", overlayMix: 0.6 },
    ],
    bestFor: ["New lecture learning", "Untimed practice questions"],
    howTo: "Quiet volume through the whole block. For recorded lectures, use the lecturer’s audio alone.",
    evidence: "tentative",
    evidenceNote: "Some controlled studies found attention benefits under specific audio setups. Better retention of medical material has not been shown.",
    visual: "lattice",
  },
  "beta-20": {
    id: "beta-20",
    name: "20 Hz Beta",
    short: "20 Hz",
    band: "Beta",
    family: "frequency",
    scene: "heartbeat",
    significance: { symbol: "β", range: "13–30 Hz", state: "Active thinking", headline: "The working brain", body: "Beta rises with alert, analytical effort: reading, recall, problem solving. A steady 20 Hz beat is a backdrop for review and Anki, a signal to your routine that this block is for work.", tint: "#5cc8ff" },
    carrierHz: 100,
    beatHz: 20,
    versions: [
      { id: "clean", replacedByRecording: true, label: "Clean tone", description: "The 100 / 120 Hz pair from your recording.", recipe: { trimDb: -5.1, layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.22 }], reverb: { seconds: 1, mix: 0.12 } } },
      { id: "study-room", label: "Study room", description: "A quiet library hum with a low warm pad.", recipe: { trimDb: -3.1, layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.17 }, { kind: "noise", color: "pink", level: 0.13, lowpassHz: 1800 }, { kind: "pad", style: "warm", rootHz: 98, level: 0.08 }], reverb: { seconds: 1.6, mix: 0.2 } }, overlay: "grain", overlayMix: 0.3, scene: "skeleton" },
      { id: "lofi", label: "Lo-fi warmth", description: "Chords, tape hiss, dust crackle and light rain.", recipe: { trimDb: -2.1, layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.15 }, { kind: "pad", style: "warm", rootHz: 130.81, level: 0.16 }, { kind: "vinyl", level: 0.6 }, { kind: "rain", intensity: "light", level: 0.32 }], reverb: { seconds: 2.5, mix: 0.3 } }, visual: "grain", overlay: "rain", overlayMix: 0.45, scene: "retro-tv" },
    ],
    bestFor: ["Lecture review", "Anki", "Morning start"],
    howTo: "One track for the whole review block. Keep it low enough to form each answer in your head.",
    evidence: "low",
    evidenceNote: "One small (32-person) study found better word recall with 20 Hz beats. There is little basis for calling it the best Anki frequency.",
    visual: "flow",
    source: "Matches your “20 Hz · 100 Hz base” recording (100 / 120 Hz).",
  },
  "alpha-10": {
    id: "alpha-10",
    name: "10 Hz Alpha",
    short: "10 Hz",
    band: "Alpha",
    family: "frequency",
    scene: "earth",
    significance: { symbol: "α", range: "8–12 Hz", state: "Calm, awake", headline: "The resting rhythm", body: "Alpha swells when you close your eyes and settle: awake, unhurried, between efforts. It suits breaks and resets between blocks, not the hardest thinking.", tint: "#6ee7c8" },
    carrierHz: 55.5,
    beatHz: 10,
    versions: [
      { id: "clean", replacedByRecording: true, label: "Clean tone", description: "The 55.5 / 65.5 Hz pair from your recording.", recipe: { trimDb: -6.0, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.2 }], reverb: { seconds: 1.4, mix: 0.15 } } },
      { id: "ocean", label: "Ocean", description: "Slow surf that rises and falls about every nine seconds.", recipe: { trimDb: -4.4, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.13 }, { kind: "ocean", level: 0.8 }], reverb: { seconds: 3, mix: 0.3 } }, visual: "tide", scene: "kelp-forest" },
      { id: "wind-chimes", label: "Wind chimes", description: "A glass pad, a light breeze and sparse chimes.", recipe: { trimDb: -2.1, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.12 }, { kind: "pad", style: "glass", rootHz: 261.63, level: 0.07 }, { kind: "chimes", level: 0.35 }, { kind: "wind", level: 0.24 }], reverb: { seconds: 4, mix: 0.45 } }, overlay: "flow", overlayMix: 0.4 },
    ],
    bestFor: ["Rest between blocks", "Unwinding at home"],
    howTo: "About 10 minutes eyes-closed or away from screens, then move for 5 before the next block.",
    evidence: "low",
    evidenceNote: "You may find it soothing, but pleasant music or plain quiet may work just as well. A matching brain state is not guaranteed.",
    defaultStopMinutes: 15,
    visual: "breath",
    source: "Matches your 10 Hz alpha recording (55.5 / 65.5 Hz).",
  },
  "delta-2": {
    id: "delta-2",
    name: "2 Hz Delta",
    short: "2 Hz",
    band: "Delta",
    family: "frequency",
    scene: "satellite",
    significance: { symbol: "δ", range: "0.5–4 Hz", state: "Deep sleep", headline: "The slow waves of sleep", body: "Delta dominates deep non-REM sleep, when the day is consolidated and the body repairs. A 2 Hz beat is a wind-down ritual before sleep, not a switch that produces it.", tint: "#8a9cff" },
    carrierHz: 39,
    beatHz: 2,
    versions: [
      { id: "clean", replacedByRecording: true, label: "Clean tone", description: "The 39 / 41 Hz pair from your recording.", recipe: { trimDb: -5.5, layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.19 }], reverb: { seconds: 1.5, mix: 0.15 } } },
      { id: "night-rain", label: "Night rain", description: "Light rain on the window over a deep floor.", recipe: { trimDb: -3.1, layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.14 }, { kind: "rain", intensity: "light", level: 0.55, window: true }, { kind: "noise", color: "brown", level: 0.2, lowpassHz: 300 }], reverb: { seconds: 2.5, mix: 0.3 } }, overlay: "rain", overlayMix: 0.55 },
      { id: "deep-hum", label: "Deep hum", description: "A distant low choir in a large, dark room.", recipe: { trimDb: -2.6, layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.13 }, { kind: "pad", style: "choir", rootHz: 65.41, level: 0.15 }], reverb: { seconds: 6, mix: 0.5 } }, visual: "grain", overlay: "breath", overlayMix: 0.3, scene: "earth" },
    ],
    bestFor: ["Falling asleep"],
    howTo: "20–30 minutes with the stop timer, only if it feels soothing. Quiet for the rest of the night.",
    evidence: "very-low",
    evidenceNote: "Not shown to deepen sleep or strengthen overnight memory. In an insomnia trial, adding binaural beats to music did not beat music alone.",
    defaultStopMinutes: 30,
    visual: "tide",
    source: "Matches your 2 Hz delta recording (39 / 41 Hz). Needs headphones that reach low bass.",
  },
  "brown-noise": {
    id: "brown-noise",
    name: "Brown noise",
    short: "Brown",
    band: "Noise",
    family: "ambient",
    versions: [
      { id: "deep", label: "Deep brown", description: "Warm, rounded low noise.", recipe: { trimDb: -1.6, layers: [{ kind: "noise", color: "brown", level: 0.62, lowpassHz: 700 }] } },
      { id: "soft-fan", label: "Soft fan", description: "Brown noise with a little airy pink on top.", recipe: { trimDb: 1.5, layers: [{ kind: "noise", color: "brown", level: 0.42 }, { kind: "noise", color: "pink", level: 0.12, lowpassHz: 1200 }] }, overlay: "flow", overlayMix: 0.3 },
      { id: "brown-rain", label: "Brown + rain", description: "A deep floor with light rain above it.", recipe: { trimDb: 0.9, layers: [{ kind: "noise", color: "brown", level: 0.45, lowpassHz: 900 }, { kind: "rain", intensity: "light", level: 0.35 }], reverb: { seconds: 1.5, mix: 0.15 } }, overlay: "rain", overlayMix: 0.5 },
    ],
    bestFor: ["Masking a noisy room", "Deep study when silence isn’t possible"],
    howTo: "Low volume, only when conversations around you break focus. Silence stays the baseline.",
    evidence: "comfort",
    evidenceNote: "A masking and comfort option. A 2024 review found no eligible studies on brown noise specifically.",
    visual: "grain",
  },
  "soft-rain": {
    id: "soft-rain",
    name: "Soft rain",
    short: "Rain",
    band: "Nature",
    family: "ambient",
    versions: [
      { id: "light", label: "Light rain", description: "A gentle, even shower.", recipe: { trimDb: 4.1, layers: [{ kind: "rain", intensity: "light", level: 0.9 }], reverb: { seconds: 1.8, mix: 0.2 } } },
      { id: "window", label: "Rain on the window", description: "Steady rain on glass, thunder far away.", recipe: { trimDb: 1.9, layers: [{ kind: "rain", intensity: "steady", level: 0.85, window: true, thunder: true }, { kind: "noise", color: "brown", level: 0.12, lowpassHz: 250 }], reverb: { seconds: 2.4, mix: 0.25 } }, overlay: "tide", overlayMix: 0.25 },
      { id: "fireplace", label: "Rain & fireplace", description: "Light rain outside, a fire crackling inside.", recipe: { trimDb: 2.6, layers: [{ kind: "rain", intensity: "light", level: 0.5 }, { kind: "fire", level: 0.8 }], reverb: { seconds: 1.5, mix: 0.2 } }, overlay: "breath", overlayMix: 0.45 },
    ],
    bestFor: ["Breaks", "Settling before sleep"],
    howTo: "Through a speaker is fine. Before bed, 20 minutes, then let it stop at lights out.",
    evidence: "comfort",
    evidenceNote: "A 2026 lab study found continuous pink noise at 50 dBA reduced REM sleep, so AXOM stops rain on a timer rather than playing all night.",
    defaultStopMinutes: 20,
    visual: "rain",
  },
  "white-noise": {
    id: "white-noise",
    name: "White noise",
    short: "White",
    band: "Noise",
    family: "ambient",
    scene: "retro-tv",
    versions: [
      { id: "soft", label: "Soft white", description: "White noise with the harsh top rolled off.", recipe: { trimDb: 4.6, layers: [{ kind: "noise", color: "white", level: 0.3, highpassHz: 60, lowpassHz: 4800 }] } },
      { id: "pure", label: "Bright white", description: "The classic even hiss, with only the sharpest edge taken off.", recipe: { trimDb: 5.1, layers: [{ kind: "noise", color: "white", level: 0.24, highpassHz: 40, lowpassHz: 8000 }] } },
      { id: "pink", label: "Pink", description: "Balanced like rain on a roof: softer highs, fuller lows.", recipe: { trimDb: 1.3, layers: [{ kind: "noise", color: "pink", level: 0.5 }] }, visual: "grain", overlay: "rain", overlayMix: 0.25 },
    ],
    bestFor: ["Masking chatter and traffic", "Open-plan libraries"],
    howTo: "Keep it just loud enough to cover the distraction; louder only makes you tired.",
    evidence: "comfort",
    evidenceNote: "Masking helps when the noise around you is the problem. White noise has mixed results for attention and is not a memory aid.",
    visual: "grain",
  },
  cafe: {
    id: "cafe",
    name: "Café",
    short: "Café",
    band: "Ambience",
    family: "ambient",
    versions: [
      { id: "quiet", label: "Quiet café", description: "A few conversations across the room and the odd cup.", recipe: { trimDb: 8.0, layers: [{ kind: "chatter", level: 0.55, voices: 4 }], reverb: { seconds: 1.8, mix: 0.35 } } },
      { id: "busy", label: "Busy café", description: "A fuller room: more voices, more cups.", recipe: { trimDb: 8.0, layers: [{ kind: "chatter", level: 0.6, voices: 8 }], reverb: { seconds: 2.2, mix: 0.4 } } },
      { id: "rainy", label: "Rainy afternoon", description: "Soft voices inside, rain on the window.", recipe: { trimDb: 8.0, layers: [{ kind: "chatter", level: 0.45, voices: 5 }, { kind: "rain", intensity: "light", level: 0.4, window: true }], reverb: { seconds: 1.8, mix: 0.3 } }, overlay: "rain", overlayMix: 0.4 },
    ],
    bestFor: ["Writing and admin", "When silence feels too loud"],
    howTo: "Moderate ambient noise can help creative work; switch it off for dense reading.",
    evidence: "low",
    evidenceNote: "A classic 2012 study found moderate café-level noise (~70 dB) helped creative tasks; it tends to hurt careful reading and memorizing.",
    visual: "flow",
  },
  fan: {
    id: "fan",
    name: "Fan",
    short: "Fan",
    band: "Ambience",
    family: "ambient",
    scene: "chrome-spheres",
    versions: [
      { id: "low", label: "Box fan · low", description: "Soft air, a quiet motor hum.", recipe: { trimDb: 0.9, layers: [{ kind: "fan", level: 0.55, speed: "low" }] } },
      { id: "high", label: "Box fan · high", description: "More air, a brighter wash.", recipe: { trimDb: 0.8, layers: [{ kind: "fan", level: 0.55, speed: "high" }] } },
      { id: "purifier", label: "Air purifier", description: "Smooth filtered air, no hum.", recipe: { trimDb: 4.5, layers: [{ kind: "noise", color: "pink", level: 0.42, highpassHz: 180, lowpassHz: 3200 }] } },
    ],
    bestFor: ["Sleep and naps", "A steady masker without the “noise” color"],
    howTo: "Use a stop timer for sleep; steady sound all night isn’t needed.",
    evidence: "comfort",
    evidenceNote: "A comfort and masking option; steady broadband sound can mask disruptions but isn’t a sleep treatment.",
    defaultStopMinutes: 45,
    visual: "flow",
  },
  airplane: {
    id: "airplane",
    name: "Airplane cabin",
    short: "Cabin",
    band: "Ambience",
    family: "ambient",
    scene: "cockpit",
    versions: [
      { id: "cruise", label: "Cruise", description: "The low, even roar of a long-haul cabin.", recipe: { trimDb: -1.2, layers: [{ kind: "cabin", level: 0.6 }] } },
      { id: "night", label: "Night flight", description: "Darker and deeper, lights off.", recipe: { trimDb: -0.3, layers: [{ kind: "cabin", level: 0.5 }, { kind: "noise", color: "brown", level: 0.2, lowpassHz: 180 }] }, visual: "tide" },
      { id: "window", label: "Window seat", description: "Engines plus wind past the fuselage.", recipe: { trimDb: 0.0, layers: [{ kind: "cabin", level: 0.5 }, { kind: "wind", level: 0.35 }] } },
    ],
    bestFor: ["Deep study in a noisy space", "Naps"],
    howTo: "The low rumble masks voices well; keep it quiet and use headphones.",
    evidence: "comfort",
    evidenceNote: "A masking option many people find calming. There’s no evidence it improves learning itself.",
    visual: "tide",
  },
  forest: {
    id: "forest",
    name: "Forest birds",
    short: "Forest",
    band: "Nature",
    family: "ambient",
    scene: "kelp-forest",
    versions: [
      { id: "morning", label: "Morning birds", description: "A few birds calling across the trees.", recipe: { trimDb: 8.0, layers: [{ kind: "birds", level: 0.6 }], reverb: { seconds: 2.4, mix: 0.3 } } },
      { id: "dawn", label: "Dawn chorus", description: "More voices, closer together.", recipe: { trimDb: 8.0, layers: [{ kind: "birds", level: 0.55, density: "dawn" }], reverb: { seconds: 2.6, mix: 0.35 } } },
      { id: "stream", label: "Birds by a stream", description: "Birdsong over running water.", recipe: { trimDb: 6.4, layers: [{ kind: "birds", level: 0.5 }, { kind: "noise", color: "pink", level: 0.22, highpassHz: 600, lowpassHz: 5000 }, { kind: "ocean", level: 0.2 }], reverb: { seconds: 2, mix: 0.25 } } },
    ],
    bestFor: ["Breaks and walks", "Morning start"],
    howTo: "A nature break, not background for dense reading. Pair it with a few minutes away from screens.",
    evidence: "low",
    evidenceNote: "Studies of natural soundscapes report small benefits for mood and attention restoration during breaks; effects on learning are unproven.",
    visual: "breath",
  },
  ocean: {
    id: "ocean",
    name: "Ocean waves",
    short: "Ocean",
    band: "Nature",
    family: "ambient",
    versions: [
      { id: "surf", label: "Surf", description: "Waves rolling in about every nine seconds.", recipe: { trimDb: 1.5, layers: [{ kind: "ocean", level: 0.7 }], reverb: { seconds: 2.5, mix: 0.25 } } },
      { id: "shore", label: "Distant shore", description: "Softer waves with a breeze off the water.", recipe: { trimDb: 4.0, layers: [{ kind: "ocean", level: 0.5 }, { kind: "wind", level: 0.3 }], reverb: { seconds: 3, mix: 0.3 } } },
      { id: "night", label: "Night sea", description: "Low, dark swells.", recipe: { trimDb: 2.4, layers: [{ kind: "ocean", level: 0.5 }, { kind: "noise", color: "brown", level: 0.25, lowpassHz: 260 }], reverb: { seconds: 3, mix: 0.3 } }, scene: "satellite" },
    ],
    bestFor: ["Breaks", "Winding down"],
    howTo: "Slow and repetitive, which is what makes it calming; better for rests than for reading.",
    evidence: "comfort",
    evidenceNote: "A comfort sound. Natural sounds are consistently rated restorative, but they’re not a learning aid.",
    visual: "tide",
  },
  yours: {
    id: "yours",
    name: "Your sounds",
    short: "Yours",
    band: "Yours",
    family: "ambient",
    scene: "calm-water",
    versions: [],
    bestFor: ["Whatever works for you"],
    howTo: "Files you add stay on this device. Keep the volume low enough to think over.",
    evidence: "comfort",
    evidenceNote: "Your own sound. The listening log below is the honest way to see whether it helps your recall.",
    visual: "flow",
  },
  again: {
    id: "again",
    name: "Again",
    short: "Again",
    band: "Music",
    family: "ambient",
    scene: "ink-bloom",
    versions: [
      { id: "original", label: "Again", description: "Unlocked on the desk. A song from a friend of AXOM.", src: "soundscapes/unlockables/again.m4a", gain: 0.55 },
    ],
    bestFor: ["Breaks", "A reset between blocks"],
    howTo: "A song, not a masker: play it between blocks, not under dense reading.",
    evidence: "comfort",
    evidenceNote: "Music with lyrics tends to compete with reading and memorizing, so it’s here for breaks and resets.",
    visual: "flow",
  },
};

interface RecordingEntry { preset: string; id: string; label: string; description?: string; src: string; gain?: number; source?: string; scene?: string }
// Your own recordings lead their preset (in manifest order); where one exists,
// the designed "clean tone" it replaces steps aside: yours plus two others.
const leading = new Map<SoundscapeId, SoundscapeVersion[]>();
for (const recording of recordings as RecordingEntry[]) {
  const preset = SOUNDSCAPES[recording.preset as SoundscapeId];
  if (!preset || preset.versions.some((version) => version.id === recording.id)) continue;
  const list = leading.get(preset.id) ?? [];
  list.push({ id: recording.id, label: recording.label, description: recording.description ?? "Your imported recording.", src: recording.src, gain: recording.gain, source: recording.source, scene: recording.scene });
  leading.set(preset.id, list);
}
for (const [id, list] of leading) {
  const preset = SOUNDSCAPES[id];
  preset.versions = [...list, ...preset.versions.filter((version) => !version.replacedByRecording)];
}

/** Versions before any of your own files were added (restored when files are removed). */
const BASE_VERSIONS = new Map<SoundscapeId, SoundscapeVersion[]>(
  (Object.keys(SOUNDSCAPES) as SoundscapeId[]).map((id) => [id, SOUNDSCAPES[id].versions]),
);

export interface UserSoundVersionInput { id: string; name: string; presetId?: string; url: string }

/**
 * Put your own files in front of the preset they belong to (or on the
 * "Your sounds" shelf). Idempotent: always rebuilds from the base versions.
 */
export function applyUserSounds(sounds: UserSoundVersionInput[]): void {
  for (const id of Object.keys(SOUNDSCAPES) as SoundscapeId[]) {
    const own: SoundscapeVersion[] = sounds
      .filter((sound) => (isSoundscapeId(sound.presetId) && sound.presetId !== "again" ? sound.presetId : "yours") === id)
      .map((sound) => ({ id: `user-${sound.id}`, label: sound.name, description: "Your file, stored on this device.", src: sound.url, gain: 1, userFile: true }));
    SOUNDSCAPES[id].versions = [...own, ...(BASE_VERSIONS.get(id) ?? [])];
  }
}

/** Presets with nothing to play (an empty "Your sounds") are hidden and never started. */
export function isPlayable(id: SoundscapeId): boolean {
  return SOUNDSCAPES[id].versions.length > 0;
}

export function versionOf(preset: SoundscapePreset, versionId?: string): SoundscapeVersion {
  return preset.versions.find((version) => version.id === versionId) ?? preset.versions[0];
}

/** The scene for a preset's selected version (versions can re-skin or layer it). */
export function lookFor(preset: SoundscapePreset, versionId?: string): Required<Pick<SoundscapeLook, "visual">> & SoundscapeLook {
  const version = versionOf(preset, versionId);
  // A version that designs its own generative look opts out of the preset's default scene.
  const ownLook = Boolean(version.visual || version.overlay);
  return { visual: version.visual ?? preset.visual, overlay: version.overlay, overlayMix: version.overlayMix ?? 0.55, scene: version.scene ?? (ownLook ? undefined : preset.scene) };
}

export const FREQUENCY_ORDER: SoundscapeId[] = ["gamma-40", "beta-20", "alpha-10", "delta-2"];
export const AMBIENT_ORDER: SoundscapeId[] = ["white-noise", "brown-noise", "fan", "soft-rain", "ocean", "forest", "cafe", "airplane"];
export const SOUNDSCAPE_ORDER: SoundscapeId[] = [...FREQUENCY_ORDER, ...AMBIENT_ORDER];

export function isSoundscapeId(value: unknown): value is SoundscapeId {
  return typeof value === "string" && value in SOUNDSCAPES;
}

export interface RegimenStep {
  activity: string;
  /** null = silence is the recommendation. */
  presetId: SoundscapeId | null;
  optional?: SoundscapeId;
  note: string;
}

/**
 * The learner's own starting rotation for 90-minute blocks (from their
 * research, Sep 2026). A starting experiment, not a prescription — the
 * listening log below is how they judge it.
 */
export const LISTENING_REGIMEN: RegimenStep[] = [
  { activity: "New lecture learning", presetId: "gamma-40", note: "Quiet volume through the 90-minute block." },
  { activity: "Lecture review", presetId: "beta-20", note: "Keep one track for the whole block — don’t switch midway." },
  { activity: "Anki", presetId: "beta-20", note: "Low enough that you can form each answer before flipping." },
  { activity: "Practice questions", presetId: null, optional: "gamma-40", note: "Silence for exam-style blocks. 40 Hz is optional for untimed practice." },
  { activity: "Rest between blocks", presetId: "alpha-10", note: "10 minutes eyes-closed, then 5 minutes moving." },
  { activity: "Morning start", presetId: "beta-20", note: "10–15 minutes while getting ready." },
  { activity: "Unwinding at home", presetId: "alpha-10", note: "20–30 minutes, not continuous." },
  { activity: "Falling asleep", presetId: "delta-2", note: "20–30 minutes on the stop timer, then quiet overnight." },
];

/** What the research supports regardless of preset. */
export const LISTENING_PRINCIPLES = [
  "Judge a track by next-day recall and question accuracy, not by how focused it feels.",
  "Keep volume low and avoid lyrics while reading or memorizing.",
  "Binaural beats need stereo headphones; speakers mode uses audible (monaural) beats instead.",
  "No frequency is established as best for a task; longer or louder is not better.",
];
