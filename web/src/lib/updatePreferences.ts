/**
 * Device-only update preferences. Downloading in the background never
 * installs anything: applying an update always waits for an explicit click,
 * a verified workspace checkpoint, and then a restart.
 */
export interface UpdatePreferences {
  version: 1;
  /** Desktop: fetch and verify a signed update as soon as it is published. */
  autoDownload: boolean;
}

export const UPDATE_PREFS_KEY = "axom.updates.v1";
export const UPDATE_PREFS_EVENT = "axom:update-preferences";
export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = { version: 1, autoDownload: true };

export function readUpdatePreferences(): UpdatePreferences {
  try {
    const raw = JSON.parse(window.localStorage.getItem(UPDATE_PREFS_KEY) ?? "null") as Partial<UpdatePreferences> | null;
    return { version: 1, autoDownload: typeof raw?.autoDownload === "boolean" ? raw.autoDownload : DEFAULT_UPDATE_PREFERENCES.autoDownload };
  } catch {
    return DEFAULT_UPDATE_PREFERENCES;
  }
}

export function writeUpdatePreferences(patch: Partial<UpdatePreferences>): UpdatePreferences {
  const next = { ...readUpdatePreferences(), ...patch, version: 1 as const };
  try { window.localStorage.setItem(UPDATE_PREFS_KEY, JSON.stringify(next)); } catch { /* device preference only */ }
  window.dispatchEvent(new CustomEvent(UPDATE_PREFS_EVENT, { detail: next }));
  return next;
}
