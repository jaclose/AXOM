export type GeneratedSoundLayerType =
  | "white-noise"
  | "pink-noise"
  | "brown-noise"
  | "oscillator"
  | "binaural"
  | "environment"
  | "ambient";

export interface GeneratedSoundLayer {
  id: string;
  type: GeneratedSoundLayerType;
  label: string;
  description: string;
  gain: number;
  frequency?: number;
  leftFrequency?: number;
  rightFrequency?: number;
  mediaId?: string;
}

export const AXOM_GENERATED_SOUND_LAYERS: GeneratedSoundLayer[] = [
  { id: "white-noise", type: "white-noise", label: "White noise", description: "Broadband masking layer for open-plan distraction.", gain: 0.42 },
  { id: "pink-noise", type: "pink-noise", label: "Pink noise", description: "Balanced ambient wash with less hiss than white noise.", gain: 0.36 },
  { id: "brown-noise", type: "brown-noise", label: "Brown noise", description: "Low-frequency rumble for focused, enclosed study sessions.", gain: 0.45 },
  { id: "alpha-10hz", type: "binaural", label: "Alpha", description: "A subtle 10 Hz pair meant for calm, awake reset blocks.", gain: 0.18, leftFrequency: 55.5, rightFrequency: 65.5 },
  { id: "beta-20hz", type: "binaural", label: "Beta", description: "A light 20 Hz pair for alert review and Anki blocks.", gain: 0.16, leftFrequency: 100, rightFrequency: 120 },
  { id: "theta-7hz", type: "binaural", label: "Theta", description: "Slow drift for rest and reflective processing periods.", gain: 0.14, leftFrequency: 100, rightFrequency: 107 },
  { id: "delta-2hz", type: "binaural", label: "Delta", description: "A deep 2 Hz pair intended for wind-down and sleep rituals.", gain: 0.13, leftFrequency: 39, rightFrequency: 41 },
  { id: "gamma-40hz", type: "binaural", label: "40 Hz Gamma", description: "A focused pair used as a subtle attention cue.", gain: 0.14, leftFrequency: 200, rightFrequency: 240 },
  { id: "focus-blend", type: "ambient", label: "Focus blend", description: "A minimal stack of brown noise and a very small frequency pair.", gain: 0.5 },
  { id: "calm-reading", type: "environment", label: "Calm reading", description: "Soft noise plus light tone to reduce sharp attention spikes.", gain: 0.28 },
  { id: "wind-down", type: "ambient", label: "Wind down", description: "Low-level drift and soft texture for transitions out of work.", gain: 0.3 },
];

export function generatedLayerMap() {
  return new Map(AXOM_GENERATED_SOUND_LAYERS.map((layer) => [layer.id, layer]));
}

export function generatedLayerById(id: string): GeneratedSoundLayer | undefined {
  return generatedLayerMap().get(id);
}
