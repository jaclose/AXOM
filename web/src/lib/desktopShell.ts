// Desktop-shell detection. The Tauri runtime injects `window.__TAURI_INTERNALS__`
// before any app script runs, so its presence is the signal that AXOM is running
// inside the desktop app rather than a browser tab. Both checks are safe to call
// during tests, SSR, or before the DOM exists.

/** True inside the AXOM Tauri desktop app. */
export function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/** True inside the desktop app on macOS, where the menu bar timer exists. */
export function isMacDesktopShell(): boolean {
  if (!isTauriShell() || typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  const userAgent = nav.userAgent || "";
  // iOS webviews also say "like Mac OS X"; only the Mac has a menu bar.
  if (/iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(userAgent)) return false;
  return /Mac/i.test(platform) || /Mac/i.test(userAgent);
}
