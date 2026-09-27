/** The cinematic is decoration, never a signal that saved data is ready. */
export const STARTUP_INTRO_ENABLED_KEY = "axom.startupIntro.enabled";
export const STARTUP_INTRO_SESSION_KEY = "axom.startupIntro.seen";
/** The ident runs 7.0 s and ends on 0.5 s of the overlay's own #0d0d0e. */
export const STARTUP_INTRO_FILM_MS = 7_000;
/** A film that has not started by now (slow network, stalled decoder) is skipped. */
export const STARTUP_INTRO_START_MS = 1_500;
/** Absolute cap from mount: a film that starts at the last moment still finishes. */
export const STARTUP_INTRO_MAX_MS = STARTUP_INTRO_START_MS + STARTUP_INTRO_FILM_MS + 500;
const EXIT_MS = 160;

/**
 * 10-bit cuts keep the film's near-black gradients free of banding; 8-bit
 * H.264 is the universal fallback. Codec strings match the published files.
 */
const STARTUP_FILMS = [
  { path: "startup/axom-ident-hevc10.mp4", type: 'video/mp4; codecs="hvc1.2.4.L120.90"' },
  { path: "startup/axom-ident-vp9.webm", type: 'video/webm; codecs="vp09.02.40.10"' },
] as const;
const FALLBACK_FILM = "startup/axom-ident.mp4";

export function pickStartupFilm(video: HTMLVideoElement): string {
  for (const film of STARTUP_FILMS) {
    try {
      if (video.canPlayType(film.type)) return film.path;
    } catch { /* An engine that cannot answer is treated as unsupported. */ }
  }
  return FALLBACK_FILM;
}

export interface StartupIntro {
  /** Always resolves, including skipped, unavailable, and disabled media. */
  finished: Promise<void>;
  /** Immediate removal for startup errors or an explicit skip. Idempotent. */
  dismiss: () => void;
}

type StartupIntroOptions = {
  native?: boolean;
  appRoot?: HTMLElement | null;
};

export function startStartupIntro(options: StartupIntroOptions = {}): StartupIntro {
  const inactive = { finished: Promise.resolve(), dismiss() {} };
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) return inactive;

  // Privacy modes can deny either storage API. Decoration must still fail open.
  try {
    if (window.localStorage.getItem(STARTUP_INTRO_ENABLED_KEY) === "false") return inactive;
  } catch { /* Preference unavailable; continue without writing workspace data. */ }
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return inactive;
  } catch { return inactive; }

  const native = options.native ?? ("__TAURI_INTERNALS__" in window);
  if (!native) {
    try {
      if (window.sessionStorage.getItem(STARTUP_INTRO_SESSION_KEY) === "1") return inactive;
      window.sessionStorage.setItem(STARTUP_INTRO_SESSION_KEY, "1");
    } catch { /* A blocked session store must not prevent opening the app. */ }
  }

  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const overlay = document.createElement("section");
  overlay.className = "axom-startup-intro";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Opening AXOM");
  overlay.setAttribute("aria-modal", "true");

  const video = document.createElement("video");
  video.className = "axom-startup-intro__film";
  // Respect the same relative Vite base as the app's portable web package.
  video.src = `${import.meta.env.BASE_URL}${pickStartupFilm(video)}`;
  video.poster = `${import.meta.env.BASE_URL}startup/axom-ident-poster.png`;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.tabIndex = -1;
  video.setAttribute("aria-hidden", "true");

  const controls = document.createElement("div");
  controls.className = "axom-startup-intro__controls";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Skip intro";
  const disable = document.createElement("button");
  disable.type = "button";
  disable.textContent = "Don’t show again";
  controls.append(skip, disable);
  overlay.append(video, controls);

  const appRoot = options.appRoot ?? document.getElementById("root");
  const wasInert = appRoot?.hasAttribute("inert") ?? false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // App can render underneath, but its inputs are unavailable until visible.
  appRoot?.setAttribute("inert", "");
  document.body.append(overlay);

  let removed = false;
  let fading = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(dismiss, STARTUP_INTRO_MAX_MS);
  let startDeadline: ReturnType<typeof setTimeout> | undefined = setTimeout(dismiss, STARTUP_INTRO_START_MS);

  function dismiss() {
    if (removed) return;
    removed = true;
    clearTimeout(deadline);
    clearTimeout(startDeadline);
    clearTimeout(fadeTimer);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pagehide", dismiss);
    overlay.removeEventListener("click", onClick);
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", dismiss);
    const restoreFocus = overlay.contains(document.activeElement);
    // Release the decoder and network request; a detached autoplaying video can
    // otherwise stay alive in a long-running desktop webview.
    try { video.pause(); } catch { /* Unsupported media API. */ }
    video.removeAttribute("src");
    try { video.load(); } catch { /* Unsupported media API. */ }
    overlay.remove();
    if (!wasInert) appRoot?.removeAttribute("inert");
    if (restoreFocus && previousFocus?.isConnected && !previousFocus.closest("[inert]")) {
      previousFocus.focus({ preventScroll: true });
    }
    resolveFinished();
  }

  function onEnded() {
    if (removed || fading) return;
    fading = true;
    overlay.classList.add("axom-startup-intro--leaving");
    // The deadline remains active: neither CSS nor a media event owns liveness.
    fadeTimer = setTimeout(dismiss, EXIT_MS);
  }

  function onPlaying() {
    // Reveal decoded frames, not the poster immediately before frame 1.
    video.classList.add("axom-startup-intro__film--playing");
    // Once frames flow, only the absolute cap applies.
    clearTimeout(startDeadline);
    startDeadline = undefined;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismiss();
  }

  function onClick(event: MouseEvent) {
    // Consume the launch gesture; it must not click a freshly mounted setup UI.
    event.preventDefault();
    event.stopPropagation();
    if (event.target === disable) {
      try { window.localStorage.setItem(STARTUP_INTRO_ENABLED_KEY, "false"); } catch { /* Still skip now. */ }
    }
    dismiss();
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pagehide", dismiss);
  overlay.addEventListener("click", onClick);
  video.addEventListener("ended", onEnded);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", dismiss);
  // Missing codecs, denied autoplay, and missing files all dismiss immediately.
  try { void video.play()?.catch(dismiss); } catch { dismiss(); }
  return { finished, dismiss };
}
