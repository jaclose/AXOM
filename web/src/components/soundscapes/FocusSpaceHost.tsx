import { useEffect, useRef, useState } from "react";
import { Expand, Maximize2, Minimize2, X } from "lucide-react";
import { useFocusSpace, readFocusVideo } from "../../lib/soundscapes/focusSpaces";
import { sceneById } from "../../lib/soundscapes/scenes";
import { useReducedMotion } from "../../lib/motion";
import { ScenePlayer } from "./ScenePlayer";
import { SoundscapeVisual } from "./SoundscapeVisual";
import { SOUNDSCAPES, lookFor } from "../../lib/soundscapes/presets";

export function FocusSpaceHost() {
  const { open, selected, immersive, revision, close } = useFocusSpace();
  const scene = sceneById(selected);
  const reduced = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const shell = document.querySelector<HTMLElement>(".shell");
    const previousInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    document.body.classList.add("focus-space-active");
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) close();
    };
    window.addEventListener("keydown", escape);
    return () => {
      if (shell) shell.inert = previousInert;
      document.body.classList.remove("focus-space-active");
      window.removeEventListener("keydown", escape);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, close]);
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen(); useFocusSpace.setState({ immersive: true }); }
    } catch { setFullscreenError("Fullscreen is unavailable here. Immersive view still keeps your controls close."); }
  }
  if (!open) return null;
  const title = selected === "local" ? "Your video" : scene?.label ?? "Living light";
  return <section className={`focus-space-host ${immersive ? "immersive" : ""}`} role="region" aria-label="Active focus space">
    <div className="focus-space-visual">
      {selected === "local" ? <LocalVideo key={revision} /> : scene ? <ScenePlayer scene={scene} animate={!reduced} /> : <SoundscapeVisual {...lookFor(SOUNDSCAPES["alpha-10"])} animate={!reduced} />}
    </div>
    <header className="focus-space-hud"><div><small>FOCUS SPACE</small><h2>{title}</h2></div><div>
      <button type="button" aria-label={immersive ? "Exit immersive view" : "Enter immersive view"} onClick={() => useFocusSpace.setState({ immersive: !immersive })}>{immersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
      {document.fullscreenEnabled && <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}><Expand size={18} /></button>}
      <button ref={closeRef} type="button" aria-label="Close focus space" onClick={() => { close(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }}><X size={20} /></button>
    </div></header>
    {fullscreenError && <p className="focus-space-message" role="alert">{fullscreenError}</p>}
    <p className="focus-space-caption">Keep one thing in view.</p>
  </section>;
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
