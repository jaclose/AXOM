// Mounted once at the app root: loads your own sounds and backgrounds from
// this device and folds them into the soundscape catalog, so the dock, the
// Soundscapes page and the media keys all see the same list.
import { useEffect } from "react";
import { applyUserScenes } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia } from "../../lib/soundscapes/userMedia";
import { syncUserSoundCatalog } from "../../lib/soundscapes/userSounds";
import { watchOutputRemoval } from "../../lib/soundscapes/outputGuard";

export function UserMediaBridge() {
  const items = useUserMedia((state) => state.items);
  const urls = useUserMedia((state) => state.urls);

  useEffect(() => {
    void useUserMedia.getState().load();
  }, []);

  // Headphones out: pause, like a music app (see outputGuard for coverage).
  useEffect(() => watchOutputRemoval(() => {
    if (useSoundscape.getState().status === "playing") void useSoundscape.getState().pause();
  }), []);

  useEffect(() => {
    applyUserScenes(items.filter((item) => item.kind === "scene" && urls[item.id]).map((item) => ({ id: item.id, name: item.name, url: urls[item.id], image: item.mime.startsWith("image/") })));
    syncUserSoundCatalog();
  }, [items, urls]);

  return null;
}
