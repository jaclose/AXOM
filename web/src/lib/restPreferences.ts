export type RestSound = "bell" | "warm" | "pulse" | "custom" | "system:Ping" | "system:Blow" | "system:Glass";
export interface RestPreferences {
  minutes: number;
  sound: RestSound;
  volume: number;
  fadeIn: boolean;
  systemNotification: boolean;
  vibration: boolean;
  soundscapeMode: "keep" | "pause" | "duck";
  customName?: string;
}
export interface RestPreset { id: string; name: string; preferences: RestPreferences }
export const REST_PREFERENCES_KEY = "axom.rest.preferences.v1";
export const DEFAULT_REST_PREFERENCES: RestPreferences = {
  minutes: 15, sound: "bell", volume: 70, fadeIn: true,
  systemNotification: true, vibration: false, soundscapeMode: "duck",
};
const SOUNDS = new Set<RestSound>(["bell", "warm", "pulse", "custom", "system:Ping", "system:Blow", "system:Glass"]);
export function normalizeRestPreferences(value: Partial<RestPreferences> = {}): RestPreferences {
  return {
    minutes: typeof value.minutes === "number" && Number.isFinite(value.minutes) ? Math.min(120, Math.max(1, Math.round(value.minutes))) : 15,
    volume: typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(100, Math.max(0, value.volume)) : 70,
    sound: SOUNDS.has(value.sound as RestSound) ? value.sound as RestSound : "bell",
    fadeIn: value.fadeIn !== false,
    systemNotification: value.systemNotification !== false,
    vibration: value.vibration === true,
    soundscapeMode: value.soundscapeMode === "pause" || value.soundscapeMode === "keep" ? value.soundscapeMode : "duck",
    customName: typeof value.customName === "string" ? value.customName.slice(0, 120) : undefined,
  };
}
export function readRestPreferences(): { preferences: RestPreferences; presets: RestPreset[] } {
  const defaults = [10, 20, 30].map((minutes) => ({ id: `default-${minutes}`, name: minutes === 10 ? "10 min reset" : minutes === 20 ? "20 min power nap" : "30 min rest", preferences: { ...DEFAULT_REST_PREFERENCES, minutes } }));
  try {
    const raw = JSON.parse(localStorage.getItem(REST_PREFERENCES_KEY) ?? "{}");
    return {
      preferences: normalizeRestPreferences(raw.preferences),
      presets: Array.isArray(raw.presets) ? raw.presets.filter((item: RestPreset) => item && typeof item.id === "string" && typeof item.name === "string" && item.preferences).slice(0, 12).map((item: RestPreset) => ({ id: item.id, name: item.name.slice(0, 60), preferences: normalizeRestPreferences(item.preferences) })) : defaults,
    };
  } catch { return { preferences: { ...DEFAULT_REST_PREFERENCES }, presets: defaults }; }
}
