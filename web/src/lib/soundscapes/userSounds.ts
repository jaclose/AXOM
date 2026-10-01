// What you can do with one of your own sounds once it is on this device:
// rename it, or say what it plays for. Each action changes the file's
// details, the preset catalog and the player in ONE tick, so the interface
// never renders a half-moved file (for instance a "Your sounds" shelf that is
// still selected but already empty).
import { SOUNDSCAPES, applyUserSounds, isSoundscapeId, type SoundscapeId } from "./presets";
import { useSoundscape } from "./store";
import { useUserMedia, type UserMediaMeta } from "./userMedia";

export const userVersionId = (id: string) => `user-${id}`;

/** The preset a file plays for; anything unknown sits on the "Your sounds" shelf. */
export function homeOf(item: Pick<UserMediaMeta, "presetId">): SoundscapeId {
  return isSoundscapeId(item.presetId) && item.presetId !== "again" ? item.presetId : "yours";
}

/** Fold your sounds into the preset catalog and let every list re-render. */
export function syncUserSoundCatalog(): void {
  const { items, urls, loaded } = useUserMedia.getState();
  applyUserSounds(items
    .filter((item) => item.kind === "sound" && urls[item.id])
    .map((item) => ({ id: item.id, name: item.name, presetId: item.presetId, url: urls[item.id] })));
  const player = useSoundscape.getState();
  // Before your files have loaded, an empty shelf says nothing about what exists.
  if (loaded) player.settleCatalog();
  player.bumpCatalog();
}

export function renameUserSound(id: string, name: string): void {
  useUserMedia.getState().update(id, { name });
  syncUserSoundCatalog();
  useSoundscape.getState().refreshNowPlaying();
}

/**
 * Make a file play for a preset (or put it back on its own shelf). From then
 * on it is that preset's pick: in the dock, your rotation and Pomodoro follow.
 * Returns the names for a confirmation, or null when nothing changed.
 */
export function assignUserSound(id: string, to: SoundscapeId): { sound: string; preset: string } | null {
  const item = useUserMedia.getState().items.find((entry) => entry.id === id);
  if (!item) return null;
  const from = homeOf(item);
  if (from === to) return null;
  useUserMedia.getState().update(id, { presetId: to });
  // Catalog first, then the player: it follows the file to its new home
  // before anything looks at the shelf the file just left.
  const { items, urls } = useUserMedia.getState();
  applyUserSounds(items
    .filter((entry) => entry.kind === "sound" && urls[entry.id])
    .map((entry) => ({ id: entry.id, name: entry.name, presetId: entry.presetId, url: urls[entry.id] })));
  useSoundscape.getState().moveVersion(from, to, userVersionId(id));
  syncUserSoundCatalog();
  return { sound: item.name, preset: SOUNDSCAPES[to].name };
}
