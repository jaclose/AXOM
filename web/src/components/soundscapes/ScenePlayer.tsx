import { useEffect, useRef } from "react";
import { sceneUrl, type Scene } from "../../lib/soundscapes/scenes";
import { useReducedMotion } from "../../lib/motion";

/**
 * A silent looping video backdrop. Plays only while `animate` is true and the
 * element is on screen; reduced motion shows the poster frame.
 */
export function ScenePlayer({ scene, animate, className = "" }: { scene: Scene; animate: boolean; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let visible = true;
    const sync = () => {
      if (animate && !reduced && visible && !document.hidden) void video.play().catch(() => { /* autoplay blocked: poster stays */ });
      else video.pause();
    };
    const observer = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); })
      : null;
    observer?.observe(video);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [animate, reduced, scene.src]);

  return (
    <video
      ref={videoRef}
      key={scene.src}
      className={`scene-player ${className}`}
      src={sceneUrl(scene.src)}
      poster={sceneUrl(scene.poster)}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
