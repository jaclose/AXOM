import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../lib/motion";
import { CORONA_WAVES, SILENT, coronaShape, followTime, orbPose, readBands } from "../../lib/soundscapes/orbMotion";
import { mixRgb, paletteFromPixels, type Rgb } from "../../lib/soundscapes/sceneColors";
import { soundscapeAnalyser } from "../../lib/soundscapes/store";

const TAU = Math.PI * 2;
const POINTS = 120;
const colour = (rgb: Rgb, alpha: number) => `rgba(${rgb.map(Math.round).join(",")},${alpha})`;

/** The original AXOM mark, surrounded by two smooth, sound-responsive contours. */
export function SoundOrb({ active, reactive = false, tint = "rgb(var(--accent-rgb))", size = 46 }: {
  active: boolean; reactive?: boolean; tint?: string; size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stage = canvas?.parentElement;
    if (!canvas || !ctx || !stage) return;
    const mark = new Image();
    mark.src = `${import.meta.env.BASE_URL}icons/axom-orb-512.png`;
    const sampler = document.createElement("canvas");
    sampler.width = 32; sampler.height = 18;
    const sampleCtx = sampler.getContext("2d", { willReadFrequently: true });
    const posters = new Map<string, HTMLImageElement>();
    let primary: Rgb = [200, 169, 106];
    let secondary: Rgb = [236, 221, 186];
    canvas.style.color = tint;
    const components = getComputedStyle(canvas).color.match(/\d+(?:\.\d+)?/g);
    if (components && components.length >= 3) primary = [Number(components[0]), Number(components[1]), Number(components[2])];
    secondary = mixRgb(primary, [255, 255, 255], 0.25);
    let width = 0, height = 0, ratio = 1, cx = 0, cy = 0, radius = 0;
    let frame = 0, visible = true, lastPaint = 0, lastSample = -Infinity;
    let frequency = new Uint8Array(0), waveform = new Uint8Array(0);
    const waves = new Float32Array(CORONA_WAVES.length);
    let swell = 0, glow = 0;
    const position = (value: string, span: number) => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? value.trim().endsWith("%") ? span * n / 100 : n : span / 2;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      ratio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      const style = getComputedStyle(canvas);
      cx = position(style.getPropertyValue("--orb-x"), width); cy = position(style.getPropertyValue("--orb-y"), height);
      const cap = Number.parseFloat(style.getPropertyValue("--orb-max"));
      const diameter = Math.min(width, height) * size / 100;
      radius = (Number.isFinite(cap) && cap > 0 ? Math.min(cap, diameter) : diameter) / 2;
    };
    const sample = () => {
      let source: CanvasImageSource | null = stage.querySelector<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement>(".scene-player, .soundscape-visual");
      if (source instanceof HTMLVideoElement && source.readyState < 2) {
        const url = source.poster;
        let poster = posters.get(url);
        if (url && !poster) { poster = new Image(); poster.src = url; posters.set(url, poster); poster.onload = () => { lastSample = -Infinity; paint(performance.now()); }; }
        source = poster?.complete && poster.naturalWidth ? poster : null;
      }
      if (!source || !sampleCtx || !width || !height) return;
      try {
        sampleCtx.drawImage(source, 0, 0, 32, 18);
        const palette = paletteFromPixels(sampleCtx.getImageData(0, 0, 32, 18).data, 32, 18, { x: cx / width, y: cy / height });
        if (palette) { primary = palette.primary; secondary = palette.secondary; }
      } catch { /* Scene may not have a readable frame yet. */ }
    };
    const paint = (now: number) => {
      const dt = lastPaint ? Math.min(0.1, Math.max(0, (now - lastPaint) / 1000)) : 1 / 30;
      lastPaint = now;
      if (now - lastSample >= 900) { lastSample = now; sample(); }
      const analyser = active && reactive && !reduced ? soundscapeAnalyser() : null;
      canvas.dataset.response = reduced ? "still" : !active ? "idle" : analyser ? "audio" : "ambient";
      let bands = SILENT;
      if (analyser) {
        if (frequency.length !== analyser.frequencyBinCount) frequency = new Uint8Array(analyser.frequencyBinCount);
        if (waveform.length !== analyser.fftSize) waveform = new Uint8Array(analyser.fftSize);
        analyser.getByteFrequencyData(frequency); analyser.getByteTimeDomainData(waveform);
        bands = readBands(frequency, waveform, analyser.context.sampleRate / analyser.fftSize);
      }
      const pose = orbPose(bands);
      swell = followTime(swell, pose.swell, dt, 0.09, 0.4);
      glow = followTime(glow, pose.glow, dt, 0.7, 1.1);
      const shape = coronaShape(bands);
      for (let i = 0; i < waves.length; i++) waves[i] = followTime(waves[i], shape[i] * pose.ripple, dt, 0.12, 0.5);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      if (radius < 2) return;
      const r = radius * (1 + swell);
      if (mark.complete && mark.naturalWidth) ctx.drawImage(mark, cx - radius, cy - radius, radius * 2, radius * 2);
      const time = now / 1000;
      for (let contour = 0; contour < 2; contour++) {
        ctx.beginPath();
        for (let point = 0; point <= POINTS; point++) {
          const angle = point / POINTS * TAU;
          let bend = 0;
          for (let i = 0; i < waves.length; i++) bend += waves[i] * Math.cos(CORONA_WAVES[i] * angle + i * 1.7 + (active && !reduced ? time * (i % 2 ? -0.08 : 0.1) : 0) + contour * 0.5);
          const ambient = active && !reduced && !analyser ? 0.006 * Math.sin(time * 0.5 + angle * 3 + contour) : 0;
          const cr = r * (1.06 + contour * 0.10 + bend * 0.09 + ambient);
          const x = cx + Math.cos(angle) * cr, y = cy + Math.sin(angle) * cr;
          if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.strokeStyle = colour(contour ? secondary : primary, (contour ? 0.5 : 0.8) + glow * 0.12);
        ctx.lineWidth = contour ? 1 : 1.5; ctx.stroke();
      }
    };
    const loop = (now: number) => {
      if (!visible || document.hidden || !active || reduced) return;
      if (now - lastPaint >= 1000 / 30) paint(now);
      frame = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden && active && !reduced) { lastPaint = 0; frame = requestAnimationFrame(loop); }
    };
    resize(); paint(performance.now()); mark.onload = () => paint(performance.now());
    restart();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { resize(); paint(performance.now()); }) : null;
    ro?.observe(canvas);
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) restart(); else cancelAnimationFrame(frame); }) : null;
    io?.observe(canvas);
    const onVisibility = () => { if (document.hidden) cancelAnimationFrame(frame); else restart(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelAnimationFrame(frame); mark.onload = null; posters.forEach((poster) => { poster.onload = null; }); ro?.disconnect(); io?.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [active, reactive, reduced, size, tint]);
  return <canvas ref={canvasRef} className="sound-orb" data-response={reduced ? "still" : active ? "ambient" : "idle"} aria-hidden="true" />;
}
