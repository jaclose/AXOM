import {
  CINEMATICS,
  LEGACY_INTRO_ENABLED_KEY,
  decideStartupCinematic,
  readCinematicLedger,
  readCinematicPreferences,
  writeCinematicLedger,
  writeCinematicPreferences,
  type CinematicFilm,
} from "./cinematics";
import { APP_RELEASE_VERSION } from "./brand";

/** The cinematic is decoration, never a signal that saved data is ready. */
export const STARTUP_INTRO_ENABLED_KEY = LEGACY_INTRO_ENABLED_KEY;
export const STARTUP_INTRO_SESSION_KEY = "axom.startupIntro.seen";
const EXIT_MS = 160;
/** Headroom past the film's own length for decode start and the fade. */
const DEADLINE_SLACK_MS = 700;

/** The best encoding this engine can decode: 10-bit sources first, then `src`. */
export function pickFilmSource(video: HTMLVideoElement, film: CinematicFilm): string {
  for (const source of film.sources ?? []) {
    try {
      if (video.canPlayType(source.type)) return source.src;
    } catch { /* An engine that cannot answer is treated as unsupported. */ }
  }
  return film.src;
}

export function introDeadlineMs(film: CinematicFilm): number {
  return film.durationMs + DEADLINE_SLACK_MS;
}

/** Hard deadline for the default everyday film. */
export const STARTUP_INTRO_MAX_MS = introDeadlineMs(CINEMATICS["slow-sweep"]);

export interface StartupIntro {
  /** Always resolves, including skipped, unavailable, and disabled media. */
  finished: Promise<void>;
  /** Immediate removal for startup errors or an explicit skip. Idempotent. */
  dismiss: () => void;
}

type StartupIntroOptions = {
  native?: boolean;
  appRoot?: HTMLElement | null;
  /** Preview a specific film now, ignoring the schedule (Settings → Preview). */
  preview?: { film: CinematicFilm; caption?: string };
  now?: Date;
  version?: string;
};

function reducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.motion === "reduce") return true;
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return true;
  }
}

export function startStartupIntro(options: StartupIntroOptions = {}): StartupIntro {
  const inactive = { finished: Promise.resolve(), dismiss() {} };
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) return inactive;

  const native = options.native ?? ("__TAURI_INTERNALS__" in window);
  let film: CinematicFilm;
  let caption: string | undefined;
  if (options.preview) {
    if (reducedMotion()) return inactive;
    film = options.preview.film;
    caption = options.preview.caption;
  } else {
    let playedThisTab = false;
    if (!native) {
      try { playedThisTab = window.sessionStorage.getItem(STARTUP_INTRO_SESSION_KEY) === "1"; } catch { /* blocked */ }
    }
    const { decision, nextLedger } = decideStartupCinematic({
      prefs: readCinematicPreferences(),
      ledger: readCinematicLedger(),
      version: options.version ?? APP_RELEASE_VERSION,
      now: options.now ?? new Date(),
      reducedMotion: reducedMotion(),
      playedThisTab,
    });
    // Privacy modes can deny either storage API. Decoration must still fail open.
    writeCinematicLedger(nextLedger);
    if (!decision.play) return inactive;
    if (!native) {
      try { window.sessionStorage.setItem(STARTUP_INTRO_SESSION_KEY, "1"); } catch { /* blocked */ }
    }
    film = decision.film;
    caption = decision.caption;
  }

  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const overlay = document.createElement("section");
  overlay.className = "axom-startup-intro";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", caption ? `Opening AXOM — ${caption}` : "Opening AXOM");
  overlay.setAttribute("aria-modal", "true");
  overlay.dataset.film = film.id;
  overlay.style.background = film.background;

  const video = document.createElement("video");
  video.className = "axom-startup-intro__film";
  // Respect the same relative Vite base as the app's portable web package.
  video.src = `${import.meta.env.BASE_URL}${pickFilmSource(video, film)}`;
  video.poster = `${import.meta.env.BASE_URL}${film.poster}`;
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
  overlay.append(video);
  if (caption) {
    const text = document.createElement("p");
    text.className = "axom-startup-intro__caption";
    text.textContent = caption;
    overlay.append(text);
  }
  overlay.append(controls);

  const appRoot = options.appRoot ?? document.getElementById("root");
  const wasInert = appRoot?.hasAttribute("inert") ?? false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // App can render underneath, but its inputs are unavailable until visible.
  appRoot?.setAttribute("inert", "");
  document.body.append(overlay);

  let removed = false;
  let fading = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(dismiss, introDeadlineMs(film));

  function dismiss() {
    if (removed) return;
    removed = true;
    clearTimeout(deadline);
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
    // Reveal decoded frames, not the bright poster immediately before frame 1.
    video.classList.add("axom-startup-intro__film--playing");
    overlay.classList.add("axom-startup-intro--playing");
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
    if (event.target === disable) writeCinematicPreferences({ frequency: "never" });
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
