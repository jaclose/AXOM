// ===========================================================================
// Scenes: looping, silent video backdrops for soundscapes. Shipped scenes
// (scenes.json — Pixabay-licensed clips) plus personal imports
// (scenes.personal.json, gitignored). Built by scripts/import-scenes.mjs.
// ===========================================================================
export interface Scene {
  id: string;
  label: string;
  mood: "calm" | "serious" | "fun";
  /** Relative to the site root (served from web/public). */
  src: string;
  poster: string;
  credit?: string;
  seconds?: number;
}

const manifests = import.meta.glob<{ default: unknown }>("../../data/scenes*.json", { eager: true });

export const SCENES: Scene[] = Object.entries(manifests)
  .filter(([path]) => !(import.meta.env.VITEST && path.includes(".personal.")))
  .flatMap(([, module]) => (Array.isArray(module.default) ? module.default : []))
  .filter((scene): scene is Scene => Boolean(scene && typeof scene.id === "string" && typeof scene.src === "string"));

const BY_ID = new Map(SCENES.map((scene) => [scene.id, scene]));

export function sceneById(id: string | undefined): Scene | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Resolve a public asset path against the app base (works under sub-paths and in the desktop app). */
export function sceneUrl(path: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
  return `${base}${path.replace(/^\//, "")}`;
}
