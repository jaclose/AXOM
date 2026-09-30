import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronLeft, ChevronRight, Expand, Maximize2, Minimize2, RotateCcw, Square, X } from "lucide-react";
import { useFocusSpace, readFocusVideo } from "../../lib/soundscapes/focusSpaces";
import { EXPERIENCE_ALLOW, EXPERIENCE_SANDBOX, experienceById, type Experience } from "../../lib/soundscapes/experiences";
import { sceneById } from "../../lib/soundscapes/scenes";
import { useReducedMotion } from "../../lib/motion";
import { ScenePlayer } from "./ScenePlayer";
import { SoundscapeVisual } from "./SoundscapeVisual";
import { SOUNDSCAPES, lookFor } from "../../lib/soundscapes/presets";
import "../../styles/experiences.css";

/** One shell-owned surface. Size changes preserve the active document. */
export function FocusSpaceHost() {
  const { open, selected, immersive, compact, revision, close } = useFocusSpace();
  const scene = sceneById(selected);
  const experience = experienceById(selected);
  const reduced = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) close(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); if (previous?.isConnected) previous.focus(); };
  }, [open, close]);
  useEffect(() => {
    if (!open || compact) return;
    const shell = document.querySelector<HTMLElement>(".shell");
    const previousInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    document.body.classList.add("focus-space-active");
    return () => { if (shell) shell.inert = previousInert; document.body.classList.remove("focus-space-active"); };
  }, [open, compact]);
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen(); useFocusSpace.setState({ immersive: true, compact: false }); }
    } catch { setFullscreenError("Fullscreen is unavailable here. You can still expand the experience."); }
  }
  const end = () => { close(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  if (!open) return null;
  const title = experience?.title ?? (selected === "local" ? "Your video" : scene?.label ?? "Living light");
  return createPortal(<section className={`focus-space-host ${experience ? "experience-host" : ""} ${immersive ? "immersive" : ""} ${compact ? "compact" : ""}`} role="region" aria-label="Active focus space">
    <div className="focus-space-visual">
      {experience ? <ExperienceFrame key={experience.id} experience={experience} compact={compact} /> : selected === "local" ? <LocalVideo key={revision} /> : scene ? <ScenePlayer scene={scene} animate={!reduced} /> : <SoundscapeVisual {...lookFor(SOUNDSCAPES["alpha-10"])} animate={!reduced} />}
    </div>
    <header className="focus-space-hud"><div><small>{experience ? experience.category : "FOCUS SPACE"}</small><h2>{title}</h2></div><div>
      {experience && <><button type="button" aria-label="Previous experience" onClick={() => useFocusSpace.getState().next(-1)}><ChevronLeft size={18} /></button><button type="button" aria-label="Next experience" onClick={() => useFocusSpace.getState().next()}><ChevronRight size={18} /></button></>}
      <button type="button" aria-label={compact ? "Expand experience" : immersive ? "Exit immersive view" : "Enter immersive view"} onClick={() => useFocusSpace.setState(compact ? { compact: false } : { immersive: !immersive })}>{immersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
      {document.fullscreenEnabled && <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}><Expand size={18} /></button>}
      <button ref={closeRef} type="button" aria-label="Close focus space" onClick={end}><X size={20} /></button>
    </div></header>
    {fullscreenError && <p className="focus-space-message" role="alert">{fullscreenError}</p>}
    {!experience && <p className="focus-space-caption">Keep one thing in view.</p>}
  </section>, document.body);
}

function ExperienceFrame({ experience, compact }: { experience: Experience; compact: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "slow">("loading");
  useEffect(() => {
    if (stopped) return;
    const timeout = window.setTimeout(() => setStatus((current) => current === "loading" ? "slow" : current), 18_000);
    return () => clearTimeout(timeout);
  }, [attempt, stopped]);
  const restart = () => { setStatus("loading"); setStopped(false); setAttempt((value) => value + 1); };
  return <>
    {!stopped && <iframe key={attempt} title={experience.title} src={experience.url} sandbox={EXPERIENCE_SANDBOX} allow={EXPERIENCE_ALLOW} referrerPolicy="no-referrer" onLoad={() => setStatus("loaded")} onError={() => setStatus("slow")} />}
    {compact && !stopped && <button type="button" className="experience-preview-expand" aria-label={`Expand ${experience.title}`} onClick={() => useFocusSpace.setState({ compact: false })}><Expand size={24} /><span>Expand to explore</span></button>}
    {stopped ? <div className="experience-loading" role="status"><p>Experience stopped.</p><small>Starting again opens a fresh view.</small><button type="button" className="gbtn" onClick={restart}>Start again</button></div> : status !== "loaded" && <div className="experience-loading" role="status"><p>{status === "slow" ? "This site is taking a while." : `Opening ${experience.title}…`}</p>{status === "slow" && <><button type="button" className="gbtn" onClick={restart}>Try again</button><a href={experience.url} target="_blank" rel="noopener noreferrer">Open website <ArrowUpRight size={14} /></a></>}</div>}
    <footer className="experience-toolbar"><div className="experience-credit"><a href={experience.url} target="_blank" rel="noopener noreferrer">{experience.author} <ArrowUpRight size={12} /></a><span>{experience.instructions}</span></div><div className="experience-tools"><a href={experience.source} target="_blank" rel="noopener noreferrer" title={experience.license}>Source</a><button type="button" onClick={restart} aria-label="Reload experience" title="Reload if the site is not appearing"><RotateCcw size={15} /></button><button type="button" onClick={() => setStopped(true)} disabled={stopped} aria-label="Stop experience"><Square size={15} /></button></div></footer>
  </>;
}

function LocalVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [video, setVideo] = useState<{ url: string; name: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let url: string | undefined;
    void readFocusVideo().then((stored) => {
      if (disposed) return;
      if (!stored) { setError("Import a video from Focus Spaces to save it on this device."); return; }
      url = URL.createObjectURL(stored.blob);
      setVideo({ url, name: stored.name });
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "The video could not be opened."); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, []);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const sync = () => {
      if (document.hidden || reduced) element.pause();
      else void element.play().catch(() => setError("Playback is paused. Use the video controls to start it."));
    };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { element.pause(); document.removeEventListener("visibilitychange", sync); };
  }, [video, reduced]);
  return <>{video && <video ref={videoRef} src={video.url} muted loop playsInline controls preload="metadata" aria-label={video.name} onError={() => setError("This browser cannot play the saved video. Try an H.264 MP4.")} />}
    {!video && !error && <p className="focus-space-message" role="status">Opening your video…</p>}
    {error && <p className="focus-space-message" role="status">{error}</p>}</>;
}
