import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../lib/motion";
import { CORONA_WAVES, SILENT, coronaShape, followTime, onsetStrength, orbPose, readBands, spectrumSpoke } from "../../lib/soundscapes/orbMotion";
import { canvasPixelRatio } from "../../lib/soundscapes/canvasQuality";
import { mixRgb, paletteFromPixels, type Rgb } from "../../lib/soundscapes/sceneColors";
import { soundscapeAnalyser } from "../../lib/soundscapes/store";

const TAU = Math.PI * 2;
const CONTOUR_POINTS = 144;
const SPOKE_COUNT = 160;
const PARTICLES = 28;
const colour = (rgb: Rgb, alpha: number) => "rgba(" + rgb.map(Math.round).join(",") + "," + Math.max(0, Math.min(1, alpha)) + ")";

/** AXOM's original mark inside a layered, audio-responsive resonance field. */
export function SoundOrb({ active, reactive = false, tint = "rgb(var(--accent-rgb))", size = 46, immersive = false }: {
  active: boolean;
  reactive?: boolean;
  tint?: string;
  size?: number;
  /** Render native fullscreen pixels up to 8K UHD; never upscale past the display. */
  immersive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stage = canvas?.parentElement;
    if (!canvas || !ctx || !stage) return;

    const mark = new Image();
    mark.decoding = "async";
    mark.src = import.meta.env.BASE_URL + "icons/axom-orb-512.png";
    const sampler = document.createElement("canvas");
    sampler.width = 32;
    sampler.height = 18;
    const sampleCtx = sampler.getContext("2d", { willReadFrequently: true });
    const posters = new Map<string, HTMLImageElement>();

    let primary: Rgb = [200, 169, 106];
    let secondary: Rgb = [236, 221, 186];
    const readTint = () => {
      canvas.style.color = tint;
      const values = getComputedStyle(canvas).color.match(/\d+(?:\.\d+)?/g);
      if (values && values.length >= 3) {
        primary = [Number(values[0]), Number(values[1]), Number(values[2])];
        secondary = mixRgb(primary, [255, 255, 255], 0.26);
      }
    };
    readTint();

    let width = 0;
    let height = 0;
    let ratio = 1;
    let cx = 0;
    let cy = 0;
    let radius = 0;
    let frame = 0;
    let visible = true;
    let lastPaint = 0;
    let lastSample = -Infinity;
    let frequency = new Uint8Array(0);
    let waveform = new Uint8Array(0);
    const waves = new Float32Array(CORONA_WAVES.length);
    const spokes = new Float32Array(SPOKE_COUNT);
    let swell = 0;
    let glow = 0;
    let onset = 0;
    let rollingLevel = 0;

    const position = (value: string, span: number) => {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? value.trim().endsWith("%") ? span * number / 100 : number : span / 2;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      ratio = canvasPixelRatio(width, height, window.devicePixelRatio || 1, immersive);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.dataset.quality = immersive ? "native" : "preview";
      const style = getComputedStyle(canvas);
      cx = position(style.getPropertyValue("--orb-x"), width);
      cy = position(style.getPropertyValue("--orb-y"), height);
      const max = Number.parseFloat(style.getPropertyValue("--orb-max"));
      const diameter = Math.min(width, height) * size / 100;
      radius = (Number.isFinite(max) && max > 0 ? Math.min(max, diameter) : diameter) / 2;
    };

    // The color follows the selected background, while the shape always follows audio.
    const sample = () => {
      let source: CanvasImageSource | null = stage.querySelector<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement>(".scene-player, .soundscape-visual");
      if (source instanceof HTMLVideoElement && source.readyState < 2) {
        const url = source.poster;
        let poster = posters.get(url);
        if (url && !poster) {
          poster = new Image();
          poster.src = url;
          posters.set(url, poster);
          poster.onload = () => { lastSample = -Infinity; paint(performance.now()); };
        }
        source = poster?.complete && poster.naturalWidth ? poster : null;
      }
      if (!source || !sampleCtx || !width || !height) return;
      try {
        sampleCtx.drawImage(source, 0, 0, 32, 18);
        const palette = paletteFromPixels(sampleCtx.getImageData(0, 0, 32, 18).data, 32, 18, { x: cx / width, y: cy / height });
        if (palette) {
          primary = mixRgb(primary, palette.primary, 0.18);
          secondary = mixRgb(secondary, palette.secondary, 0.18);
        }
      } catch {
        // Cross-origin or not-yet-ready scenes retain the AXOM palette.
      }
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
        analyser.getByteFrequencyData(frequency);
        analyser.getByteTimeDomainData(waveform);
        bands = readBands(frequency, waveform, analyser.context.sampleRate / analyser.fftSize);
      }
      const pose = orbPose(bands);
      swell = followTime(swell, pose.swell, dt, 0.10, 0.42);
      // Luminance changes only with this slow envelope; transients shape geometry.
      glow = followTime(glow, pose.glow, dt, 0.82, 1.3);
      const trigger = analyser ? onsetStrength(bands.level, rollingLevel) : 0;
      rollingLevel = followTime(rollingLevel, bands.level, dt, 0.65, 0.65);
      onset = followTime(onset, trigger, dt, 0.05, 0.34);
      const shape = coronaShape(bands);
      for (let i = 0; i < waves.length; i++) {
        waves[i] = followTime(waves[i], shape[i] * pose.ripple, dt, 0.12, 0.52);
      }
      for (let i = 0; i < spokes.length; i++) {
        const target = analyser ? spectrumSpoke(frequency, i, SPOKE_COUNT) : 0;
        spokes[i] = followTime(spokes[i], target, dt, 0.075, 0.3);
      }

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (radius < 2) return;

      const t = active && !reduced ? now / 1000 : 0;
      const r = radius * (1 + swell);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Deep atmospheric glow remains broad and slow, not a flashing audio meter.
      const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.78);
      halo.addColorStop(0, colour(primary, 0.04 + glow * 0.05));
      halo.addColorStop(0.57, colour(primary, 0.10 + glow * 0.11));
      halo.addColorStop(0.81, colour(secondary, 0.025 + glow * 0.055));
      halo.addColorStop(1, colour(secondary, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.78, 0, TAU);
      ctx.fillStyle = halo;
      ctx.fill();

      // Inclined, independently rotating elliptical paths make a volumetric field.
      for (let orbit = 0; orbit < 3; orbit++) {
        const tilt = -0.48 + orbit * 0.44 + t * (orbit % 2 ? -0.028 : 0.023);
        const a = r * (1.1 + orbit * 0.15);
        const b = a * (0.58 + orbit * 0.07);
        const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
        ctx.beginPath();
        for (let point = 0; point <= CONTOUR_POINTS; point++) {
          const angle = point / CONTOUR_POINTS * TAU;
          const x = a * Math.cos(angle), y = b * Math.sin(angle);
          const px = cx + x * cosTilt - y * sinTilt;
          const py = cy + x * sinTilt + y * cosTilt;
          if (!point) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.lineWidth = orbit === 1 ? 1.35 : 0.95;
        ctx.strokeStyle = colour(orbit === 1 ? primary : secondary, 0.18 + glow * 0.23);
        ctx.stroke();
      }

      // Spectral filaments radiate from the underlying analyser's individual bins.
      // Their length, not their brightness, follows fast transients.
      for (let i = 0; i < spokes.length; i++) {
        const angle = TAU * i / SPOKE_COUNT + t * 0.025;
        const energy = spokes[i];
        const inner = r * (1.125 + 0.015 * Math.sin(i * 1.37));
        const outer = inner + r * (0.038 + energy * 0.20 + onset * 0.06);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.lineWidth = i % 4 === 0 ? 1.4 : 0.75;
        ctx.strokeStyle = colour(i % 3 ? primary : secondary, 0.24 + glow * 0.37);
        ctx.stroke();
      }

      // Three continuous corona membranes, phase-shifted by low/mid/high energy.
      for (let contour = 0; contour < 3; contour++) {
        ctx.beginPath();
        for (let point = 0; point <= CONTOUR_POINTS; point++) {
          const angle = point / CONTOUR_POINTS * TAU;
          let bend = 0;
          for (let i = 0; i < waves.length; i++) {
            bend += waves[i] * Math.cos(CORONA_WAVES[i] * angle + i * 1.7 +
              t * (i % 2 ? -0.17 : 0.13) + contour * 0.63);
          }
          const breathing = active && !reduced && !analyser ? 0.01 * Math.sin(t * 0.67 + angle * 3 + contour) : 0;
          const cr = r * (1.02 + contour * 0.12 + bend * 0.12 + breathing);
          const px = cx + Math.cos(angle) * cr, py = cy + Math.sin(angle) * cr;
          if (!point) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.lineWidth = contour === 0 ? 1.65 : contour === 1 ? 1.25 : 0.85;
        ctx.strokeStyle = colour(contour === 1 ? secondary : primary, 0.42 + glow * (contour === 0 ? 0.33 : 0.19));
        ctx.shadowColor = colour(primary, 0.16 + glow * 0.18);
        ctx.shadowBlur = Math.min(18, r * 0.04);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Sparse travelling glints give depth without random noise or strobing.
      for (let i = 0; i < PARTICLES; i++) {
        const angle = TAU * i / PARTICLES + t * (i % 2 ? -0.065 : 0.044);
        const distance = r * (1.23 + 0.13 * Math.sin(i * 1.9 + t * 0.17));
        const x = cx + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance * 0.88;
        ctx.beginPath();
        ctx.arc(x, y, i % 5 === 0 ? 1.65 : 0.85, 0, TAU);
        ctx.fillStyle = colour(i % 3 ? secondary : primary, 0.23 + glow * 0.2);
        ctx.fill();
      }

      // Canonical brand artwork is never redrawn or distorted.
      if (mark.complete && mark.naturalWidth) {
        ctx.shadowColor = colour(primary, 0.16 + glow * 0.12);
        ctx.shadowBlur = Math.min(32, r * 0.07);
        ctx.drawImage(mark, cx - radius, cy - radius, radius * 2, radius * 2);
        ctx.shadowBlur = 0;
      }
    };

    const loop = (now: number) => {
      if (!visible || document.hidden || !active || reduced) return;
      if (now - lastPaint >= 1000 / 30) paint(now);
      frame = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden && active && !reduced) {
        lastPaint = 0;
        frame = requestAnimationFrame(loop);
      }
    };
    resize();
    paint(performance.now());
    mark.onload = () => paint(performance.now());
    restart();
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { resize(); paint(performance.now()); }) : null;
    ro?.observe(canvas);
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) restart(); else cancelAnimationFrame(frame);
      }) : null;
    io?.observe(canvas);
    const onVisibility = () => { if (document.hidden) cancelAnimationFrame(frame); else restart(); };
    const onPalette = () => { readTint(); lastSample = -Infinity; paint(performance.now()); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("axom:palette-change", onPalette);
    window.addEventListener("axom:theme-change", onPalette);
    return () => {
      cancelAnimationFrame(frame);
      mark.onload = null;
      posters.forEach((poster) => { poster.onload = null; });
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("axom:palette-change", onPalette);
      window.removeEventListener("axom:theme-change", onPalette);
    };
  }, [active, reactive, reduced, immersive, size, tint]);

  return <canvas ref={canvasRef} className="sound-orb"
    data-response={reduced ? "still" : active ? "ambient" : "idle"}
    data-quality={immersive ? "native" : "preview"} aria-hidden="true" />;
}
