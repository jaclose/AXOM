import { STORAGE_KEYS } from "./brand";
import { paletteThemeColor, readPalettePreference } from "./palette";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export const THEME_CHANGE_EVENT = "axom:theme-change";

let volatilePreference: ThemePreference | undefined;

export interface ThemeChangeDetail {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readThemePreference(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): ThemePreference {
  if (!storage) return volatilePreference ?? "system";
  try {
    const stored = storage?.getItem(STORAGE_KEYS.themePreference);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return volatilePreference ?? "system";
  }
}

export function resolveThemePreference(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

function systemPrefersDark(targetWindow: Window | undefined): boolean {
  try {
    return targetWindow?.matchMedia?.(THEME_MEDIA_QUERY).matches ?? true;
  } catch {
    return true;
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
  prefersDark: boolean = systemPrefersDark(typeof window === "undefined" ? undefined : window),
): ResolvedTheme {
  const safePreference = isThemePreference(preference) ? preference : "system";
  const resolvedTheme = resolveThemePreference(safePreference, prefersDark);
  if (!targetDocument) return resolvedTheme;

  const root = targetDocument.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = safePreference;
  root.style.colorScheme = resolvedTheme;
  const themeColor = targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", paletteThemeColor(readPalettePreference(), resolvedTheme));
  return resolvedTheme;
}

function announceTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme, targetWindow?: Window) {
  if (!targetWindow || typeof CustomEvent === "undefined") return;
  targetWindow.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
    detail: { preference, resolvedTheme },
  }));
}

export function setThemePreference(
  preference: ThemePreference,
  options: {
    storage?: Pick<Storage, "setItem">;
    window?: Window;
    document?: Document;
  } = {},
): ResolvedTheme {
  const safePreference = isThemePreference(preference) ? preference : "system";
  const targetWindow = options.window ?? (typeof window === "undefined" ? undefined : window);
  const targetDocument = options.document ?? targetWindow?.document;
  const storage = options.storage ?? browserStorage();
  volatilePreference = safePreference;
  try {
    storage?.setItem(STORAGE_KEYS.themePreference, safePreference);
  } catch {
    // Theme still applies for this session when storage is blocked.
  }
  const resolvedTheme = applyThemePreference(safePreference, targetDocument, systemPrefersDark(targetWindow));
  announceTheme(safePreference, resolvedTheme, targetWindow);
  return resolvedTheme;
}

/**
 * Keep the resolved theme synchronized with OS and cross-tab changes. The
 * pre-paint script applies the first value; this controller owns runtime drift.
 */
export function installThemeSync(
  targetWindow: Window | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!targetWindow) return () => {};
  const media = (() => {
    try { return targetWindow.matchMedia?.(THEME_MEDIA_QUERY); } catch { return undefined; }
  })();
  const storage = (() => {
    try { return targetWindow.localStorage; } catch { return undefined; }
  })();

  const applyCurrent = (preference = readThemePreference(storage)): ResolvedTheme => (
    applyThemePreference(preference, targetWindow.document, media?.matches ?? true)
  );
  applyCurrent();

  const onMediaChange = () => {
    const preference = readThemePreference(storage);
    if (preference !== "system") return;
    const resolvedTheme = applyCurrent(preference);
    announceTheme(preference, resolvedTheme, targetWindow);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.themePreference) return;
    const preference = isThemePreference(event.newValue) ? event.newValue : "system";
    const resolvedTheme = applyCurrent(preference);
    announceTheme(preference, resolvedTheme, targetWindow);
  };

  if (media?.addEventListener) media.addEventListener("change", onMediaChange);
  else media?.addListener?.(onMediaChange);
  targetWindow.addEventListener("storage", onStorage);
  return () => {
    if (media?.removeEventListener) media.removeEventListener("change", onMediaChange);
    else media?.removeListener?.(onMediaChange);
    targetWindow.removeEventListener("storage", onStorage);
  };
}
