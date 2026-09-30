import {
  CINEMATICS,
  LEGACY_INTRO_ENABLED_KEY,
  decideStartupCinematic,
  readCinematicLedger,
  readCinematicPreferences,
  writeCinematicLedger,
  type CinematicFilm,
} from "./cinematics";
import { APP_RELEASE_VERSION } from "./brand";
import { PRESENTATION_TIMING, coverForIntro, endPresentation, onAppReady, prefersReducedMotion, revealApp } from "./presentation";

/** The cinematic is decoration, never a signal that saved data is ready. */
export const STARTUP_INTRO_ENABLED_KEY = LEGACY_INTRO_ENABLED_KEY;
export const STARTUP_INTRO_SESSION_KEY = "axom.startupIntro.seen";
/** A film that ends on black starts handing over this long before its end. */
const BLACK_HANDOVER_LEAD_S = 0.42;
/** Headroom past the film's own length for decode start. */
const DEADLINE_SLACK_MS = 700;

/** Hard liveness deadline: the film, its exit, the longest wait for the app, and slack. */
export function introDeadlineMs(film: CinematicFilm): number {
  const toBlack = film.exit === "hold" ? PRESENTATION_TIMING.toBlackMs : 0;
  return film.durationMs + toBlack + PRESENTATION_TIMING.readyHoldMs + PRESENTATION_TIMING.overlayFadeMs + DEADLINE_SLACK_MS;
}

/** Hard deadline for the longest film (the first-run ident). */
export const STARTUP_INTRO_MAX_MS = introDeadlineMs(CINEMATICS.ident);

export interface StartupIntro {
  /** Always resolves, including skipped, unavailable, and disabled media. */
  finished: Promise<void>;
  /** Immediate removal for startup errors or an explicit skip. Idempotent. */
  dismiss: () => void;
  /** True when a film is actually playing (the app then reveals when it ends). */
  playing: boolean;
}

type StartupIntroOptions = {
  native?: boolean;
  appRoot?: HTMLElement | null;
  /** Preview a specific film now, ignoring the schedule (Settings → Preview). */
  preview?: { film: CinematicFilm; caption?: string };
  now?: Date;
  version?: string;
};

const reducedMotion = prefersReducedMotion;

export function startStartupIntro(options: StartupIntroOptions = {}): StartupIntro {
  const inactive = { finished: Promise.resolve(), dismiss() {}, playing: false };
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
  video.src = `${import.meta.env.BASE_URL}${film.src}`;
  video.poster = `${import.meta.env.BASE_URL}${film.poster}`;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.tabIndex = -1;
  video.setAttribute("aria-hidden", "true");

  // No on-screen buttons (JD, Ideas 3): the film is short, a click anywhere or
  // Escape skips it, and "never" lives in Settings > Appearance > Opening film.
  overlay.append(video);
  if (caption) {
    const text = document.createElement("p");
    text.className = "axom-startup-intro__caption";
    text.textContent = caption;
    overlay.append(text);
  }

  const appRoot = options.appRoot ?? document.getElementById("root");
  const wasInert = appRoot?.hasAttribute("inert") ?? false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // App can render underneath, but its inputs are unavailable until visible.
  appRoot?.setAttribute("inert", "");
  overlay.style.setProperty("--intro-to-black", `${PRESENTATION_TIMING.toBlackMs}ms`);
  overlay.style.setProperty("--intro-fade", `${PRESENTATION_TIMING.overlayFadeMs}ms`);
  document.body.append(overlay);
  coverForIntro();

  let removed = false;
  let leaving = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWaiting = () => {};
  let frame = 0;
  const deadline = setTimeout(dismiss, introDeadlineMs(film));

  function releaseInputs() {
    if (!wasInert) appRoot?.removeAttribute("inert");
  }

  /**
   * Film → black → AXOM. A lockup film first fades to the film's own black;
   * then, once the workspace has rendered (or after a short cap), the black
   * layer fades away while the shell settles in beneath it.
   */
  function leave(quick = false) {
    if (removed || leaving) return;
    leaving = true;
    cancelAnimationFrame(frame);
    overlay.classList.add("axom-startup-intro--exiting");
    let handedOver = false;
    const reveal = () => {
      if (handedOver || removed) return;
      handedOver = true;
      stopWaiting();
      clearTimeout(fadeTimer);
      const fadeMs = quick ? PRESENTATION_TIMING.quickFadeMs : PRESENTATION_TIMING.overlayFadeMs;
      overlay.style.setProperty("--intro-fade", `${fadeMs}ms`);
      overlay.classList.add("axom-startup-intro--leaving");
      releaseInputs();
      revealApp("intro");
      fadeTimer = setTimeout(dismiss, fadeMs);
    };
    // Stay on black until the workspace's first frame exists (capped), so the
    // film never hands over to a loading state, even on a skip or a media error.
    const handOver = () => {
      fadeTimer = setTimeout(reveal, PRESENTATION_TIMING.readyHoldMs);
      stopWaiting = onAppReady(reveal);
    };
    if (!quick && film.exit === "hold") {
      overlay.classList.add("axom-startup-intro--to-black");
      fadeTimer = setTimeout(handOver, PRESENTATION_TIMING.toBlackMs);
    } else {
      handOver();
    }
  }

  function dismiss() {
    if (removed) return;
    removed = true;
    clearTimeout(deadline);
    clearTimeout(fadeTimer);
    stopWaiting();
    cancelAnimationFrame(frame);
    // Removed without a hand-over (deadline, pagehide, startup error): no reveal pending.
    if (!leaving) endPresentation();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pagehide", dismiss);
    overlay.removeEventListener("click", onClick);
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", onError);
    const restoreFocus = overlay.contains(document.activeElement);
    // Release the decoder and network request; a detached autoplaying video can
    // otherwise stay alive in a long-running desktop webview.
    try { video.pause(); } catch { /* Unsupported media API. */ }
    video.removeAttribute("src");
    try { video.load(); } catch { /* Unsupported media API. */ }
    overlay.remove();
    releaseInputs();
    if (restoreFocus && previousFocus?.isConnected && !previousFocus.closest("[inert]")) {
      previousFocus.focus({ preventScroll: true });
    }
    resolveFinished();
  }

  function onEnded() {
    // The deadline remains active: neither CSS nor a media event owns liveness.
    leave();
  }

  function onError() {
    // Missing codec or file: the black layer simply fades into the app.
    leave(true);
  }

  /** A film that ends on black hands over during its final black frames. */
  function watchForBlack() {
    if (removed || leaving) return;
    const duration = Number.isFinite(video.duration) ? video.duration : film.durationMs / 1000;
    if (video.currentTime >= duration - BLACK_HANDOVER_LEAD_S) leave();
    else frame = requestAnimationFrame(watchForBlack);
  }

  function onPlaying() {
    // Reveal decoded frames, not the bright poster immediately before frame 1.
    video.classList.add("axom-startup-intro__film--playing");
    overlay.classList.add("axom-startup-intro--playing");
    if (film.exit === "black") frame = requestAnimationFrame(watchForBlack);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    leave(true);
  }

  function onClick(event: MouseEvent) {
    // Consume the launch gesture; it must not click a freshly mounted setup UI.
    event.preventDefault();
    event.stopPropagation();
    leave(true);
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pagehide", dismiss);
  overlay.addEventListener("click", onClick);
  video.addEventListener("ended", onEnded);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", onError);
  // Missing codecs, denied autoplay, and missing files hand over at once.
  try { void video.play()?.catch(onError); } catch { onError(); }
  return { finished, dismiss, playing: true };
}
