// ===========================================================================
// Scenes: looping, silent video backdrops for soundscapes. Shipped scenes
// (scenes.json — Pixabay-licensed clips) plus personal imports
// (scenes.personal.json, gitignored). Built by scripts/import-scenes.mjs.
// ===========================================================================
export interface Scene {
  id: string;
  label: string;
  mood: "calm" | "serious" | "fun";
  genre: "nature" | "future" | "space" | "waves" | "fun" | "yours";
  /** A still image instead of a looping video (your own photos). */
  image?: boolean;
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
const SHIPPED = [...SCENES];

/** Your own backgrounds (userMedia) join the list first. Idempotent. */
export function applyUserScenes(scenes: Array<{ id: string; name: string; url: string; image: boolean }>): void {
  const own: Scene[] = scenes.map((scene) => ({ id: `user-${scene.id}`, label: scene.name, mood: "calm", genre: "yours", src: scene.url, poster: scene.image ? scene.url : "", image: scene.image }));
  SCENES.splice(0, SCENES.length, ...own, ...SHIPPED);
  BY_ID.clear();
  for (const scene of SCENES) BY_ID.set(scene.id, scene);
}

export const SCENE_GENRES: Array<{ id: Scene["genre"]; label: string }> = [
  { id: "yours", label: "Yours" },
  { id: "nature", label: "Nature" },
  { id: "waves", label: "Water & calm" },
  { id: "space", label: "Space & flight" },
  { id: "future", label: "Future" },
  { id: "fun", label: "Playful" },
];

export function sceneById(id: string | undefined): Scene | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Resolve a public asset path against the app base (works under sub-paths and in the desktop app). */
export function sceneUrl(path: string): string {
  if (/^(blob:|https?:|data:)/.test(path)) return path;
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
  return `${base}${path.replace(/^\//, "")}`;
}
