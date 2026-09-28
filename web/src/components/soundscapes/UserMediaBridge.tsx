// Mounted once at the app root: loads your own sounds and backgrounds from
// this device and folds them into the soundscape catalog, so the dock, the
// Soundscapes page and the media keys all see the same list.
import { useEffect } from "react";
import { applyUserSounds } from "../../lib/soundscapes/presets";
import { applyUserScenes } from "../../lib/soundscapes/scenes";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia } from "../../lib/soundscapes/userMedia";

export function UserMediaBridge() {
  const items = useUserMedia((state) => state.items);
  const urls = useUserMedia((state) => state.urls);

  useEffect(() => {
    void useUserMedia.getState().load();
  }, []);

  useEffect(() => {
    applyUserSounds(items.filter((item) => item.kind === "sound" && urls[item.id]).map((item) => ({ id: item.id, name: item.name, presetId: item.presetId, url: urls[item.id] })));
    applyUserScenes(items.filter((item) => item.kind === "scene" && urls[item.id]).map((item) => ({ id: item.id, name: item.name, url: urls[item.id], image: item.mime.startsWith("image/") })));
    useSoundscape.getState().bumpCatalog();
  }, [items, urls]);

  return null;
}
