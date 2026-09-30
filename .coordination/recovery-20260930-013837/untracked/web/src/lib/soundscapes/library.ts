import { create } from "zustand";
import { isSoundscapeId } from "./presets";
import { SPOTIFY_CATALOG } from "./spotify";

export const MEDIA_LIBRARY_KEY = "axom.media-library.v1";
function validEntry(id: unknown): id is string {
  return typeof id === "string" && (isSoundscapeId(id) || SPOTIFY_CATALOG.some((entry) => entry.id === id));
}
interface LibraryPrefs { favorites: string[]; recent: string[] }
function readPrefs(): LibraryPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) ?? "null");
    return { favorites: Array.isArray(raw?.favorites) ? raw.favorites.filter(validEntry) : [], recent: Array.isArray(raw?.recent) ? raw.recent.filter(validEntry).slice(0, 16) : [] };
  } catch { return { favorites: [], recent: [] }; }
}
export const useMediaLibrary = create<LibraryPrefs & { toggleFavorite: (id: string) => void; remember: (id: string) => void }>((set, get) => {
  const save = (patch: Partial<LibraryPrefs>) => {
    set(patch);
    const { favorites, recent } = get();
    try { localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify({ favorites, recent })); } catch { /* device browsing preferences */ }
  };
  return { ...readPrefs(),
    toggleFavorite(id) { if (validEntry(id)) save({ favorites: get().favorites.includes(id) ? get().favorites.filter((entry) => entry !== id) : [...get().favorites, id] }); },
    remember(id) { if (validEntry(id)) save({ recent: [id, ...get().recent.filter((entry) => entry !== id)].slice(0, 16) }); },
  };
});
