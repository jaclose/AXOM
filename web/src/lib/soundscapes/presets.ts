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
const recordings = Object.values(manifests).flatMap((module) => (Array.isArray(module.default) ? module.default : []));
import type { SynthRecipe } from "./synth";

export type SoundscapeVisual = "lattice" | "flow" | "breath" | "tide" | "grain" | "rain";

/** One way a preset can sound: a synthesized recipe or an imported recording. */
/** How a version looks: its own scene and/or a second scene blended on top. */
export interface SoundscapeLook {
  visual?: SoundscapeVisual;
  overlay?: SoundscapeVisual;
  /** 0–1 strength of the overlay (screen blend). */
  overlayMix?: number;
}

export type SoundscapeVersion =
  | ({ id: string; label: string; description: string; recipe: SynthRecipe } & SoundscapeLook)
  | ({ id: string; label: string; description: string; src: string; gain?: number; source?: string } & SoundscapeLook);
export type EvidenceLevel = "tentative" | "low" | "very-low" | "comfort";

export interface SoundscapePreset {
  id: SoundscapeId;
  name: string;
  /** Short label for the dock capsule. */
  short: string;
  band: "Gamma" | "Beta" | "Alpha" | "Delta" | "Noise" | "Nature";
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

export type SoundscapeId = "gamma-40" | "beta-20" | "alpha-10" | "delta-2" | "brown-noise" | "soft-rain";

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
    carrierHz: 200,
    beatHz: 40,
    versions: [
      { id: "clean", label: "Clean tone", description: "Just the 200 / 240 Hz pair in a small room.", recipe: { layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.32 }], reverb: { seconds: 1.2, mix: 0.15 } } },
      { id: "deep-focus", label: "Deep focus", description: "A slow analog chord pad over a low brown-noise floor.", recipe: { layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.22 }, { kind: "pad", style: "warm", rootHz: 110, level: 0.15 }, { kind: "noise", color: "brown", level: 0.16, lowpassHz: 500 }], reverb: { seconds: 3.5, mix: 0.35 } }, overlay: "breath", overlayMix: 0.35 },
      { id: "rainfall", label: "Rainfall focus", description: "Steady rain with a faint glass pad.", recipe: { trimDb: -1, layers: [{ kind: "tone", carrierHz: 200, beatHz: 40, level: 0.2 }, { kind: "rain", intensity: "steady", level: 0.7 }, { kind: "pad", style: "glass", rootHz: 220, level: 0.05 }], reverb: { seconds: 2, mix: 0.25 } }, overlay: "rain", overlayMix: 0.6 },
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
    carrierHz: 100,
    beatHz: 20,
    versions: [
      { id: "clean", label: "Clean tone", description: "The 100 / 120 Hz pair from your recording.", recipe: { trimDb: -3.8, layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.32 }], reverb: { seconds: 1, mix: 0.12 } } },
      { id: "study-room", label: "Study room", description: "A quiet library hum with a low warm pad.", recipe: { trimDb: -2.8, layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.24 }, { kind: "noise", color: "pink", level: 0.13, lowpassHz: 1800 }, { kind: "pad", style: "warm", rootHz: 98, level: 0.08 }], reverb: { seconds: 1.6, mix: 0.2 } }, overlay: "grain", overlayMix: 0.3 },
      { id: "lofi", label: "Lo-fi warmth", description: "Chords, tape hiss, dust crackle and light rain.", recipe: { layers: [{ kind: "tone", carrierHz: 100, beatHz: 20, level: 0.2 }, { kind: "pad", style: "warm", rootHz: 130.81, level: 0.16 }, { kind: "vinyl", level: 0.6 }, { kind: "rain", intensity: "light", level: 0.32 }], reverb: { seconds: 2.5, mix: 0.3 } }, visual: "grain", overlay: "rain", overlayMix: 0.45 },
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
    carrierHz: 55.5,
    beatHz: 10,
    versions: [
      { id: "clean", label: "Clean tone", description: "The 55.5 / 65.5 Hz pair from your recording.", recipe: { trimDb: -2.3, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.34 }], reverb: { seconds: 1.4, mix: 0.15 } } },
      { id: "ocean", label: "Ocean", description: "Slow surf that rises and falls about every nine seconds.", recipe: { trimDb: -2.8, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.22 }, { kind: "ocean", level: 0.8 }], reverb: { seconds: 3, mix: 0.3 } }, visual: "tide" },
      { id: "wind-chimes", label: "Wind chimes", description: "A glass pad, a light breeze and sparse chimes.", recipe: { trimDb: -0.5, layers: [{ kind: "tone", carrierHz: 55.5, beatHz: 10, level: 0.2 }, { kind: "pad", style: "glass", rootHz: 261.63, level: 0.07 }, { kind: "chimes", level: 0.35 }, { kind: "wind", level: 0.24 }], reverb: { seconds: 4, mix: 0.45 } }, overlay: "flow", overlayMix: 0.4 },
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
    carrierHz: 39,
    beatHz: 2,
    versions: [
      { id: "clean", label: "Clean tone", description: "The 39 / 41 Hz pair from your recording.", recipe: { layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.36 }], reverb: { seconds: 1.5, mix: 0.15 } } },
      { id: "night-rain", label: "Night rain", description: "Light rain on the window over a deep floor.", recipe: { layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.26 }, { kind: "rain", intensity: "light", level: 0.55, window: true }, { kind: "noise", color: "brown", level: 0.2, lowpassHz: 300 }], reverb: { seconds: 2.5, mix: 0.3 } }, overlay: "rain", overlayMix: 0.55 },
      { id: "deep-hum", label: "Deep hum", description: "A distant low choir in a large, dark room.", recipe: { trimDb: 1.4, layers: [{ kind: "tone", carrierHz: 39, beatHz: 2, level: 0.24 }, { kind: "pad", style: "choir", rootHz: 65.41, level: 0.15 }], reverb: { seconds: 6, mix: 0.5 } }, visual: "grain", overlay: "breath", overlayMix: 0.3 },
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
    versions: [
      { id: "deep", label: "Deep brown", description: "Warm, rounded low noise.", recipe: { trimDb: 2.3, layers: [{ kind: "noise", color: "brown", level: 0.62, lowpassHz: 700 }] } },
      { id: "soft-fan", label: "Soft fan", description: "Brown noise with a little airy pink on top.", recipe: { trimDb: 3.1, layers: [{ kind: "noise", color: "brown", level: 0.42 }, { kind: "noise", color: "pink", level: 0.12, lowpassHz: 1200 }] }, overlay: "flow", overlayMix: 0.3 },
      { id: "brown-rain", label: "Brown + rain", description: "A deep floor with light rain above it.", recipe: { trimDb: 3.3, layers: [{ kind: "noise", color: "brown", level: 0.45, lowpassHz: 900 }, { kind: "rain", intensity: "light", level: 0.35 }], reverb: { seconds: 1.5, mix: 0.15 } }, overlay: "rain", overlayMix: 0.5 },
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
    versions: [
      { id: "light", label: "Light rain", description: "A gentle, even shower.", recipe: { trimDb: 4, layers: [{ kind: "rain", intensity: "light", level: 0.9 }], reverb: { seconds: 1.8, mix: 0.2 } } },
      { id: "window", label: "Rain on the window", description: "Steady rain on glass, thunder far away.", recipe: { trimDb: 3.1, layers: [{ kind: "rain", intensity: "steady", level: 0.85, window: true, thunder: true }, { kind: "noise", color: "brown", level: 0.12, lowpassHz: 250 }], reverb: { seconds: 2.4, mix: 0.25 } }, overlay: "tide", overlayMix: 0.25 },
      { id: "fireplace", label: "Rain & fireplace", description: "Light rain outside, a fire crackling inside.", recipe: { trimDb: 3.8, layers: [{ kind: "rain", intensity: "light", level: 0.5 }, { kind: "fire", level: 0.8 }], reverb: { seconds: 1.5, mix: 0.2 } }, overlay: "breath", overlayMix: 0.45 },
    ],
    bestFor: ["Breaks", "Settling before sleep"],
    howTo: "Through a speaker is fine. Before bed, 20 minutes, then let it stop at lights out.",
    evidence: "comfort",
    evidenceNote: "A 2026 lab study found continuous pink noise at 50 dBA reduced REM sleep, so AXOM stops rain on a timer rather than playing all night.",
    defaultStopMinutes: 20,
    visual: "rain",
  },
};

interface RecordingEntry { preset: string; id: string; label: string; description?: string; src: string; gain?: number; source?: string }
for (const recording of recordings as RecordingEntry[]) {
  const preset = SOUNDSCAPES[recording.preset as SoundscapeId];
  if (!preset || preset.versions.some((version) => version.id === recording.id)) continue;
  preset.versions.push({ id: recording.id, label: recording.label, description: recording.description ?? "Your imported recording.", src: recording.src, gain: recording.gain, source: recording.source });
}

export function versionOf(preset: SoundscapePreset, versionId?: string): SoundscapeVersion {
  return preset.versions.find((version) => version.id === versionId) ?? preset.versions[0];
}

/** The scene for a preset's selected version (versions can re-skin or layer it). */
export function lookFor(preset: SoundscapePreset, versionId?: string): Required<Pick<SoundscapeLook, "visual">> & SoundscapeLook {
  const version = versionOf(preset, versionId);
  return { visual: version.visual ?? preset.visual, overlay: version.overlay, overlayMix: version.overlayMix ?? 0.55 };
}

export const SOUNDSCAPE_ORDER: SoundscapeId[] = ["gamma-40", "beta-20", "alpha-10", "delta-2", "brown-noise", "soft-rain"];

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
