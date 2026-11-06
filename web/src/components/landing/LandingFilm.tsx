import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";

const ROOT = "/landing/alpha-v1";
const PORTRAIT = "(max-aspect-ratio: 1/1)";
type Connection = { saveData?: boolean; effectiveType?: string; addEventListener?: (type: string, listener: EventListener) => void; removeEventListener?: (type: string, listener: EventListener) => void };

/** Public media only. Never imports the workspace store or writes learner data. */
export function LandingFilm({ suspended = false }: { suspended?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const resumeAt = useRef(0);
  const [variant, setVariant] = useState<"web" | "mobile">("web");
  const [allowed, setAllowed] = useState(false);
  const [requested, setRequested] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const enabled = (allowed || requested) && !failed;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const portrait = window.matchMedia(PORTRAIT);
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const syncPolicy = () => {
      const permit = !reduced.matches && document.documentElement.dataset.motion !== "reduce"
        && !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType ?? "");
      setAllowed(permit);
      // A new accessibility or connection preference revokes an earlier override.
      if (!permit) setRequested(false);
    };
    const syncVariant = () => {
      if (video.current) resumeAt.current = video.current.currentTime;
      setReady(false);
      setFailed(false);
      setVariant(portrait.matches ? "mobile" : "web");
    };
    const syncVisibility = () => setVisible(document.visibilityState === "visible");
    const preference = new MutationObserver(syncPolicy);
    preference.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    syncPolicy(); syncVariant(); syncVisibility();
    reduced.addEventListener("change", syncPolicy);
    portrait.addEventListener("change", syncVariant);
    connection?.addEventListener?.("change", syncPolicy);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      preference.disconnect();
      reduced.removeEventListener("change", syncPolicy);
      portrait.removeEventListener("change", syncVariant);
      connection?.removeEventListener?.("change", syncPolicy);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    if (scene.current) observer.observe(scene.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !enabled) return;
    if (paused || suspended || !visible || !onScreen) { element.pause(); return; }
    let active = true;
    void element.play().catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setPaused(true);
    });
    return () => { active = false; element.pause(); };
  }, [enabled, paused, suspended, visible, onScreen, variant]);

  const togglePlayback = () => {
    if (failed || !enabled || paused) {
      setFailed(false);
      setRequested(true);
      setPaused(false);
    } else {
      setPaused(true);
    }
  };
  const toggleSound = () => {
    const element = video.current;
    if (!element) return;
    // Unmute inside the user's gesture. Sound never starts or resumes playback.
    element.muted = !element.muted;
    setMuted(element.muted);
  };
  const wantsPlay = !enabled || paused;
  const playbackLabel = failed ? "Retry film" : wantsPlay ? "Play background film" : "Pause background film";

  return <>
    <div ref={scene} className="landing-film" aria-hidden="true">
      <picture>
        <source media={PORTRAIT} srcSet={`${ROOT}/poster-mobile.jpg`} />
        <img src={`${ROOT}/poster.jpg`} width="1920" height="1080" alt="" loading="eager" />
      </picture>
      {enabled && <video key={variant} ref={video} src={`${ROOT}/axom-launch-${variant}.mp4`}
        className={ready ? "is-ready" : ""} muted={muted} loop playsInline preload="metadata" tabIndex={-1}
        onCanPlay={() => setReady(true)}
        onTimeUpdate={(event) => { resumeAt.current = event.currentTarget.currentTime; }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          if (Number.isFinite(element.duration) && resumeAt.current > 0) element.currentTime = Math.min(resumeAt.current, Math.max(0, element.duration - 0.1));
        }}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onError={() => { setFailed(true); setReady(false); setPaused(true); }}>
        <track kind="descriptions" src={`${ROOT}/film-description.vtt`} srcLang="en" label="English visual description" />
      </video>}
    </div>
    {failed && <p className="landing-film-notice" role="status">The film is unavailable. You can still open AXOM.</p>}
    <div className="landing-film-controls" role="group" aria-label="Film playback">
      <button type="button" onClick={togglePlayback} aria-label={playbackLabel}>
        {wantsPlay ? <Play size={ICON_SIZE.body} aria-hidden="true" /> : <Pause size={ICON_SIZE.body} aria-hidden="true" />}
        <span>{failed ? "Retry film" : wantsPlay ? "Play film" : "Pause"}</span>
      </button>
      <button type="button" onClick={toggleSound} disabled={!enabled} aria-pressed={!muted}
        aria-label={muted ? "Enable film sound" : "Mute film sound"}>
        {muted ? <VolumeX size={ICON_SIZE.body} aria-hidden="true" /> : <Volume2 size={ICON_SIZE.body} aria-hidden="true" />}
        <span>{muted ? "Sound off" : "Sound on"}</span>
      </button>
    </div>
  </>;
}
