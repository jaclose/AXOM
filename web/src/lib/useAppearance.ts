import { useSyncExternalStore } from "react";
import { PALETTE_CHANGE_EVENT, readPalettePreference, type PalettePreference } from "./palette";
import { MOTION_PREFERENCE_EVENT, readMotionPreference, type MotionPreference } from "./motionPreference";
import { THEME_CHANGE_EVENT, type ResolvedTheme } from "./theme";

function subscribeTo(event: string) {
  return (listener: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  };
}

const subscribePalette = subscribeTo(PALETTE_CHANGE_EVENT);
const subscribeMotion = subscribeTo(MOTION_PREFERENCE_EVENT);
const subscribeTheme = subscribeTo(THEME_CHANGE_EVENT);

// useSyncExternalStore requires a stable snapshot between changes, so the
// palette object is cached by its serialized identity.
let paletteCacheKey = "";
let paletteCache: PalettePreference = { id: "classic" };
function paletteSnapshot(): PalettePreference {
  const next = readPalettePreference();
  const key = `${next.id}|${next.customAccent ?? ""}`;
  if (key !== paletteCacheKey) {
    paletteCacheKey = key;
    paletteCache = next;
  }
  return paletteCache;
}

export function usePalettePreference(): PalettePreference {
  return useSyncExternalStore(subscribePalette, paletteSnapshot, () => ({ id: "classic" }));
}

export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(subscribeMotion, readMotionPreference, () => "system");
}

function resolvedThemeSnapshot(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The concrete light/dark theme currently painted (System already resolved). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, resolvedThemeSnapshot, () => "dark");
}
