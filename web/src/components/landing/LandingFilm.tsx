import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

export function LandingFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    if (scene.current) observer.observe(scene.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const sync = () => setAllowed(!reduced.matches && document.documentElement.dataset.motion !== "reduce" && !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType ?? ""));
    sync(); reduced.addEventListener("change", sync);
    const visibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => { reduced.removeEventListener("change", sync); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || !allowed || failed) return;
    if (paused || !visible || !onScreen) { element.pause(); return; }
    let active = true;
    void element.play().catch((error: unknown) => {
      // A visibility change can abort an in-flight play request. It is not a
      // user pause or an autoplay refusal and should resume when visible again.
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setPaused(true);
    });
    return () => { active = false; };
  }, [allowed, paused, visible, onScreen, failed]);
  return <>
    <div ref={scene} className="landing-film" aria-hidden="true">
      <picture><source media="(max-width: 600px)" srcSet="/landing/orbit-mobile.webp" /><img src="/landing/orbit-poster.webp" width="1920" height="1080" alt="" loading="eager" /></picture>
      {allowed && !failed && <video ref={video} className={ready ? "is-ready" : ""} muted loop playsInline preload="metadata" tabIndex={-1}
        onCanPlay={() => setReady(true)} onError={(event) => { if (event.target === event.currentTarget) { setFailed(true); setReady(false); } }}>
        <source src="/landing/orbit-720.webm" type="video/webm" media="(max-width: 800px)" />
        <source src="/landing/orbit-1080.webm" type="video/webm" />
        <source src="/landing/orbit-1080.mp4" type="video/mp4" onError={() => { setFailed(true); setReady(false); }} />
      </video>}
    </div>
    {allowed && !failed && <button className="landing-motion" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play background film" : "Pause background film"}>
      {paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? "Play motion" : "Pause motion"}</span>
    </button>}
  </>;
}
