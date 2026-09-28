// ===========================================================================
// Taste: what the learner told the opener they're into. One small model
// drives the "For you" row, section order, the hero default and which scene
// "Auto" shows — so picks, pins and scenes stay consistent everywhere.
// ===========================================================================
import type { SoundscapeId } from "./presets";
import type { Scene } from "./scenes";

export type SoundGenre = "frequencies" | "nature" | "water" | "noise" | "places" | "music";
export type VisualGenre = Scene["genre"] | "random";

export interface Taste {
  sounds: SoundGenre[];
  visuals: VisualGenre[];
  /** ISO time the opener was finished or skipped; absent = show the opener. */
  completedAt?: string;
}

export const EMPTY_TASTE: Taste = { sounds: [], visuals: [] };

export interface SoundGenreOption {
  id: SoundGenre;
  label: string;
  blurb: string;
  presets: SoundscapeId[];
  /** What plays while hovering (music opens Spotify instead). */
  preview?: { preset: SoundscapeId; version?: string };
  /** Tile backdrop scene id (falls back to the generative visual). */
  scene: string;
  tint: string;
}

export const SOUND_GENRES: SoundGenreOption[] = [
  { id: "frequencies", label: "Frequencies", blurb: "Gamma, beta, alpha & delta beats", presets: ["gamma-40", "beta-20", "alpha-10", "delta-2"], preview: { preset: "alpha-10" }, scene: "earth", tint: "#b48cff" },
  { id: "nature", label: "Birds & nature", blurb: "Forest mornings, dawn chorus", presets: ["forest"], preview: { preset: "forest", version: "morning" }, scene: "kelp-forest", tint: "#7ad39a" },
  { id: "water", label: "Rain & waves", blurb: "Soft rain, surf, the open sea", presets: ["soft-rain", "ocean"], preview: { preset: "ocean", version: "surf" }, scene: "open-sea", tint: "#6cc4ff" },
  { id: "noise", label: "Noise", blurb: "White, brown and a steady fan", presets: ["white-noise", "brown-noise", "fan"], preview: { preset: "brown-noise", version: "deep" }, scene: "retro-tv", tint: "#e0b36a" },
  { id: "places", label: "Places", blurb: "A café murmur, an airliner at cruise", presets: ["cafe", "airplane"], preview: { preset: "cafe", version: "quiet" }, scene: "hangar-lights", tint: "#ff9d6c" },
  { id: "music", label: "Piano & jazz", blurb: "Your chess piano playlist, study jazz", presets: [], scene: "ink-bloom", tint: "#8fd0ff" },
];

export interface VisualGenreOption {
  id: VisualGenre;
  label: string;
  blurb: string;
  /** Scenes that represent the genre best on a tall tile, in order (personal ids first; missing ones are skipped). */
  lead?: string[];
}

export const VISUAL_GENRES: VisualGenreOption[] = [
  { id: "nature", label: "Nature", blurb: "Forests, storms, living things", lead: ["pixel-coast", "campfire-watch", "kelp-forest"] },
  { id: "future", label: "Future", blurb: "Neon corridors, tunnels, light", lead: ["gotham-rooftop", "neon-corridor"] },
  { id: "space", label: "Space", blurb: "Earth, stars, the long walk", lead: ["astronaut-walk", "earth"] },
  { id: "waves", label: "Waves", blurb: "Open sea, foam, ink in water", lead: ["pink-ocean", "open-sea"] },
  { id: "fun", label: "Fun", blurb: "Skeletons, cradles, retro TVs", lead: ["onsen-shibas", "skeleton"] },
  { id: "random", label: "Random", blurb: "A different scene every time" },
];

const SOUND_IDS = new Set(SOUND_GENRES.map((genre) => genre.id));
const VISUAL_IDS = new Set(VISUAL_GENRES.map((genre) => genre.id));

export function normalizeTaste(value: unknown): Taste {
  if (!value || typeof value !== "object") return { ...EMPTY_TASTE };
  const record = value as Partial<Taste>;
  return {
    sounds: Array.isArray(record.sounds) ? [...new Set(record.sounds.filter((id): id is SoundGenre => SOUND_IDS.has(id as SoundGenre)))] : [],
    visuals: Array.isArray(record.visuals) ? [...new Set(record.visuals.filter((id): id is VisualGenre => VISUAL_IDS.has(id as VisualGenre)))] : [],
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
  };
}

/** Pinned first, then the presets of each picked genre in pick order. */
export function forYouOrder(taste: Taste, pinned: readonly SoundscapeId[]): SoundscapeId[] {
  const picked = taste.sounds.flatMap((genre) => SOUND_GENRES.find((option) => option.id === genre)?.presets ?? []);
  return [...new Set([...pinned, ...picked])];
}

/** Put anything the learner picked first, keeping the original order otherwise. */
export function preferFirst<T extends string>(order: readonly T[], preferred: readonly string[]): T[] {
  const rank = (id: T) => { const index = preferred.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return [...order].sort((a, b) => rank(a) - rank(b));
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A per-session seed so "Random" changes between sessions but not while you browse. */
let sessionSeed: string | null = null;
export function sessionRandomSeed(): string {
  sessionSeed ??= Math.random().toString(36).slice(2);
  return sessionSeed;
}

/**
 * The scene "Auto" should show for a preset: its designed scene when that
 * fits the learner's visual taste, otherwise a stable pick from the genres
 * they chose ("random" = any scene, reshuffled each session).
 */
export function sceneForTaste(presetKey: string, designed: string | undefined, visuals: readonly VisualGenre[], scenes: readonly Scene[], seed = sessionRandomSeed()): string | undefined {
  if (!visuals.length || !scenes.length) return designed;
  const random = visuals.includes("random");
  const genres = visuals.filter((genre): genre is Scene["genre"] => genre !== "random");
  const designedScene = designed ? scenes.find((scene) => scene.id === designed) : undefined;
  if (!random && designedScene && genres.includes(designedScene.genre)) return designed;
  const pool = genres.length ? scenes.filter((scene) => genres.includes(scene.genre)) : scenes;
  if (!pool.length) return designed;
  return pool[hash(`${presetKey}:${random ? seed : ""}`) % pool.length].id;
}
