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

export type SoundscapeVisual = "lattice" | "flow" | "breath" | "tide" | "grain" | "rain";
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
  /** A soft drone under the tone (the "study music" bed). */
  pad?: boolean;
  noise?: "brown" | "pink";
  rain?: boolean;
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
    pad: true,
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
    carrierHz: 40,
    beatHz: 2,
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
    noise: "brown",
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
    rain: true,
    bestFor: ["Breaks", "Settling before sleep"],
    howTo: "Through a speaker is fine. Before bed, 20 minutes, then let it stop at lights out.",
    evidence: "comfort",
    evidenceNote: "A 2026 lab study found continuous pink noise at 50 dBA reduced REM sleep, so AXOM stops rain on a timer rather than playing all night.",
    defaultStopMinutes: 20,
    visual: "rain",
  },
};

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
